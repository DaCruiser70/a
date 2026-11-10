'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'

// The login page's circuit: four coloured wires from the left edge of the page into dots on the
// card's left edge, plus a navy wire from the logo into the top of the card. Decorative only.
//
// Geometry comes from the real layout (ResizeObserver on the page, the left column and the card),
// so the wires stay attached to the card edge at every width. Drawn in page pixels: no viewBox.
// Desktop only (the CSS hides it below 1000px, and nothing is drawn there either). Every distance
// is in rem, read from the page when measuring, so the circuit scales with the fluid type.

// In rem, so the circuit grows with the page (the login page makes rem fluid from 1000px)
const LANE_GAP    = 2.75   // between wires
const STEP_DROP   = 1.5    // each wire steps down once by this much
const CORNER      = 0.625
const CLEARANCE   = 1.5    // from the paragraph above and the value cards below
const DESKTOP     = '(min-width: 1000px)'
const REDUCE      = '(prefers-reduced-motion: reduce)'

const WIRES = ['green', 'blue', 'amber', 'steel'] as const

type Geo = {
  w: number; h: number
  rem: number
  wires: { d: string; x: number; y: number }[]          // empty when there is no room between the texts
  navy:  { d: string; x: number; y: number } | null
}

function media(query: string) {
  return {
    subscribe: (cb: () => void) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    get: () => window.matchMedia(query).matches,
  }
}
const reduceMedia  = media(REDUCE)
const desktopMedia = media(DESKTOP)

// Flat, one rounded step down, flat into the dot
function stepPath(y: number, stepX: number, endX: number, rem: number): string {
  const r = CORNER * rem, y2 = y + STEP_DROP * rem
  return `M 0 ${y} H ${stepX - r} Q ${stepX} ${y} ${stepX} ${y + r} V ${y2 - r} Q ${stepX} ${y2} ${stepX + r} ${y2} H ${endX}`
}

function measure(stage: HTMLElement): Geo | null {
  const card   = stage.querySelector<HTMLElement>('[data-ld-card]')
  const sub    = stage.querySelector<HTMLElement>('.ld-sub')
  const values = stage.querySelector<HTMLElement>('.ld-values')
  const logo   = stage.querySelector<HTMLElement>('[data-ld-logo]')
  if (!card || !sub || !values) return null
  // The page's rem, but the circuit never grows past 1.2x its 1440 size (16px)
  const rem = Math.min(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16, 16 * 1.2)
  const s = stage.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  const top = (el: HTMLElement) => el.getBoundingClientRect().top - s.top
  const bottom = (el: HTMLElement) => el.getBoundingClientRect().bottom - s.top

  const cardX = c.left - s.left
  const cardTop = c.top - s.top
  const cardBottom = c.bottom - s.top
  const gap = LANE_GAP * rem, drop = STEP_DROP * rem
  const bundle = (WIRES.length - 1) * gap + drop       // first wire's start to last wire's dot

  // Centred on the card's middle (the card is centred on the page), but always below the paragraph,
  // above the value cards and with every dot on the card's edge
  const ideal = (cardTop + cardBottom) / 2 - bundle / 2
  const lo = Math.max(bottom(sub) + CLEARANCE * rem, cardTop + 2.5 * rem - drop)
  const hi = Math.min(top(values) - CLEARANCE * rem - bundle, cardBottom - 2 * rem - bundle)
  const firstY = Math.round(Math.min(Math.max(ideal, lo), hi))
  const fits = lo <= hi && cardX > 16 * rem

  // The lowest wire steps first (furthest left), the top wire last: a staircase that never crosses
  const wires = fits
    ? WIRES.map((_, i) => {
        const y = firstY + i * gap
        const stepX = cardX - 3.5 * rem - i * 2.5 * rem
        return { d: stepPath(y, stepX, cardX, rem), x: cardX, y: y + drop }
      })
    : []

  let navy: Geo['navy'] = null
  if (logo) {
    const g = logo.getBoundingClientRect()
    const startX = g.right - s.left + rem
    const y = g.top - s.top + g.height / 2
    const dropX = cardX + 4.5 * rem
    const r = CORNER * rem
    if (dropX - r > startX && cardTop - y > 2.5 * rem) {
      navy = { d: `M ${startX} ${y} H ${dropX - r} Q ${dropX} ${y} ${dropX} ${y + r} V ${cardTop}`, x: dropX, y: cardTop }
    }
  }
  return { w: s.width, h: s.height, rem, wires, navy }
}

export default function LoginWires() {
  const ref = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geo | null>(null)
  const id = useId().replace(/:/g, '')
  const reduce  = useSyncExternalStore(reduceMedia.subscribe, reduceMedia.get, () => true)
  const desktop = useSyncExternalStore(desktopMedia.subscribe, desktopMedia.get, () => false)

  useEffect(() => {
    const stage = ref.current?.parentElement
    if (!stage || !desktop) return
    // ResizeObserver reports once on observe, so the first measurement needs no extra call
    const ro = new ResizeObserver(() => setGeo(measure(stage)))
    ro.observe(stage)
    stage.querySelectorAll('[data-ld-card], [data-ld-left], .ld-values').forEach(el => ro.observe(el))
    return () => ro.disconnect()
  }, [desktop])

  const show = desktop && geo
  return (
    <div ref={ref} className="ld-wires" aria-hidden="true">
      {show && (
        <svg width={geo.w} height={geo.h} focusable="false">
          <defs>
            <filter id={`${id}-glow`} x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {[...geo.wires.map((w, i) => ({ ...w, tone: WIRES[i] as string, n: i + 1 })),
            ...(geo.navy ? [{ ...geo.navy, tone: 'navy', n: 5 }] : [])].map(w => (
            <g key={w.tone} className={`ld-wire ld-wire-${w.tone}`}>
              <path id={`${id}-${w.tone}`} className="ld-wire-base" d={w.d} />
              <path className={`ld-wire-flow ld-flow-${w.n}`} d={w.d} pathLength={1000} />
              {!reduce && (
                <circle className="ld-wire-spark" r={0.22 * geo.rem} filter={`url(#${id}-glow)`}>
                  <animateMotion dur={`${4.2 + w.n * 0.7}s`} begin={`${-w.n * 0.9}s`} repeatCount="indefinite" calcMode="linear">
                    <mpath href={`#${id}-${w.tone}`} />
                  </animateMotion>
                </circle>
              )}
              <circle className="ld-wire-ping" cx={w.x} cy={w.y} r={0.375 * geo.rem} />
              <circle className="ld-wire-dot" cx={w.x} cy={w.y} r={0.3125 * geo.rem} />
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}
