'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { VALUES, STATS, type ValueItem } from '@/lib/career-content'
import { FORMS_HOME } from '@/lib/routes'
import MiniCircuit from '@/components/career/MiniCircuit'
import ProgressRing from '@/components/welcome/ProgressRing'
import { RAIL_W, RAIL_H, RAIL_D, STATION_POINTS, LIT_OFFSETS, pctOf } from '@/components/welcome/wire-geometry'

// The welcome page's "follow the wire" layout: a rail of five stations on the left and a panel on
// the right that shows one station at a time. Nothing is remembered between visits: every visit
// starts on station 1. Animation is CSS only (styles/pages/welcome-wire.css), off under reduced motion.

export type FormStepState = 'done' | 'next' | 'review' | 'todo'
export type FormStep = { key: string; label: string; state: FormStepState }

const TOTAL_STATIONS = 5

const VALUE_TONE: Record<ValueItem['id'], string> = {
  valued:    'var(--wl-glow)',
  respected: 'var(--cc-track-c)',
  empowered: 'var(--cc-track-t)',
}
const VALUE_ICON: Record<ValueItem['id'], string> = {
  valued:    'M12 2l3 7 7 .6-5.3 4.7 1.7 7.2L12 17.8 5.6 21.5l1.7-7.2L2 9.6 9 9z',
  respected: 'M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z',
  empowered: 'M13 2L4 14h6l-1 8 9-12h-6z',
}
// The orbs climb the curved pipe from bottom left to top right (viewBox 760 × 390)
const ORB_AT: [number, number][] = [[120, 290], [380, 165], [640, 55]]
const ORB_PIPE = 'M20 290 H120 C250 290 250 165 380 165 C510 165 510 55 640 55 H750'
// The stat rings sit alternately high and low on the wave
const RING_DROP = [0, 46, 0, 46]

const STEP_TEXT: Record<FormStepState, string> = { done: 'Done', next: 'Up next', review: 'With HR', todo: 'To do' }
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five']

type FocusRequest = { target: 'heading' | 'station'; n: number } | null

export default function WireJourney({ video, aboutShort, aboutFull, steps, doneCount }: {
  video:      React.ReactNode
  aboutShort: string
  aboutFull:  React.ReactNode
  steps:      FormStep[]
  doneCount:  number
}) {
  const [stage, setStage]     = useState(1)
  const [focusReq, setFocusReq] = useState<FocusRequest>(null)
  const [value, setValue]     = useState<ValueItem['id']>('valued')
  const [aboutOpen, setAboutOpen] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const rootRef    = useRef<HTMLDivElement>(null)

  const total   = steps.length
  const allDone = doneCount >= total

  const stations = [
    { title: 'Welcome',            sub: 'A word from the team' },
    { title: 'What we believe',    sub: 'Valued, Respected, Empowered' },
    { title: 'Where you could go', sub: 'Four career tracks' },
    { title: 'By the numbers',     sub: 'Why people stay' },
    { title: 'Your forms',         sub: `${doneCount} of ${total} done` },
  ]

  function go(n: number, target: 'heading' | 'station') {
    const next = Math.max(1, Math.min(TOTAL_STATIONS, n))
    setStage(next)
    setFocusReq({ target, n: next })
  }

  // After a station change: focus the panel heading (clicks, Back, Next) or the station itself
  // (arrow keys on the rail, so the arrows keep working)
  useEffect(() => {
    if (!focusReq) return
    if (focusReq.target === 'heading') headingRef.current?.focus()
    else {
      const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(`[data-station="${focusReq.n}"]`) ?? [])
      buttons.find(b => b.offsetParent !== null)?.focus()
    }
  }, [focusReq])

  function onRailKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(stage + 1, 'station') }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); go(stage - 1, 'station') }
  }

  const formsHeading = allDone ? `All ${NUMBER_WORDS[total].toLowerCase()} are done.`
    : doneCount === 0 ? 'Let’s get you started.'
    : `${NUMBER_WORDS[total - doneCount]} more to go.`
  const chosen = VALUES.find(v => v.id === value) ?? VALUES[0]

  const eyebrow = (label: string) => <div className="wl-eyebrow">STATION {stage} OF {TOTAL_STATIONS} &middot; {label}</div>
  const heading = (content: React.ReactNode) => (
    <h2 ref={headingRef} tabIndex={-1} className="wl-h2">{content}</h2>
  )

  return (
    <div ref={rootRef} className="wl-layout-wrap career-sections">
      {/* Small screens: a row of step pills instead of the rail */}
      <div className="wl-minirail" role="group" aria-label="Stations" onKeyDown={onRailKey}>
        {stations.map((s, i) => (
          <button
            key={s.title}
            type="button"
            data-station={i + 1}
            className={`wl-minipill${stage === i + 1 ? ' on' : ''}`}
            aria-label={`Station ${i + 1}: ${s.title}`}
            aria-current={stage === i + 1 ? 'step' : undefined}
            onClick={() => go(i + 1, 'heading')}
          >
            {i + 1}. {s.title}
          </button>
        ))}
      </div>

      <div className="wl-layout">
        {/* ── The wire ── */}
        <div className="wl-rail" role="group" aria-label="Stations" onKeyDown={onRailKey}>
          <svg viewBox={`0 0 ${RAIL_W} ${RAIL_H}`} className="wl-rail-svg" aria-hidden="true" focusable="false">
            <defs>
              <filter id="wl-glow" x="-30%" y="-10%" width="160%" height="120%">
                <feGaussianBlur stdDeviation="3.2" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <path className="wl-pipe-wall" d={RAIL_D} />
            <path className="wl-pipe-bore" d={RAIL_D} />
            <path className="wl-pipe-flow" d={RAIL_D} />
            <path className="wl-pipe-lit" d={RAIL_D} pathLength={100} filter="url(#wl-glow)" style={{ strokeDashoffset: LIT_OFFSETS[stage - 1] }} />
          </svg>

          {stations.map((s, i) => {
            const n = i + 1
            const state = n === stage ? 'on' : n < stage ? 'done' : 'todo'
            const leftColumn = i % 2 === 0
            return (
              <button
                key={s.title}
                type="button"
                data-station={n}
                className={`wl-station ${state}`}
                style={pctOf(STATION_POINTS[i])}
                aria-label={`Station ${n}: ${s.title}`}
                aria-current={n === stage ? 'step' : undefined}
                onClick={() => go(n, 'heading')}
              >
                <span className="wl-station-dial" aria-hidden="true" />
                <span className="wl-station-core" aria-hidden="true">{state === 'done' ? '✓' : n}</span>
                <span className={`wl-station-label ${leftColumn ? 'right' : 'left'}`} aria-hidden="true">
                  <b>{s.title}</b>
                  <span>{s.sub}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* ── The panel ── */}
        <div className="wl-panel-shadow">
          <section className="wl-panel" aria-label={`Station ${stage} of ${TOTAL_STATIONS}: ${stations[stage - 1].title}`}>
            <div key={stage} className="wl-stage">
              {stage === 1 && (
                <>
                  {eyebrow('WELCOME')}
                  {heading('A few words from our team.')}
                  <div className="wl-video-window">{video}</div>
                  <div className="wl-about">
                    <div id="wl-about-more" className="wl-about-text">{aboutOpen ? aboutFull : <p>{aboutShort}</p>}</div>
                    <button
                      type="button"
                      className="wl-textbtn"
                      aria-expanded={aboutOpen}
                      aria-controls="wl-about-more"
                      onClick={() => setAboutOpen(o => !o)}
                    >
                      {aboutOpen ? 'Show less' : 'Read more about AEM'}
                    </button>
                  </div>
                </>
              )}

              {stage === 2 && (
                <>
                  {eyebrow('WHAT WE BELIEVE')}
                  {heading('The power runs on people.')}
                  <p className="wl-text">Tap each one.</p>
                  <div className="wl-orbs">
                    <svg viewBox="0 0 760 390" className="wl-orbs-svg" aria-hidden="true" focusable="false">
                      <defs>
                        <filter id="wl-glow-orbs" x="-10%" y="-30%" width="120%" height="160%">
                          <feGaussianBlur stdDeviation="3" result="b" />
                          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                      </defs>
                      <path className="wl-orb-wall" d={ORB_PIPE} />
                      <path className="wl-orb-bore" d={ORB_PIPE} />
                      <path className="wl-orb-flow" d={ORB_PIPE} filter="url(#wl-glow-orbs)" />
                    </svg>
                    {VALUES.map((v, i) => (
                      <button
                        key={v.id}
                        type="button"
                        className={`wl-orb${value === v.id ? ' on' : ''}`}
                        style={{ '--c': VALUE_TONE[v.id], left: `${(ORB_AT[i][0] / 760) * 100}%`, top: `${(ORB_AT[i][1] / 390) * 100}%` } as React.CSSProperties}
                        aria-pressed={value === v.id}
                        onClick={() => setValue(v.id)}
                      >
                        <span className="wl-orb-ring" aria-hidden="true">
                          <span className="wl-orb-dial" />
                          <span className="wl-orb-core">
                            <svg width="34" height="34" viewBox="0 0 24 24" focusable="false"><path d={VALUE_ICON[v.id]} className="wl-orb-icon" /></svg>
                          </span>
                        </span>
                        <span className="wl-orb-word">{v.title}</span>
                      </button>
                    ))}
                  </div>
                  <p className="wl-believe" aria-live="polite">{chosen.title}. {chosen.text}</p>
                </>
              )}

              {stage === 3 && (
                <>
                  {eyebrow('YOUR PATH AT AEM')}
                  {heading(<>Where could <span className="wl-you">you</span> go?</>)}
                  <p className="wl-text">
                    From the trunk line, the circuit splits into four career tracks. Follow one, or cross between them,
                    and meet teammates who walked those paths.
                  </p>
                  <div className="wl-circuit"><MiniCircuit variant="entry" /></div>
                  <div className="wl-push"><Link href="/welcome/careers" className="wl-gold-btn">Explore career paths &rarr;</Link></div>
                </>
              )}

              {stage === 4 && (
                <>
                  {eyebrow('BY THE NUMBERS')}
                  {heading('Build a career that lasts.')}
                  <p className="wl-text">People come here to stay, and the numbers show it.</p>
                  <div className="wl-rings">
                    <svg viewBox="0 0 760 300" preserveAspectRatio="none" className="wl-wave" aria-hidden="true" focusable="false">
                      <path d="M0 120 C100 20 160 230 270 150 S 430 30 520 150 S 680 250 760 130" />
                    </svg>
                    <ul className="wl-ring-row">
                      {STATS.map((s, i) => (
                        <li key={s.label} className="wl-stat" style={{ '--drop': `${RING_DROP[i]}px` } as React.CSSProperties}>
                          {/* The ring fill is decoration only, not data */}
                          <div className="wl-stat-ring" style={{ '--p': `${s.ring}%` } as React.CSSProperties} aria-hidden="true">
                            <span className="wl-stat-arc" />
                            <span className="wl-stat-core">{s.value}</span>
                          </div>
                          <div className="wl-stat-label"><span className="wl-sr-only">{s.value} </span>{s.label}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {stage === 5 && (
                <>
                  {eyebrow('YOUR FORMS')}
                  <div className="wl-forms-head">
                    <ProgressRing done={doneCount} total={total} variant="forms" />
                    <div>
                      {heading(formsHeading)}
                      <p className="wl-text">
                        {allDone ? 'Everything is in. You can look over your forms any time.' : 'Save as you go. You can leave and come back any time.'}
                      </p>
                    </div>
                  </div>
                  <ul className="wl-forms">
                    {steps.map((s, i) => (
                      <li key={s.key} className={`wl-form ${s.state}`}>
                        <span className="wl-form-dot" aria-hidden="true">{s.state === 'done' ? '✓' : i + 1}</span>
                        <span className="wl-form-name">{s.label}</span>
                        <span className="wl-form-tag">{STEP_TEXT[s.state]}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="wl-push">
                    <Link href={FORMS_HOME} className="wl-gold-btn">{allDone ? 'View my forms' : 'Continue my forms'} &rarr;</Link>
                  </div>
                </>
              )}
            </div>

            {/* Back / Next */}
            <div className="wl-nav">
              <button type="button" className={`wl-outline-btn${stage === 1 ? ' hidden' : ''}`} onClick={() => go(stage - 1, 'heading')} tabIndex={stage === 1 ? -1 : undefined} aria-hidden={stage === 1 || undefined}>
                &larr; Back
              </button>
              <span className="wl-nav-label">STATION {stage} OF {TOTAL_STATIONS}</span>
              <button type="button" className={`wl-outline-btn gold${stage === TOTAL_STATIONS ? ' hidden' : ''}`} onClick={() => go(stage + 1, 'heading')} tabIndex={stage === TOTAL_STATIONS ? -1 : undefined} aria-hidden={stage === TOTAL_STATIONS || undefined}>
                Next: {stations[Math.min(stage, TOTAL_STATIONS - 1)].title} &rarr;
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
