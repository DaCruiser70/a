'use client'

import { useEffect, useState } from 'react'

export type MePortal = { label: string; href: string }
export type Me = { name: string; roles: string[]; portals: MePortal[] }

// One /api/me request per page load, shared by every component that needs it
let mePromise: Promise<Me | null> | null = null

function loadMe(): Promise<Me | null> {
  if (!mePromise) {
    mePromise = fetch('/api/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() as Promise<Me> : null))
      .catch(() => null)
      .then(me => {
        if (!me) mePromise = null // allow a retry on the next mount
        return me
      })
  }
  return mePromise
}

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe]           = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadMe().then(result => {
      if (cancelled) return
      setMe(result)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return { me, loading }
}
