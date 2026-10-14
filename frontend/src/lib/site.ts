import { headers } from 'next/headers'

/**
 * Where this deployment is being reached from, as seen by the request.
 *
 * The app is self-hosted and answers on localhost, on the LAN and on whatever
 * public hostname the tunnel is using today, so anything that has to be an
 * absolute URL — canonical links, Open Graph, robots.txt, the sitemap — is built
 * from the live request instead of a value frozen into the build.
 *
 * SITE_URL wins when it is set, which is what you want on a permanent domain.
 */
export function requestOrigin(): string {
  const h = headers()
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3001'
  const forwarded = h.get('x-forwarded-proto')
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('192.168.')
  const proto = forwarded || (local ? 'http' : 'https')
  return `${proto}://${host}`
}

/** Absolute origin for SEO documents: the configured site URL, else the request's. */
export function siteOrigin(): string {
  const configured = (process.env.SITE_URL || '').trim().replace(/\/+$/, '')
  return configured || requestOrigin()
}

export const SITE_NAME = 'HerovaAi'
// Kept verbatim in sync with the static public site's <title>/meta description
// (herovaai-site/index.html) so both front doors present the same positioning.
export const SITE_TAGLINE = 'The Autonomous AI Engine for Your Shop & Content'
export const SITE_DESCRIPTION =
  'HerovaAi automates customer service on WhatsApp 24/7 in your own words, generates images and cinematic video with Google Flow, and publishes daily to YouTube Shorts & TikTok. Free to try.'
/** Pages that are meant to be found by search engines. */
export const PUBLIC_ROUTES = ['/', '/login', '/register', '/privacy', '/terms'] as const
