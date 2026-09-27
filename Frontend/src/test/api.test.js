import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  api,
  setTokens,
  getAccessToken,
  clearTokens,
  DEMO_CREDENTIALS,
} from "../services/api"

describe("API Client & Services", () => {
  beforeEach(() => {
    clearTokens()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("manages JWT access tokens correctly in localStorage", () => {
    expect(getAccessToken()).toBeNull()
    setTokens("mock-access-token-123", "mock-refresh-token-456")
    expect(getAccessToken()).toBe("mock-access-token-123")
    clearTokens()
    expect(getAccessToken()).toBeNull()
  })

  it("contains valid persona credentials for seed testing", () => {
    expect(DEMO_CREDENTIALS.adjuster.email).toBe("adjuster@insurimax.com")
    expect(DEMO_CREDENTIALS.senior_adjuster.role).toBe("senior_adjuster")
    expect(DEMO_CREDENTIALS.admin.role).toBe("admin")
    expect(DEMO_CREDENTIALS.hospital_desk.role).toBe("hospital_desk")
  })

  it("fetches claims queue with proper schema objects via API", async () => {
    const mockQueue = [
      {
        id: "88888888-8888-8888-8888-888888888881",
        claim_number: "CLM-2026-8821",
        patient_name: "Ramesh Chawla",
        hospital_name: "Apollo Hospital, Bannerghatta",
        billed_amount: 285400.0,
        approved_amount: 246900.0,
        status: "in_review",
        ai_confidence_score: 0.94,
        sla_deadline: "2026-09-28T02:00:00Z",
        sla_breached: false,
      },
    ]

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockQueue,
    })

    const queue = await api.queue.getQueue()
    expect(Array.isArray(queue)).toBe(true)
    expect(queue.length).toBe(1)
    expect(queue[0].claim_number).toBe("CLM-2026-8821")
    expect(queue[0].billed_amount).toBe(285400.0)
    expect(queue[0].status).toBe("in_review")
  })

  it("retrieves adjudication result with line items and confidence score", async () => {
    const mockAdj = {
      id: "adj-1",
      claim_id: "88888888-8888-8888-8888-888888888881",
      status: "completed",
      total_billed_inr: 285400.0,
      total_approved_inr: 246900.0,
      total_deducted_inr: 38500.0,
      confidence_score: 0.94,
      line_items: [
        {
          id: "li-1",
          line_number: 1,
          item_name: "Laparoscopic Cholecystectomy Surgeon Fee",
          billed_amount_inr: 95000.0,
          approved_amount_inr: 95000.0,
          deducted_amount_inr: 0.0,
          ai_status: "approved",
          final_status: "approved",
        },
      ],
    }

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockAdj,
    })

    const adj = await api.adjudication.get("88888888-8888-8888-8888-888888888881")
    expect(adj).toBeDefined()
    expect(adj.status).toBe("completed")
    expect(adj.total_billed_inr).toBe(285400.0)
    expect(Array.isArray(adj.line_items)).toBe(true)
    expect(adj.line_items.length).toBe(1)
  })

  it("retrieves line item policy explanation and citation", async () => {
    const mockExpl = {
      item_id: "li-1",
      item_name: "Laparoscopic Cholecystectomy Surgeon Fee",
      ai_explanation: "Procedure verified with OT register. Surgeon credentials verified.",
      clause_reference: "Clause 2.1 (Surgical Packages)",
      billed_amount_inr: 95000.0,
    }

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockExpl,
    })

    const expl = await api.adjudication.getExplanation("c-1", "li-1")
    expect(expl).toBeDefined()
    expect(expl.ai_explanation).toContain("Procedure verified")
    expect(expl.clause_reference).toBe("Clause 2.1 (Surgical Packages)")
  })

  it("fetches non-payable items catalog according to IRDAI standard", async () => {
    const mockItems = [
      {
        id: "npi-1",
        name: "PPE Kits & Surgical Gowns",
        category: "infection_control",
        irdai_standard: true,
      },
    ]

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockItems,
    })

    const items = await api.policies.listNonPayableItems()
    expect(Array.isArray(items)).toBe(true)
    expect(items[0].irdai_standard).toBe(true)
  })

  it("fetches patient claim status via dedicated patient route", async () => {
    const mockPatientStatus = {
      claim_id: "88888888-8888-8888-8888-888888888881",
      status: "in_review",
      status_message: "Your claim is currently under review.",
      approved_amount_inr: 246900.0,
      submitted_at: "2026-09-27T18:02:17Z",
      last_updated: "2026-09-27T18:02:17Z",
    }

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockPatientStatus,
    })

    const res = await api.patient.getStatus("88888888-8888-8888-8888-888888888881")
    expect(res.status).toBe("in_review")
    expect(res.approved_amount_inr).toBe(246900.0)
    expect(res.status_message).toContain("under review")
  })
})
