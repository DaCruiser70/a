'use client'

import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Task = {
  id: string
  task_key: string
  task_name: string
  status: 'pending' | 'confirmed'
  confirmed_at: string | null
  created_at: string
}

type HireGroup = {
  hire_id: string
  hire_name: string
  hire_role: string | null
  hire_start_date: string | null
  tasks: Task[]
  pending_count: number
  total_count: number
}

export default function StakeholderHireDetail() {
  const router    = useRouter()
  const params    = useParams()
  const hireId    = params?.id as string

  const [hireGroup, setHireGroup]         = useState<HireGroup | null>(null)
  const [loadError, setLoadError]         = useState(false)
  const [loading, setLoading]             = useState(true)
  const [confirmModal, setConfirmModal]   = useState<Task | null>(null)
  const [confirming, setConfirming]       = useState(false)
  const [noteText, setNoteText]           = useState('')
  const [toast, setToast]                 = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stakeholder/tasks')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const group = (data.hires as HireGroup[]).find(h => h.hire_id === hireId)
        if (!group) { setLoadError(true); return }
        setHireGroup(group)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [hireId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

  async function handleConfirm() {
    if (!confirmModal) return
    setConfirming(true)
    try {
      const trimmedNote = noteText.trim()
      const res = await fetch(`/api/stakeholder/tasks/${confirmModal.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ note: trimmedNote || null }),
      })
      if (!res.ok) { showToast('Failed to confirm. Please try again.'); return }

      setHireGroup(prev => {
        if (!prev) return prev
        const tasks = prev.tasks.map(t =>
          t.id === confirmModal.id
            ? { ...t, status: 'confirmed' as const, confirmed_at: new Date().toISOString() }
            : t
        )
        const pending_count = tasks.filter(t => t.status === 'pending').length
        return { ...prev, tasks, pending_count }
      })
      showToast(`"${confirmModal.task_name}" confirmed`)
      setNoteText('')
      setConfirmModal(null)
    } finally {
      setConfirming(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', background: '#F5F4F1' }}>
        <div style={{ color: '#B0ABA4', fontSize: '14px' }}>Loading…</div>
      </div>
    )
  }

  if (loadError || !hireGroup) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', background: '#F5F4F1' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: '#888780', marginBottom: '16px' }}>Task not found or access denied.</div>
          <button onClick={() => router.push('/stakeholder/dashboard')} style={{ padding: '8px 18px', background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F4F1', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── NAV ── */}
      <nav style={{
        background: '#1B3A6B', padding: '0 1.5rem', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button
          onClick={() => router.push('/stakeholder/dashboard')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.65)', fontSize: '13px', fontFamily: 'inherit', fontWeight: 500,
            padding: '6px 10px', borderRadius: '6px',
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '14px', height: '14px' }}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Dashboard
        </button>
        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
          Stakeholder Portal
        </span>
        <button
          onClick={async () => { const s = createClient(); await s.auth.signOut(); router.push('/login') }}
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
      </nav>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Hire summary card */}
        <div style={{
          background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.07)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)', padding: '1.5rem',
          marginBottom: '1.25rem',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B0ABA4', marginBottom: '8px' }}>
            New Hire
          </div>
          <div style={{ fontWeight: 700, fontSize: '20px', color: '#1A1916', marginBottom: '4px' }}>
            {hireGroup.hire_name}
          </div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '6px' }}>
            {hireGroup.hire_role && (
              <span style={{ fontSize: '12px', color: '#888780', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '12px', height: '12px' }}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                {hireGroup.hire_role}
              </span>
            )}
            {hireGroup.hire_start_date && (
              <span style={{ fontSize: '12px', color: '#888780', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '12px', height: '12px' }}>
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Start: {new Date(hireGroup.hire_start_date).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            )}
          </div>
          <div style={{ marginTop: '12px', padding: '8px 12px', background: '#F5F4F1', borderRadius: '8px', fontSize: '12px', color: '#888780' }}>
            {hireGroup.total_count - hireGroup.pending_count} of {hireGroup.total_count} task{hireGroup.total_count !== 1 ? 's' : ''} confirmed
          </div>
        </div>

        {/* Tasks */}
        <div style={{
          background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.07)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden',
        }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: '#1A1916' }}>Your Tasks</div>
            <div style={{ fontSize: '12px', color: '#888780', marginTop: '2px' }}>
              Confirm each item once you have completed it for this hire.
            </div>
          </div>

          {hireGroup.tasks.map((task, i) => (
            <div key={task.id} style={{
              padding: '1.125rem 1.5rem',
              borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.05)',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: task.status === 'confirmed' ? 'rgba(13,92,70,0.1)' : 'rgba(200,146,10,0.1)',
                border:     `1px solid ${task.status === 'confirmed' ? 'rgba(13,92,70,0.2)' : 'rgba(200,146,10,0.25)'}`,
              }}>
                {task.status === 'confirmed' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="2.5" strokeLinecap="round" style={{ width: '14px', height: '14px' }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="2" strokeLinecap="round" style={{ width: '14px', height: '14px' }}>
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#1A1916', marginBottom: '2px' }}>
                  {task.task_name}
                </div>
                <div style={{ fontSize: '11px', color: '#B0ABA4' }}>
                  {task.status === 'confirmed' && task.confirmed_at
                    ? `Confirmed ${new Date(task.confirmed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : `Added ${new Date(task.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  }
                </div>
              </div>

              {task.status === 'pending' ? (
                <button
                  onClick={() => setConfirmModal(task)}
                  style={{
                    padding: '7px 14px', borderRadius: '8px',
                    background: '#1B3A6B', color: '#fff',
                    border: 'none', cursor: 'pointer',
                    fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  Confirm Complete
                </button>
              ) : (
                <span style={{
                  fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '100px',
                  color: '#0D5C46', background: 'rgba(13,92,70,0.1)', border: '1px solid rgba(13,92,70,0.2)',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  Confirmed
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── CONFIRM MODAL ── */}
      {confirmModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget && !confirming) { setConfirmModal(null); setNoteText('') } }}
        >
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 28px 24px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontWeight: 700, fontSize: '17px', color: '#1A1916', marginBottom: '8px' }}>
                Confirm task complete?
              </div>
              <div style={{ fontSize: '13px', color: '#4A4640', lineHeight: 1.5 }}>
                Please confirm that you have completed:
              </div>
              <div style={{
                marginTop: '10px', padding: '10px 14px', borderRadius: '8px',
                background: 'rgba(27,58,107,0.06)', border: '1px solid rgba(27,58,107,0.12)',
                fontWeight: 600, fontSize: '14px', color: '#1B3A6B',
              }}>
                {confirmModal.task_name}
              </div>
              <div style={{ fontSize: '12px', color: '#888780', marginTop: '10px', lineHeight: 1.5 }}>
                for {hireGroup?.hire_name}{hireGroup?.hire_role ? ` (${hireGroup.hire_role})` : ''}.
                This action cannot be undone.
              </div>

              {/* Optional completion note */}
              <div style={{ marginTop: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4A4640', marginBottom: '6px' }}>
                  Notes for HR <span style={{ fontWeight: 400, color: '#888780' }}>(optional)</span>
                </label>
                <textarea
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. login details, or where the card was left for the new hire"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  disabled={confirming}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    padding: '10px 12px', border: '1.5px solid rgba(0,0,0,0.15)',
                    borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
                    lineHeight: 1.5, outline: 'none', color: '#1A1916',
                    background: confirming ? '#F9F8F7' : '#fff',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '5px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#888780' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '11px', height: '11px', flexShrink: 0 }}>
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    Encrypted — only HR can read this
                  </div>
                  <span style={{ fontSize: '11px', color: noteText.length > 900 ? '#C8920A' : '#B0ABA4' }}>
                    {noteText.length}/1000
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setConfirmModal(null); setNoteText('') }}
                disabled={confirming}
                style={{ padding: '8px 18px', borderRadius: '8px', border: '1.5px solid rgba(0,0,0,0.12)', background: '#fff', cursor: confirming ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: '13px', color: '#4A4640' }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                style={{
                  padding: '8px 18px', borderRadius: '8px', border: 'none',
                  background: confirming ? 'rgba(13,92,70,0.5)' : '#0D5C46',
                  color: '#fff', cursor: confirming ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontSize: '13px', fontWeight: 600,
                }}
              >
                {confirming ? 'Confirming…' : 'Yes, confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#1A1916', color: '#fff', borderRadius: '10px',
          padding: '10px 18px', fontSize: '13px', fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)', zIndex: 999, whiteSpace: 'nowrap',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: '14px', height: '14px', flexShrink: 0 }}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {toast}
        </div>
      )}
    </div>
  )
}
