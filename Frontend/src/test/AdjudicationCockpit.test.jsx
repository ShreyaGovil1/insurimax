import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders financial summary bar with billed, approved, and deductions", async () => {
    render(
      <AuthProvider>
        <ToastProvider>
          <AdjudicationCockpit claimId="88888888-8888-8888-8888-888888888881" onBack={() => {}} />
        </ToastProvider>
      </AuthProvider>
    )

    // Wait for claim data to load
    await waitFor(() => {
      expect(screen.getByText("1. Total Billed")).toBeInTheDocument()
      expect(screen.getByText("2. Approved Amount")).toBeInTheDocument()
      expect(screen.getByText("3. Deductions & Exclusions")).toBeInTheDocument()
      expect(screen.getByText("4. AI Confidence")).toBeInTheDocument()
    })

    // Verify claim and line items render
    expect(screen.getByText(/CLM-2026-8821/i)).toBeInTheDocument()
    expect(screen.getByText(/Ramesh Chawla/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Laparoscopic Cholecystectomy Surgeon Fee/i).length).toBeGreaterThan(0)
  })

  it("displays policy citation panel with clause references", async () => {
    render(
      <AuthProvider>
        <ToastProvider>
          <AdjudicationCockpit claimId="88888888-8888-8888-8888-888888888881" onBack={() => {}} />
        </ToastProvider>
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByText(/Phase 2 Clause Citation & Reasoning/i)).toBeInTheDocument()
      expect(screen.getByText(/Procedure verified with OT register/i)).toBeInTheDocument()
    })
  })
})
