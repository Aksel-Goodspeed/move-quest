import { ChevronLeft, Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchUserPosts, fetchUserProfile } from '../api'
import { cacheKeys, getCached } from '../lib/cache'
import type { FeedItem, UserProfile } from '../types'
import { Avatar } from './Avatar'
import { PostCard } from './PostCard'
import { Skeleton } from './Skeleton'

interface Props {
  profileUserId: string
  currentUserId: string
  onBack: () => void
  onOpenSettings: () => void
}

export function ProfilePage({
  profileUserId,
  currentUserId,
  onBack,
  onOpenSettings,
}: Props) {
  const isMe = profileUserId === currentUserId
  const [profile, setProfile] = useState<UserProfile | null>(
    () => getCached<UserProfile>(cacheKeys.profile(profileUserId)) ?? null,
  )
  const [posts, setPosts] = useState<FeedItem[]>(
    () => getCached<FeedItem[]>(cacheKeys.posts(profileUserId)) ?? [],
  )
  const [loading, setLoading] = useState(
    () => getCached<UserProfile>(cacheKeys.profile(profileUserId)) === undefined,
  )
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setOpenId(null)
    // Show cached data instantly (stale-while-revalidate); otherwise skeleton.
    const cachedProfile = getCached<UserProfile>(cacheKeys.profile(profileUserId))
    if (cachedProfile) {
      setProfile(cachedProfile)
      setPosts(getCached<FeedItem[]>(cacheKeys.posts(profileUserId)) ?? [])
      setLoading(false)
    } else {
      setProfile(null)
      setPosts([])
      setLoading(true)
    }
    async function load() {
      try {
        const [prof, userPosts] = await Promise.all([
          fetchUserProfile(profileUserId),
          fetchUserPosts(profileUserId, { limit: 60 }),
        ])
        if (!cancelled) {
          setProfile(prof)
          setPosts(userPosts)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profileUserId])

  async function handleDeleted(attemptId: string) {
    setPosts((cur) => cur.filter((p) => p.attemptId !== attemptId))
    setOpenId(null)
    // Refresh header stats (uploads + points dropped).
    try {
      const prof = await fetchUserProfile(profileUserId)
      setProfile(prof)
    } catch {
      // Non-fatal; the grid already reflects the removal.
    }
  }

  const openPost = posts.find((p) => p.attemptId === openId) ?? null
  const name = profile?.displayName ?? 'Player'

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="topbar">
        {isMe ? (
          <span className="topbar-spacer" aria-hidden="true" />
        ) : (
          <button type="button" className="icon-round-btn" onClick={onBack} aria-label="Back">
            <ChevronLeft size={22} strokeWidth={2} />
          </button>
        )}
        <h1 id="profile-title" className="topbar-title">
          {isMe ? 'Your profile' : name}
        </h1>
        {isMe ? (
          <button
            type="button"
            className="icon-round-btn"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <Settings size={20} strokeWidth={2} />
          </button>
        ) : (
          <span className="topbar-spacer" aria-hidden="true" />
        )}
      </header>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="profile-hero">
        <Avatar name={name} size={88} />
        <p className="profile-hero-name">{loading ? '…' : name}</p>
        <div className="profile-stats" role="group" aria-label="Profile stats">
          <div className="profile-stat">
            <span className="profile-stat-num">
              {loading ? <Skeleton width={28} height={20} /> : profile?.uploads ?? 0}
            </span>
            <span className="profile-stat-label">Uploads</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">
              {loading ? (
                <Skeleton width={28} height={20} />
              ) : (
                <>
                  {profile?.weekPoints ?? 0}
                  <span className="profile-stat-unit">pts</span>
                </>
              )}
            </span>
            <span className="profile-stat-label">This week</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-num">
              {loading ? (
                <Skeleton width={28} height={20} />
              ) : (
                <>
                  {profile?.allTimePoints ?? 0}
                  <span className="profile-stat-unit">pts</span>
                </>
              )}
            </span>
            <span className="profile-stat-label">All-time</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="profile-grid">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="profile-grid-cell" radius={12} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <h2>No moves yet</h2>
          <p>{isMe ? 'Clear a challenge and your photos show up here.' : 'No posts from this player yet.'}</p>
        </div>
      ) : (
        <ul className="profile-grid">
          {posts.map((post) => (
            <li key={post.attemptId}>
              <button
                type="button"
                className="profile-grid-cell"
                onClick={() => setOpenId(post.attemptId)}
                aria-label={`${post.challengeTitle} — open post`}
              >
                {post.photoUrl ? (
                  <img src={post.photoUrl} alt={post.challengeTitle} loading="lazy" />
                ) : (
                  <span className="profile-grid-empty" aria-hidden="true" />
                )}
                <span className="profile-grid-points">+{post.pointsAwarded}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openPost
        ? createPortal(
            <div className="post-modal" onClick={() => setOpenId(null)}>
              <div className="post-modal-inner" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="post-modal-close"
                  aria-label="Close"
                  onClick={() => setOpenId(null)}
                >
                  <X size={22} />
                </button>
                <PostCard
                  item={openPost}
                  userId={currentUserId}
                  onEngagementChange={(attemptId, patch) =>
                    setPosts((cur) =>
                      cur.map((p) => (p.attemptId === attemptId ? { ...p, ...patch } : p)),
                    )
                  }
                  onDeleted={(attemptId) => void handleDeleted(attemptId)}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
