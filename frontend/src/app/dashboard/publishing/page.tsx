'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { channelApi } from '@/lib/api'
import { Button, InlineError, Skeleton } from '@/components/ui/primitives'
import { CommercialPostCreator } from '@/components/CommercialPostCreator'
import toast from 'react-hot-toast'

const STATUS: Record<string, string> = {
  scheduled: 'Waiting',
  processing: 'Publishing',
  published: 'Published',
  failed: 'Needs attention',
  cancelled: 'Cancelled',
}

export default function PublishingPage() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response: any = await channelApi.getScheduledPosts()
      setPosts(response.posts || [])
    } catch (err: any) {
      setError(err.message || 'Could not load scheduled posts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const cancel = async (id: string) => {
    setBusyId(id)
    try {
      await channelApi.cancelScheduledPost(id)
      toast.success('Scheduled post cancelled')
      await load()
    } catch (err: any) {
      toast.error(err.message || 'Could not cancel this post')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.22em] text-brand-400/80">Publishing</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Scheduled posts</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-dark-400">
            Review what is queued, see delivery results, or cancel a post before it starts publishing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/chat" className="btn-primary btn-sm inline-flex items-center gap-1.5">
            Create a post <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <Button variant="ghost" size="sm" onClick={load} loading={loading} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
        </div>
      </div>

      <CommercialPostCreator />

      {error ? <InlineError>{error}</InlineError> : null}
      {loading && posts.length === 0 ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}</div>
      ) : null}
      {!loading && posts.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-5 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-400/20 bg-brand-400/[0.07] text-brand-300">
            <CalendarClock className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Nothing is scheduled yet</h2>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-dark-400">
              Create a post from Chat, choose a verified platform, then set the date and time. You can check its status here.
            </p>
          </div>
          <Link href="/dashboard/chat" className="btn-primary btn-sm">Create a post</Link>
        </div>
      ) : null}

      <div className="space-y-3">
        {posts.map((post) => (
          <article key={post._id} className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge badge-violet capitalize">{String(post.channel || '').replaceAll('_', ' ')}</span>
                <span className={`badge ${post.status === 'published' ? 'badge-green' : post.status === 'failed' ? 'badge-amber' : 'badge-slate'}`}>
                  {STATUS[post.status] || post.status}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-dark-100">{post.text}</p>
              {post.mediaUrl ? <p className="mt-2 truncate text-[11px] text-dark-500">Media attached</p> : null}
              <p className="mt-2 text-xs text-dark-400">
                {post.status === 'published' && post.publishedAt
                  ? `Published ${new Date(post.publishedAt).toLocaleString()}`
                  : `Scheduled for ${new Date(post.scheduledAt).toLocaleString()}`}
              </p>
              {post.resultMessage && post.status !== 'scheduled' ? (
                <p className={`mt-2 text-xs leading-relaxed ${post.status === 'failed' ? 'text-amber-300' : 'text-dark-400'}`}>
                  {post.resultMessage}
                </p>
              ) : null}
            </div>
            {post.status === 'scheduled' ? (
              <Button
                variant="danger"
                size="sm"
                loading={busyId === post._id}
                onClick={() => void cancel(post._id)}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                className="w-full sm:w-auto"
              >
                Cancel post
              </Button>
            ) : null}
          </article>
        ))}
      </div>
      {posts.length >= 100 ? <p className="text-center text-[11px] text-dark-500">Showing the 100 most recent scheduled posts.</p> : null}
    </div>
  )
}
