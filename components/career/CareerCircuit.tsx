'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TRACKS, STAGES, PEOPLE, FOUNDATION, TRACK_BY_ID, STAGE_BY_ID,
  nextStage, peopleThrough, initials,
  type Person, type StageId, type TrackId,
} from '@/lib/career-content'
import {
  MAP_W, MAP_H, TRUNK_D, START_POINT, LANES, JUNCTIONS, LANE_END_X, FOUNDATION_AT,
  CROSS_LINK_PATHS, NODES, JOURNEY_PATHS, pct,
} from '@/components/career/geometry'

// The interactive part of /welcome/careers: track filters, the circuit map (desktop) or the track
// list (below 980px), the stage card, and the people grid with the selected person's journey.
// Every animation is CSS (styles/pages/careers.css) and stops under prefers-reduced-motion.

type Filter = 'all' | TrackId

const trackVar = (t: TrackId) => ({ '--c': `var(--cc-track-${t})` }) as React.CSSProperties

// Card vertical offset per track row, so the card stays inside the map (from the design)
const CARD_SHIFT: Record<TrackId, string> = { t: '-16%', c: '-38%', p: '-62%', b: '-84%' }

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 2l10 6-10 6z" className="cc-play-shape" />
    </svg>
  )
}

// Videos are placeholders: a styled button that does nothing yet
function VideoPlaceholder({ label }: { label: string }) {
  return (
    <button type="button" className="cc-vid" aria-disabled="true">
      <span className="cc-vid-play"><PlayIcon /></span>
      <span>{label} <span className="cc-vid-soon">(video coming soon)</span></span>
    </button>
  )
}

export default function CareerCircuit() {
  const [node, setNode]     = useState<StageId | null>(null)
  const [person, setPerson] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const cardRef   = useRef<HTMLDivElement>(null)
  const journeyRef = useRef<HTMLDivElement>(null)

  const chosen: Person | null = PEOPLE.find(p => p.id === person) ?? null
  const route  = chosen?.route ?? []
  const cur    = node ? STAGE_BY_ID[node] : null

  // Close the card and return focus to the valve (or list row) that shows this stage
  const close = useCallback(() => {
    const id = node
    setNode(null)
    if (!id) return
    requestAnimationFrame(() => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>(`[data-stage-btn="${id}"]`))
      targets.find(el => el.offsetParent !== null)?.focus()
    })
  }, [node])

  // The card is announced and focused whenever it opens or moves to the next step
  useEffect(() => {
    if (node) cardRef.current?.focus()
  }, [node])

  // Esc closes the card from anywhere on the page
  useEffect(() => {
    if (!node) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [node, close])

  function toggleNode(id: StageId) {
    setNode(n => (n === id ? null : id))
  }

  function pickPerson(id: string | null) {
    setPerson(id)
    setFilter('all')
  }

  function pickFilter(f: Filter) {
    setFilter(f)
    setPerson(null)
  }

  function clearAll() {
    setPerson(null)
    setFilter('all')
    setNode(null)
  }

  // Picking someone from the people grid brings their journey (just under it) into view
  function pickFromGrid(id: string | null) {
    pickPerson(id)
    if (!id) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => journeyRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }))
  }

  const laneDim = (t: TrackId) => !!chosen || (filter !== 'all' && filter !== t)
  const nodeDim = (id: StageId, t: TrackId) => (chosen ? !route.includes(id) : filter !== 'all' && filter !== t)

  const filters: { id: Filter; label: string }[] = [{ id: 'all', label: 'All tracks' }, ...TRACKS.map(t => ({ id: t.id, label: t.label }))]

  return (
    <>
      {/* ── Filters and status ── */}
      <div className="cc-toolbar">
        <div className="cc-filters" role="group" aria-label="Show a track">
          {filters.map(f => {
            const on = !chosen && filter === f.id
            return (
              <button
                key={f.id}
                type="button"
                className={`cc-filter${on ? ' on' : ''}`}
                style={f.id === 'all' ? ({ '--c': 'var(--cc-glow)' } as React.CSSProperties) : trackVar(f.id)}
                aria-pressed={on}
                onClick={() => pickFilter(f.id)}
              >
                <i aria-hidden="true" />{f.label}
              </button>
            )
          })}
        </div>
        <div className="cc-status" aria-live="polite">
          {chosen ? (
            <span className="cc-lit">
              Lighting up {chosen.name}&rsquo;s route
              <button type="button" className="cc-clear" onClick={clearAll}>Clear</button>
            </span>
          ) : (
            <span className="cc-hint">Tap a valve to open it. Pick a person below to light up their route.</span>
          )}
        </div>
      </div>

      {/* ── Map (desktop) and the card, in a soft frame ── */}
      <div className="cc-frame">
      <div className="cc-stage">
        <div className={`cc-map${chosen ? ' has-person' : ''}`} style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="cc-svg" aria-hidden="true" focusable="false">
            <defs>
              <filter id="cc-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3.2" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {CROSS_LINK_PATHS.map((d, i) => <path key={i} className="cc-xlink" d={d} />)}

            <g className="cc-trunk">
              <path className="cc-wall" d={TRUNK_D} />
              <path className="cc-inner" d={TRUNK_D} />
              <path className="cc-core" d={TRUNK_D} />
              <path className="cc-flow fast" d={TRUNK_D} filter="url(#cc-glow)" />
            </g>

            {LANES.map(l => (
              <g key={l.track} className={`cc-lane${laneDim(l.track) ? ' dim' : ''}`} style={trackVar(l.track)}>
                <path className="cc-wall" d={l.d} />
                <path className="cc-inner" d={l.d} />
                <path className="cc-core" d={l.d} />
                <path className="cc-flow" d={l.d} filter="url(#cc-glow)" style={{ animationDelay: `${l.delay}s` }} />
              </g>
            ))}

            {JUNCTIONS.map(([x, y]) => (
              <g key={x} className="cc-flange">
                <circle cx={x} cy={y} r={15} className="cc-flange-ring" />
                <circle cx={x} cy={y} r={5} className="cc-flange-gold" />
              </g>
            ))}
            {LANES.map(l => (
              <g key={l.track} className="cc-flange" style={trackVar(l.track)}>
                <circle cx={l.elbow[0]} cy={l.elbow[1]} r={12} className="cc-flange-ring" />
                <circle cx={l.elbow[0]} cy={l.elbow[1]} r={4} className="cc-flange-dot" />
                <rect x={LANE_END_X - 4} y={l.endY - 17} width={14} height={34} rx={4} className="cc-endcap" />
              </g>
            ))}

            {PEOPLE.map(p => (
              <g key={p.id} className={`cc-journey${person === p.id ? ' on' : ''}`}>
                <path className="cc-journey-halo" d={JOURNEY_PATHS[p.id]} filter="url(#cc-glow)" />
                <path className="cc-journey-line" d={JOURNEY_PATHS[p.id]} />
                <path className="cc-flow fast cc-journey-flow" d={JOURNEY_PATHS[p.id]} />
                {person === p.id && <path className="cc-pulse" d={JOURNEY_PATHS[p.id]} pathLength={100} filter="url(#cc-glow)" />}
              </g>
            ))}
          </svg>

          {/* Start marker and foundation */}
          <div className="cc-start" style={pct(START_POINT)} aria-hidden="true">
            <span className="cc-start-ping" />
            <span className="cc-start-core">DAY<br />ONE</span>
            <span className="cc-start-label">YOU ARE HERE</span>
          </div>
          <div className="cc-foundation" style={pct(FOUNDATION_AT)}>
            <div className="cc-foundation-title">YOUR FOUNDATION</div>
            <ul>{FOUNDATION.map(f => <li key={f}>{f}</li>)}</ul>
          </div>

          {/* Track chips (filters) */}
          {LANES.map(l => {
            const t = TRACK_BY_ID[l.track]
            return (
              <button
                key={l.track}
                type="button"
                className={`cc-lchip${laneDim(l.track) ? ' dim' : ''}`}
                style={{ left: pct(l.chip).left, top: `calc(${pct(l.chip).top} - var(--cc-pill-lift))`, ...trackVar(l.track) }}
                aria-pressed={!chosen && filter === l.track}
                onClick={() => pickFilter(filter === l.track ? 'all' : l.track)}
              >
                <i aria-hidden="true" />{t.label}
              </button>
            )
          })}

          {/* Valves */}
          {NODES.map(({ stage, at }) => {
            const step = route.indexOf(stage.id)
            const on = node === stage.id
            return (
              <button
                key={stage.id}
                type="button"
                data-stage-btn={stage.id}
                className={`cc-node${on ? ' on' : ''}${nodeDim(stage.id, stage.track) ? ' dim' : ''}`}
                style={{ ...pct(at), ...trackVar(stage.track) }}
                aria-label={`${stage.title}, ${TRACK_BY_ID[stage.track].label} track, step ${stage.index + 1} of 5${step >= 0 ? `, step ${step + 1} of ${chosen!.name}’s route` : ''}`}
                aria-pressed={on}
                onClick={() => toggleNode(stage.id)}
              >
                <span className="cc-dial" aria-hidden="true" />
                <span className="cc-core-btn" aria-hidden="true">{stage.index + 1}</span>
                {step >= 0 && <span className="cc-badge" aria-hidden="true">{step + 1}</span>}
                <span className="cc-node-label" aria-hidden="true">{stage.title}</span>
              </button>
            )
          })}
        </div>

        {cur && (() => {
          const track = TRACK_BY_ID[cur.track]
          const right = cur.index <= 2
          const here  = peopleThrough(cur.id)
          const nxt   = nextStage(cur)
          const at    = pct(NODES.find(n => n.stage.id === cur.id)!.at)
          return (
            <div
              className="cc-cardpos"
              style={{
                left: right ? `calc(${at.left} + 50px)` : `calc(${at.left} - 400px)`,
                top: at.top,
                transform: `translateY(${CARD_SHIFT[cur.track]})`,
                ...trackVar(cur.track),
              }}
            >
              <div
                key={cur.id}
                ref={cardRef}
                tabIndex={-1}
                role="dialog"
                aria-labelledby="cc-card-title"
                className={`cc-card ${right ? 'from-left' : 'from-right'}`}
              >
                <button type="button" className="cc-card-close" aria-label="Close" onClick={close}>&times;</button>
                <div className="cc-card-track">{track.label} track</div>
                <div className="cc-card-when">{cur.timing}</div>
                <h3 id="cc-card-title" className="cc-card-title">{cur.title}</h3>
                <p className="cc-card-blurb">{cur.blurb}</p>
                <div className="cc-eyebrow">WHAT YOU BUILD HERE</div>
                <ul className="cc-chips">{cur.builds.map(b => <li key={b} className="cc-chip">{b}</li>)}</ul>
                <VideoPlaceholder label={here.length ? `Hear ${here[0].name} talk about this step` : 'A short video about this step'} />
                {here.length > 0 && (
                  <div className="cc-card-people">
                    {here.slice(0, 2).map(p => (
                      <button key={p.id} type="button" className="cc-tilebtn" onClick={() => pickPerson(p.id)}>
                        Trace {p.name}&rsquo;s route
                      </button>
                    ))}
                  </div>
                )}
                {nxt && (
                  <button type="button" className="cc-next" onClick={() => setNode(nxt.id)}>
                    Next step: {nxt.title} &rarr;
                  </button>
                )}
              </div>
            </div>
          )
        })()}
      </div>
      </div>
      <p className="cc-map-caption">Dotted lines are where people have switched tracks. Careers here are not a ladder.</p>

      {/* ── Track list (below 980px) ── */}
      <div className="cc-mlist">
        {TRACKS.map(t => (
          <section key={t.id} aria-labelledby={`cc-mlist-${t.id}`} style={trackVar(t.id)} className={laneDim(t.id) ? 'dim' : ''}>
            <h3 id={`cc-mlist-${t.id}`} className="cc-mlist-head">{t.label}</h3>
            <ul>
              {STAGES.filter(s => s.track === t.id).map(s => {
                const step = route.indexOf(s.id)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-stage-btn={s.id}
                      className={`cc-mrow${node === s.id ? ' on' : ''}`}
                      aria-pressed={node === s.id}
                      onClick={() => toggleNode(s.id)}
                    >
                      <span className="cc-mdot" aria-hidden="true">{s.index + 1}</span>
                      <span className="cc-mtext">
                        <b>{s.title}</b>
                        <span>{s.timing}{step >= 0 ? ` · step ${step + 1} of ${chosen!.name}’s route` : ''}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* ── People ── */}
      <section id="people" className="cc-people-section" aria-labelledby="cc-people-title">
        <div className="cc-kicker">MEET PEOPLE WHO&rsquo;VE DONE IT</div>
        <h2 id="cc-people-title" className="cc-h2">Real routes. Real teammates.</h2>
        <p className="cc-lede">Pick someone and their journey lights up across the circuit above. Names, routes and videos here are placeholders until HR sends the real ones.</p>

        <div className="cc-people">
          {PEOPLE.map(p => {
            const on = person === p.id
            return (
              <button
                key={p.id}
                type="button"
                className={`cc-pcard${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => pickFromGrid(on ? null : p.id)}
              >
                <span className="cc-avatar" style={trackVar(p.track)} aria-hidden="true">{initials(p.name)}</span>
                <span className="cc-ptext">
                  <b>{p.name}</b>
                  <span>{p.journey}</span>
                  <span className="cc-pcta">{on ? 'ROUTE LIT UP ↑' : 'TRACE THIS ROUTE →'}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div ref={journeyRef} aria-live="polite">
          {chosen && (
            <div className="cc-journey-panel">
              <div>
                <div className="cc-eyebrow gold">THE JOURNEY</div>
                <h3 className="cc-journey-name">{chosen.name}</h3>
                <ol className="cc-steps">
                  {chosen.route.map((id, i) => {
                    const s = STAGE_BY_ID[id]
                    return (
                      <li key={id} style={trackVar(s.track)}>
                        <span className="cc-step-dot" aria-hidden="true">{i + 1}</span>
                        <span className="cc-step-text"><b>{s.title}</b><span>{TRACK_BY_ID[s.track].label}</span></span>
                      </li>
                    )
                  })}
                </ol>
              </div>
              <div style={{ '--c': 'var(--cc-glow)' } as React.CSSProperties}>
                <VideoPlaceholder label={`Watch ${chosen.name}’s story`} />
                {/* PLACEHOLDER quote */}
                <p className="cc-quote">&ldquo;Placeholder quote. A short line in their own words about what they learned and who helped them along the way.&rdquo;</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
