import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import {
  formatDurationMs,
  SingleClaimProcessView,
  ClaimProcessAuditTrail,
} from "../components/analytics/ClaimProcessView"

describe("formatDurationMs", () => {
  it("formats short durations under 1 minute", () => {
    expect(formatDurationMs(30000)).toBe("< 1m")
  })

  it("formats minutes", () => {
    expect(formatDurationMs(15 * 60 * 1000)).toBe("15m")
  })

  it("formats hours and minutes", () => {
    expect(formatDurationMs((2 * 60 + 35) * 60 * 1000)).toBe("2h 35m")
  })

  it("formats days and hours", () => {
    expect(formatDurationMs((48 + 6) * 3600 * 1000)).toBe("2d 6h")
  })
})

describe("SingleClaimProcessView", () => {
  const sampleEvents = [
    {
      timestamp: "2026-10-10T16:42:00Z",
      claim_id: "claim-176118",
      claim_number: "DP-20261010-176118",
      from_status: null,
      to_status: "submitted",
      note: "Claim created",
    },
    {
      timestamp: "2026-10-11T01:18:00Z",
      claim_id: "claim-176118",
      claim_number: "DP-20261010-176118",
      from_status: "in_review",
      to_status: "escalated",
      note: "Suspected billing upcoding & consumable inflation",
    },
    {
      timestamp: "2026-10-11T02:28:00Z",
      claim_id: "claim-176118",
      claim_number: "DP-20261010-176118",
      from_status: "queried",
      to_status: "in_review",
      note: "All queries answered by the hospital",
    },
  ]

  it("renders the unique claim header, total steps, and step details", () => {
    render(
      <MemoryRouter>
        <SingleClaimProcessView
          claimId="claim-176118"
          claimNumber="DP-20261010-176118"
          events={sampleEvents}
          onBack={vi.fn()}
        />
      </MemoryRouter>
    )

    // Check header
    expect(screen.getByText("DP-20261010-176118")).toBeInTheDocument()
    expect(screen.getByText(/3 recorded status transitions/i)).toBeInTheDocument()

    // Check notes
    expect(
      screen.getByText("Suspected billing upcoding & consumable inflation")
    ).toBeInTheDocument()
    expect(
      screen.getByText("All queries answered by the hospital")
    ).toBeInTheDocument()

    // Check step numbers
    expect(screen.getByText("#1")).toBeInTheDocument()
    expect(screen.getByText("#2")).toBeInTheDocument()
    expect(screen.getByText("#3")).toBeInTheDocument()
  })

  it("toggles ordering between chronological and reverse", () => {
    render(
      <MemoryRouter>
        <SingleClaimProcessView
          claimId="claim-176118"
          claimNumber="DP-20261010-176118"
          events={sampleEvents}
          onBack={vi.fn()}
        />
      </MemoryRouter>
    )

    const toggleBtn = screen.getByTitle(
      "Toggle chronological vs reverse chronological order"
    )
    expect(toggleBtn).toHaveTextContent("Oldest first (Lifecycle)")

    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveTextContent("Newest first")
  })
})

describe("ClaimProcessAuditTrail", () => {
  const allAuditEntries = [
    {
      timestamp: "2026-10-11T16:48:00Z",
      claim_id: "c1",
      claim_number: "DP-20261011-66AF2C",
      from_status: "draft",
      to_status: "submitted",
      note: "Submitted to insurer",
    },
    {
      timestamp: "2026-10-11T14:08:00Z",
      claim_id: "c2",
      claim_number: "DP-20261010-7488C0",
      from_status: "draft",
      to_status: "submitted",
      note: "Submitted to insurer",
    },
    {
      timestamp: "2026-10-11T02:28:00Z",
      claim_id: "c3",
      claim_number: "DP-20261010-176118",
      from_status: "queried",
      to_status: "in_review",
      note: "All queries answered by the hospital",
    },
  ]

  it("groups audit entries by unique claim and shows summary cards", () => {
    const onSelectClaimId = vi.fn()
    render(
      <MemoryRouter>
        <ClaimProcessAuditTrail
          auditEntries={allAuditEntries}
          auditTotal={3}
          loading={false}
          selectedClaimId={null}
          onSelectClaimId={onSelectClaimId}
        />
      </MemoryRouter>
    )

    expect(screen.getAllByText("DP-20261011-66AF2C").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("DP-20261010-7488C0").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("DP-20261010-176118").length).toBeGreaterThanOrEqual(1)

    // Clicking quick select chip for a claim triggers onSelectClaimId
    fireEvent.click(screen.getByTitle("View change process for DP-20261010-176118"))
    expect(onSelectClaimId).toHaveBeenCalledWith("c3")
  })
})
