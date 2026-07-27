import { Send, SmilePlus, Trash2, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { commentOnPost, deleteOwnPost, fetchReactors, reactToPost } from '../api'
import { iconForChallenge } from '../challengeIcon'
import { cue } from '../feedback'
import { timeAgo } from '../labels'
import type { FeedComment, FeedItem, ReactionSummary } from '../types'
import { Avatar } from './Avatar'
import { EmojiPicker } from './EmojiPicker'

interface Props {
  item: FeedItem
  userId: string
  /** When provided, the author name/avatar links to that user's profile. */
  onOpenProfile?: (userId: string) => void
  /**
   * Called when this post's reactions/comments change, so a parent list can
   * keep its own copy fresh (e.g. the profile grid behind a post modal —
   * otherwise reopening the modal shows stale engagement).
   */
  onEngagementChange?: (
    attemptId: string,
    patch: { reactions?: ReactionSummary[]; comments?: FeedComment[] },
  ) => void
  /** Called after the owner deletes this post, so the parent can drop it. */
  onDeleted?: (attemptId: string) => void
}

/** How many recent comments to show before the list is expanded. */
const COMMENT_PREVIEW = 2

/**
 * A single feed post with reactions + comments. Shared by the Home feed
 * (inline list) and the profile page (inside a floating post modal).
 */
export function PostCard({
  item,
  userId,
  onOpenProfile,
  onEngagementChange,
  onDeleted,
}: Props) {
  const isMine = item.userId === userId
  const [reactions, setReactions] = useState<ReactionSummary[]>(item.reactions)
  const [comments, setComments] = useState<FeedComment[]>(item.comments)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [commentsExpanded, setCommentsExpanded] = useState(false)
  const [reactError, setReactError] = useState<string | null>(null)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [reactorsEmoji, setReactorsEmoji] = useState<string | null>(null)
  const [reactorList, setReactorList] = useState<
    { userId: string; displayName: string }[] | null
  >(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const TaskIcon = iconForChallenge({
    title: item.challengeTitle,
    prompt: item.challengePrompt,
  })

  useEffect(() => {
    setReactions(item.reactions)
    setComments(item.comments)
  }, [item.reactions, item.comments])

  function grow() {
    const el = inputRef.current
    if (!el) return
    const max = 140
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    // Only allow scrolling once the box hits its max height; otherwise the
    // textarea shows an awkward scrollbar while it's still growing.
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }

  function applyReactions(next: ReactionSummary[]) {
    setReactions(next)
    onEngagementChange?.(item.attemptId, { reactions: next })
  }

  async function react(emoji: string) {
    if (isMine) return
    const previous = reactions
    const existing = previous.find((r) => r.emoji === emoji)
    const optimistic = existing
      ? previous
          .map((r) =>
            r.emoji === emoji
              ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) }
              : r,
          )
          .filter((r) => r.count > 0)
      : [...previous, { emoji, count: 1, mine: true }]
    cue.react()
    setPickerOpen(false)
    setReactError(null)
    applyReactions(optimistic)
    try {
      const authoritative = await reactToPost(item.attemptId, emoji)
      applyReactions(authoritative)
    } catch (err) {
      applyReactions(previous)
      setReactError(err instanceof Error ? err.message : 'Could not react')
    }
  }

  async function postComment() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setCommentError(null)
    try {
      const comment = await commentOnPost(item.attemptId, body)
      cue.tick()
      const next = [...comments, comment]
      setComments(next)
      onEngagementChange?.(item.attemptId, { comments: next })
      setDraft('')
      requestAnimationFrame(grow)
    } catch (err) {
      // Keep the draft so the user can retry, and surface the failure.
      cue.error()
      setCommentError(err instanceof Error ? err.message : 'Could not post comment')
    } finally {
      setBusy(false)
    }
  }

  function onCommentSubmit(e: FormEvent) {
    e.preventDefault()
    void postComment()
  }

  function onCommentKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void postComment()
    }
  }

  async function openReactors(emoji: string) {
    setReactorsEmoji(emoji)
    setReactorList(null)
    try {
      const people = await fetchReactors(item.attemptId, emoji)
      setReactorList(people)
    } catch {
      setReactorList([])
    }
  }

  function startPress(emoji: string) {
    longPressed.current = false
    cancelPress()
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      cue.tick()
      void openReactors(emoji)
    }, 450)
  }

  function cancelPress() {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteOwnPost(item.attemptId)
      cue.tick()
      setConfirmingDelete(false)
      onDeleted?.(item.attemptId)
    } catch (err) {
      cue.error()
      setDeleteError(err instanceof Error ? err.message : 'Could not delete post')
    } finally {
      setDeleting(false)
    }
  }

  const canOpenProfile = Boolean(onOpenProfile)
  const hasHiddenComments = comments.length > COMMENT_PREVIEW
  const visibleComments =
    commentsExpanded || !hasHiddenComments
      ? comments
      : comments.slice(-COMMENT_PREVIEW)

  return (
    <article className={`feed-card ${isMine ? 'is-mine' : ''}`}>
      <header className="feed-head">
        {canOpenProfile ? (
          <button
            type="button"
            className="feed-author-link"
            onClick={() => onOpenProfile?.(item.userId)}
            aria-label={`View ${item.displayName}'s profile`}
          >
            <Avatar name={item.displayName} size={40} />
          </button>
        ) : (
          <Avatar name={item.displayName} size={40} />
        )}
        <div className="feed-id">
          <span className="feed-author">
            {canOpenProfile ? (
              <button
                type="button"
                className="feed-author-name"
                onClick={() => onOpenProfile?.(item.userId)}
              >
                {item.displayName}
              </button>
            ) : (
              item.displayName
            )}
            {isMine ? <span className="feed-you"> · you</span> : null}
          </span>
          <span className="feed-meta">
            <TaskIcon size={13} strokeWidth={2} aria-hidden="true" />
            <span className="feed-meta-task">{item.challengeTitle}</span>
            <span className="feed-meta-sep">·</span>
            {timeAgo(item.awardedAt)}
          </span>
        </div>
        {isMine ? (
          <button
            type="button"
            className="feed-delete"
            onClick={() => {
              setDeleteError(null)
              setConfirmingDelete(true)
            }}
            aria-label="Delete this post"
          >
            <Trash2 size={18} strokeWidth={2} />
          </button>
        ) : null}
      </header>

      {item.photoUrl ? (
        <div className="feed-photo-wrap">
          <button
            type="button"
            className="feed-photo"
            onClick={() => setLightbox(true)}
            aria-label="View full size"
          >
            <img
              src={item.photoUrl}
              alt={`${item.displayName}: ${item.challengeTitle}`}
              loading="lazy"
            />
          </button>
          <span className="feed-points">+{item.pointsAwarded}</span>
        </div>
      ) : null}

      {lightbox && item.photoUrl
        ? createPortal(
            <div className="lightbox" onClick={() => setLightbox(false)}>
              <button
                type="button"
                className="lightbox-close"
                aria-label="Close"
                onClick={() => setLightbox(false)}
              >
                <X size={24} />
              </button>
              <img
                src={item.photoUrl}
                alt="Full size"
                onClick={(e) => e.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}

      <div className="feed-body">
        <div className="reaction-bar">
          {reactions.map((r) =>
            isMine ? (
              <button
                key={r.emoji}
                type="button"
                className={`reaction static ${r.mine ? 'mine' : ''}`}
                onPointerDown={() => startPress(r.emoji)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onClick={() => openReactors(r.emoji)}
                aria-label={`See who reacted ${r.emoji}`}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="reaction-count">{r.count}</span>
              </button>
            ) : (
              <button
                key={r.emoji}
                type="button"
                className={`reaction ${r.mine ? 'mine' : ''}`}
                aria-pressed={r.mine}
                onPointerDown={() => startPress(r.emoji)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onClick={() => {
                  // Suppress the toggle if this was a long-press.
                  if (longPressed.current) {
                    longPressed.current = false
                    return
                  }
                  void react(r.emoji)
                }}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <span className="reaction-count">{r.count}</span>
              </button>
            ),
          )}
          {!isMine ? (
            <div className="reaction-add">
              <button
                type="button"
                className="reaction add"
                aria-label="Add a reaction"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((v) => !v)}
              >
                <SmilePlus size={18} strokeWidth={2} />
              </button>
              {pickerOpen ? (
                <EmojiPicker onPick={(e) => void react(e)} onClose={() => setPickerOpen(false)} />
              ) : null}
            </div>
          ) : reactions.length === 0 ? (
            <p className="muted reaction-empty">Teammates can react to your move</p>
          ) : null}
        </div>
        {reactError ? (
          <p className="banner error" role="alert">
            {reactError}
          </p>
        ) : null}

        <div className="feed-comments">
          {comments.length > 0 ? (
            <>
              {hasHiddenComments && !commentsExpanded ? (
                <button
                  type="button"
                  className="comment-toggle"
                  onClick={() => setCommentsExpanded(true)}
                >
                  View all {comments.length} comments
                </button>
              ) : null}
              <ul className={`comment-list ${commentsExpanded ? 'expanded' : ''}`}>
                {visibleComments.map((c) => (
                  <li key={c.id}>
                    <Avatar name={c.displayName} avatarUrl={c.avatarUrl} size={26} />
                    <span className="comment-text">
                      <span className="comment-author">{c.displayName}</span>
                      <span className="comment-body">{c.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {hasHiddenComments && commentsExpanded ? (
                <button
                  type="button"
                  className="comment-toggle"
                  onClick={() => setCommentsExpanded(false)}
                >
                  Show fewer comments
                </button>
              ) : null}
            </>
          ) : null}

          <form className="comment-form" onSubmit={onCommentSubmit}>
            <textarea
              ref={inputRef}
              rows={1}
              maxLength={280}
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                grow()
              }}
              onKeyDown={onCommentKeyDown}
              disabled={busy}
              aria-label={`Comment on ${item.displayName}'s move`}
            />
            <button
              type="submit"
              className="ghost-btn icon-btn comment-send"
              disabled={busy || draft.trim().length < 1}
              aria-label="Post comment"
            >
              <Send size={16} strokeWidth={2} />
            </button>
          </form>
          {commentError ? (
            <p className="banner error" role="alert">
              {commentError}
            </p>
          ) : null}
        </div>
      </div>

      {confirmingDelete
        ? createPortal(
            <div
              className="confirm-overlay"
              onClick={() => (deleting ? null : setConfirmingDelete(false))}
            >
              <div
                className="confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="confirm-title" className="confirm-title">
                  Delete this post?
                </h2>
                <p className="confirm-text">
                  This removes your “{item.challengeTitle}” post and subtracts the
                  {` ${item.pointsAwarded} `}
                  points it earned. This can’t be undone.
                </p>
                {deleteError ? (
                  <p className="banner error" role="alert">
                    {deleteError}
                  </p>
                ) : null}
                <div className="confirm-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => void confirmDelete()}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {reactorsEmoji
        ? createPortal(
            <div className="reactors-overlay" onClick={() => setReactorsEmoji(null)}>
              <div
                className="reactors-sheet"
                role="dialog"
                aria-label={`People who reacted ${reactorsEmoji}`}
                onClick={(e) => e.stopPropagation()}
              >
                <p className="reactors-title">
                  <span aria-hidden="true">{reactorsEmoji}</span>
                  <span>Reacted</span>
                </p>
                {reactorList === null ? (
                  <p className="reactors-empty">Loading…</p>
                ) : reactorList.length === 0 ? (
                  <p className="reactors-empty">No one yet</p>
                ) : (
                  <ul className="reactors-list">
                    {reactorList.map((person) => (
                      <li key={person.userId}>
                        <Avatar name={person.displayName} size={30} />
                        <span className="reactors-name">
                          {person.displayName}
                          {person.userId === userId ? ' · you' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </article>
  )
}
