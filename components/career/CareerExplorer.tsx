'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import CareerCircuit from '@/components/career/CareerCircuit'
import MiniCircuit from '@/components/career/MiniCircuit'

// /welcome/careers in two steps, switched in place (no route change):
//   intro     one screen: eyebrow, headline, two lines and "Explore the circuit"
//   explorer  how it works, the filters, the circuit map (or the track list on small screens), the
//             people grid and a footer back to the welcome page
// The intro fades and slides out, then the explorer fades in (about 300ms, CSS). With reduced motion
// the switch is instant. Each step moves focus to its own heading or button.

type Step = 'intro' | 'leaving' | 'explorer'

// "How it works", numbered in the first three track colours (green, blue, amber)
const HOW_STEPS = [
  { n: 1, track: 't', strong: 'Tap a valve',             rest: 'to open a step' },
  { n: 2, track: 'c', strong: 'Pick a person',           rest: 'to light up their route' },
  { n: 3, track: 'p', strong: 'Follow the dotted lines', rest: 'to see where tracks cross' },
] as const

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function CareerExplorer({ back }: { back: { href: string; label: string } }) {
  const [step, setStep] = useState<Step>('intro')
  const [returned, setReturned] = useState(false)
  const explorerHeading = useRef<HTMLHeadingElement>(null)
  const exploreButton   = useRef<HTMLButtonElement>(null)

  function explore() {
    if (reducedMotion()) { setStep('explorer'); return }
    setStep('leaving')
    // The slide-out's animationend moves on; this only covers a browser that never fires it
    window.setTimeout(() => setStep(s => (s === 'leaving' ? 'explorer' : s)), 600)
  }

  function backToIntro() {
    setReturned(true)
    setStep('intro')
  }

  // Each step starts at the top with focus on its heading (explorer) or its button (back on intro)
  useEffect(() => {
    if (step === 'explorer') {
      window.scrollTo({ top: 0, behavior: 'auto' })
      explorerHeading.current?.focus()
    } else if (step === 'intro' && returned) {
      window.scrollTo({ top: 0, behavior: 'auto' })
      exploreButton.current?.focus()
    }
  }, [step, returned])

  return (
    <div className="cc-shell">
      <Link href={back.href} className="cc-backlink">&larr; {back.label}</Link>

      {step !== 'explorer' ? (
        <section
          className={`cc-intro${step === 'leaving' ? ' leaving' : ''}`}
          aria-labelledby="cc-intro-title"
          onAnimationEnd={e => { if (step === 'leaving' && e.target === e.currentTarget) setStep('explorer') }}
        >
          <div className="cc-intro-text">
            <div className="cc-kicker gold">YOUR PATH AT AEM</div>
            <h1 id="cc-intro-title" className="cc-h1">Where could <span className="cc-you">you</span> go?</h1>
            <p className="cc-hero-lede">
              Every line on this map is a path a real teammate has taken. Pick a track and follow it.
            </p>
            <div className="cc-hero-actions">
              <button ref={exploreButton} type="button" className="cc-gold-btn" onClick={explore} disabled={step === 'leaving'}>
                Explore the circuit &rarr;
              </button>
            </div>
          </div>
          <div className="cc-hero-vis"><MiniCircuit variant="hero" /></div>
        </section>
      ) : (
        <section className="cc-explorer" aria-labelledby="cc-explorer-title">
          <div className="cc-explorer-head">
            <h1 id="cc-explorer-title" ref={explorerHeading} tabIndex={-1} className="cc-explorer-title">Four tracks. One circuit.</h1>
            <button type="button" className="cc-backlink" onClick={backToIntro}>&larr; Back to intro</button>
          </div>

          <ol className="cc-how" aria-label="How it works">
            {HOW_STEPS.map(s => (
              <li key={s.n} style={{ '--c': `var(--cc-track-${s.track})` } as React.CSSProperties}>
                <b className="cc-how-n" aria-hidden="true">{s.n}</b>
                <span><b>{s.strong}</b> {s.rest}</span>
              </li>
            ))}
          </ol>

          <CareerCircuit />

          <footer className="cc-footer">
            <p>Found a path that sparks something? Tell your manager in your first week. Then head back to your welcome page.</p>
            <Link href={back.href} className="cc-white-btn">{back.label} &rarr;</Link>
          </footer>
        </section>
      )}
    </div>
  )
}
