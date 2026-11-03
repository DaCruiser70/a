import { TRACKS, type TrackId } from '@/lib/career-content'
import { roundedPath, type Pt } from '@/components/career/geometry'

// Decorative circuits: the careers hero ('hero') and the welcome page's entry card ('entry').
// Generated from the four tracks; hidden from assistive tech. CSS animation only.

type Variant = 'hero' | 'entry'

const SPEC: Record<Variant, {
  w: number; h: number; startX: number; trunkTo: number; y: number; endX: number; r: number
  laneY: Record<TrackId, number>; jogX: Record<TrackId, number>; valveX: Record<TrackId, number>
}> = {
  hero: {
    w: 560, h: 360, startX: 0, trunkTo: 100, y: 180, endX: 540, r: 22,
    laneY: { t: 40, c: 125, p: 235, b: 320 },
    jogX:  { t: 150, c: 185, p: 185, b: 150 },
    valveX: { t: 470, c: 470, p: 470, b: 470 },
  },
  entry: {
    w: 440, h: 220, startX: 10, trunkTo: 90, y: 110, endX: 430, r: 20,
    laneY: { t: 20, c: 70, p: 150, b: 200 },
    jogX:  { t: 110, c: 110, p: 110, b: 110 },
    valveX: { t: 230, c: 330, p: 260, b: 360 },
  },
}

const trackVar = (t: TrackId) => ({ '--c': `var(--cc-track-${t})` }) as React.CSSProperties

export default function MiniCircuit({ variant }: { variant: Variant }) {
  const s = SPEC[variant]
  const glowId = `cc-glow-${variant}`
  const trunk = roundedPath([[s.startX, s.y], [s.trunkTo, s.y]], s.r)
  const lanes = TRACKS.map((t, i) => ({
    t: t.id,
    d: roundedPath([[s.trunkTo, s.y], [s.jogX[t.id], s.y], [s.jogX[t.id], s.laneY[t.id]], [s.endX, s.laneY[t.id]]] as Pt[], s.r),
    delay: -0.6 * i,
  }))

  return (
    <svg viewBox={`0 0 ${s.w} ${s.h}`} className={`cc-mini cc-mini-${variant}`} aria-hidden="true" focusable="false">
      <defs>
        <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g className="cc-trunk">
        <path className="cc-wall" d={trunk} />
        <path className="cc-inner" d={trunk} />
        <path className="cc-flow" d={trunk} filter={`url(#${glowId})`} />
      </g>
      {lanes.map(l => (
        <g key={l.t} className="cc-lane" style={trackVar(l.t)}>
          <path className="cc-wall" d={l.d} />
          <path className="cc-inner" d={l.d} />
          {variant === 'hero' && <path className="cc-core" d={l.d} />}
          <path className="cc-flow" d={l.d} filter={`url(#${glowId})`} style={{ animationDelay: `${l.delay}s` }} />
        </g>
      ))}
      {variant === 'hero' && (
        <g className="cc-flange">
          <circle cx={s.trunkTo} cy={s.y} r={12} className="cc-flange-ring" />
          <circle cx={s.trunkTo} cy={s.y} r={4} className="cc-flange-gold" />
        </g>
      )}
      {variant === 'entry' && <circle cx={s.startX} cy={s.y} r={10} className="cc-mini-start" />}
      {TRACKS.map(t => (
        <g key={t.id} style={trackVar(t.id)}>
          {variant === 'hero' && (
            <g className="cc-flange">
              <circle cx={s.jogX[t.id]} cy={s.laneY[t.id]} r={10} className="cc-flange-ring" />
              <circle cx={s.jogX[t.id]} cy={s.laneY[t.id]} r={3.5} className="cc-flange-dot" />
            </g>
          )}
          <circle cx={s.valveX[t.id]} cy={s.laneY[t.id]} r={variant === 'hero' ? 9 : 11} className="cc-mini-valve" />
        </g>
      ))}
    </svg>
  )
}
