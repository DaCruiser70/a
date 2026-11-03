import {
  TRACKS, STAGES, PEOPLE, CROSS_LINKS, STAGE_BY_ID,
  type Stage, type StageId, type TrackId,
} from '@/lib/career-content'

// The Career Circuit map, generated from lib/career-content.ts. All coordinates are in the SVG's
// viewBox (MAP_W × MAP_H); positions of the HTML overlays (valves, chips, card) are the same points
// as percentages, so they line up with the SVG at any width.

export type Pt = readonly [number, number]

export const MAP_W = 1300
export const MAP_H = 910

const COL_X     = [420, 610, 800, 990, 1180] as const   // one column per stage index
const COL_GAP   = COL_X[1] - COL_X[0]
const TRUNK     = { from: 90, to: 214, y: 455 }         // "Day one" to the junction
const LANE_FROM = 210                                     // where every lane leaves the junction
const LANE_END  = 1262
const PIPE_R    = 28
const LINK_R    = 20
const ROUTE_R   = 22

// Outer tracks jog at the first riser, inner tracks at the second, so the pipes nest. 220 units
// between tracks leaves room for each row's labels and the next row's track pill.
const LANE_Y: Record<TrackId, number> = { t: 125, c: 345, p: 565, b: 785 }
const JOG_X:  Record<TrackId, number> = { t: 250, c: 290, p: 290, b: 250 }

export const pct = (p: Pt) => ({ left: `${(p[0] / MAP_W) * 100}%`, top: `${(p[1] / MAP_H) * 100}%` })

export function stagePoint(s: Stage): Pt {
  return [COL_X[s.index], LANE_Y[s.track]]
}

const sub   = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const len   = (v: Pt) => Math.hypot(v[0], v[1])
const unit  = (v: Pt): Pt => { const l = len(v) || 1; return [v[0] / l, v[1] / l] }
const fmt   = (n: number) => Number(n.toFixed(2))

// Polyline with rounded corners: each corner becomes a quadratic curve whose radius is capped at
// half of either neighbouring segment, so two corners never overlap. Straight-through and repeated
// points are dropped.
export function roundedPath(points: readonly Pt[], radius: number): string {
  const pts: Pt[] = []
  for (const p of points) {
    const last = pts[pts.length - 1]
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    if (pts.length >= 2) {
      const a = pts[pts.length - 2]
      const cross = (last[0] - a[0]) * (p[1] - last[1]) - (last[1] - a[1]) * (p[0] - last[0])
      if (Math.abs(cross) < 1e-6) pts.pop()   // collinear: the middle point adds nothing
    }
    pts.push(p)
  }
  if (pts.length === 0) return ''
  let d = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1]
    const vin = sub(cur, prev), vout = sub(next, cur)
    const r = Math.min(radius, len(vin) / 2, len(vout) / 2)
    const a = [cur[0] - unit(vin)[0] * r, cur[1] - unit(vin)[1] * r]
    const b = [cur[0] + unit(vout)[0] * r, cur[1] + unit(vout)[1] * r]
    d += ` L${fmt(a[0])} ${fmt(a[1])} Q${fmt(cur[0])} ${fmt(cur[1])} ${fmt(b[0])} ${fmt(b[1])}`
  }
  const end = pts[pts.length - 1]
  return `${d} L${fmt(end[0])} ${fmt(end[1])}`
}

// From one stage to another: along its own lane to the riser halfway to the next column, across to
// the target lane, then along that lane. Same-lane steps are a straight run.
function hop(from: Pt, to: Pt): Pt[] {
  if (from[1] === to[1]) return [to]
  const riser = from[0] + COL_GAP / 2
  return [[riser, from[1]], [riser, to[1]], to]
}

// ── The map ──

// chip: where the track pill is anchored: the lane's first node. CSS lifts it above the node
// (--cc-pill-lift in careers.css) by an amount that depends on the rendered size of the map.
export type LaneGeo = { track: TrackId; d: string; elbow: Pt; endY: number; chip: Pt; delay: number }

export const TRUNK_D = roundedPath([[TRUNK.from, TRUNK.y], [TRUNK.to, TRUNK.y]], PIPE_R)
export const START_POINT: Pt = [TRUNK.from, TRUNK.y]
export const LANE_END_X = LANE_END

export const LANES: LaneGeo[] = TRACKS.map((t, i) => {
  const y = LANE_Y[t.id], x = JOG_X[t.id]
  return {
    track: t.id,
    d:     roundedPath([[LANE_FROM, TRUNK.y], [x, TRUNK.y], [x, y], [LANE_END, y]], PIPE_R),
    elbow: [x, y],
    endY:  y,
    chip:  [COL_X[0], y],
    delay: -0.7 * i,
  }
})

// Junction flanges on the trunk: the junction itself and each riser
export const JUNCTIONS: Pt[] = [...new Set([TRUNK.to, ...Object.values(JOG_X)])].map(x => [x, TRUNK.y] as Pt)

// Foundation list sits under the start marker
export const FOUNDATION_AT: Pt = [16, TRUNK.y + 74]

export const CROSS_LINK_PATHS: string[] = CROSS_LINKS.map(([a, b]) => {
  const pa = stagePoint(STAGE_BY_ID[a]), pb = stagePoint(STAGE_BY_ID[b])
  return roundedPath([pa, ...hop(pa, pb)], LINK_R)
})

export const NODES = STAGES.map(s => ({ stage: s, at: stagePoint(s) }))

export function routePath(route: readonly StageId[]): string {
  if (route.length === 0) return ''
  const pts: Pt[] = [stagePoint(STAGE_BY_ID[route[0]])]
  for (let i = 1; i < route.length; i++) {
    pts.push(...hop(pts[pts.length - 1], stagePoint(STAGE_BY_ID[route[i]])))
  }
  return roundedPath(pts, ROUTE_R)
}

export const JOURNEY_PATHS: Record<string, string> = Object.fromEntries(PEOPLE.map(p => [p.id, routePath(p.route)]))
