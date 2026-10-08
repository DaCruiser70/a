'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const TEAL = '#0F4C4A'
const TEAL_LIGHT = 'rgba(15,76,74,0.08)'
const TEAL_BORDER = 'rgba(15,76,74,0.2)'

type PayrollHire = {
  id:                       string
  full_name:                string
  position:                 string | null
  status:                   string
  start_date:               string | null
  entered_payroll_queue_at: string | null
  employee_id:              string | null
  payroll_completed_at:     string | null
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function timeInQueue(since: string | null): string {
  if (!since) return '—'
  const ms = Date.now() - new Date(since).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PayrollDashboard() {
  const router = useRouter()
  const [hires, setHires]           = useState<PayrollHire[]>([])
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('full_name, preferred_name')
        .eq('id', user.id)
        .single()
      if (data) setDisplayName(data.preferred_name ?? data.full_name ?? '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/payroll/hires')
      .then(r => r.ok ? r.json() : { hires: [] })
      .then(d => setHires(d.hires ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const awaiting   = hires.filter(h => !h.employee_id)
  const completed  = hires.filter(h => !!h.employee_id)
  const weekAgo    = new Date(Date.now() - 7 * 86_400_000)
  const thisWeek   = completed.filter(h => h.payroll_completed_at && new Date(h.payroll_completed_at) >= weekAgo)

  const statCards = [
    { label: 'Awaiting Payroll',      value: awaiting.length,  color: '#C8920A' },
    { label: 'Completed This Week',   value: thisWeek.length,  color: TEAL },
    { label: 'Total Completed',       value: completed.length, color: '#374151' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#F5F4F1', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── NAV ── */}
      <nav style={{
        background: TEAL, borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 1.5rem', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Image src="/logo.png" alt="AEM" width={100} height={26} style={{ filter: 'brightness(0) invert(1)', opacity: 0.9 }} />
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.18)' }} />
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
            Payroll Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
        background: `linear-gradient(135deg, ${TEAL} 0%, #0a3332 100%)`,
        padding: '2.5rem 1.5rem', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-60px', right: '-60px', width: '300px', height: '300px',
          borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: '1100px', margin: '0 auto', position: 'relative' }}>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
              Payroll Processing
            </span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.01em' }}>
            {displayName ? `Welcome back, ${displayName.split(' ')[0]}.` : 'Payroll Dashboard'}
          </h1>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.55)', margin: 0 }}>
            {loading ? 'Loading…' : awaiting.length === 0
              ? 'No hires currently awaiting payroll processing.'
              : `${awaiting.length} hire${awaiting.length !== 1 ? 's' : ''} awaiting payroll processing`}
          </p>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.5rem 1.5rem 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '1.5rem' }}>
          {statCards.map(card => (
            <div key={card.label} style={{
              background: '#fff', borderRadius: '14px',
              border: '1px solid rgba(0,0,0,0.07)', padding: '1.25rem 1.5rem',
              boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
            }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: card.color, lineHeight: 1 }}>
                {loading ? '—' : card.value}
              </div>
              <div style={{ fontSize: '13px', color: '#888780', marginTop: '4px', fontWeight: 500 }}>
                {card.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── TABLE ── */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem 2.5rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#B0ABA4', fontSize: '14px', padding: '3rem 0' }}>Loading…</div>
        ) : hires.length === 0 ? (
          <div style={{
            background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.07)',
            padding: '3rem 2rem', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
            <div style={{ fontWeight: 600, fontSize: '15px', color: '#1A1916', marginBottom: '6px' }}>No hires in queue</div>
            <div style={{ fontSize: '13px', color: '#888780' }}>
              Hires will appear here once HR has approved all their onboarding forms.
            </div>
          </div>
        ) : (
          <>
            {awaiting.length > 0 && (
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888780', marginBottom: '12px' }}>
                  Awaiting Processing
                </div>
                <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                        {['Name', 'Position', 'Start Date', 'Time in Queue', 'Status', ''].map(h => (
                          <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#888780', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {awaiting.map((hire, i) => (
                        <tr key={hire.id} style={{ borderBottom: i < awaiting.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{
                                width: '32px', height: '32px', borderRadius: '50%',
                                background: TEAL_LIGHT, border: `1px solid ${TEAL_BORDER}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '11px', fontWeight: 700, color: TEAL, flexShrink: 0,
                              }}>
                                {getInitials(hire.full_name)}
                              </div>
                              <span style={{ fontWeight: 600, fontSize: '14px', color: '#1A1916' }}>{hire.full_name}</span>
                            </div>
                          </td>
                          <td style={{ padding: '14px 16px', fontSize: '13px', color: '#888780' }}>{hire.position ?? '—'}</td>
                          <td style={{ padding: '14px 16px', fontSize: '13px', color: '#888780' }}>{fmtDate(hire.start_date)}</td>
                          <td style={{ padding: '14px 16px', fontSize: '13px', color: '#888780' }}>{timeInQueue(hire.entered_payroll_queue_at)}</td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{
                              fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px',
                              color: '#C8920A', background: 'rgba(200,146,10,0.1)', border: '1px solid rgba(200,146,10,0.25)',
                            }}>
                              Awaiting
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <button
                              onClick={() => router.push(`/payroll/newhire/${hire.id}`)}
                              style={{
                                padding: '7px 14px', borderRadius: '8px', border: `1px solid ${TEAL}`,
                                background: TEAL, color: '#fff', cursor: 'pointer',
                                fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                              }}
                            >
                              Review →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {completed.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888780', marginBottom: '12px' }}>
                  Completed
                </div>
                <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                        {['Name', 'Position', 'Employee ID', 'Completed', 'Status', ''].map(h => (
                          <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#888780', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {completed.map((hire, i) => (
                        <tr key={hire.id} style={{ borderBottom: i < completed.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{
                                width: '32px', height: '32px', borderRadius: '50%',
                                background: 'rgba(13,92,70,0.08)', border: '1px solid rgba(13,92,70,0.2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '11px', fontWeight: 700, color: '#0D5C46', flexShrink: 0,
                              }}>
                                {getInitials(hire.full_name)}
                              </div>
                              <span style={{ fontWeight: 600, fontSize: '14px', color: '#1A1916' }}>{hire.full_name}</span>
                            </div>
                          </td>
                          <td style={{ padding: '14px 16px', fontSize: '13px', color: '#888780' }}>{hire.position ?? '—'}</td>
                          <td style={{ padding: '14px 16px', fontSize: '13px', fontFamily: 'monospace', color: '#374151', fontWeight: 600 }}>{hire.employee_id}</td>
                          <td style={{ padding: '14px 16px', fontSize: '13px', color: '#888780' }}>{fmtDate(hire.payroll_completed_at)}</td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{
                              fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px',
                              color: '#0D5C46', background: 'rgba(13,92,70,0.1)', border: '1px solid rgba(13,92,70,0.2)',
                            }}>
                              Completed
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            <button
                              onClick={() => router.push(`/payroll/newhire/${hire.id}`)}
                              style={{
                                padding: '7px 14px', borderRadius: '8px',
                                border: '1px solid rgba(0,0,0,0.1)',
                                background: 'rgba(0,0,0,0.03)', color: '#888780', cursor: 'pointer',
                                fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                              }}
                            >
                              View →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
