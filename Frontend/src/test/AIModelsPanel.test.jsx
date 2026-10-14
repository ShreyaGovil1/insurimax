import React from "react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AIModelsPanel } from "../components/admin/AIModelsPanel"
import { ToastProvider } from "../components/ui/toast"
import { api } from "../services/api"

const config = {
  steps: [
    {
      key: "adjudication",
      label: "Claim adjudication",
      description: "Decides every line item.",
      model: "gemini-3.5-flash",
      default_model: "gemini-3.5-flash",
      is_default: true,
    },
    {
      key: "hospital_precheck",
      label: "Hospital pre-check",
      description: "Flags likely deductions.",
      model: "gemini-2.5-pro",
      default_model: "gemini-2.5-flash",
      is_default: false,
    },
  ],
  available_models: [
    { id: "gemini-3.5-flash", preset: true, on_account: true },
    { id: "gemini-2.5-pro", preset: true, on_account: true },
    { id: "gemini-2.5-flash", preset: true, on_account: true },
    { id: "gemini-4-argon", preset: true, on_account: false },
  ],
  fetch_error: null,
  updated_at: null,
}

const renderPanel = () =>
  render(
    <ToastProvider>
      <AIModelsPanel />
    </ToastProvider>
  )

describe("AIModelsPanel", () => {
  afterEach(() => vi.restoreAllMocks())

  it("lists each step with its model and marks models missing from the account", async () => {
    vi.spyOn(api.admin, "getAiModels").mockResolvedValue(config)
    renderPanel()

    const select = await screen.findByRole("combobox", { name: "Model for Claim adjudication" })
    expect(select).toHaveValue("gemini-3.5-flash")
    expect(screen.getByRole("combobox", { name: "Model for Hospital pre-check" })).toHaveValue("gemini-2.5-pro")
    expect(screen.getAllByRole("option", { name: "gemini-4-argon (not found on account)" }).length).toBeGreaterThan(0)
    expect(screen.getByText("Custom")).toBeInTheDocument()
  })

  it("saves only changed steps, sending null for a step reset to its default", async () => {
    vi.spyOn(api.admin, "getAiModels").mockResolvedValue(config)
    const update = vi.spyOn(api.admin, "updateAiModels").mockResolvedValue(config)
    renderPanel()

    fireEvent.change(await screen.findByRole("combobox", { name: "Model for Claim adjudication" }), {
      target: { value: "gemini-2.5-pro" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Reset Hospital pre-check to the default model" }))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ adjudication: "gemini-2.5-pro", hospital_precheck: null })
    )
  })
})
