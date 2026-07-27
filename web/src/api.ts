import { cacheKeys, setCached } from './lib/cache'
import { functionsUrl, supabase } from './lib/supabase'
import type {
  AttemptSummary,
  Challenge,
  FeedComment,
  FeedItem,
  LeaderboardEntry,
  ReactionSummary,
  Score,
  User,
  UserProfile,
  VerifyResult,
} from './types'

function mapChallenge(row: {
  id: string
  slug: string
  title: string
  prompt: string
  difficulty: Challenge['difficulty']
  points: number
}): Challenge {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    prompt: row.prompt,
    difficulty: row.difficulty,
    points: row.points,
  }
}

export async function fetchProfile(): Promise<{
  user: User
  score: Score
} | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, display_name, email_domain, is_active, created_at')
    .eq('id', user.id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!profile) return null

  const { data: score } = await supabase
    .from('scores')
    .select('user_id, display_name, total_points, accepted_count, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  return {
    user: {
      id: profile.id,
      displayName: profile.display_name,
      emailDomain: profile.email_domain,
      isActive: profile.is_active,
      createdAt: profile.created_at,
    },
    score: score
      ? {
          userId: score.user_id,
          displayName: score.display_name,
          totalPoints: score.total_points,
          acceptedCount: score.accepted_count,
          updatedAt: score.updated_at,
        }
      : {
          userId: profile.id,
          displayName: profile.display_name ?? 'Player',
          totalPoints: 0,
          acceptedCount: 0,
          updatedAt: profile.created_at,
        },
  }
}

function authErrorMessage(error: {
  message?: string
  code?: string
  status?: number
  name?: string
}): string {
  const message = error.message?.trim() || ''
  if (message.toLowerCase().includes('database error saving new user')) {
    return 'Sign-up could not create your profile. Ask an admin to check Auth logs / the handle_new_user trigger.'
  }
  if (message.includes('EMAIL_DOMAIN_NOT_ALLOWED')) {
    return 'That email domain is not allowed for this team app.'
  }
  const parts = [
    message || null,
    error.code ? `code=${error.code}` : null,
    error.status ? `status=${error.status}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Authentication failed'
}

function localRedirectTo(): string {
  const base = import.meta.env.BASE_URL || '/'
  if (base === '/' || base === './') return `${window.location.origin}/`
  return `${window.location.origin}${base}`
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: localRedirectTo(),
    },
  })
  if (error) throw new Error(authErrorMessage(error))
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    throw new Error('An account with this email already exists. Try signing in.')
  }
  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw new Error(authErrorMessage(error))
  return data
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: localRedirectTo(),
  })
  if (error) throw new Error(authErrorMessage(error))
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(authErrorMessage(error))
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(authErrorMessage(error))
}

export async function claimDisplayName(displayName: string): Promise<User> {
  const { data, error } = await supabase.rpc('claim_display_name', {
    p_display_name: displayName,
  })
  if (error) {
    if (error.message.includes('NAME_TAKEN')) {
      throw new Error('That display name is taken')
    }
    throw new Error(error.message)
  }
  const row = data as {
    id: string
    display_name: string
    email_domain: string
    is_active: boolean
    created_at: string
  }
  return {
    id: row.id,
    displayName: row.display_name,
    emailDomain: row.email_domain,
    isActive: row.is_active,
    createdAt: row.created_at,
  }
}

export async function drawChallenges(): Promise<{
  challenges: Challenge[]
  remaining: number
}> {
  const { data, error } = await supabase.rpc('draw_challenges', { p_limit: 3 })
  if (error) throw new Error(error.message)
  const challenges = (data ?? []).map(mapChallenge)

  const { data: remaining, error: remErr } = await supabase.rpc(
    'count_remaining_challenges',
  )
  if (remErr) throw new Error(remErr.message)

  return { challenges, remaining: Number(remaining ?? 0) }
}

export async function selectChallenge(
  challengeId: string,
): Promise<{ attempt: AttemptSummary; challenge: Challenge }> {
  const { data, error } = await supabase.rpc('select_challenge', {
    p_challenge_id: challengeId,
  })
  if (error) {
    if (error.message.includes('ALREADY_COMPLETED')) {
      throw new Error('You already completed this challenge')
    }
    throw new Error(error.message)
  }
  const attempt = data as {
    id: string
    challenge_id: string
    status: string
  }
  const { data: challenge, error: chErr } = await supabase
    .from('challenges')
    .select('id, slug, title, prompt, difficulty, points')
    .eq('id', attempt.challenge_id)
    .single()
  if (chErr || !challenge) throw new Error(chErr?.message ?? 'Challenge missing')
  return {
    attempt: {
      id: attempt.id,
      challengeId: attempt.challenge_id,
      status: attempt.status,
    },
    challenge: mapChallenge(challenge),
  }
}

export async function verifyAttempt(
  attemptId: string,
  photo: Blob,
): Promise<VerifyResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')

  const form = new FormData()
  form.append('attempt_id', attemptId)
  form.append('photo', photo, 'capture.jpg')

  const res = await fetch(functionsUrl('verify-photo'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    },
    body: form,
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `Verification failed (${res.status})`
    throw new Error(message)
  }

  return (body as { result: VerifyResult }).result
}

function mapLeaderboardRows(data: unknown): LeaderboardEntry[] {
  return ((data ?? []) as Array<{
    rank: number
    user_id: string
    display_name: string
    total_points: number
    accepted_count: number
    updated_at: string
  }>).map((row) => ({
    rank: Number(row.rank),
    userId: row.user_id,
    displayName: row.display_name,
    totalPoints: row.total_points,
    acceptedCount: row.accepted_count,
    updatedAt: row.updated_at,
  }))
}

/** All-time leaderboard (cumulative scores). */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: 100 })
  if (error) throw new Error(error.message)
  const entries = mapLeaderboardRows(data)
  setCached(cacheKeys.board('all'), entries)
  return entries
}

/** Weekly leaderboard — challenge points earned since Monday. */
export async function fetchWeeklyLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_weekly_leaderboard', {
    p_limit: 100,
  })
  if (error) throw new Error(error.message)
  const entries = mapLeaderboardRows(data)
  setCached(cacheKeys.board('week'), entries)
  return entries
}

interface FeedRow {
  attempt_id: string
  user_id: string
  display_name: string
  challenge_id: string
  challenge_title: string
  challenge_prompt: string
  points_awarded: number
  photo_path: string
  awarded_at: string
  reactions?: Array<{ emoji: string; count: number; mine: boolean }> | null
  comments?: Array<{
    id: string
    display_name: string
    avatar_url: string | null
    body: string
    created_at: string
  }> | null
}

// Signed-URL cache. createSignedUrls mints a fresh token every call, so
// without this the <img src> changes on every fetch and the browser can never
// reuse a cached image. Caching the URL per path (with a long TTL) keeps the
// src stable across navigations, so images are downloaded once.
const SIGN_TTL_SECONDS = 3600
const SIGN_REFRESH_BUFFER_MS = 5 * 60 * 1000
const signedUrlCache = new Map<string, { url: string; expires: number }>()

async function signPhotoPaths(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const result = new Map<string, string>()
  const missing: string[] = []
  for (const path of paths) {
    const hit = signedUrlCache.get(path)
    if (hit && hit.expires - SIGN_REFRESH_BUFFER_MS > now) {
      result.set(path, hit.url)
    } else {
      missing.push(path)
    }
  }
  if (missing.length > 0) {
    const { data: signed } = await supabase.storage
      .from('challenge-photos')
      .createSignedUrls(missing, SIGN_TTL_SECONDS)
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) {
        signedUrlCache.set(s.path, {
          url: s.signedUrl,
          expires: now + SIGN_TTL_SECONDS * 1000,
        })
        result.set(s.path, s.signedUrl)
      }
    }
  }
  return result
}

/** Sign photo paths and shape feed rows (from get_feed / get_user_posts) into FeedItems. */
async function hydrateFeedRows(rows: FeedRow[]): Promise<FeedItem[]> {
  const paths = rows.map((r) => r.photo_path).filter(Boolean)
  const urlMap = paths.length > 0 ? await signPhotoPaths(paths) : new Map<string, string>()

  return rows.map((row) => ({
    attemptId: row.attempt_id,
    userId: row.user_id,
    displayName: row.display_name,
    challengeId: row.challenge_id,
    challengeTitle: row.challenge_title,
    challengePrompt: row.challenge_prompt,
    pointsAwarded: row.points_awarded,
    photoPath: row.photo_path,
    photoUrl: urlMap.get(row.photo_path) ?? null,
    awardedAt: row.awarded_at,
    reactions: (row.reactions ?? []).map((r) => ({
      emoji: r.emoji,
      count: Number(r.count),
      mine: Boolean(r.mine),
    })),
    comments: (row.comments ?? []).map((c) => ({
      id: c.id,
      displayName: c.display_name,
      avatarUrl: c.avatar_url,
      body: c.body,
      createdAt: c.created_at,
    })),
  }))
}

export async function fetchFeed(options?: {
  beforeAwardedAt?: string
  beforeId?: string
  limit?: number
}): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc('get_feed', {
    p_limit: options?.limit ?? 20,
    p_before_awarded_at: options?.beforeAwardedAt ?? null,
    p_before_id: options?.beforeId ?? null,
  })
  if (error) throw new Error(error.message)
  const items = await hydrateFeedRows((data ?? []) as FeedRow[])
  if (!options?.beforeAwardedAt) setCached(cacheKeys.feed, items)
  return items
}

/** All accepted posts by one user, newest first (their profile gallery). */
export async function fetchUserPosts(
  userId: string,
  options?: { beforeAwardedAt?: string; beforeId?: string; limit?: number },
): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc('get_user_posts', {
    p_user_id: userId,
    p_limit: options?.limit ?? 30,
    p_before_awarded_at: options?.beforeAwardedAt ?? null,
    p_before_id: options?.beforeId ?? null,
  })
  if (error) throw new Error(error.message)
  const items = await hydrateFeedRows((data ?? []) as FeedRow[])
  if (!options?.beforeAwardedAt) setCached(cacheKeys.posts(userId), items)
  return items
}

/** Header stats for a member's profile page (own or another user's). */
export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase.rpc('get_user_profile', {
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        user_id: string
        display_name: string
        uploads: number
        week_points: number
        all_time_points: number
      }
    | undefined
  if (!row) throw new Error('Profile not found')
  const profile: UserProfile = {
    userId: row.user_id,
    displayName: row.display_name,
    uploads: Number(row.uploads),
    weekPoints: Number(row.week_points),
    allTimePoints: Number(row.all_time_points),
  }
  setCached(cacheKeys.profile(userId), profile)
  return profile
}

export async function reactToPost(
  attemptId: string,
  emoji: string,
): Promise<ReactionSummary[]> {
  const { data, error } = await supabase.rpc('toggle_reaction', {
    p_attempt_id: attemptId,
    p_emoji: emoji,
  })
  if (error) {
    if (error.message.includes('OWN_POST')) {
      throw new Error('You cannot react to your own post')
    }
    if (error.message.includes('INVALID_EMOJI')) {
      throw new Error('Reaction must be a single emoji')
    }
    throw new Error(error.message)
  }

  const parsed: unknown =
    typeof data === 'string'
      ? (JSON.parse(data) as unknown)
      : data
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected reaction response')
  }

  return parsed.map((r: { emoji: string; count: number; mine: boolean }) => ({
    emoji: r.emoji,
    count: Number(r.count),
    mine: Boolean(r.mine),
  }))
}

export async function commentOnPost(
  attemptId: string,
  body: string,
): Promise<FeedComment> {
  const { data, error } = await supabase.rpc('add_comment', {
    p_attempt_id: attemptId,
    p_body: body,
  })
  if (error) {
    if (error.message.includes('INVALID_COMMENT')) {
      throw new Error('Comment must be 1–280 characters')
    }
    throw new Error(error.message)
  }
  const row = data as {
    id: string
    display_name: string
    avatar_url: string | null
    body: string
    created_at: string
  }
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    body: row.body,
    createdAt: row.created_at,
  }
}

/** Members who reacted to a post with a specific emoji (oldest first). */
export async function fetchReactors(
  attemptId: string,
  emoji: string,
): Promise<{ userId: string; displayName: string }[]> {
  const { data, error } = await supabase.rpc('get_post_reactors', {
    p_attempt_id: attemptId,
    p_emoji: emoji,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ user_id: string; display_name: string }>).map(
    (row) => ({ userId: row.user_id, displayName: row.display_name }),
  )
}

/** Delete one of your own posts. Removes it and subtracts its earned points. */
export async function deleteOwnPost(attemptId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_own_post', {
    p_attempt_id: attemptId,
  })
  if (error) {
    if (error.message.includes('NOT_OWNER')) {
      throw new Error('You can only delete your own posts')
    }
    throw new Error(error.message)
  }
}

export function subscribeScores(onChange: () => void): () => void {
  const channel = supabase
    .channel('scores-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scores' },
      () => onChange(),
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}

export function subscribeAcceptedAttempts(onChange: () => void): () => void {
  const channel = supabase
    .channel('attempts-feed')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'attempts' },
      (payload) => {
        const next = payload.new as { status?: string }
        if (next.status === 'accepted') onChange()
      },
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
