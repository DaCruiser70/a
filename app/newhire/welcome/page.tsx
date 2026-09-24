'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import '../../../styles/pages/welcome.css'
import { createClient } from '@/lib/supabase/client'

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export default function WelcomePage() {
  const [displayName, setDisplayName] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('full_name, preferred_name')
        .eq('id', user.id)
        .single()
      if (!data) return
      setDisplayName(data.preferred_name ?? data.full_name ?? '')
    }).catch(() => {})
  }, [])

  const initials  = displayName ? getInitials(displayName) : '…'

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }
  // Split name for hero: everything up to last word / last word
  const nameParts = displayName.trim().split(' ')
  const heroFirst = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : displayName
  const heroLast  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''

  return (
    <div className="welcome-page">

      {/* ── NAV ── */}
      <nav className="welcome-nav">
        <div className="welcome-nav-left">
          <Image src="/logo.png" alt="Advanced Energy Management Ltd" width={120} height={32} className="welcome-nav-logo" />
          <div className="welcome-nav-divider" />
          <span className="welcome-nav-label">Employee Onboarding Portal</span>
        </div>
        <div className="welcome-nav-right">
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
              We&apos;re so glad you&apos;re here. This portal will guide you through
              everything you need to get set up — at your own pace, all in one place.
            </p>
            <div className="welcome-hero-badges">
              <div className="welcome-hero-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                </svg>
                4 forms to complete
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

          <div className="welcome-hero-logo-wrap">
            <Image src="/logo.png" alt="AEM" width={200} height={80} />
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="welcome-body">

        {/* VIDEO */}
        <section className="welcome-fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="welcome-section-header">
            <span className="welcome-section-tag">Welcome video</span>
            <div className="welcome-section-line" />
          </div>
          <div className="welcome-video-wrap">
            <div className="welcome-video-frame">
              <Image src="/logo.png" alt="AEM" width={220} height={88} className="welcome-video-logo" />
              <div className="welcome-video-play-btn">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </div>
              <div className="welcome-video-coming-soon">Video coming soon</div>
            </div>
            <div className="welcome-video-footer">
              <div>
                <div className="welcome-video-title">Welcome to Advanced Energy Management</div>
                <div className="welcome-video-meta">A message from our leadership team · ~5 min</div>
              </div>
              <div className="welcome-video-badge">Coming soon</div>
            </div>
          </div>
        </section>

        {/* ABOUT */}
        <section className="welcome-fade-up" style={{ animationDelay: '0.2s' }}>
          <div className="welcome-section-header">
            <span className="welcome-section-tag">About AEM</span>
            <div className="welcome-section-line" />
          </div>
          <div className="welcome-about-grid">
            <div className="welcome-about-main">
              <h2>Powering Canada&apos;s energy future — together.</h2>
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
            </div>

            <div className="welcome-stat-card stat-navy">
              <div className="welcome-stat-num">20+</div>
              <div className="welcome-stat-label">Years in operation</div>
              <div className="welcome-stat-sub">Serving Canadian businesses since 2003</div>
            </div>

            <div className="welcome-stat-card stat-amber">
              <div className="welcome-stat-num">5</div>
              <div className="welcome-stat-label">Provinces served</div>
              <div className="welcome-stat-sub">From Ontario to British Columbia</div>
            </div>

            <div className="welcome-stat-card stat-green">
              <div className="welcome-stat-num">500+</div>
              <div className="welcome-stat-label">Projects completed</div>
              <div className="welcome-stat-sub">Energy audits, retrofits &amp; automation</div>
            </div>

            <div className="welcome-stat-card stat-purple">
              <div className="welcome-stat-num">100%</div>
              <div className="welcome-stat-label">Safety committed</div>
              <div className="welcome-stat-sub">Zero compromise on workplace safety</div>
            </div>
          </div>
        </section>

        {/* NEXT STEPS BANNER */}
        <section className="welcome-fade-up" style={{ animationDelay: '0.3s' }}>
          <div className="welcome-next">
            <div className="welcome-next-text">
              <h3>Ready to get started?</h3>
              <p>
                Your next step is to complete your onboarding forms. It only takes about 15 minutes
                and everything is saved automatically as you go.
              </p>
            </div>
            <Link href="/newhire/forms" className="welcome-next-btn">
              Go to my forms
              <span className="welcome-next-btn-arrow">→</span>
            </Link>
          </div>
        </section>

      </div>
    </div>
  )
}
