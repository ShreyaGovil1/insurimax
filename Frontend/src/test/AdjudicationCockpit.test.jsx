import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AdjudicationCockpit } from "../components/adjudication/AdjudicationCockpit"
import { ToastProvider } from "../components/ui/toast"
import { AuthProvider } from "../context/AuthContext"
import { api } from "../services/api"

const mockClaim = {
  id: "88888888-8888-8888-8888-888888888881",
  claim_number: "CLM-2026-8821",
  patient_name: "Ramesh Chawla",
  hospital_name: "Apollo Hospital, Bannerghatta",
  insurer_name: "Star Health & Allied Insurance",
  policy_number: "SH-GOLD-99201",
  billed_amount: 285400.0,
  approved_amount: 246900.0,
  deducted_amount: 38500.0,
  status: "in_review",
  ai_confidence_score: 0.94,
  sla_deadline: "2026-09-28T02:00:00Z",
  sla_breached: false,
}

const mockAdjudication = {
  id: "adj-1",
  claim_id: "88888888-8888-8888-8888-888888888881",
  status: "completed",
  total_billed_inr: 285400.0,
  total_approved_inr: 246900.0,
  total_deducted_inr: 38500.0,
  deduction_breakdown: {
    room_rent_excess: 21000.0,
    non_payables: 8400.0,
    unbundled_consumables: 9100.0,
  },
  confidence_score: 0.94,
  flagged_items_count: 3,
  line_items: [
    {
      id: "li-1",
      line_number: 1,
      item_name: "Laparoscopic Cholecystectomy Surgeon Fee",
      item_category: "surgeon_fee",
      billed_amount_inr: 95000.0,
      approved_amount_inr: 95000.0,
      deducted_amount_inr: 0.0,
      ai_status: "approved",
      final_status: "approved",
      ai_explanation: "Procedure verified with OT register. Surgeon credentials verified on MCI registry.",
      citation_data: { clause_reference: "Clause 2.1 (Surgical Packages)" },
      is_overridden: false,
    },
  ],
}

const mockExplanation = {
  item_id: "li-1",
  item_name: "Laparoscopic Cholecystectomy Surgeon Fee",
  ai_explanation: "Procedure verified with OT register. Surgeon credentials verified on MCI registry.",
  clause_reference: "Clause 2.1 (Surgical Packages)",
  clause_page: 8,
  billed_amount_inr: 95000.0,
  approved_amount_inr: 95000.0,
  deducted_amount_inr: 0.0,
  final_status: "approved",
  citation_data: { clause_reference: "Clause 2.1 (Surgical Packages)" },
}

describe("AdjudicationCockpit Component", () => {
  beforeEach(() => {
    vi.spyOn(api.claims, "getById").mockResolvedValue(mockClaim)
    vi.spyOn(api.adjudication, "get").mockResolvedValue(mockAdjudication)
    vi.spyOn(api.adjudication, "getExplanation").mockResolvedValue(mockExplanation)
    vi.spyOn(api.documents, "list").mockResolvedValue([])
    vi.spyOn(api.queries, "list").mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders financial summary bar with billed, approved, and deductions", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <AdjudicationCockpit claimId="88888888-8888-8888-8888-888888888881" onBack={() => {}} />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    )

    // Wait for claim data to load
    const amounts = await screen.findByRole("region", { name: "Claim amounts" })
    expect(within(amounts).getByText("Total billed")).toBeInTheDocument()
    expect(within(amounts).getByText("Approved")).toBeInTheDocument()
    expect(within(amounts).getByText("Deducted")).toBeInTheDocument()
    expect(within(amounts).getByText("AI confidence")).toBeInTheDocument()
    expect(within(amounts).getByText("₹2,85,400")).toBeInTheDocument()
    expect(within(amounts).getByText("₹2,46,900")).toBeInTheDocument()
    expect(within(amounts).getByText("₹38,500")).toBeInTheDocument()

    // Verify claim and line items render
    expect(screen.getByText(/CLM-2026-8821/i)).toBeInTheDocument()
    expect(screen.getByText(/Ramesh Chawla/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Laparoscopic Cholecystectomy Surgeon Fee/i).length).toBeGreaterThan(0)
  })

  it("lets the adjuster lock and finalize despite an identity mismatch", async () => {
    const adjuster = { id: "u-1", role: "adjuster", full_name: "Test Adjuster", email: "adjuster@example.com" }
    localStorage.setItem("dp_access_token", "test-token")
    localStorage.setItem("dp_user", JSON.stringify(adjuster))
    vi.spyOn(api.auth, "getMe").mockResolvedValue(adjuster)
    vi.spyOn(api.adjudication, "get").mockResolvedValue({
      ...mockAdjudication,
      gemini_raw_response: {
        flags: ["CRITICAL IDENTITY MISMATCH: Patient name on hospital bill ('R. Sharma') does not match the registered claimant ('Ramesh Chawla')"],
      },
    })

    try {
      render(
        <MemoryRouter>
          <AuthProvider>
            <ToastProvider>
              <AdjudicationCockpit claimId="88888888-8888-8888-8888-888888888881" onBack={() => {}} />
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText("Resolve the identity mismatch")).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: /Lock & finalize/i }))
      expect(await screen.findByText("Lock and finalize this decision?")).toBeInTheDocument()
      expect(screen.getByText(/despite the mismatch/i)).toBeInTheDocument()
    } finally {
      localStorage.clear()
    }
  })

  it("treats an unlocked claim as in review even if its adjudication still says finalized", async () => {
    const adjuster = { id: "u-1", role: "adjuster", full_name: "Test Adjuster", email: "adjuster@example.com" }
    localStorage.setItem("dp_access_token", "test-token")
    localStorage.setItem("dp_user", JSON.stringify(adjuster))
    vi.spyOn(api.auth, "getMe").mockResolvedValue(adjuster)
    vi.spyOn(api.adjudication, "get").mockResolvedValue({ ...mockAdjudication, status: "finalized" })

    try {
      render(
        <MemoryRouter>
          <AuthProvider>
            <ToastProvider>
              <AdjudicationCockpit claimId="88888888-8888-8888-8888-888888888881" onBack={() => {}} />
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText("Decision ready to lock")).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Unlock for re-audit/i })).not.toBeInTheDocument()
    } finally {
      localStorage.clear()
    }
  })

  it("opens the override as a pop-up and scrolls to the queries when 'Raise a query' is clicked", async () => {
    const adjuster = { id: "u-1", role: "adjuster", full_name: "Test Adjuster", email: "adjuster@example.com" }
    localStorage.setItem("dp_access_token", "test-token")
    localStorage.setItem("dp_user", JSON.stringify(adjuster))
    vi.spyOn(api.auth, "getMe").mockResolvedValue(adjuster)
    vi.spyOn(api.adjudication, "get").mockResolvedValue({
      ...mockAdjudication,
      gemini_raw_response: { flags: ["CRITICAL IDENTITY MISMATCH: bill patient differs from the registered claimant"] },
    })
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      render(
        <MemoryRouter>
          <AuthProvider>
            <ToastProvider>
              <AdjudicationCockpit claimId="88888888-8888-8888-8888-888888888881" onBack={() => {}} />
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      )

      fireEvent.click(await screen.findByRole("button", { name: /Override this decision/i }))
      const dialog = await screen.findByRole("dialog")
      expect(within(dialog).getByText("Override the AI decision")).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))

      scrollIntoView.mockClear()
      fireEvent.click(screen.getByRole("button", { name: /Raise a query/i }))
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    } finally {
      Element.prototype.scrollIntoView = original
      localStorage.clear()
    }
  })

  it("displays policy citation panel with clause references", async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <AdjudicationCockpit claimId="88888888-8888-8888-8888-888888888881" onBack={() => {}} />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText(/Why this decision/i)).toBeInTheDocument()
      expect(screen.getByText(/Procedure verified with OT register/i)).toBeInTheDocument()
      expect(screen.getByText("Clause 2.1 (Surgical Packages)")).toBeInTheDocument()
    })
  })
})
