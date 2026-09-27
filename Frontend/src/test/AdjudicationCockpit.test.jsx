import React from "react"
import { describe, it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { AdjudicationCockpit } from "../components/adjudication/AdjudicationCockpit"
import { ToastProvider } from "../components/ui/toast"
import { AuthProvider } from "../context/AuthContext"

describe("AdjudicationCockpit Component", () => {
  it("renders financial summary bar with billed, approved, and deductions", async () => {
    render(
      <AuthProvider>
        <ToastProvider>
          <AdjudicationCockpit claimId="c-101" onBack={() => {}} />
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
    expect(screen.getByText(/Laparoscopic Cholecystectomy Surgeon Fee/i)).toBeInTheDocument()
  })

  it("displays policy citation panel with clause references", async () => {
    render(
      <AuthProvider>
        <ToastProvider>
          <AdjudicationCockpit claimId="c-101" onBack={() => {}} />
        </ToastProvider>
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByText(/Phase 2 Clause Citation & Reasoning/i)).toBeInTheDocument()
      expect(screen.getByText(/Gemini 1.5 Pro Adjudication Reasoning:/i)).toBeInTheDocument()
    })
  })
})
