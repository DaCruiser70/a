'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import '../../../styles/pages/welcome.css'
import { useMe } from '@/lib/use-me'
import { PortalIdentity } from '@/components/ui/PortalName'
import { FORMS_HOME } from '@/lib/routes'
import ProgressRing from '@/components/welcome/ProgressRing'
import WireJourney, { type FormStep } from '@/components/welcome/WireJourney'

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// Signed URL is fetched fresh and held only in component state — never persisted
async function fetchWelcomeVideoUrl(): Promise<string | null> {
  try {
    const res = await fetch('/api/newhire/welcome-video', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.url === 'string' ? data.url : null
  } catch {
    return null
  }
}

type VideoState = 'loading' | 'ready' | 'unavailable'

function WelcomeVideo() {
  const [state, setState] = useState<VideoState>('loading')
  const [url, setUrl]     = useState<string | null>(null)
  const videoRef   = useRef<HTMLVideoElement>(null)
  const retried    = useRef(false)          // only one refresh per page load
  const resumeAt   = useRef<number | null>(null)
  const wasPlaying = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetchWelcomeVideoUrl().then(u => {
      if (cancelled) return
      setUrl(u)
      setState(u ? 'ready' : 'unavailable')
    })
    return () => { cancelled = true }
  }, [])

  // The signed URL may expire mid-session: fetch a fresh one once and resume where the viewer was
  async function handleError() {
    if (retried.current) { setState('unavailable'); return }
    retried.current  = true
    resumeAt.current = videoRef.current?.currentTime ?? 0
    const fresh = await fetchWelcomeVideoUrl()
    if (!fresh) { setState('unavailable'); return }
    setUrl(fresh)
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (!video || resumeAt.current === null) return
    video.currentTime = resumeAt.current
    resumeAt.current = null
    if (wasPlaying.current) video.play().catch(() => {})
  }

  if (state === 'loading') {
    return <div className="welcome-video-frame welcome-video-skeleton" aria-busy="true" aria-label="Loading video" />
  }

  if (state === 'unavailable' || !url) {
    return (
      <div className="welcome-video-frame">
        <Image src="/logo.png" alt="AEM" width={220} height={88} className="welcome-video-logo" />
        <div className="welcome-video-play-btn" style={{ cursor: 'default' }}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>
        <div className="welcome-video-coming-soon">Welcome video coming soon</div>
      </div>
    )
  }

  return (
    <div className="welcome-video-frame welcome-video-player">
      <video
        ref={videoRef}
        src={url}
        controls
        preload="metadata"
        playsInline
        aria-label="Welcome message from the President"
        onError={handleError}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => { wasPlaying.current = true }}
        onPause={() => { wasPlaying.current = false }}
      />
    </div>
  )
}

// About AEM: a short version in station 1, and the full text behind "Read more about AEM"
const ABOUT_SHORT =
  'Advanced Energy Management Ltd. is one of Canada’s leading energy management companies, operating across ' +
  'multiple provinces with a team committed to smarter, more sustainable energy solutions. Our work spans energy ' +
  'auditing, building automation, retrofits and project management.'

const ABOUT_FULL = (
  <>
    <h3>Powering Canada&apos;s energy future — together.</h3>
    <p>
      Advanced Energy Management Ltd. is one of Canada&apos;s leading energy management companies,
      operating across multiple provinces with a team of dedicated professionals committed to
      delivering smarter, more sustainable energy solutions. Since our founding, we&apos;ve built a
      reputation for technical excellence, safety-first operations, and long-lasting client relationships.
    </p>
    <p>
      Our work spans energy auditing, building automation, retrofits, and project management —
      helping businesses and institutions reduce costs and their environmental footprint. Whether
      you&apos;re joining us in the field, in the office, or remotely, you&apos;re now part of a team that
      genuinely cares about the work it does and the people it works with.
    </p>
    <p>
      This is just the beginning. We&apos;re excited to see what you&apos;ll bring to AEM.
    </p>
  </>
)

// The welcome page's client part (video, sign-out, name from /api/me). steps and doneCount: the
// hire's real progress (computeHireStatus), worked out on the server (app/newhire/welcome/page.tsx).
export default function WelcomeView({ steps, doneCount }: { steps: FormStep[]; doneCount: number }) {
  const { me } = useMe()
  const displayName = me?.name ?? ''

  const initials  = displayName ? getInitials(displayName) : '…'

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }
  // Split name for hero: everything up to last word / last word
  const nameParts = displayName.trim().split(' ')
  const heroFirst = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : displayName
  const heroLast  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''

  return (
    <div className="welcome-page wire-theme" data-portal="newhire">

      {/* ── NAV ── */}
      <nav className="welcome-nav">
        <div className="welcome-nav-left">
          <Image src="/logo.png" alt="Advanced Energy Management Ltd" width={120} height={32} className="welcome-nav-logo" />
          <div className="welcome-nav-divider" />
          <PortalIdentity role="newhire" tone="light" />
        </div>
        <div className="welcome-nav-right">
          <Link href={FORMS_HOME} className="wl-forms-pill" aria-label={`Continue my forms, ${doneCount} of ${steps.length} done`}>
            Continue my forms <span aria-hidden="true">&middot; {doneCount}/{steps.length} &rarr;</span>
          </Link>
          <div className="welcome-nav-user">
            <div className="welcome-nav-avatar">{initials}</div>
            {displayName && <span className="welcome-nav-name">{displayName}</span>}
          </div>
          <button
            onClick={handleSignOut}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 11px', borderRadius: '7px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', fontWeight: 500,
              transition: 'background 0.15s',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '13px', height: '13px' }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="welcome-hero">
        <div className="welcome-hero-orb-1" />
        <div className="welcome-hero-orb-2" />
        <div className="welcome-hero-inner">
          <div className="welcome-hero-text">
            <div className="welcome-hero-tag">
              <div className="welcome-hero-tag-dot" />
              Welcome to the team
            </div>
            <div className="welcome-hero-greeting">Welcome,</div>
            <div className="welcome-hero-name">
              {displayName
                ? <>{heroFirst}{heroLast && <> <em>{heroLast}.</em></>}</>
                : <span style={{ opacity: 0.35 }}>…</span>
              }
            </div>
            <p className="welcome-hero-sub">
              We&apos;re so glad you&apos;re here. Follow the wire to see what to expect, then finish
              your steps at your own pace, all in one place.
            </p>
            <div className="welcome-hero-badges">
              <div className="welcome-hero-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                </svg>
                5 steps to complete
              </div>
              <div className="welcome-hero-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                ~15 minutes total
              </div>
              <div className="welcome-hero-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                256-bit encrypted
              </div>
            </div>
          </div>

          <div className="welcome-hero-ring">
            <ProgressRing done={doneCount} total={steps.length} variant="banner" />
          </div>
        </div>
      </div>

      {/* ── BODY: follow the wire ── */}
      <div className="wl-body">
        <WireJourney
          video={<WelcomeVideo />}
          aboutShort={ABOUT_SHORT}
          aboutFull={ABOUT_FULL}
          steps={steps}
          doneCount={doneCount}
        />
      </div>
    </div>
  )
}
