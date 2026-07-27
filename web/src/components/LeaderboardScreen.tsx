import { ChevronLeft, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchLeaderboard, fetchWeeklyLeaderboard, subscribeScores } from '../api'
import { cue } from '../feedback'
import { cacheKeys, getCached } from '../lib/cache'
import type { LeaderboardEntry } from '../types'
import { Logo } from './Logo'
import { Skeleton, SkeletonBoardRow } from './Skeleton'

interface Props {
  userId: string
  onBack: () => void
}

type BoardTab = 'week' | 'all'

function msUntilReset(now = Date.now()): number {
  const d = new Date(now)
  const daysUntilMonday = ((8 - d.getUTCDay()) % 7) || 7
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilMonday)
  return next - now
}

function formatReset(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const MEDAL = ['rank-gold', 'rank-silver', 'rank-bronze']

export function LeaderboardScreen({ userId, onBack }: Props) {
  const [tab, setTab] = useState<BoardTab>('week')
  const [entries, setEntries] = useState<LeaderboardEntry[]>(
    () => getCached<LeaderboardEntry[]>(cacheKeys.board('week')) ?? [],
  )
  const [loading, setLoading] = useState(
    () => getCached<LeaderboardEntry[]>(cacheKeys.board('week')) === undefined,
  )
  const [error, setError] = useState<string | null>(null)
  const [resetMs, setResetMs] = useState(() => msUntilReset())

  useEffect(() => {
    const id = setInterval(() => setResetMs(msUntilReset()), 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const fetcher = tab === 'week' ? fetchWeeklyLeaderboard : fetchLeaderboard
    // Show cached rows for this tab instantly; otherwise skeleton.
    const cached = getCached<LeaderboardEntry[]>(cacheKeys.board(tab))
    if (cached) {
      setEntries(cached)
      setLoading(false)
    } else {
      setEntries([])
      setLoading(true)
    }
    async function load() {
      try {
        const data = await fetcher()
        if (!cancelled) {
          setEntries(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load board')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const unsubscribe = subscribeScores(() => {
      void fetcher().then((data) => {
        if (!cancelled) {
          setEntries(data)
          setLoading(false)
          setError(null)
        }
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [tab])

  const MIN_ROWS = 5
  const top = entries.slice(0, 3)
  const rest = entries.slice(3)
  const ghostCount = Math.max(0, MIN_ROWS - entries.length)

  return (
    <section className="screen board-screen" aria-labelledby="board-title">
      <header className="topbar">
        <button type="button" className="icon-round-btn" onClick={onBack} aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2} />
        </button>
        <Logo height={28} />
      </header>

      <h1 id="board-title">Leaderboard</h1>

      <div className="board-tabs" role="tablist" aria-label="Leaderboard range">
        {(
          [
            { id: 'week', label: 'This Week' },
            { id: 'all', label: 'All-time' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`board-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => {
              if (tab !== t.id) {
                cue.toggle()
                setTab(t.id)
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="board-subhead">
        <p className="lede">
          {tab === 'week'
            ? 'Points from moves this week. Top three get the podium.'
            : 'All-time points across every move and reaction.'}
        </p>
        {tab === 'week' ? (
          <span className="reset-chip">
            <Clock size={14} strokeWidth={2} aria-hidden="true" />
            Resets in {formatReset(resetMs)}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <>
          <ol className="podium">
            {[0, 1, 2].map((i) => (
              <li key={i} className={`podium-slot ${MEDAL[i]} is-skeleton`}>
                <Skeleton circle width={40} height={40} className="podium-rank-skeleton" />
                <Skeleton width="55%" height={13} />
                <Skeleton width={40} height={22} radius={8} />
                <Skeleton width="35%" height={10} style={{ marginTop: 6 }} />
              </li>
            ))}
          </ol>
          <div className="board-list">
            <SkeletonBoardRow />
            <SkeletonBoardRow />
          </div>
        </>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <h2>{tab === 'week' ? 'No moves yet this week' : 'No moves yet'}</h2>
          <p>
            {tab === 'week'
              ? 'Clear a challenge to put yourself on this week’s board.'
              : 'Points land here as the team completes challenges.'}
          </p>
        </div>
      ) : (
        <div className="board-stack">
          {top.length > 0 ? (
            <ol className="podium">
              {top.map((entry, i) => (
                <li
                  key={entry.userId}
                  className={`podium-slot ${MEDAL[i]} ${entry.userId === userId ? 'is-me' : ''}`}
                >
                  <span className="podium-rank">{entry.rank}</span>
                  <span className="podium-name">
                    {entry.displayName}
                    {entry.userId === userId ? ' · you' : ''}
                  </span>
                  <span className="podium-points">{entry.totalPoints}</span>
                  <span className="podium-sub">{entry.acceptedCount} moves</span>
                </li>
              ))}
            </ol>
          ) : null}

          {rest.length > 0 ? (
            <ol className="board-list">
              {rest.map((entry) => {
                const mine = entry.userId === userId
                return (
                  <li key={entry.userId} className={mine ? 'is-me' : undefined}>
                    <span className="rank">{entry.rank}</span>
                    <div className="board-main">
                      <strong>
                        {entry.displayName}
                        {mine ? ' · you' : ''}
                      </strong>
                      <span className="muted">{entry.acceptedCount} moves</span>
                    </div>
                    <span className="board-points">{entry.totalPoints}</span>
                  </li>
                )
              })}
            </ol>
          ) : null}

          {ghostCount > 0 ? (
            <div className="board-ghosts" aria-hidden="true">
              {Array.from({ length: ghostCount }).map((_, i) => (
                <div
                  key={i}
                  className="board-ghost"
                  style={{ opacity: Math.max(0.06, 0.42 * 0.66 ** i) }}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
