import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteOrigin } from '@/lib/site'

/**
 * The public pages (/, /login, /register) live in this group.
 *
 * They get their own metadata instead of inheriting the root defaults because
 * they are the only pages that should be indexed, and because the absolute URLs
 * have to match the hostname this deployment is currently answered on — the app
 * is self-hosted, so that hostname can be a LAN address today and a public tunnel
 * tomorrow. Rendering per request is the price of never emitting a canonical link
 * that points somewhere the visitor is not.
 */
export const dynamic = 'force-dynamic'

const KEYWORDS = [
  'WhatsApp AI assistant',
  'AI customer service',
  'shop assistant bot',
  'small business chatbot',
  'private AI assistant',
  'answer customer questions automatically',
  'bangla business AI',
]

export async function generateMetadata(): Promise<Metadata> {
  const base = siteOrigin()
  const h = headers()
  // The gateway records the exact path, so /login claims /login rather than /.
  const raw = h.get('x-forwarded-uri') || h.get('x-invoke-path') || '/'
  const path = raw.split('?')[0] || '/'
  const canonical = path.startsWith('/') ? path : '/'
  const title = `${SITE_NAME} — ${SITE_TAGLINE}`

  return {
    metadataBase: new URL(base),
    // absolute: the exact line we want in the tab, instead of the root layout's
    // "%s · HerovaAi" template appending the name a second time.
    title: { absolute: title },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    keywords: KEYWORDS,
    category: 'business software',
    alternates: { canonical },
    openGraph: {
      type: 'website',
      url: `${base}${canonical === '/' ? '' : canonical}`,
      siteName: SITE_NAME,
      title,
      description: SITE_DESCRIPTION,
      locale: 'en_US',
      images: [{ url: '/og.png', width: 1200, height: 630, alt: `${SITE_NAME} — ${SITE_TAGLINE}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: SITE_DESCRIPTION,
      images: ['/og.png'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
  }
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const base = siteOrigin()
  const structured = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${base}/#organization`,
        name: SITE_NAME,
        url: base,
        logo: `${base}/logo.png`,
        description: SITE_DESCRIPTION,
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        url: base,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        publisher: { '@id': `${base}/#organization` },
        inLanguage: 'en',
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: SITE_DESCRIPTION,
        url: base,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free to try, no sign-up needed' },
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        // Structured data is JSON we build ourselves, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structured) }}
      />
      {children}
    </>
  )
}
