import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DecisionSummaryCard } from "../components/adjudication/DecisionSummaryCard"

const item = (over) => ({
  id: over.id,
  line_number: over.line_number,
  item_name: over.item_name,
  billed_amount_inr: over.billed ?? 1000,
  approved_amount_inr: over.approved ?? 0,
  deducted_amount_inr: over.deducted ?? 0,
  final_status: over.status,
  ai_explanation: over.explanation ?? "",
  is_overridden: over.is_overridden ?? false,
  override_note: over.override_note ?? null,
})

const adjudication = {
  gemini_raw_response: {
    decision_summary: {
      overview: "Room and surgery were accepted; gloves were excluded as IRDAI non-payables.",
      key_reasons: ["Excluded: Surgical gloves (Rs. 450) - non-payable consumable (E3)"],
      generated_by: "ai",
    },
  },
  line_items: [
    item({ id: "a", line_number: 1, item_name: "Single Private Room", status: "approved", billed: 18000, approved: 18000 }),
    item({ id: "b", line_number: 2, item_name: "Surgical gloves", status: "non_payable", billed: 450, deducted: 450, explanation: "Gloves are an IRDAI non-payable consumable. See Annexure I." }),
    item({ id: "c", line_number: 3, item_name: "ICU charges", status: "partially_approved", billed: 10000, approved: 8000, deducted: 2000, explanation: "ICU capped at 2% of SI.", is_overridden: true, override_note: "Cap confirmed with policy schedule." }),
  ],
}

describe("DecisionSummaryCard", () => {
  it("shows the AI narrative and groups items by final outcome with their reasons", () => {
    const onSelect = vi.fn()
    render(<DecisionSummaryCard adjudication={adjudication} onSelectItem={onSelect} />)

    expect(screen.getByText(/gloves were excluded as IRDAI non-payables/i)).toBeInTheDocument()
    expect(screen.getByText(/Excluded: Surgical gloves/)).toBeInTheDocument()
    expect(screen.getByText("Excluded (1)")).toBeInTheDocument()
    expect(screen.getByText("Reduced (1)")).toBeInTheDocument()
    expect(screen.getByText("Accepted in full (1)")).toBeInTheDocument()
    // excluded item shows the first sentence of its reason
    expect(screen.getByText("Gloves are an IRDAI non-payable consumable.")).toBeInTheDocument()
    // overridden item shows the adjuster's note and the override notice
    expect(screen.getByText("Cap confirmed with policy schedule.")).toBeInTheDocument()
    expect(screen.getByText(/1 item was changed by an adjuster/i)).toBeInTheDocument()

    fireEvent.click(screen.getAllByTitle("Open this line item")[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }))
  })

  it("falls back to a prompt to rerun when no narrative was generated", () => {
    render(<DecisionSummaryCard adjudication={{ ...adjudication, gemini_raw_response: {} }} />)
    expect(screen.getByText(/No written summary for this adjudication yet/i)).toBeInTheDocument()
    expect(screen.getByText("Excluded (1)")).toBeInTheDocument()
  })
})
