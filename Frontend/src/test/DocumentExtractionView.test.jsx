import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { DocumentExtractionView } from "../components/documents/DocumentExtractionView"
import { ToastProvider } from "../components/ui/toast"
import { AuthProvider } from "../context/AuthContext"
import { api } from "../services/api"

const CLAIM_ID = "99999999-9999-9999-9999-999999999991"

const mockClaim = { id: CLAIM_ID, claim_number: "DP-TEST-1", status: "draft", patient_name: "Padma B N" }

const mockDocs = [
  {
    id: "doc-bill",
    claim_id: CLAIM_ID,
    doc_type: "itemized_bill",
    original_filename: "01_Final_Hospital_Bill.pdf",
    extraction_status: "completed",
    file_size_bytes: 2048,
  },
]

const mockExtraction = {
  document_id: "doc-bill",
  doc_type: "itemized_bill",
  extracted_data: {
    line_items: [
      {
        line_number: 1,
        item_name: "Single Private Room - per day",
        item_category: "room_rent",
        quantity: 4,
        unit_price_inr: 4500,
        total_price_inr: 18000,
        source: { document_id: "doc-bill", filename: "01_Final_Hospital_Bill.pdf", kind: "pdf", page: 1, text: "Single Private Room", rects: [], match: "exact" },
      },
    ],
    total_billed_inr: 18000,
  },
}

describe("DocumentExtractionView — View Extracted", () => {
  beforeEach(() => {
    vi.spyOn(api.documents, "list").mockResolvedValue(mockDocs)
    vi.spyOn(api.documents, "getExtractedData").mockResolvedValue(null)
    vi.spyOn(api.documents, "getDocumentExtraction").mockResolvedValue(mockExtraction)
    vi.spyOn(api.claims, "getById").mockResolvedValue(mockClaim)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads and shows a document's extracted line items without an error", async () => {
    render(
      <AuthProvider>
        <ToastProvider>
          <DocumentExtractionView claimId={CLAIM_ID} claim={mockClaim} />
        </ToastProvider>
      </AuthProvider>
    )

    const viewButton = await screen.findByRole("button", { name: /View Extracted/i })
    fireEvent.click(viewButton)

    await waitFor(() => {
      expect(api.documents.getDocumentExtraction).toHaveBeenCalledWith(CLAIM_ID, "doc-bill")
      expect(screen.getByText("Single Private Room - per day")).toBeInTheDocument()
    })
    expect(screen.queryByText(/Could not load extraction/i)).not.toBeInTheDocument()
    // the citation button for the extracted row is rendered
    expect(screen.getByRole("button", { name: /Source p\.1/i })).toBeInTheDocument()
  })
})
