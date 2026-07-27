import { Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchFeed, subscribeAcceptedAttempts } from '../api'
import { cacheKeys, getCached } from '../lib/cache'
import type { FeedItem } from '../types'
import { Logo } from './Logo'
import { PostCard } from './PostCard'
import { SkeletonFeedCard } from './Skeleton'

interface Props {
  userId: string
  onOpenLeaderboard: () => void
  onOpenProfile: (userId: string) => void
}

export function FeedScreen({ userId, onOpenLeaderboard, onOpenProfile }: Props) {
  const cachedFeed = getCached<FeedItem[]>(cacheKeys.feed)
  const [items, setItems] = useState<FeedItem[]>(cachedFeed ?? [])
  const [loading, setLoading] = useState(!cachedFeed)
  const [error, setError] = useState<string | null>(null)
  const [barHidden, setBarHidden] = useState(false)

  // Auto-hide the top bar: hide on scroll down, reveal on scroll up.
  useEffect(() => {
    let last = window.scrollY
    function onScroll() {
      const y = window.scrollY
      if (y < 12) {
        setBarHidden(false)
      } else if (y > last + 5) {
        setBarHidden(true)
      } else if (y < last - 5) {
        setBarHidden(false)
      }
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchFeed({ limit: 50 })
        if (!cancelled) setItems(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load feed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const unsubscribe = subscribeAcceptedAttempts(() => {
      void fetchFeed({ limit: 50 }).then((data) => {
        if (!cancelled) setItems(data)
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return (
    <section className="screen feed-screen" aria-label="Home feed">
      <header className={`topbar feed-topbar ${barHidden ? 'hidden' : ''}`}>
        <Logo height={28} />
        <button
          type="button"
          className="icon-round-btn"
          onClick={onOpenLeaderboard}
          aria-label="Open leaderboard"
        >
          <Trophy size={20} strokeWidth={2} />
        </button>
      </header>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="feed-list">
          <SkeletonFeedCard />
          <SkeletonFeedCard />
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing here yet</h2>
          <p>Be the first to get up and post a move.</p>
        </div>
      ) : (
        <ul className="feed-list">
          {items.map((item, index) => (
            <li key={item.attemptId} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
              <PostCard
                item={item}
                userId={userId}
                onOpenProfile={onOpenProfile}
                onDeleted={(attemptId) =>
                  setItems((cur) => cur.filter((i) => i.attemptId !== attemptId))
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
