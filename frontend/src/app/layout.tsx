import type { Metadata, Viewport } from 'next'
// Self-hosted first, then the app's own rules, so component styles win ties.
import './fonts.css'
import './globals.css'
import { Toaster } from 'react-hot-toast'

/**
 * Site-wide defaults. The public pages (/ , /login, /register) override these in
 * app/(marketing)/layout.tsx with host-aware canonical and Open Graph URLs — this
 * block is what the signed-in product inherits, which does not want to be indexed.
 */
export const metadata: Metadata = {
  title: { default: 'HerovaAi — AI & WhatsApp platform', template: '%s · HerovaAi' },
  description: 'Private local AI, WhatsApp automation and business memory for your company.',
  applicationName: 'HerovaAi',
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3001'),
  icons: { icon: '/icon.png', apple: '/icon.png' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
}

/** Keeps the browser chrome obsidian on mobile instead of flashing white. */
export const viewport: Viewport = {
  themeColor: '#0a0d0f',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-animated min-h-screen">
        {children}
        <Toaster
          position="top-right"
          gutter={10}
          toastOptions={{
            duration: 4000,
            style: {
              background: 'rgba(18,22,24,0.96)',
              color: '#f4f5f3',
              border: '1px solid rgba(255,255,255,0.09)',
              backdropFilter: 'blur(18px)',
              borderRadius: '0.85rem',
              boxShadow: '0 24px 60px -30px rgba(0,0,0,1)',
              fontSize: '13px',
              padding: '0.7rem 0.9rem',
              maxWidth: '26rem',
            },
            success: { iconTheme: { primary: '#34d399', secondary: '#0a0d0f' } },
            error: { iconTheme: { primary: '#f87171', secondary: '#0a0d0f' } },
            loading: { iconTheme: { primary: '#c0a872', secondary: '#0a0d0f' } },
          }}
        />
      </body>
    </html>
  )
}
