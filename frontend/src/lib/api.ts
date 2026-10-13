import { apiRequest, apiUpload, getApiUrl, getToken } from './auth'

// ─── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  /** Whether "Continue with Google" is switched on, plus the URLs Google needs. */
  googleStatus: (probe?: boolean) => apiRequest<any>(`/auth/google/status${probe ? '?probe=1' : ''}`),
  login: (email: string, password: string) =>
    apiRequest<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string, phone?: string) =>
    apiRequest<any>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, phone }) }),
  me: () => apiRequest<any>('/auth/me'),
  /**
   * One-click YouTube: ask for a signed, owner-bound state, then send the browser
   * to `${getApiUrl()}/auth/google/youtube?state=…`. The app's own Google client
   * runs the consent screen with YouTube scopes, so nobody needs a developer
   * console or a copied token.
   */
  youtubeConnectStart: () => apiRequest<{ success: boolean; state: string; url: string }>(
    '/auth/google/youtube/start',
    { method: 'POST', body: JSON.stringify({}) },
  ),
}

// ─── Chat ──────────────────────────────────────────────────────────────────
export const chatApi = {
  getConversations: () => apiRequest<any>('/chat/conversations'),
  getConversation: (id: string) => apiRequest<any>(`/chat/conversations/${id}`),
  createConversation: (mode: string, model?: string, skill?: string) =>
    apiRequest<any>('/chat/conversations', { method: 'POST', body: JSON.stringify({ mode, model, skill }) }),
  deleteConversation: (id: string) =>
    apiRequest<any>(`/chat/conversations/${id}`, { method: 'DELETE' }),
  sendMessage: (conversationId: string, message: string, mode?: string, model?: string, attachments?: any[], skill?: string, signal?: AbortSignal, options?: { flowModel?: string; flowAspectRatio?: string; flowMediaType?: 'image' | 'video' }) =>
    apiRequest<any>(`/chat/conversations/${conversationId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message, mode, model, attachments, skill, ...options }),
      signal,
    }),
  /** Stop an in-flight reply (backend aborts the upstream AI request too). */
  stopMessage: (conversationId: string) =>
    apiRequest<any>(`/chat/conversations/${conversationId}/stop`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  /**
   * Streaming twin of sendMessage: the reply arrives token-by-token over SSE.
   *
   * `onDelta(text)` fires for every fragment so the UI can paint as the model
   * thinks; the promise resolves with the SAME payload shape sendMessage returns
   * (from the terminal `done` event), so callers treat both paths identically.
   *
   * Fails safe by construction: validation and quota rejections are returned by the
   * server as ordinary JSON *before* the stream opens, so a non-SSE response is
   * parsed and surfaced as a normal error — and any transport-level failure rejects
   * with `code: 'STREAM_UNAVAILABLE'`, which the caller uses to retry buffered.
   */
  sendMessageStream: async (
    conversationId: string,
    message: string,
    mode?: string,
    model?: string,
    attachments?: any[],
    skill?: string,
    signal?: AbortSignal,
    options?: { flowModel?: string; flowAspectRatio?: string; flowMediaType?: 'image' | 'video' },
    onDelta?: (text: string) => void,
  ): Promise<any> => {
    const token = getToken()
    const res = await fetch(`${getApiUrl()}/chat/conversations/${conversationId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, mode, model, attachments, skill, stream: true, ...options }),
      signal,
    })

    const contentType = res.headers.get('content-type') || ''

    // Server answered with JSON: either an error raised before the stream opened
    // (quota, validation) or an older backend without SSE. Surface it faithfully.
    if (!contentType.includes('text/event-stream')) {
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const error = new Error(data?.message || `Request failed (${res.status})`) as any
        error.status = res.status
        error.code = data?.code
        throw error
      }
      // Buffered fallback body — hand it straight back as a normal success.
      return data
    }

    if (!res.ok || !res.body) {
      const error = new Error(`Stream failed (${res.status})`) as any
      error.code = 'STREAM_UNAVAILABLE'
      throw error
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalPayload: any = null
    let streamError: any = null

    const handleFrame = (frame: string) => {
      const lines = frame.split('\n')
      let event = 'message'
      const dataLines: string[] = []
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) return
      let data: any
      try { data = JSON.parse(dataLines.join('\n')) } catch { return }
      if (event === 'delta' && data.text) onDelta?.(data.text)
      else if (event === 'done') finalPayload = data
      else if (event === 'error') {
        const error = new Error(data.message || 'Generation failed') as any
        error.code = data.code
        error.status = data.status
        error.stopped = data.stopped
        streamError = error
      }
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        // SSE frames are separated by a blank line; hold the tail until it arrives.
        while ((sep = buffer.search(/\n\n/)) !== -1) {
          handleFrame(buffer.slice(0, sep))
          buffer = buffer.slice(sep + 2)
        }
      }
      if (buffer.trim()) handleFrame(buffer)
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err
      const error = new Error(err?.message || 'Stream interrupted') as any
      error.code = 'STREAM_UNAVAILABLE'
      throw error
    }

    if (streamError) throw streamError
    if (!finalPayload) {
      const error = new Error('Stream ended without a result') as any
      error.code = 'STREAM_UNAVAILABLE'
      throw error
    }
    return finalPayload
  },
  sendPublicMessage: (message: string, conversationId?: string | null, model?: string, signal?: AbortSignal) =>
    apiRequest<any>('/chat/public/message', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId, model }),
      signal,
    }),
  getMuteState: (id: string, customer: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/customers/${encodeURIComponent(customer)}/mute`),
  muteMessage: (id: string, customer: string, reason?: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/customers/${encodeURIComponent(customer)}/mute`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'manual' }),
    }),
  unmuteMessage: (id: string, customer: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/customers/${encodeURIComponent(customer)}/unmute`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getSkills: () => apiRequest<any>('/chat/skills'),
  /** Ask the backend to wake LM Studio and load the smallest model (non-blocking). */
  warmLocalModel: (model?: string) =>
    apiRequest<any>('/chat/lm-studio/warm', { method: 'POST', body: JSON.stringify({ model }) }),
  /**
   * Give the RAM back when the visitor leaves the local chat.
   * `graceSeconds` lets a reload keep the server: the model is unloaded now and
   * LM Studio stops only if nothing uses it again inside that window.
   */
  releaseLocalModel: (opts?: { graceSeconds?: number }) =>
    apiRequest<any>('/chat/lm-studio/unload', {
      method: 'POST',
      body: JSON.stringify({ stopServer: true, graceSeconds: opts?.graceSeconds ?? 0 }),
    }),
  getModels: (opts?: { refresh?: boolean }) =>
    apiRequest<any>(`/chat/models${opts?.refresh ? '?refresh=1' : ''}`, { cache: 'no-store' }),
  getQuota: () => apiRequest<any>('/chat/quota'),
  unloadModel: (model?: string, opts?: { stopServer?: boolean; graceSeconds?: number }) =>
    apiRequest<any>('/chat/lm-studio/unload', {
      method: 'POST',
      body: JSON.stringify({
        model,
        // Omitted (undefined) → the backend keeps its default of stopping the
        // server. Passing false frees the model but keeps the daemon warm.
        stopServer: opts?.stopServer,
        graceSeconds: opts?.graceSeconds,
      }),
    }),
  getLmStatus: () => apiRequest<any>('/chat/lm-studio/status'),
}

// ─── Payments ──────────────────────────────────────────────────────────────
// Three plans priced in taka: free ৳0, pro ৳100/month, enterprise ৳300/month.
// Nagad is the local rail: buyers send money to the owner's Nagad number and the
// order is confirmed automatically when Nagad's merchant API is configured,
// otherwise by the owner checking the TrxID. SSLCommerz (cards/bKash) is the
// second rail for buyers who prefer it.
export const paymentApi = {
  /** Plan table + which gateways are live. Public. */
  plans: () => apiRequest<any>('/payments/plans', { cache: 'no-store' }),
  /** Open an SSLCommerz session for a paid tier. Returns { url, tranId, amount }. */
  init: (tier: 'pro' | 'enterprise') =>
    apiRequest<any>('/payments/init', { method: 'POST', body: JSON.stringify({ tier }) }),
  status: (tranId: string) => apiRequest<any>(`/payments/status/${tranId}`),
  orders: () => apiRequest<any>('/payments/orders'),

  // Nagad
  nagadConfig: () => apiRequest<any>('/payments/nagad/config', { cache: 'no-store' }),
  /** Create a Nagad order: auto mode returns { url }, manual mode the wallet to pay. */
  nagadOrder: (tier: 'pro' | 'enterprise') =>
    apiRequest<any>('/payments/nagad/order', { method: 'POST', body: JSON.stringify({ tier }) }),
  /** Record the TrxID from the Nagad SMS. */
  nagadSubmit: (tranId: string, trxId: string, senderNumber: string) =>
    apiRequest<any>('/payments/nagad/submit', {
      method: 'POST',
      body: JSON.stringify({ tranId, trxId, senderNumber }),
    }),
  nagadVerify: (tranId: string) =>
    apiRequest<any>(`/payments/nagad/verify/${tranId}`, { method: 'POST', body: JSON.stringify({}) }),
}

// ─── Channels (Facebook, Messenger, Instagram, Telegram, YouTube, webhook) ──
// The catalogue carries each platform's capabilities and numbered setup steps;
// credentials are only ever sent, never read back (the API returns `configured`).
export const channelApi = {
  list: () => apiRequest<any>('/channels', { cache: 'no-store' }),
  connect: (id: string, data: { credentials?: Record<string, string>; automations?: Record<string, any>; label?: string }) =>
    apiRequest<any>(`/channels/${id}/connect`, { method: 'POST', body: JSON.stringify(data) }),
  test: (id: string) => apiRequest<any>(`/channels/${id}/test`, { method: 'POST', body: JSON.stringify({}) }),
  setAutomations: (id: string, data: Record<string, any>) =>
    apiRequest<any>(`/channels/${id}/automations`, { method: 'PUT', body: JSON.stringify(data) }),
  postNow: (id: string, text?: string) =>
    apiRequest<any>(`/channels/${id}/post-now`, { method: 'POST', body: JSON.stringify({ text }) }),
  getScheduledPosts: () => apiRequest<any>('/channels/scheduled-posts', { cache: 'no-store' }),
  schedulePost: (data: { channelId: string; text: string; mediaUrl?: string; scheduledAt: string }) =>
    apiRequest<any>('/channels/scheduled-posts', { method: 'POST', body: JSON.stringify(data) }),
  cancelScheduledPost: (id: string) =>
    apiRequest<any>(`/channels/scheduled-posts/${id}`, { method: 'DELETE' }),
  disconnect: (id: string) => apiRequest<any>(`/channels/${id}`, { method: 'DELETE' }),
}

// ─── User ──────────────────────────────────────────────────────────────────
export const userApi = {
  getProfile: () => apiRequest<any>('/user/profile'),
  updateProfile: (data: any) => apiRequest<any>('/user/profile', { method: 'PUT', body: JSON.stringify(data) }),
  updateSubscription: (tier: string) =>
    apiRequest<any>('/user/subscription', { method: 'PUT', body: JSON.stringify({ tier }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<any>('/user/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),

  // Agent-platform API key. The value is only ever written; reads return a masked preview.
  getApiKey: () => apiRequest<any>('/user/api-key'),
  setApiKey: (contentbotApiKey: string) =>
    apiRequest<any>('/user/api-key', { method: 'PUT', body: JSON.stringify({ contentbotApiKey }) }),
  verifyApiKey: (value?: string) =>
    apiRequest<any>('/user/api-key/verify', { method: 'POST', body: JSON.stringify(value ? { value } : {}) }),
  revokeApiKey: () => apiRequest<any>('/user/api-key', { method: 'DELETE' }),
}

// ─── Memory ────────────────────────────────────────────────────────────────
export const memoryApi = {
  get: () => apiRequest<any>('/memory'),
  update: (data: any) => apiRequest<any>('/memory', { method: 'PUT', body: JSON.stringify(data) }),
  /** Switch personalisation on or off without touching anything the owner typed. */
  setEnabled: (enabled: boolean) =>
    apiRequest<any>('/memory/enabled', { method: 'POST', body: JSON.stringify({ enabled }) }),
  /** Sample reply for a form that has not been saved yet. */
  preview: (data: any) =>
    apiRequest<any>('/memory/preview', { method: 'POST', body: JSON.stringify(data) }),
  clear: () => apiRequest<any>('/memory', { method: 'DELETE' }),
  addCatalogItem: (item: any) =>
    apiRequest<any>('/memory/catalog', { method: 'POST', body: JSON.stringify(item) }),
  updateCatalogItem: (itemId: string, item: any) =>
    apiRequest<any>(`/memory/catalog/${itemId}`, { method: 'PUT', body: JSON.stringify(item) }),
  deleteCatalogItem: (itemId: string) =>
    apiRequest<any>(`/memory/catalog/${itemId}`, { method: 'DELETE' }),
  addEntry: (key: string, value: string, category?: string) =>
    apiRequest<any>('/memory/entries', { method: 'POST', body: JSON.stringify({ key, value, category }) }),
  deleteEntry: (entryId: string) =>
    apiRequest<any>(`/memory/entries/${entryId}`, { method: 'DELETE' }),
  updateEntry: (entryId: string, key: string, value: string, category?: string) =>
    apiRequest<any>(`/memory/entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify({ key, value, category }),
    }),
}

// ─── WhatsApp ──────────────────────────────────────────────────────────────
export const whatsappApi = {
  getSessions: () => apiRequest<any>('/whatsapp/sessions'),
  getAnalytics: () => apiRequest<any>('/whatsapp/analytics', { cache: 'no-store' }),
  /** Message log for one session, optionally narrowed to a single customer. */
  getMessages: (id: string, from?: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/messages${from ? `?from=${encodeURIComponent(from)}` : ''}`),
  exportHistory: (id: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/export`, { cache: 'no-store' }),
  createSession: (sessionName: string, phoneNumber?: string) =>
    apiRequest<any>('/whatsapp/sessions', { method: 'POST', body: JSON.stringify({ sessionName, phoneNumber }) }),
  disconnect: (id: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/disconnect`, { method: 'POST' }),
  /** Ask the backend to mint an 8-char pairing code (link-by-code, no QR scan). */
  requestPairingCode: (id: string, phoneNumber: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/pairing-code`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber }),
    }),
  deleteSession: (id: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}`, { method: 'DELETE' }),
  updateSettings: (id: string, settings: any) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  sendMessage: (id: string, to: string, message: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/send`, {
      method: 'POST',
      body: JSON.stringify({ to, message }),
    }),
  muteMessage: (id: string, customer: string, reason?: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/customers/${encodeURIComponent(customer)}/mute`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'manual' }),
    }),
  unmuteMessage: (id: string, customer: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/customers/${encodeURIComponent(customer)}/unmute`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getMuteState: (id: string, customer: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/customers/${encodeURIComponent(customer)}/mute`),
}

// ─── Platform status (public switches) ─────────────────────────────────────
// What the admin has switched off, so the UI can say so instead of letting a
// button fail. Nothing here is private: a notice string and five booleans.
export const platformApi = {
  status: () => apiRequest<any>('/platform/status', { cache: 'no-store' }),
}

// ─── Admin ─────────────────────────────────────────────────────────────────
export const adminApi = {
  getStats: () => apiRequest<any>('/admin/stats'),
  getUsers: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiRequest<any>(`/admin/users${qs}`)
  },
  createUser: (data: any) =>
    apiRequest<any>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: any) =>
    apiRequest<any>(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: string) =>
    apiRequest<any>(`/admin/users/${id}`, { method: 'DELETE' }),
  getUserChats: (id: string) => apiRequest<any>(`/admin/users/${id}/chats`),
  getAllConversations: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiRequest<any>(`/admin/conversations${qs}`)
  },
  getSettings: () => apiRequest<any>('/admin/settings'),
  getWhatsAppSessions: () => apiRequest<any>('/admin/whatsapp/sessions'),
  getWhatsAppMessages: (id: string, contact?: string) => {
    const qs = contact ? '?' + new URLSearchParams({ contact }).toString() : ''
    return apiRequest<any>(`/admin/whatsapp/sessions/${id}/messages${qs}`)
  },
  getSubscriptions: () => apiRequest<any>('/admin/subscriptions'),

  // Nagad orders waiting for a human, plus where the money should land.
  getPayments: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return apiRequest<any>(`/admin/payments${qs}`)
  },
  approvePayment: (tranId: string, note?: string) =>
    apiRequest<any>(`/admin/payments/${tranId}/approve`, { method: 'POST', body: JSON.stringify({ note }) }),
  rejectPayment: (tranId: string, note?: string) =>
    apiRequest<any>(`/admin/payments/${tranId}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),
  getNagadSettings: () => apiRequest<any>('/admin/nagad'),
  updateNagadSettings: (data: { wallet?: string; holder?: string; autoVerify?: boolean; note?: string }) =>
    apiRequest<any>('/admin/nagad', { method: 'PUT', body: JSON.stringify(data) }),
  updateUserSubscription: (id: string, data: any) =>
    apiRequest<any>(`/admin/users/${id}/subscription`, { method: 'PUT', body: JSON.stringify(data) }),
  resetUserTokens: (id: string) =>
    apiRequest<any>(`/admin/users/${id}/reset-tokens`, { method: 'POST' }),

  // Platform switchboard: the stop buttons, the plan limits and the audit trail.
  getControls: () => apiRequest<any>('/admin/controls', { cache: 'no-store' }),
  updateControls: (data: Record<string, any>) =>
    apiRequest<any>('/admin/controls', { method: 'PUT', body: JSON.stringify(data) }),
  getAudit: (limit?: number) =>
    apiRequest<any>(`/admin/audit${limit ? `?limit=${limit}` : ''}`, { cache: 'no-store' }),
  /** Per-owner usage: sessions, messages answered, channel replies, plan headroom. */
  getUsage: (limit?: number) =>
    apiRequest<any>(`/admin/usage${limit ? `?limit=${limit}` : ''}`, { cache: 'no-store' }),
  getLiveWhatsapp: () => apiRequest<any>('/admin/whatsapp/live', { cache: 'no-store' }),
  /* Stop one owner's WhatsApp browser without touching their login. */
  stopWhatsappSession: (id: string, reason?: string) =>
    apiRequest<any>(`/admin/whatsapp/sessions/${id}/stop`, { method: 'POST', body: JSON.stringify({ reason }) }),

  /** Google sign-in readiness plus the two URLs to paste into Google Cloud Console. */
  getGoogleSignin: () => apiRequest<any>('/admin/google-signin'),

  // Provider key vault — keys added here take effect without a restart.
  getApiKeys: () => apiRequest<any>('/admin/api-keys'),
  createApiKey: (data: { envName: string; value: string; label?: string }) =>
    apiRequest<any>('/admin/api-keys', { method: 'POST', body: JSON.stringify(data) }),
  updateApiKey: (id: string, data: { label?: string; value?: string; enabled?: boolean }) =>
    apiRequest<any>(`/admin/api-keys/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteApiKey: (id: string) =>
    apiRequest<any>(`/admin/api-keys/${id}`, { method: 'DELETE' }),
  /** Live probe: pass { id } for a saved key or { envName, value } for a draft. */
  testApiKey: (data: { id?: string; envName?: string; value?: string }) =>
    apiRequest<any>('/admin/api-keys/test', { method: 'POST', body: JSON.stringify(data) }),
}

// ─── Google Flow MCP ───────────────────────────────────────────────────────
export const flowApi = {
  /** Get Flow MCP status, connection readiness, and model capabilities */
  getStatus: () => apiRequest<any>('/flow/status', { cache: 'no-store' }),
  /** Get the active account's image allowance and current period usage. */
  getImageQuota: () => apiRequest<any>('/flow/image-quota', { cache: 'no-store' }),
  /** Get available Flow models and aspect ratios */
  getModels: () => apiRequest<any>('/flow/models', { cache: 'no-store' }),
  /** Generate an image or video using Google Flow MCP */
  generate: (data: { prompt: string; mediaType?: 'image' | 'video'; duration?: number; ratio?: string; model?: string }) =>
    apiRequest<any>('/flow/generate', { method: 'POST', body: JSON.stringify(data) }),
  /** Begin Google Flow account connection handshake */
  beginConnect: () => apiRequest<any>('/flow/connect/begin', { method: 'POST' }),
  /** Complete Google Flow account connection handshake */
  completeConnect: (data?: { connectionId?: string }) =>
    apiRequest<any>('/flow/connect/complete', { method: 'POST', body: JSON.stringify(data || {}) }),
  /** Begin an admin-only handshake for one HerovaAi shared image account. */
  beginHouseConnect: (accountId: 'ff2' | 'ff3' | 'ff1') =>
    apiRequest<any>('/flow/house/connect/begin', { method: 'POST', body: JSON.stringify({ accountId }) }),
  /** Complete an admin-only handshake for one HerovaAi shared image account. */
  completeHouseConnect: (data: { accountId: 'ff2' | 'ff3' | 'ff1'; connectionId: string }) =>
    apiRequest<any>('/flow/house/connect/complete', { method: 'POST', body: JSON.stringify(data) }),
  /** Connect Google Flow via cookies / session */
  connectCookies: (rawCookies: string | any[]) =>
    apiRequest<any>('/flow/connect/cookies', { method: 'POST', body: JSON.stringify({ rawCookies }) }),
  /** Disconnect Google Flow account */
  disconnect: () => apiRequest<any>('/flow/connect/disconnect', { method: 'POST' }),
  /** AI Auto-Generate Social Post (Hook, Caption, 10-15 #tags, CTA, Thumbnail recommendation) */
  generatePost: (data: { mediaUrl: string; prompt: string; platform?: string; customTopic?: string }) =>
    apiRequest<any>('/flow/generate-post', { method: 'POST', body: JSON.stringify(data) }),
  /** Create original Facebook commercial copy from a brief, reference image, and business profile. */
  generateCommercialPost: (data: {
    prompt?: string
    customTopic?: string
    referenceImage?: { mimeType: string; data: string } | null
  }) => apiRequest<any>('/flow/generate-commercial-post', { method: 'POST', body: JSON.stringify(data) }),
  /** Store a selected image only when the user chooses to publish or schedule it. */
  uploadCommercialReference: (data: { mimeType: string; data: string }) =>
    apiRequest<any>('/flow/commercial-post/reference', { method: 'POST', body: JSON.stringify(data) }),
  /** Push/Publish post directly to connected channel */
  publishPost: (data: { channelId: string; text: string; mediaUrl?: string }) =>
    apiRequest<any>('/flow/publish-post', { method: 'POST', body: JSON.stringify(data) }),
}

/** Admin Google Flow Studio, which accepts optional multipart reference images. */
export const googleFlowApi = {
  // `refresh` bypasses the backend's short-lived option cache (the manual
  // "Sync Flow options" button); the automatic page-load read uses the cache.
  getOptions: (refresh = false) => apiRequest<any>(
    `/google-flow/options${refresh ? '?refresh=1' : ''}`,
    { cache: 'no-store' },
  ),
  generate: (formData: FormData) => apiUpload<any>('/google-flow/generate', formData),
}
