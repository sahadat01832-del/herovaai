import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/site'

// Built per request so the sitemap URL is the hostname the crawler actually used
// (localhost, the LAN address or the public tunnel) instead of a stale one.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const base = siteOrigin()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The product itself is behind a login; publishing a dashboard does nothing
        // for search and everything for a crawler getting lost.
        disallow: ['/api/', '/dashboard', '/auth/', '/dashboard/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
