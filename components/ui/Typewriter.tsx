'use client'

import { useEffect, useState } from 'react'

// The login page's two-line headline. Decorative: the page carries a visually hidden <h1> with the
// same meaning, so this whole block is aria-hidden. Both lines keep their height while empty, so the
// page never jumps. Under prefers-reduced-motion the first phrase shows fully typed and nothing moves.

const PHRASES: readonly [string, string][] = [
  ['Your first day',    'starts here.'],
  ['The power',         'runs on people.'],
  ['Welcome to a team', 'that has your back.'],
  ['Safe, supported,',  'and ready to go.'],
  ['Great careers',     'start with people.'],
  ['Everything you need', 'is waiting inside.'],
]

const TICK_MS     = 35                       // one tick: deleting moves every tick, typing every other
const TYPE_EVERY  = 2                        // 70ms per typed character
const HOLD_TICKS  = Math.round(2200 / TICK_MS)
const PAUSE_TICKS = Math.round(400 / TICK_MS)

type Mode = 'typing' | 'holding' | 'deleting' | 'pausing'
type State = { phrase: number; chars: number; mode: Mode; wait: number; still: boolean }

const FULL_FIRST: State = { phrase: 0, chars: PHRASES[0][0].length + PHRASES[0][1].length, mode: 'holding', wait: 0, still: true }

function step(s: State): State {
  const total = PHRASES[s.phrase][0].length + PHRASES[s.phrase][1].length
  switch (s.mode) {
    case 'typing':
      if (s.wait + 1 < TYPE_EVERY) return { ...s, wait: s.wait + 1 }
      if (s.chars + 1 >= total) return { ...s, chars: total, mode: 'holding', wait: 0 }
      return { ...s, chars: s.chars + 1, wait: 0 }
    case 'holding':
      return s.wait + 1 >= HOLD_TICKS ? { ...s, mode: 'deleting', wait: 0 } : { ...s, wait: s.wait + 1 }
    case 'deleting':
      return s.chars <= 1 ? { ...s, chars: 0, mode: 'pausing', wait: 0 } : { ...s, chars: s.chars - 1 }
    case 'pausing':
      return s.wait + 1 >= PAUSE_TICKS
        ? { phrase: (s.phrase + 1) % PHRASES.length, chars: 0, mode: 'typing', wait: 0, still: false }
        : { ...s, wait: s.wait + 1 }
  }
}

export default function Typewriter() {
  // Server render and no-JS: the first phrase, fully typed
  const [state, setState] = useState<State>(FULL_FIRST)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let interval: ReturnType<typeof setInterval> | null = null

    const stop = () => { if (interval) clearInterval(interval); interval = null }
    // The first tick clears the static phrase and starts typing from nothing
    const run  = () => {
      stop()
      interval = setInterval(() => setState(s => s.still ? { phrase: 0, chars: 0, mode: 'typing', wait: 0, still: false } : step(s)), TICK_MS)
    }
    const onChange = () => {
      if (reduce.matches) { stop(); setState(FULL_FIRST) } else run()
    }
    if (!reduce.matches) run()
    reduce.addEventListener('change', onChange)
    return () => {
      reduce.removeEventListener('change', onChange)
      stop()
    }
  }, [])

  const [one, two] = PHRASES[state.phrase]
  const lineOne = one.slice(0, Math.min(state.chars, one.length))
  const lineTwo = two.slice(0, Math.max(0, state.chars - one.length))
  const onTwo   = state.chars > one.length
  const cursor  = state.still ? null : <span className="ld-tw-cursor" />

  return (
    <div className="ld-headline" aria-hidden="true">
      <span className="ld-tw-line ld-tw-one">{lineOne}{!onTwo && cursor}</span>
      <span className="ld-tw-line ld-tw-two">{lineTwo}{onTwo && cursor}</span>
    </div>
  )
}
