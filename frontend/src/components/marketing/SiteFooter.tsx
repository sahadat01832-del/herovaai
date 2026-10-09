import Link from 'next/link'

/* ══════════════════════════════════════════════════════════════════════════
   One footer for every public page.

   The marketing pages used to end on a bare copyright line: no way to reach
   the policies, no way to reach the operator. Visitor-facing software is
   expected to publish the pages a person looks for before trusting it with a
   business number, so the footer now carries them and every marketing route
   renders this component instead of its own strip.

   Deliberately dependency-free (no hooks, no server-only imports) because the
   home page is a client component and importing this from it must stay legal.
   ══════════════════════════════════════════════════════════════════════════ */

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/', label: 'Home' },
      { href: '/register', label: 'Create account' },
      { href: '/login', label: 'Sign in' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Terms of Service' },
    ],
  },
] as const

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/[0.06] py-9">
      <div className="mx-auto w-full max-w-6xl px-5">
        <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <span className="font-display text-[13.5px] font-semibold text-white">
              Herova<span className="text-brand-400">Ai</span>
            </span>
            <p className="mt-2 text-[12px] leading-relaxed text-dark-500">
              The assistant that answers your customers on WhatsApp while you serve them — with a
              memory of your business, made for local shops and small teams.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-12 gap-y-6" aria-label="Footer">
            {COLUMNS.map(column => (
              <div key={column.title}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dark-600">
                  {column.title}
                </p>
                <ul className="mt-3 space-y-2 text-[12.5px]">
                  {column.links.map(link => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-dark-400 transition-colors hover:text-white">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-2 border-t border-white/[0.05] pt-5 text-[11.5px] text-dark-600 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} HerovaAi · the AI assistant for local businesses</span>
          <span>WhatsApp replies · business memory · optional and yours to pause</span>
        </div>
      </div>
    </footer>
  )
}
