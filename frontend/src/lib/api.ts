import { apiRequest } from './auth'

// ─── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
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
  sendMessage: (conversationId: string, message: string, mode?: string, model?: string, attachments?: any[], skill?: string) =>
    apiRequest<any>(`/chat/conversations/${conversationId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message, mode, model, attachments, skill }),
    }),
  sendPublicMessage: (message: string, conversationId?: string | null, model?: string) =>
    apiRequest<any>('/chat/public/message', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId, model }),
    }),
  getModels: () => apiRequest<any>('/chat/models'),
  getSkills: () => apiRequest<any>('/chat/skills'),
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
}

// ─── Memory ────────────────────────────────────────────────────────────────
export const memoryApi = {
  get: () => apiRequest<any>('/memory'),
  update: (data: any) => apiRequest<any>('/memory', { method: 'PUT', body: JSON.stringify(data) }),
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
  getMessages: (id: string, from?: string) =>
    apiRequest<any>(`/whatsapp/sessions/${id}/messages${from ? `?from=${from}` : ''}`),
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
}
