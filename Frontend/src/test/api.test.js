import { describe, it, expect, beforeEach } from "vitest"
import {
  api,
  setTokens,
  getAccessToken,
  clearTokens,
  DEMO_USERS,
  DEMO_CLAIMS,
} from "../services/api"

describe("API Client & Services", () => {
  beforeEach(() => {
    clearTokens()
  })

  it("manages JWT access tokens correctly in localStorage", () => {
    expect(getAccessToken()).toBeNull()
    setTokens("mock-access-token-123", "mock-refresh-token-456")
    expect(getAccessToken()).toBe("mock-access-token-123")
    clearTokens()
    expect(getAccessToken()).toBeNull()
  })

  it("fetches claims queue with proper schema objects", async () => {
    const queue = await api.queue.getQueue()
    expect(Array.isArray(queue)).toBe(true)
    expect(queue.length).toBeGreaterThan(0)
    expect(queue[0]).toHaveProperty("claim_number")
    expect(queue[0]).toHaveProperty("billed_amount")
    expect(queue[0]).toHaveProperty("status")
  })

  it("retrieves adjudication result with line items and confidence score", async () => {
    const adj = await api.adjudication.get("c-101")
    expect(adj).toBeDefined()
    expect(adj.status).toBe("completed")
    expect(adj.total_billed_inr).toBeGreaterThan(0)
    expect(Array.isArray(adj.line_items)).toBe(true)
    expect(adj.line_items.length).toBeGreaterThan(0)
  })

  it("retrieves line item policy explanation and citation", async () => {
    const expl = await api.adjudication.getExplanation("c-101", "li-01")
    expect(expl).toBeDefined()
    expect(expl).toHaveProperty("ai_explanation")
    expect(expl).toHaveProperty("clause_reference")
    expect(expl.billed_amount_inr).toBeGreaterThan(0)
  })

  it("fetches non-payable items catalog according to IRDAI standard", async () => {
    const items = await api.policies.listNonPayableItems()
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].irdai_standard).toBe(true)
  })
})
