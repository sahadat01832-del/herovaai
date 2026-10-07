import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'

export const metadata: Metadata = {
  title: 'ContentBot Dashboard',
  description: 'AI-powered content management & automation platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-animated min-h-screen">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(13,13,43,0.95)',
              color: '#f8f8fc',
              border: '1px solid rgba(255,255,255,0.1)',
              backdropFilter: 'blur(20px)',
              borderRadius: '0.75rem',
            },
            success: { iconTheme: { primary: '#22c55e', secondary: '#070715' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#070715' } },
          }}
        />
      </body>
    </html>
  )
}
