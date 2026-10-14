import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw, RotateCcw, Sparkles } from "lucide-react"
import { api } from "../../services/api"
import { cn, formatRelative } from "../../lib/utils"
import { useToast } from "../ui/toast"
import { Button } from "../ui/button"
import { Select } from "../ui/select"
import { Skeleton } from "../ui/skeleton"

/**
 * Admin: choose the Gemini model each AI step uses. Options are the preset models plus the
 * ones the Google (Vertex AI) account reports; a step left on its default uses the env setting.
 */
export function AIModelsPanel() {
  const { toast } = useToast()
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState({}) // stepKey -> chosen model (unsaved)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async ({ refresh = false } = {}) => {
    try {
      const data = await api.admin.getAiModels({ refresh })
      setConfig(data)
      if (refresh) {
        toast({
          title: data.fetch_error ? "Couldn't reach the Google account" : "Model list refreshed",
          description: data.fetch_error ? "Showing the preset models only." : undefined,
          variant: data.fetch_error ? "destructive" : "success",
        })
      }
    } catch (err) {
      toast({ title: "Couldn't load AI model settings", description: err.message, variant: "destructive" })
    }
  }

  useEffect(() => {
    let cancelled = false
    api.admin
      .getAiModels()
      .then((data) => !cancelled && setConfig(data))
      .catch((err) => !cancelled && toast({ title: "Couldn't load AI model settings", description: err.message, variant: "destructive" }))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [toast])

  const refresh = async () => {
    setRefreshing(true)
    await load({ refresh: true })
    setRefreshing(false)
  }

  const steps = useMemo(() => config?.steps || [], [config])
  const models = config?.available_models || []
  const accountKnown = !config?.fetch_error
  const onAccountCount = models.filter((m) => m.on_account).length

  const changes = useMemo(() => {
    const out = {}
    for (const s of steps) {
      if (s.key in draft && draft[s.key] !== s.model) out[s.key] = draft[s.key] === s.default_model ? null : draft[s.key]
    }
    return out
  }, [draft, steps])
  const changeCount = Object.keys(changes).length

  const save = async () => {
    setSaving(true)
    try {
      const data = await api.admin.updateAiModels(changes)
      setConfig(data)
      setDraft({})
      toast({ title: "AI models saved", description: "New AI runs use these models within a minute.", variant: "success" })
    } catch (err) {
      toast({ title: "Couldn't save AI models", description: err.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const optionLabel = (m, step) => {
    const tags = []
    if (m.id === step.default_model) tags.push("default")
    if (accountKnown && !m.on_account) tags.push("not found on account")
    return tags.length ? `${m.id} (${tags.join(", ")})` : m.id
  }

  return (
    <section className="animate-rise overflow-hidden rounded-card bg-surface shadow-card" aria-label="AI models">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-body font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-peacock-500" />
            Gemini model per AI step
          </div>
          <p className="mt-0.5 max-w-2xl text-small text-ink-3">
            Choose which model runs each step. A step on its default uses the model set in the server environment.
          </p>
          {config && (
            <p className="mt-1.5 text-tiny text-ink-3">
              {accountKnown
                ? `${onAccountCount} model${onAccountCount === 1 ? "" : "s"} available on the Google account`
                : "Showing preset models only"}
              {config.updated_at ? ` · Last changed ${formatRelative(config.updated_at)}` : ""}
            </p>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={refresh} loading={refreshing} disabled={loading}>
          {!refreshing && <RefreshCw className="h-3.5 w-3.5" />}
          Refresh model list
        </Button>
      </div>

      {config?.fetch_error && (
        <div role="alert" className="flex items-start gap-2.5 border-b border-marigold-100 bg-marigold-50 px-4 py-3 text-small text-marigold-800 sm:px-5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Couldn't list the models on the Google account, so only the preset models are offered. Check the server's Vertex AI
            credentials, then refresh.
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {steps.map((step) => {
            const value = draft[step.key] ?? step.model
            const isDefault = value === step.default_model
            const changed = step.key in changes
            return (
              <li key={step.key} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{step.label}</span>
                    {changed ? (
                      <span className="rounded-full bg-marigold-50 px-2 py-0.5 text-tiny font-semibold text-marigold-800">Unsaved</span>
                    ) : (
                      !isDefault && <span className="rounded-full bg-peacock-50 px-2 py-0.5 text-tiny font-semibold text-peacock-700">Custom</span>
                    )}
                  </div>
                  <p className="text-small text-ink-3">{step.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Select
                    className="h-9 w-full text-small sm:w-80"
                    aria-label={`Model for ${step.label}`}
                    value={value}
                    onChange={(e) => setDraft((d) => ({ ...d, [step.key]: e.target.value }))}
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {optionLabel(m, step)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(isDefault && "invisible")}
                    onClick={() => setDraft((d) => ({ ...d, [step.key]: step.default_model }))}
                    aria-label={`Reset ${step.label} to the default model`}
                    title={`Reset to ${step.default_model}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-line bg-ground/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <span className="text-small text-ink-3">
          {changeCount ? `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}` : "Changes apply to new AI runs only."}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setDraft({})} disabled={!changeCount || saving}>
            Discard
          </Button>
          <Button onClick={save} loading={saving} disabled={!changeCount}>
            Save changes
          </Button>
        </div>
      </div>
    </section>
  )
}
