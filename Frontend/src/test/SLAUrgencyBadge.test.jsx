import React from "react"
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SLAUrgencyBadge } from "../components/common/SLAUrgencyBadge"

describe("SLAUrgencyBadge Component", () => {
  it("renders breached badge when explicitly breached", () => {
    render(<SLAUrgencyBadge slaDeadline={null} isBreached={true} />)
    expect(screen.getByText(/SLA Breached/i)).toBeInTheDocument()
  })

  it("renders urgent warning badge when less than 30 minutes left", () => {
    const twentyMinsFuture = new Date(Date.now() + 20 * 60 * 1000 + 5000).toISOString()
    render(<SLAUrgencyBadge slaDeadline={twentyMinsFuture} isBreached={false} />)
    expect(screen.getByText(/(19|20)m left/i)).toBeInTheDocument()
  })

  it("renders normal countdown badge when more than 30 minutes left", () => {
    const twoHoursFuture = new Date(Date.now() + 120 * 60 * 1000 + 5000).toISOString()
    render(<SLAUrgencyBadge slaDeadline={twoHoursFuture} isBreached={false} />)
    expect(screen.getByText(/(1h 59m|2h 0m) left/i)).toBeInTheDocument()
  })
})
