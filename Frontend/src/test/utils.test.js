import { describe, it, expect } from "vitest"
import { formatCurrencyINR, calculateSLARemaining } from "../lib/utils"

describe("Utilities & SLA Formatting", () => {
  it("formats Indian Rupee (INR) currency correctly", () => {
    expect(formatCurrencyINR(0)).toBe("₹0")
    expect(formatCurrencyINR(1500)).toContain("1,500")
    expect(formatCurrencyINR(285400)).toContain("2,85,400")
    expect(formatCurrencyINR(null)).toBe("₹0")
    expect(formatCurrencyINR(undefined)).toBe("₹0")
  })

  it("calculates SLA remaining when safe (> 30 mins)", () => {
    const deadline = new Date(Date.now() + 120 * 60 * 1000 + 5000).toISOString()
    const result = calculateSLARemaining(deadline)

    expect(result.isBreached).toBe(false)
    expect(result.isUrgent).toBe(false)
    expect(result.text).toMatch(/(1h 59m|2h 0m) left/)
  })

  it("flags SLA as urgent when under IRDAI 30-minute warning threshold", () => {
    const deadline = new Date(Date.now() + 20 * 60 * 1000 + 5000).toISOString()
    const result = calculateSLARemaining(deadline)

    expect(result.isBreached).toBe(false)
    expect(result.isUrgent).toBe(true)
    expect(result.text).toMatch(/(19|20)m left/)
  })

  it("flags SLA as breached when deadline is past", () => {
    const deadline = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const result = calculateSLARemaining(deadline)

    expect(result.isBreached).toBe(true)
    expect(result.isUrgent).toBe(true)
    expect(result.text).toContain("Breached")
  })

  it("handles null or missing deadline gracefully", () => {
    const result = calculateSLARemaining(null)
    expect(result.isBreached).toBe(false)
    expect(result.text).toBe("No SLA")
  })
})
