// Tiny in-memory, session-scoped cache for stale-while-revalidate rendering.
// Screens seed their initial state from here so navigating back is instant,
// then refresh in the background.

const store = new Map<string, unknown>()

export function getCached<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, value)
}

export function clearCache(): void {
  store.clear()
}

export const cacheKeys = {
  feed: 'feed',
  profile: (userId: string) => `profile:${userId}`,
  posts: (userId: string) => `posts:${userId}`,
  board: (period: 'week' | 'all') => `board:${period}`,
}
