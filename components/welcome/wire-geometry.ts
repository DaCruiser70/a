import { roundedPath, type Pt } from '@/components/career/geometry'

// The welcome page's wire rail, generated from the five station positions (viewBox RAIL_W × RAIL_H).
// The pipe zig-zags between two columns with a short straight run through each station, so every
// station sits on a level piece of pipe. LIT_OFFSETS: how much of the pathLength=100 pipe stays
// unlit when a station is active (the gold part ends at that station).

export const RAIL_W = 300
export const RAIL_H = 680

const LEFT_X  = 90
const RIGHT_X = 200
const STUB    = 10      // straight run above and below each station
const START_Y = 14
const END_Y   = 650
const RADIUS  = 5

export const STATION_POINTS: Pt[] = [70, 200, 330, 460, 590].map((y, i) => [i % 2 === 0 ? LEFT_X : RIGHT_X, y] as Pt)

const points: Pt[] = [[LEFT_X, START_Y]]
STATION_POINTS.forEach(([x, y], i) => {
  if (i > 0) points.push([x, y - STUB])
  points.push([x, y + (i === STATION_POINTS.length - 1 ? 0 : STUB)])
})
points.push([LEFT_X, END_Y])

export const RAIL_D = roundedPath(points, RADIUS)

// Lengths along the polyline (the rounded corners are only 5 units, so this matches the drawn path
// closely enough for the lit stroke to stop at the station)
const segs = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]))
const total = segs.reduce((a, b) => a + b, 0)

function lengthTo(target: Pt): number {
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const onSeg = a[0] === b[0] && target[0] === a[0] && target[1] >= Math.min(a[1], b[1]) && target[1] <= Math.max(a[1], b[1])
    if (onSeg) return acc + Math.abs(target[1] - a[1])
    acc += segs[i - 1]
  }
  return acc
}

export const LIT_OFFSETS: number[] = STATION_POINTS.map(p => Number((100 - (lengthTo(p) / total) * 100).toFixed(2)))

export const pctOf = ([x, y]: Pt) => ({ left: `${(x / RAIL_W) * 100}%`, top: `${(y / RAIL_H) * 100}%` })
