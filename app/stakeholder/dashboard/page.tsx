'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useMe } from '@/lib/use-me'
import PortalSwitcher from '@/components/ui/PortalSwitcher'

type HireGroup = {
  hire_id: string
  hire_name: string
  hire_role: string | null
  hire_start_date: string | null
  pending_count: number
  total_count: number
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function HireCard({ hire, onView }: { hire: HireGroup; onView: () => void }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '14px',
      border: `1px solid ${hire.pending_count > 0 ? 'rgba(200,146,10,0.25)' : 'rgba(0,0,0,0.07)'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden',
    }}>
      <div style={{ padding: '1.25rem 1.25rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#1A1916', marginBottom: '2px' }}>
              {hire.hire_name}
            </div>
            {hire.hire_role && (
              <div style={{ fontSize: '12px', color: '#888780' }}>{hire.hire_role}</div>
            )}
            {hire.hire_start_date && (
              <div style={{ fontSize: '11px', color: '#B0ABA4', marginTop: '2px' }}>
                Start: {new Date(hire.hire_start_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
          <span style={{
            fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px', whiteSpace: 'nowrap', flexShrink: 0,
            color:      hire.pending_count > 0 ? '#C8920A' : '#0D5C46',
            background: hire.pending_count > 0 ? 'rgba(200,146,10,0.1)' : 'rgba(13,92,70,0.1)',
            border:     `1px solid ${hire.pending_count > 0 ? 'rgba(200,146,10,0.25)' : 'rgba(13,92,70,0.2)'}`,
          }}>
            {hire.pending_count > 0 ? `${hire.pending_count} pending` : 'All done'}
          </span>
        </div>
        <div style={{ fontSize: '12px', color: '#888780', marginBottom: '12px' }}>
          {hire.total_count - hire.pending_count} of {hire.total_count} task{hire.total_count !== 1 ? 's' : ''} confirmed
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '0.75rem 1.25rem' }}>
        <button
          onClick={onView}
          style={{
            width: '100%', padding: '8px 16px', borderRadius: '8px',
            background: hire.pending_count > 0 ? '#1B3A6B' : 'rgba(0,0,0,0.04)',
            color: hire.pending_count > 0 ? '#fff' : '#888780',
            border: 'none', cursor: 'pointer',
            fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          {hire.pending_count > 0 ? 'View tasks →' : 'View details →'}
        </button>
      </div>
    </div>
  )
}

export default function StakeholderDashboard() {
  const router = useRouter()
  const [hires, setHires]           = useState<HireGroup[]>([])
  const { me } = useMe()
  const displayName = me?.name ?? ''
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    // Archive old completed hires first (idempotent), then fetch the visible ones
    fetch('/api/stakeholder/tasks/archive', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        fetch('/api/stakeholder/tasks')
          .then(r => r.ok ? r.json() : { hires: [] })
          .then(data => setHires(data.hires ?? []))
          .catch(() => {})
          .finally(() => setLoading(false))
      })
  }, [])

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }

  const needsAction       = hires.filter(h => h.pending_count > 0)
  const recentlyCompleted = hires.filter(h => h.pending_count === 0)
  const totalPending      = needsAction.reduce((sum, h) => sum + h.pending_count, 0)
  const totalTasks        = hires.reduce((sum, h) => sum + h.total_count, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#F5F4F1', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── NAV ── */}
      <nav style={{
        background: '#1B3A6B', borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 1.5rem', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Image src="/logo.png" alt="AEM" width={100} height={26} style={{ filter: 'brightness(0) invert(1)', opacity: 0.9 }} />
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.18)' }} />
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500, letterSpacing: '0.01em' }}>
            Stakeholder Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <PortalSwitcher tone="dark" />
          {displayName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700, color: '#fff',
              }}>
                {getInitials(displayName)}
              </div>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
                {displayName}
              </span>
            </div>
          )}
          <button
            onClick={handleSignOut}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 11px', borderRadius: '7px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', fontWeight: 500,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '13px', height: '13px' }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1B3A6B 0%, #0f2449 100%)',
        padding: '2.5rem 1.5rem',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-60px', right: '-60px', width: '300px', height: '300px',
          borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: '960px', margin: '0 auto', position: 'relative' }}>
          <div style={{ marginBottom: '4px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: totalPending > 0 ? '#F59E0B' : '#34D399', display: 'inline-block' }} />
              {totalPending > 0 ? 'Action Required' : 'All Clear'}
            </span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
            {displayName ? `Welcome back, ${displayName.split(' ')[0]}.` : 'Your Tasks'}
          </h1>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.55)', margin: 0 }}>
            {loading ? 'Loading tasks…'
              : totalTasks === 0 ? 'No tasks have been assigned to you yet.'
              : totalPending === 0 ? `All confirmed. Nothing outstanding.`
              : `${totalPending} task${totalPending !== 1 ? 's' : ''} pending across ${needsAction.length} new hire${needsAction.length !== 1 ? 's' : ''}`
            }
          </p>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#B0ABA4', fontSize: '14px', padding: '3rem 0' }}>
            Loading…
          </div>
        ) : hires.length === 0 ? (
          <div style={{
            background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.07)',
            padding: '3rem 2rem', textAlign: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
            <div style={{ fontWeight: 600, fontSize: '15px', color: '#1A1916', marginBottom: '6px' }}>
              No tasks assigned
            </div>
            <div style={{ fontSize: '13px', color: '#888780' }}>
              Tasks will appear here once HR saves an equipment provisioning record that includes your items.
            </div>
          </div>
        ) : (
          <>
            {/* ── Needs Action ── */}
            {needsAction.length > 0 && (
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888780', marginBottom: '12px' }}>
                  Needs Action
                </div>
                <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
                  {needsAction.map(hire => (
                    <HireCard key={hire.hire_id} hire={hire} onView={() => router.push(`/stakeholder/newhire/${hire.hire_id}`)} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Recently Completed ── */}
            {recentlyCompleted.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888780', marginBottom: '12px' }}>
                  Recently Completed
                </div>
                <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
                  {recentlyCompleted.map(hire => (
                    <HireCard key={hire.hire_id} hire={hire} onView={() => router.push(`/stakeholder/newhire/${hire.hire_id}`)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
