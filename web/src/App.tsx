import { useCallback, useEffect, useState } from 'react'
import {
  claimDisplayName,
  drawChallenges,
  fetchProfile,
  requestPasswordReset,
  selectChallenge,
  signIn,
  signOut,
  signUp,
  updatePassword,
  verifyAttempt,
} from './api'
import { cue, setFeedbackEnabled } from './feedback'
import { AuthScreen } from './components/AuthScreen'
import { BottomNav } from './components/BottomNav'
import { CaptureScreen } from './components/CaptureScreen'
import { ChallengePicker } from './components/ChallengePicker'
import { ConfirmScreen } from './components/ConfirmScreen'
import { FeedScreen } from './components/FeedScreen'
import { LeaderboardScreen } from './components/LeaderboardScreen'
import { ProfilePage } from './components/ProfilePage'
import { ProfileSetup } from './components/ProfileSetup'
import { ResultScreen } from './components/ResultScreen'
import { SetPasswordScreen } from './components/SetPasswordScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { clearCache } from './lib/cache'
import { preparePhotoForUpload } from './lib/preparePhoto'
import { supabase } from './lib/supabase'
import { applyTheme, loadSettings, saveSettings, type Settings } from './settings'
import type {
  AttemptSummary,
  Challenge,
  Score,
  Screen,
  User,
  VerifyResult,
} from './types'

// Persist the active tab so a page refresh returns you where you were,
// rather than always dropping onto Challenges.
const NAV_KEY = 'mq.nav'
const TAB_SCREENS: Screen[] = [
  'feed',
  'challenges',
  'profile',
  'leaderboard',
  'settings',
]

function loadNav(): { screen: Screen; viewingUserId: string | null } | null {
  try {
    const raw = localStorage.getItem(NAV_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { screen: Screen; viewingUserId: string | null }
    if (!TAB_SCREENS.includes(parsed.screen)) return null
    return parsed
  } catch {
    return null
  }
}

function saveNav(screen: Screen, viewingUserId: string | null): void {
  try {
    if (!TAB_SCREENS.includes(screen)) return
    localStorage.setItem(NAV_KEY, JSON.stringify({ screen, viewingUserId }))
  } catch {
    // ignore storage failures (private mode, quota)
  }
}

function clearNav(): void {
  try {
    localStorage.removeItem(NAV_KEY)
  } catch {
    // ignore
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('boot')
  const [user, setUser] = useState<User | null>(null)
  const [score, setScore] = useState<Score | null>(null)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [remaining, setRemaining] = useState(0)
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null)
  const [attempt, setAttempt] = useState<AttemptSummary | null>(null)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [captureBusyLabel, setCaptureBusyLabel] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [viewingUserId, setViewingUserId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)

  const refreshDraw = useCallback(async () => {
    const drawn = await drawChallenges()
    setChallenges(drawn.challenges)
    setRemaining(drawn.remaining)
  }, [])

  const enterApp = useCallback(
    async (profile: User, nextScore: Score) => {
      setUser(profile)
      setScore(nextScore)
      if (!profile.displayName) {
        setScreen('profile-setup')
        return
      }
      const saved = loadNav()
      const target: Screen = saved?.screen ?? 'challenges'
      if (saved) setViewingUserId(saved.viewingUserId)
      // ChallengePicker needs the draw loaded before it renders.
      if (target === 'challenges') await refreshDraw()
      setScreen(target)
    },
    [refreshDraw],
  )

  useEffect(() => {
    let cancelled = false
    let recoveryPending = false

    async function bootFromSession() {
      try {
        const me = await fetchProfile()
        if (cancelled) return
        if (!me) {
          setScreen('auth')
          return
        }
        if (!me.user.isActive) {
          setError('Your account is deactivated.')
          await signOut()
          setScreen('auth')
          return
        }
        await enterApp(me.user, me.score)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load profile')
          setScreen('auth')
        }
      }
    }

    async function boot() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      if (recoveryPending) {
        setScreen('set-password')
        return
      }
      if (!session) {
        setScreen('auth')
        return
      }
      await bootFromSession()
    }
    void boot()

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryPending = true
        setError(null)
        setScreen('set-password')
        return
      }
      if (!session) {
        recoveryPending = false
        setUser(null)
        setScore(null)
        setScreen('auth')
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [enterApp])

  useEffect(() => {
    applyTheme(settings.theme)
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [settings.theme])

  useEffect(() => {
    setFeedbackEnabled(settings.uiFeedback)
  }, [settings.uiFeedback])

  // Remember the active tab (and viewed profile) across refreshes.
  useEffect(() => {
    saveNav(screen, viewingUserId)
  }, [screen, viewingUserId])

  function updateSettings(next: Settings) {
    setSettings(next)
    saveSettings(next)
  }

  function openProfile(profileUserId: string) {
    cue.nav()
    setError(null)
    setViewingUserId(profileUserId)
    setScreen('profile')
  }

  function navigate(next: Screen) {
    setError(null)
    if (next === 'challenges') {
      void goChallenges()
    } else if (next === 'profile') {
      if (user) openProfile(user.id)
    } else {
      setScreen(next)
    }
  }

  async function handleSignIn(email: string, password: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await signIn(email, password)
      const me = await fetchProfile()
      if (!me) throw new Error('Profile not found')
      if (!me.user.isActive) throw new Error('Your account is deactivated.')
      await enterApp(me.user, me.score)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignUp(email: string, password: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const data = await signUp(email, password)
      if (data.session) {
        const me = await fetchProfile()
        if (me) {
          await enterApp(me.user, me.score)
          return
        }
      }
      setPendingEmail(email)
      setScreen('confirm')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed'
      if (message.toLowerCase().includes('domain') || message.includes('EMAIL_DOMAIN')) {
        setError('That email domain is not allowed for this team app.')
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(email: string) {
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset(email)
      setNotice('Password reset email sent if that account exists. Open the link to choose a new password.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleSetPassword(password: string) {
    setBusy(true)
    setError(null)
    try {
      await updatePassword(password)
      const me = await fetchProfile()
      if (!me) throw new Error('Profile not found')
      if (!me.user.isActive) throw new Error('Your account is deactivated.')
      await enterApp(me.user, me.score)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save password')
    } finally {
      setBusy(false)
    }
  }

  async function handleProfile(displayName: string) {
    setBusy(true)
    setError(null)
    try {
      const updated = await claimDisplayName(displayName)
      const me = await fetchProfile()
      if (!me) throw new Error('Profile missing')
      await enterApp(updated, me.score)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save name')
    } finally {
      setBusy(false)
    }
  }

  async function handlePick(challenge: Challenge) {
    cue.select()
    setBusyId(challenge.id)
    setError(null)
    try {
      const selected = await selectChallenge(challenge.id)
      setActiveChallenge(selected.challenge)
      setAttempt(selected.attempt)
      setResult(null)
      setScreen('capture')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select challenge')
    } finally {
      setBusyId(null)
    }
  }

  async function handleSubmit(file: File) {
    if (!attempt) return
    setBusy(true)
    setCaptureBusyLabel('Compressing…')
    setError(null)
    try {
      const photo = await preparePhotoForUpload(file)
      setCaptureBusyLabel('Posting…')
      const verified = await verifyAttempt(attempt.id, photo)
      setResult(verified)
      if (verified.status === 'accepted') {
        cue.success()
        const me = await fetchProfile()
        if (me) {
          setScore(me.score)
          setUser(me.user)
        }
      } else {
        cue.error()
      }
      setScreen('result')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(
        message === 'Load failed' || message === 'Failed to fetch'
          ? 'Could not reach the verifier (network/CORS). Check you’re online and verify-photo is deployed.'
          : message,
      )
    } finally {
      setBusy(false)
      setCaptureBusyLabel(null)
    }
  }

  async function goChallenges() {
    setError(null)
    setResult(null)
    setActiveChallenge(null)
    setAttempt(null)
    try {
      const me = await fetchProfile()
      if (me) {
        setScore(me.score)
        setUser(me.user)
      }
      await refreshDraw()
      setScreen('challenges')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load challenges')
      setScreen('challenges')
    }
  }

  async function handleSignOut() {
    await signOut()
    clearNav()
    clearCache()
    setUser(null)
    setScore(null)
    setViewingUserId(null)
    setScreen('auth')
  }

  if (screen === 'boot') {
    return (
      <div className="app-shell">
        <p className="boot-msg" role="status">
          Loading Move Quest…
        </p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {screen === 'auth' ? (
        <AuthScreen
          busy={busy}
          error={error}
          notice={notice}
          onSignIn={(e, p) => void handleSignIn(e, p)}
          onSignUp={(e, p) => void handleSignUp(e, p)}
          onReset={(e) => void handleReset(e)}
        />
      ) : null}

      {screen === 'confirm' ? (
        <ConfirmScreen
          email={pendingEmail}
          onBack={() => {
            setError(null)
            setScreen('auth')
          }}
        />
      ) : null}

      {screen === 'set-password' ? (
        <SetPasswordScreen
          busy={busy}
          error={error}
          onSubmit={(password) => void handleSetPassword(password)}
        />
      ) : null}

      {screen === 'profile-setup' ? (
        <ProfileSetup
          busy={busy}
          error={error}
          onSubmit={(name) => void handleProfile(name)}
          onSignOut={() => void handleSignOut()}
        />
      ) : null}

      {screen === 'challenges' && user && score ? (
        <ChallengePicker
          challenges={challenges}
          remaining={remaining}
          scorePoints={score.totalPoints}
          displayName={user.displayName ?? 'Player'}
          busyId={busyId}
          error={error}
          onPick={handlePick}
          onReshuffle={() => void goChallenges()}
          onOpenFeed={() => setScreen('feed')}
        />
      ) : null}

      {screen === 'capture' && activeChallenge ? (
        <CaptureScreen
          challenge={activeChallenge}
          busy={busy}
          busyLabel={captureBusyLabel}
          error={error}
          onBack={() => void goChallenges()}
          onSubmit={(file) => void handleSubmit(file)}
        />
      ) : null}

      {screen === 'result' && activeChallenge && result ? (
        <ResultScreen
          challenge={activeChallenge}
          result={result}
          onRetry={() => {
            setError(null)
            setScreen('capture')
          }}
          onNext={() => void goChallenges()}
          onBoard={() => setScreen('leaderboard')}
          onFeed={() => setScreen('feed')}
        />
      ) : null}

      {screen === 'leaderboard' && user ? (
        <LeaderboardScreen userId={user.id} onBack={() => setScreen('feed')} />
      ) : null}

      {screen === 'feed' && user ? (
        <FeedScreen
          userId={user.id}
          onOpenLeaderboard={() => setScreen('leaderboard')}
          onOpenProfile={openProfile}
        />
      ) : null}

      {screen === 'profile' && user ? (
        <ProfilePage
          profileUserId={viewingUserId ?? user.id}
          currentUserId={user.id}
          onBack={() => setScreen('feed')}
          onOpenSettings={() => setScreen('settings')}
        />
      ) : null}

      {screen === 'settings' && user ? (
        <SettingsScreen
          user={user}
          settings={settings}
          onChange={updateSettings}
          onBack={() => openProfile(user.id)}
          onSignOut={() => void handleSignOut()}
        />
      ) : null}

      {user && ['feed', 'challenges', 'profile', 'leaderboard', 'settings'].includes(screen) ? (
        <BottomNav current={screen} onNavigate={navigate} />
      ) : null}
    </div>
  )
}
