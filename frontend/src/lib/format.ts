/** Formatting helpers shared by every screen, so a number looks the same everywhere. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parse(value?: string | number | Date | null): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "just now", "12m ago", "3d ago" — exact timestamps belong in a title attribute. */
export function relativeTime(value?: string | number | Date | null): string {
  const date = parse(value)
  if (!date) return '—'
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.round(days / 7)}w ago`
  return formatDate(date)
}

export function formatDate(value?: string | number | Date | null): string {
  const date = parse(value)
  if (!date) return '—'
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

export function formatDateTime(value?: string | number | Date | null): string {
  const date = parse(value)
  if (!date) return '—'
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${formatDate(date)}, ${hh}:${mm}`
}

/** 1_240_000 → "1.24M" */
export function compactNumber(value?: number | null): string {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 2)}B`
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

export function formatNumber(value?: number | null): string {
  return Number(value || 0).toLocaleString()
}

/** 0.834 → "83%" */
export function percent(part?: number | null, total?: number | null): number {
  const p = Number(part || 0)
  const t = Number(total || 0)
  if (!t) return 0
  return Math.min(100, Math.round((p / t) * 100))
}

/** Seconds → "2m 14s" */
export function duration(seconds?: number | null): string {
  const s = Math.max(0, Math.round(Number(seconds || 0)))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** 0…4 estimate used by the password meter. */
export function passwordStrength(password: string): { score: number; label: string } {
  const value = String(password || '')
  if (!value) return { score: 0, label: 'Empty' }
  let score = 0
  if (value.length >= 8) score++
  if (value.length >= 12) score++
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++
  if (/\d/.test(value)) score++
  if (/[^A-Za-z0-9]/.test(value)) score++
  return { score: Math.min(3, score), label: ['Very weak', 'Weak', 'Fair', 'Strong'][Math.min(3, score)] }
}
