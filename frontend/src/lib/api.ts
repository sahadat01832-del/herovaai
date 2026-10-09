import { apiRequest } from './auth'

// ─── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  /** Whether "Continue with Google" is switched on, plus the URLs Google needs. */
  googleStatus: () => apiRequest<any>('/auth/google/status'),
  login: (email: string, password: string) =>
    apiRequest<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string, phone?: string) =>
    apiRequest<any>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, phone }) }),
  me: () => apiRequest<any>('/auth/me'),
}

// ─── Chat ──────────────────────────────────────────────────────────────────
export const chatApi = {
  getConversations: () => apiRequest<any>('/chat/conversations'),
  getConversation: (id: string) => apiRequest<any>(`/chat/conversations/${id}`),
  createConversation: (mode: string, model?: string, skill?: string) =>
    apiRequest<any>('/chat/conversations', { method: 'POST', body: JSON.stringify({ mode, model, skill }) }),
  deleteConversation: (id: string) =>
    apiRequest<any>(`/chat/conversations/${id}`, { method: 'DELETE' }),
  sendMessage: (conversationId: string, message: string, mode?: string, model?: string, attachments?: any[], skill?: string, signal?: AbortSignal) =>
    apiRequest<any>(`/chat/conversations/${conversationId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message, mode, model, attachments, skill }),
      signal,
    }),
  /** Stop an in-flight reply (backend aborts the upstream AI request too). */
  stopMessage: (conversationId: string) =>
    apiRequest<any>(`/chat/conversations/${conversationId}/stop`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
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
  unloadModel: (model?: string) =>
    apiRequest<any>('/chat/lm-studio/unload', {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),
  getLmStatus: () => apiRequest<any>('/chat/lm-studio/status'),
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
  /** Message log for one session, optionally narrowed to a single customer. */
  getMessages: (id: string, from?: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/messages${from ? `?from=${encodeURIComponent(from)}` : ''}`),
  createSession: (sessionName: string) =>
    apiRequest<any>('/whatsapp/sessions', { method: 'POST', body: JSON.stringify({ sessionName }) }),
  disconnect: (id: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/disconnect`, { method: 'POST' }),
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
  updateUserSubscription: (id: string, data: any) =>
    apiRequest<any>(`/admin/users/${id}/subscription`, { method: 'PUT', body: JSON.stringify(data) }),
  resetUserTokens: (id: string) =>
    apiRequest<any>(`/admin/users/${id}/reset-tokens`, { method: 'POST' }),

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
