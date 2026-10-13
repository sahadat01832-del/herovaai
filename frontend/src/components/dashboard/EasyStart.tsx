'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Image as ImageIcon, MessageCircle, Smartphone, Video, Youtube } from 'lucide-react'
import { authApi } from '@/lib/api'
import { getApiUrl } from '@/lib/auth'
import { Badge, Button } from '@/components/ui/primitives'
import toast from 'react-hot-toast'

/* ══════════════════════════════════════════════════════════════════════════
   Start here — the short version.

   Written for someone who has never seen an API key and does not want to.
   Three plain facts, in this order:

     1. Images need no setup; Flow and backup engines are tried automatically.
     2. YouTube connects with one click, using a Google account you already have.
     3. Everything else is either "we show you the exact page to copy from" or
        honestly not possible, with what to do instead.

   The detailed cards below stay for anyone who wants them; this panel is the
   part that does not require reading them.
   ══════════════════════════════════════════════════════════════════════════ */

type Props = {
  onOpenChannel: (channelId: string) => void
  imageAccountsReady: boolean | null
}

function Row({
  icon, title, children, action,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-white/[0.06] py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-brand-200">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-white">{title}</p>
        <div className="mt-1 text-[12.5px] leading-relaxed text-dark-400">{children}</div>
        {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}

export function EasyStart({ onOpenChannel, imageAccountsReady }: Props) {
  const [starting, setStarting] = useState(false)

  const connectYoutube = async () => {
    setStarting(true)
    try {
      const res = await authApi.youtubeConnectStart()
      if (!res?.state) throw new Error('no state returned')
      // Same origin as every other API call — the callback comes back to this app.
      window.location.href = `${getApiUrl()}/auth/google/youtube?state=${encodeURIComponent(res.state)}`
    } catch (err: any) {
      setStarting(false)
      toast.error(err?.message || 'Could not start the Google connection — try the token route in the YouTube card.')
    }
  }

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-300">Start here</p>
          <h2 className="mt-1 text-[16px] font-semibold text-white">What works today, and how little you have to do</h2>
        </div>
        <Badge tone="green" icon={<Check className="h-3 w-3" />}>10 free · 100 Pro · unlimited Enterprise</Badge>
      </div>

      <div className="mt-5">
        <Row
          icon={<MessageCircle className="h-4 w-4" aria-hidden />}
          title="WhatsApp — link your existing shop number"
          action={
            <Link href="/dashboard/whatsapp" className="btn-gold inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-semibold">
              Set up WhatsApp <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          Enter the number you want to use and follow the pairing-code steps on your phone. Linking alone
          does not send replies: switch on “Reply to new customer messages” when you are ready, then test
          from another phone. Turn it off here any time to pause.
        </Row>

        <Row
          icon={<ImageIcon className="h-4 w-4" aria-hidden />}
          title={imageAccountsReady === false
            ? 'AI images — backup engine available to try'
            : imageAccountsReady
              ? 'AI images — no personal account connection needed'
              : 'AI images — checking image service'}
          action={
            imageAccountsReady !== null ? (
              <Link href="/dashboard/chat" className="btn-gold inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-semibold">
                Generate one now <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null
          }
        >
          {imageAccountsReady === false ? (
            <>The shared Google Flow pool is offline, so HerovaAi will try its configured backup image engine. If that engine is unavailable too, the chat will explain the problem and you can retry. Your allowance is <strong className="text-white">10 successful images a day on Free, 100 per billing cycle on Pro, or unlimited on Enterprise</strong>. No personal Google account or API key is needed.</>
          ) : imageAccountsReady ? (
            <>Generate <strong className="text-white">10 images a day on Free, 100 per billing cycle on Pro, or unlimited on Enterprise</strong> with Google Flow Nano Banana Pro through HerovaAi&apos;s shared accounts. You do not need to connect your own Google account or provide an API key. Your personal Flow account remains optional for video. Try <span className="text-dark-300">“a photo of my shop at golden hour”</span>.</>
          ) : (
            <>Checking whether HerovaAi&apos;s shared Google Flow accounts are ready. You will not need to connect your own Google account for image generation.</>
          )}
        </Row>

        <Row
          icon={<Youtube className="h-4 w-4" aria-hidden />}
          title="YouTube — one click with the Google account you already have"
          action={
            <>
              <Button size="sm" loading={starting} onClick={connectYoutube}>Connect YouTube with Google</Button>
              <button
                type="button"
                onClick={() => onOpenChannel('youtube')}
                className="text-[12px] font-medium text-dark-400 underline decoration-white/20 underline-offset-4 hover:text-white"
              >
                or paste a token instead
              </button>
            </>
          }
        >
          Uploads Shorts and full videos, writes the title and tags, and answers comments on your videos.
          No developer console, no copied keys — Google asks you to approve it once. (If you would rather
          paste an access token, that route is still in the card below.)
        </Row>

        <Row
          icon={<MessageCircle className="h-4 w-4" aria-hidden />}
          title="Facebook Page and Messenger — we show you the two values to copy"
          action={
            <>
              <Button size="sm" variant="ghost" onClick={() => onOpenChannel('facebook_page')}>Post to my Page</Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenChannel('messenger')}>Answer Page messages</Button>
            </>
          }
        >
          Meta does not allow a one-click connect for posting, so this one needs two short copy-pastes from
          your own Page (the steps name the exact screen). Once saved, posting, photos, videos and comment
          replies run on their own.
        </Row>

        <Row
          icon={<Video className="h-4 w-4" aria-hidden />}
          title="TikTok — paste one bridge link, or a token if you have one"
          action={<Button size="sm" variant="ghost" onClick={() => onOpenChannel('tiktok')}>Set up TikTok</Button>}
        >
          The quickest route is a free Make/Zapier/n8n webhook that already knows how to post to TikTok:
          create it, paste the link here, done. A direct Creator token works too — comment replies need
          TikTok&apos;s own approval.
        </Row>

        <Row icon={<Smartphone className="h-4 w-4" aria-hidden />} title="imo — honestly not possible">
          imo publishes no API for anyone, so no app can answer its chats automatically, ours included. The
          practical move is to point those customers at your WhatsApp number, where the assistant already
          replies — pair it from the WhatsApp page.
        </Row>
      </div>
    </section>
  )
}
