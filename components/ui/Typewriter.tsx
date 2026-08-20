'use client'

import { useEffect, useRef, useState } from 'react'

const phrases = [
  'starts here.',
  'begins today.',
  'just got easier.',
  'matters to us.',
  'is exciting.',
]

export default function Typewriter() {
  const [display, setDisplay] = useState('')
  const state = useRef({
    phraseIndex: 0,
    charIndex: 0,
    deleting: false,
    holding: false,
  })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    function tick() {
      const s = state.current
      const current = phrases[s.phraseIndex]

      if (s.holding) {
        s.holding = false
        s.deleting = true
        timer = setTimeout(tick, 2000)
        return
      }

      if (!s.deleting) {
        s.charIndex++
        setDisplay(current.slice(0, s.charIndex))
        if (s.charIndex === current.length) {
          s.holding = true
          timer = setTimeout(tick, 85)
        } else {
          timer = setTimeout(tick, 85)
        }
      } else {
        s.charIndex--
        setDisplay(current.slice(0, s.charIndex))
        if (s.charIndex === 0) {
          s.deleting = false
          s.phraseIndex = (s.phraseIndex + 1) % phrases.length
        }
        timer = setTimeout(tick, 50)
      }
    }

    timer = setTimeout(tick, 800)
    return () => clearTimeout(timer)
  }, [])

  return (
    <em className="typewriter-wrap">
      <span className="typewriter">{display}</span>
      <span className="typewriter-cursor">|</span>
    </em>
  )
}