'use client'

import { useRef } from 'react'
import type { HireTab, TabBadge, Tone } from '@/lib/hr-hire'

// Uppercase status pill. The text always carries the meaning; the tone only reinforces it.
export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`hh-pill ${tone}`}>{children}</span>
}

export type TabDef = { id: HireTab; label: string; badge?: TabBadge }

export const tabId   = (t: HireTab) => `hh-tab-${t}`
export const panelId = (t: HireTab) => `hh-panel-${t}`

// WAI-ARIA tabs with automatic activation: Left / Right move and select, Home / End jump.
// Only the selected tab is in the Tab order.
export default function HireTabBar({ tabs, active, onSelect }: {
  tabs: TabDef[]
  active: HireTab
  onSelect: (tab: HireTab) => void
}) {
  const refs = useRef<Partial<Record<HireTab, HTMLButtonElement | null>>>({})

  function move(e: React.KeyboardEvent, index: number) {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    const t = tabs[next].id
    onSelect(t)
    const el = refs.current[t]
    el?.focus()
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className="hh-tabbar">
      <div className="hh-tabbar-inner" role="tablist" aria-label="Hire record sections">
        {tabs.map((t, i) => {
          const selected = t.id === active
          return (
            <button
              key={t.id}
              ref={el => { refs.current[t.id] = el }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              className={`hh-tab${selected ? ' active' : ''}`}
              onClick={() => onSelect(t.id)}
              onKeyDown={e => move(e, i)}
            >
              {t.label}
              {t.badge && <StatusPill tone={t.badge.tone}><span className="hh-sr-only">, </span>{t.badge.text}</StatusPill>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
