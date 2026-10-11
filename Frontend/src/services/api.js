/**
 * InsuriMax API Client
 * Connects directly to FastAPI backend at http://127.0.0.1:8000/api/v1
 * Uses real JWT token authentication and connects to live PostgreSQL database.
 */

const BASE_URL =
  (typeof window !== "undefined" && window.__ENV__?.VITE_API_URL) ||
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:8000/api/v1"

// ── Auth Token Storage ───────────────────────────────────────────────────────
export function getAccessToken() {
  return localStorage.getItem("dp_access_token")
}

export function setTokens(accessToken, refreshToken) {
  if (accessToken) localStorage.setItem("dp_access_token", accessToken)
  if (refreshToken) localStorage.setItem("dp_refresh_token", refreshToken)
}

export function clearTokens() {
  localStorage.removeItem("dp_access_token")
  localStorage.removeItem("dp_refresh_token")
  localStorage.removeItem("dp_user")
}

export function getCurrentStoredUser() {
  const raw = localStorage.getItem("dp_user")
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setCurrentStoredUser(user) {
  localStorage.setItem("dp_user", JSON.stringify(user))
}

// ── Request Helper ───────────────────────────────────────────────────────────
async function apiRequest(endpoint, options = {}) {
  const token = getAccessToken()
  const headers = {
    ...options.headers,
  }

  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`
  }

  let body = options.body
  if (body !== undefined && body !== null && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
    body = JSON.stringify(body)
  }

  if (!(options.body instanceof FormData) && !(body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json"
  }

  const url = `${BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`

  try {
    const res = await fetch(url, { ...options, headers, body })

    if (!res.ok) {
      let errorData = null
      try {
        errorData = await res.json()
      } catch {
        errorData = { detail: res.statusText }
      }
      // Expired / revoked session (e.g. user deactivated): drop credentials and tell the app
      if (res.status === 401 && token && !endpoint.startsWith("/auth/login")) {
        clearTokens()
        if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:expired"))
      }
      const err = new Error(errorData?.detail || `Request failed with status ${res.status}`)
      err.status = res.status
      err.data = errorData
      throw err
    }

    if (res.status === 204) return null
    return await res.json()
  } catch (err) {
    console.warn(`[InsuriMax API] ${options.method || "GET"} ${endpoint} failed:`, err.message)
    throw err
  }
}

// Authenticated binary fetch (e.g. rendered PDF pages): returns an object URL the caller must revoke.
async function apiBlobUrl(endpoint, { method = "GET", body } = {}) {
  const token = getAccessToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) headers["Content-Type"] = "application/json"
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json())?.detail || detail
    } catch {
      // non-JSON error body
    }
    const err = new Error(detail || `Request failed with status ${res.status}`)
    err.status = res.status
    throw err
  }
  return URL.createObjectURL(await res.blob())
}

// ── Seed User Credentials Reference for Demo Personas ─────────────────────────
export const DEMO_CREDENTIALS = {
  adjuster: {
    email: "adjuster@insurimax.com",
    password: "Password@123",
    role: "adjuster",
    name: "Priya Sharma",
  },
  admin: {
    email: "admin@insurimax.com",
    password: "Password@123",
    role: "admin",
    name: "Vikram Seth (Operations Admin)",
  },
  hospital_desk: {
    email: "hospital@insurimax.com",
    password: "Password@123",
    role: "hospital_desk",
    name: "Sunita Rao (Apollo Billing)",
  },
}

// ── API Methods ──────────────────────────────────────────────────────────────

export const api = {
  // Auth
  auth: {
    async login(email, password) {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      setTokens(data.access_token, data.refresh_token)
      const me = await api.auth.getMe()
      setCurrentStoredUser(me)
      return { tokens: data, user: me }
    },

    async register(email, password, full_name, org_id = null) {
      return await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, full_name, org_id }),
      })
    },

    async registerOrg(orgData, adminUserData) {
      return await apiRequest("/auth/register-org", {
        method: "POST",
        body: JSON.stringify({ org: orgData, admin_user: adminUserData }),
      })
    },

    async refreshToken(refreshToken) {
      const data = await apiRequest("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (data?.access_token) {
        setTokens(data.access_token, data.refresh_token)
      }
      return data
    },

    async getMe() {
      return await apiRequest("/auth/me")
    },

    async logout() {
      try {
        await apiRequest("/auth/logout", { method: "POST" })
      } catch {
        // Ignore errors on logout
      } finally {
        clearTokens()
      }
    },
  },

  // Users (Admin / Identity)
  users: {
    async getById(userId) {
      return await apiRequest(`/users/${userId}`)
    },

    async updateRole(userId, role) {
      return await apiRequest(`/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      })
    },
  },

  // Admin panel (admin role only)
  admin: {
    async getStats() {
      return await apiRequest("/admin/stats")
    },

    async listUsers({ search, role, is_active, skip = 0, limit = 50 } = {}) {
      const params = new URLSearchParams({ skip, limit })
      if (search) params.set("search", search)
      if (role) params.set("role", role)
      if (is_active !== undefined && is_active !== "") params.set("is_active", is_active)
      return await apiRequest(`/admin/users?${params.toString()}`)
    },

    async createUser(data) {
      return await apiRequest("/admin/users", { method: "POST", body: JSON.stringify(data) })
    },

    async updateUser(userId, data) {
      return await apiRequest(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    },

    async resetPassword(userId, password) {
      return await apiRequest(`/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      })
    },

    async listOrganizations() {
      return await apiRequest("/admin/organizations")
    },

    async updateOrganization(orgId, data) {
      return await apiRequest(`/admin/organizations/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    },

    async createOrganization(data) {
      return await apiRequest("/admin/organizations", {
        method: "POST",
        body: JSON.stringify(data),
      })
    },
  },

  // Queue
  queue: {
    async getQueue() {
      return await apiRequest("/queue")
    },

    async getStats() {
      return await apiRequest("/queue/stats")
    },

    async getUnassignedQueue() {
      return await apiRequest("/queue/unassigned")
    },

    async assignClaim(claimId, adjusterId) {
      return await apiRequest(`/queue/${claimId}/assign?adjuster_id=${adjusterId}`, {
        method: "POST",
      })
    },


    async getAdjusterDailyDigest(adjusterId, date) {
      const query = date ? `?date=${date}` : ""
      return await apiRequest(`/adjusters/${adjusterId}/daily-digest${query}`)
    },

    async getAdjusterOverrides(adjusterId, limit = 50) {
      return await apiRequest(`/adjusters/${adjusterId}/overrides?limit=${limit}`)
    },
  },

  // Claims
  claims: {
    async list(filters = {}) {
      const params = new URLSearchParams()
      if (filters.status) params.append("status", filters.status)
      if (filters.hospital_org_id) params.append("hospital_org_id", filters.hospital_org_id)
      if (filters.sla_remaining_lt_minutes) params.append("sla_remaining_lt_minutes", filters.sla_remaining_lt_minutes)
      if (filters.page) params.append("page", filters.page)
      if (filters.page_size) params.append("page_size", filters.page_size)

      const qs = params.toString() ? `?${params.toString()}` : ""
      return await apiRequest(`/claims${qs}`)
    },

    async getById(claimId) {
      return await apiRequest(`/claims/${claimId}`)
    },

    async listInsurers() {
      return await apiRequest("/claims/insurers")
    },

    async create(claimData) {
      return await apiRequest("/claims", {
        method: "POST",
        body: JSON.stringify(claimData),
      })
    },

    async submit(claimId) {
      return await apiRequest(`/claims/${claimId}/submit`, { method: "POST" })
    },

    async updateStatus(claimId, status, note = null) {
      return await apiRequest(`/claims/${claimId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, note }),
      })
    },

    // Hospital desk: permanently deletes a draft claim (same endpoint admins use to void)
    async delete(claimId) {
      return await apiRequest(`/claims/${claimId}`, { method: "DELETE" })
    },

    async void(claimId) {
      return await apiRequest(`/claims/${claimId}`, {
        method: "DELETE",
      })
    },

    async getSla(claimId) {
      return await apiRequest(`/claims/${claimId}/sla`)
    },

    async getSummary(claimId) {
      return await apiRequest(`/claims/${claimId}/summary`)
    },

    async getAuditReport(claimId) {
      return await apiRequest(`/claims/${claimId}/audit-report`)
    },
  },

  // Documents & Extraction
  documents: {
    async list(claimId) {
      return await apiRequest(`/claims/${claimId}/documents`)
    },

    async upload(claimId, formData) {
      return await apiRequest(`/claims/${claimId}/documents`, {
        method: "POST",
        body: formData,
      })
    },

    // Citation viewer: page count/kind, and one page as an image (object URL; revoke when done)
    async getPages(claimId, docId) {
      return await apiRequest(`/claims/${claimId}/documents/${docId}/pages`)
    },

    async getPageImageUrl(claimId, docId, page) {
      return await apiBlobUrl(`/claims/${claimId}/documents/${docId}/pages/${page}`)
    },

    async getSignedUrl(claimId, docId) {
      return await apiRequest(`/claims/${claimId}/documents/${docId}`)
    },

    async delete(claimId, docId) {
      return await apiRequest(`/claims/${claimId}/documents/${docId}`, {
        method: "DELETE",
      })
    },

    async triggerExtraction(claimId, docId) {
      return await apiRequest(`/claims/${claimId}/documents/${docId}/extract`, {
        method: "POST",
      })
    },

    async getExtractionJob(jobId) {
      return await apiRequest(`/extraction-jobs/${jobId}`)
    },

    async getExtractedData(claimId) {
      const res = await apiRequest(`/claims/${claimId}/extracted-data`)
      return res?.extracted_data || res
    },

    async getDocumentExtraction(claimId, docId) {
      return await apiRequest(`/claims/${claimId}/documents/${docId}/extracted-data`)
    },

    async patchDocumentExtraction(claimId, docId, payload) {
      return await apiRequest(`/claims/${claimId}/documents/${docId}/extracted-data`, {
        method: "PATCH",
        body: JSON.stringify({ corrected_payload: payload }),
      })
    },

    async patchExtractedData(claimId, patchPayload) {
      return await apiRequest(`/claims/${claimId}/extracted-data`, {
        method: "PATCH",
        body: JSON.stringify({ corrected_payload: patchPayload }),
      })
    },
  },

  // Adjudication Engine
  adjudication: {
    async run(claimId, { confirmDiscardOverrides = false } = {}) {
      const qs = confirmDiscardOverrides ? "?confirm_discard_overrides=true" : ""
      return await apiRequest(`/claims/${claimId}/adjudicate${qs}`, {
        method: "POST",
      })
    },

    async get(claimId) {
      return await apiRequest(`/claims/${claimId}/adjudication`)
    },

    async getLineItem(claimId, itemId) {
      return await apiRequest(`/claims/${claimId}/adjudication/line-items/${itemId}`)
    },

    async getExplanation(claimId, itemId) {
      return await apiRequest(`/claims/${claimId}/adjudication/line-items/${itemId}/explanation`)
    },

    async overrideLineItem(claimId, itemId, overrideData) {
      return await apiRequest(`/claims/${claimId}/adjudication/line-items/${itemId}/override`, {
        method: "POST",
        body: JSON.stringify(overrideData),
      })
    },

    async finalize(claimId, finalizeData) {
      return await apiRequest(`/claims/${claimId}/adjudication/finalize`, {
        method: "POST",
        body: JSON.stringify(finalizeData),
      })
    },
  },

  // Queries
  queries: {
    async list(claimId) {
      return await apiRequest(`/claims/${claimId}/queries`)
    },

    async get(queryId) {
      return await apiRequest(`/queries/${queryId}`)
    },

    async create(claimId, queryData) {
      return await apiRequest(`/claims/${claimId}/queries`, {
        method: "POST",
        body: JSON.stringify(queryData),
      })
    },

    async respond(queryId, responseData) {
      return await apiRequest(`/queries/${queryId}/respond`, {
        method: "POST",
        body: JSON.stringify(responseData),
      })
    },

    async resolve(queryId, resolutionData) {
      return await apiRequest(`/queries/${queryId}/resolve`, {
        method: "PATCH",
        body: JSON.stringify(resolutionData),
      })
    },
  },

  // Hospital Pre-Check
  hospital: {
    async runPreCheck(formData) {
      return await apiRequest("/hospital/pre-check", {
        method: "POST",
        body: formData,
      })
    },

    async getPreCheck(checkId) {
      return await apiRequest(`/hospital/pre-check/${checkId}`)
    },

    async getSubmissionTemplates() {
      return await apiRequest("/hospital/submission-templates")
    },

    async submitClaim(claimId, checkId) {
      return await apiRequest(`/hospital/claims/${claimId}/submit?check_id=${encodeURIComponent(checkId)}`, {
        method: "POST",
      })
    },
  },

  // Patient Status Portal (Public & Tokenized)
  patient: {
    async getStatus(claimId) {
      return await apiRequest(`/patient/claims/${claimId}/status`)
    },

    async subscribeNotifications(claimId, { email, phone } = {}) {
      const params = new URLSearchParams()
      if (email) params.append("email", email)
      if (phone) params.append("phone", phone)
      const qs = params.toString() ? `?${params.toString()}` : ""
      return await apiRequest(`/patient/claims/${claimId}/notifications/subscribe${qs}`, {
        method: "POST",
      })
    },

    async getRecentClaims(limit = 4) {
      return await apiRequest(`/patient/claims/recent?limit=${limit}`)
    },

    async getBimaBharosaPayload(claimId, issueType = "discharge_delay") {
      return await apiRequest(`/patient/claims/${claimId}/bima-bharosa-payload?issue_type=${encodeURIComponent(issueType)}`)
    },

    // Prefilled complaint values as a PDF for filing on Bima Bharosa manually; returns an object URL to revoke.
    async downloadBimaBharosaPdf(claimId, { issueType = "discharge_delay", complainant } = {}) {
      return await apiBlobUrl(`/patient/claims/${claimId}/bima-bharosa-form.pdf?issue_type=${encodeURIComponent(issueType)}`, {
        method: "POST",
        body: complainant || {},
      })
    },

    async lookupEscalation({ query, patientName, phone, hospitalName, issueType = "discharge_delay", claimId } = {}) {
      return await apiRequest(`/patient/escalation/lookup`, {
        method: "POST",
        body: JSON.stringify({
          query,
          patient_name: patientName,
          phone,
          hospital_name: hospitalName,
          issue_type: issueType,
          claim_id: claimId,
        }),
      })
    },
  },

  // Policies & Rules
  policies: {
    async list(params = {}) {
      const sp = new URLSearchParams()
      if (params.insurer_name) sp.append("insurer_name", params.insurer_name)
      if (params.org_id) sp.append("org_id", params.org_id)
      if (params.page) sp.append("page", params.page)
      if (params.page_size) sp.append("page_size", params.page_size)
      const qs = sp.toString() ? `?${sp.toString()}` : ""
      return await apiRequest(`/policies${qs}`)
    },

    async getById(policyId) {
      return await apiRequest(`/policies/${policyId}`)
    },

    async create(policyData) {
      return await apiRequest("/policies", {
        method: "POST",
        body: JSON.stringify(policyData),
      })
    },

    async createVersion(policyId, formData) {
      return await apiRequest(`/policies/${policyId}/versions`, {
        method: "POST",
        body: formData,
      })
    },

    async getVersion(policyId, versionId) {
      return await apiRequest(`/policies/${policyId}/versions/${versionId}`)
    },

    async extractRules(policyId, versionId) {
      return await apiRequest(`/policies/${policyId}/versions/${versionId}/extract-rules`, {
        method: "POST",
      })
    },

    async getRules(policyId, versionId) {
      return await apiRequest(`/policies/${policyId}/versions/${versionId}/rules`)
    },

    async patchRules(policyId, versionId, rulesList) {
      return await apiRequest(`/policies/${policyId}/versions/${versionId}/rules`, {
        method: "PATCH",
        body: JSON.stringify(rulesList),
      })
    },

    async getClause(policyId, versionId, ruleId) {
      return await apiRequest(`/policies/${policyId}/versions/${versionId}/clauses/${ruleId}`)
    },

    async listNonPayableItems(orgId = null) {
      const qs = orgId ? `?org_id=${orgId}` : ""
      return await apiRequest(`/non-payable-items${qs}`)
    },

    async createNonPayableItem(itemData) {
      return await apiRequest("/non-payable-items", {
        method: "POST",
        body: JSON.stringify(itemData),
      })
    },
  },

  // Compliance, Analytics & Admin
  compliance: {
    async getSlaReport(periodDays = 30, orgId = null) {
      const params = new URLSearchParams({ period_days: periodDays })
      if (orgId) params.append("org_id", orgId)
      return await apiRequest(`/compliance/sla-report?${params.toString()}`)
    },

    async getAuditTrail(filters = {}) {
      const params = new URLSearchParams()
      if (filters.claim_id) params.append("claim_id", filters.claim_id)
      if (filters.user_id) params.append("user_id", filters.user_id)
      if (filters.limit) params.append("limit", filters.limit)
      const qs = params.toString() ? `?${params.toString()}` : ""
      return await apiRequest(`/compliance/audit-trail${qs}`)
    },

    async getFullTrace(claimId) {
      return await apiRequest(`/compliance/claims/${claimId}/full-trace`)
    },

    async getAnomalies(severity = null, limit = 50) {
      const params = new URLSearchParams({ limit })
      if (severity) params.append("severity", severity)
      return await apiRequest(`/analytics/anomalies?${params.toString()}`)
    },

    async getHospitalPatterns(hospitalOrgId) {
      return await apiRequest(`/analytics/hospitals/${hospitalOrgId}/patterns`)
    },

    async getHospitalOverrideHistory(hospitalOrgId, limit = 50) {
      return await apiRequest(`/analytics/hospitals/${hospitalOrgId}/override-history?limit=${limit}`)
    },

    async investigateAnomaly(anomalyId) {
      return await apiRequest(`/analytics/anomalies/${anomalyId}/investigate`, {
        method: "POST",
      })
    },

    async getAutoApprovalThresholds(orgId) {
      return await apiRequest(`/org/${orgId}/auto-approval-thresholds`)
    },

    async updateAutoApprovalThresholds(orgId, { confidence_threshold, max_amount_inr }) {
      const params = new URLSearchParams()
      if (confidence_threshold !== undefined && confidence_threshold !== null) {
        params.append("confidence_threshold", confidence_threshold)
      }
      if (max_amount_inr !== undefined && max_amount_inr !== null) {
        params.append("max_amount_inr", max_amount_inr)
      }
      return await apiRequest(`/org/${orgId}/auto-approval-thresholds?${params.toString()}`, {
        method: "PATCH",
      })
    },

    async getOrgSettings(orgId) {
      return await apiRequest(`/org/${orgId}/settings`)
    },

    async updateOrgSettings(orgId, settingsData) {
      return await apiRequest(`/org/${orgId}/settings`, {
        method: "PATCH",
        body: JSON.stringify(settingsData),
      })
    },
  },

  // Webhooks
  webhooks: {
    async subscribe(subscriptionData) {
      return await apiRequest("/webhooks/subscribe", {
        method: "POST",
        body: JSON.stringify(subscriptionData),
      })
    },

    async list() {
      return await apiRequest("/webhooks")
    },
  },

  // System Health & Probes
  system: {
    async getRoot() {
      const serverRoot = BASE_URL.replace(/\/api\/v1\/?$/, "")
      const res = await fetch(`${serverRoot}/`)
      return await res.json()
    },

    async getHealth() {
      const serverRoot = BASE_URL.replace(/\/api\/v1\/?$/, "")
      const res = await fetch(`${serverRoot}/health`)
      return await res.json()
    },

    async getReady() {
      const serverRoot = BASE_URL.replace(/\/api\/v1\/?$/, "")
      const res = await fetch(`${serverRoot}/ready`)
      return await res.json()
    },
  },
}

// Backward compatibility alias: api.analytics -> api.compliance
api.analytics = api.compliance
