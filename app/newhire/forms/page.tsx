'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import '../../../styles/pages/forms.css'
import type { FormStatus } from '@/types'
import { PortalIdentity } from '@/components/ui/PortalName'

const FORMS = [
  {
    id: 'personal',
    step: 1,
    title: 'Personal Information',
    desc: 'Your name, address, phone number, and emergency contact details.',
    time: '4 min',
    tags: ['required'],
    href: '/newhire/forms/personal',
  },
  {
    id: 'banking',
    step: 2,
    title: 'Banking & Direct Deposit',
    desc: 'Institution number, transit number, and account details for payroll.',
    time: '3 min',
    tags: ['required', 'sensitive'],
    href: '/newhire/forms/banking',
  },
  {
    id: 'sin',
    step: 3,
    title: 'Social Insurance Number',
    desc: 'Your SIN for tax and payroll purposes. Encrypted with AES-256.',
    time: '1 min',
    tags: ['required', 'sensitive'],
    href: '/newhire/forms/sin',
  },
  {
    id: 'policy',
    step: 4,
    title: 'Policy Acknowledgement',
    desc: 'Read and sign off on AEM workplace policies and code of conduct.',
    time: '5 min',
    tags: ['required'],
    href: '/newhire/forms/policy',
  },
  {
    id: 'documents',
    step: 5,
    title: 'Document Uploads',
    desc: 'Upload required tax forms and optional certifications, licences, and ID.',
    time: '10 min',
    tags: ['required'],
    href: '/newhire/forms/documents',
  },
]

// Sidebar row state; text is always present for screen readers, not only colour and icon
const ROW_STATUS_TEXT: Record<FormStatus, string> = {
  pending: 'not started', review: 'sent to HR, in review', approved: 'approved', flagged: 'action required',
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export default function FormsPage() {
  const router = useRouter()

  const [formStatuses, setFormStatuses] = useState<Record<string, FormStatus>>({})
  const [userName, setUserName]         = useState('')
  const [loading, setLoading]           = useState(true)
  // Security clearance is separate: shown only when the manager's plan unlocks it, never counted in progress
  const [clearance, setClearance]       = useState<{ required: boolean; status: FormStatus | null }>({ required: false, status: null })
  // What has been sent to HR, derived on the server from the stored form statuses
  const [submission, setSubmission]     = useState<{ sent: number; total: number; complete: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/newhire/status', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(statusData => {
        setFormStatuses({ ...statusData.formStatuses, documents: statusData.documentsStatus })
        setUserName(statusData.name)
        setSubmission(statusData.submission)
        if (statusData.clearance) setClearance(statusData.clearance)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }

  // A form counts as sent once saved (review, approved or flagged). Clearance is never counted.
  const total     = submission?.total ?? FORMS.length
  const doneCount = submission?.sent ?? 0
  const allDone   = submission?.complete ?? false
  const progress  = (doneCount / total) * 100

  // First form still needing action (pending or flagged), in step order
  const activeId = FORMS
    .filter(f => {
      const s = formStatuses[f.id] ?? 'pending'
      return s === 'pending' || s === 'flagged'
    })
    .sort((a, b) => a.step - b.step)[0]?.id ?? null

  const ringRef = useRef<SVGCircleElement>(null)
  useEffect(() => {
    const circumference = 188
    const offset = circumference - (doneCount / total) * circumference
    if (ringRef.current) {
      ringRef.current.style.strokeDashoffset = String(offset)
    }
  }, [doneCount, total])

  const progressTitle = allDone ? 'All received' : doneCount === 0 ? 'Not started' : 'In progress'
  const progressSub   = allDone
    ? 'HR is reviewing.'
    : `${total - doneCount} required form${total - doneCount !== 1 ? 's' : ''} remaining`

  return (
    <div className="forms-page" data-portal="newhire">

      {/* ── NAV ── */}
      <nav className="forms-nav">
        <div className="forms-nav-left">
          <Image src="/logo.png" alt="AEM" width={120} height={32} className="forms-nav-logo" />
          <div className="forms-nav-divider" />
          <PortalIdentity role="newhire" tone="light" />
        </div>
        <div className="forms-nav-right">
          <button
            className="forms-nav-back"
            onClick={() => router.push('/newhire/welcome')}
          >
            ← Welcome page
          </button>
          <div className="forms-nav-user">
            <div className="forms-nav-avatar">
              {loading ? '…' : getInitials(userName)}
            </div>
            <span className="forms-nav-name">{loading ? '' : userName}</span>
          </div>
          <button
            onClick={handleSignOut}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 11px', borderRadius: '7px',
              border: '1px solid rgba(0,0,0,0.12)',
              background: 'transparent', color: '#888780',
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

      {/* ── HEADER ── */}
      <div className="forms-header">
        <div className="forms-header-orb" />
        <div className="forms-header-inner">
          <div className="forms-header-text">
            <div className="forms-header-tag">
              <div className="forms-header-tag-dot" />
              Onboarding Forms
            </div>
            <h1 className="forms-header-title">Your onboarding checklist.</h1>
            <p className="forms-header-sub">
              Complete all required forms below. Each one goes to HR as soon as you save it.
              Your progress is saved automatically — pick up where you left off any time.
            </p>
          </div>

          <div className="forms-progress-wrap">
            <div className="forms-progress-label">Overall progress</div>
            <div className="forms-progress-ring-wrap">
              <div className="forms-ring">
                <svg viewBox="0 0 72 72">
                  <circle className="forms-ring-bg" cx="36" cy="36" r="30" />
                  <circle ref={ringRef} className="forms-ring-fill" cx="36" cy="36" r="30" />
                </svg>
                <div className="forms-ring-text">
                  <span className="forms-ring-num">{doneCount}</span>
                  <span className="forms-ring-denom">of {total}</span>
                </div>
              </div>
              <div className="forms-progress-info">
                <div className="forms-progress-title">{progressTitle}</div>
                <div className="forms-progress-sub">{progressSub}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="forms-body">

        <div className="forms-list">
          {FORMS.map((form) => {
            const status     = (formStatuses[form.id] ?? 'pending') as FormStatus
            const isApproved = status === 'approved'
            const isFlagged  = status === 'flagged'
            const isReview   = status === 'review'
            const isActive   = !isApproved && !isReview && form.id === activeId

            const statusClass = isApproved ? 'completed'
              : isFlagged ? 'flagged'
              : isReview  ? 'review'
              : isActive  ? 'active'
              : ''

            const stepClass = isApproved ? 'step-done'
              : isFlagged   ? 'step-flagged'
              : isReview    ? 'step-review'
              : isActive    ? 'step-active'
              : 'step-pending'

            return (
              <Link
                key={form.id}
                href={form.href}
                className={`form-card ${statusClass}`}
                style={{ textDecoration: 'none' }}
              >
                <div className={`form-card-step ${stepClass}`}>
                  {isApproved ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : isReview ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  ) : isFlagged ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  ) : form.step}
                </div>

                <div className="form-card-content">
                  <div className="form-card-title">{form.title}</div>
                  <div className="form-card-desc">{form.desc}</div>
                  <div className="form-card-meta">
                    <div className="form-card-time">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      {form.time}
                    </div>
                    {form.tags.includes('required') && <span className="form-card-required">Required</span>}
                    {form.tags.includes('sensitive') && <span className="form-card-sensitive">Encrypted</span>}
                    {isApproved && <span className="form-card-completed-badge">Approved</span>}
                    {isReview   && <span className="form-card-review-badge">Under Review</span>}
                    {isFlagged  && <span className="form-card-flagged-badge">Action Required</span>}
                  </div>
                </div>

                <div className="form-card-arrow">→</div>
              </Link>
            )
          })}

          {clearance.required && (() => {
            const status     = clearance.status ?? 'pending'
            const isApproved = status === 'approved'
            const isFlagged  = status === 'flagged'
            const isReview   = status === 'review'
            const statusClass = isApproved ? 'completed' : isFlagged ? 'flagged' : isReview ? 'review' : ''
            const stepClass   = isApproved ? 'step-done' : isFlagged ? 'step-flagged' : isReview ? 'step-review' : 'step-pending'
            return (
              <Link href="/newhire/forms/clearance" className={`form-card ${statusClass}`} style={{ textDecoration: 'none' }}>
                <div className={`form-card-step ${stepClass}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {isApproved
                      ? <polyline points="20 6 9 17 4 12"/>
                      : <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>}
                  </svg>
                </div>
                <div className="form-card-content">
                  <div className="form-card-title">Security Clearance</div>
                  <div className="form-card-desc">Your legal name, place of birth and the clearance forms your role needs.</div>
                  <div className="form-card-meta">
                    <span className="form-card-unlocked">Unlocked by your manager</span>
                    <span className="form-card-sensitive">Encrypted</span>
                    {isApproved && <span className="form-card-completed-badge">Approved</span>}
                    {isReview   && <span className="form-card-review-badge">Under Review</span>}
                    {isFlagged  && <span className="form-card-flagged-badge">Action Required</span>}
                  </div>
                </div>
                <div className="form-card-arrow">→</div>
              </Link>
            )
          })()}
        </div>

        {/* ── SIDEBAR ── */}
        <div className="forms-sidebar">

          <div className="forms-submit-card">
            <div className="forms-submit-card-header">
              <div className="forms-submit-title">Your progress</div>
              <div className="forms-submit-sub">
                Each form goes to HR as soon as you save it. There is nothing else to submit.
              </div>
            </div>
            <div className="forms-submit-card-body">
              <div className="forms-mini-progress">
                <div className="forms-mini-bar-wrap" role="progressbar" aria-label="Required forms sent to HR"
                  aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}>
                  <div className="forms-mini-bar" style={{ width: `${progress}%` }} />
                </div>
                <div className="forms-mini-label">
                  <span>{loading ? 'Loading…' : `${doneCount} of ${total} sent to HR`}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
              </div>

              <ul className="forms-mini-list">
                {FORMS.map((form) => {
                  const status     = (formStatuses[form.id] ?? 'pending') as FormStatus
                  const isApproved = status === 'approved'
                  const isFlagged  = status === 'flagged'
                  const isReview   = status === 'review'
                  const itemClass  = isApproved ? 'done' : isFlagged ? 'flagged' : isReview ? 'review' : ''
                  return (
                    <li key={form.id} className={`forms-mini-item ${itemClass}`}>
                      <div className="forms-mini-check" aria-hidden="true">
                        {isApproved && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                        {isReview && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <polyline points="12 6 12 12 16 14"/>
                          </svg>
                        )}
                        {isFlagged && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <line x1="12" y1="8" x2="12" y2="13"/>
                          </svg>
                        )}
                      </div>
                      <span className="forms-mini-name">{form.title}</span>
                      <span className="forms-sr-only">: {ROW_STATUS_TEXT[status]}</span>
                    </li>
                  )
                })}

                {/* Security clearance: shown when unlocked; never in the bar, the count or completion */}
                {clearance.required && (() => {
                  const status     = clearance.status ?? 'pending'
                  const isApproved = status === 'approved'
                  const isFlagged  = status === 'flagged'
                  const isReview   = status === 'review'
                  const itemClass  = isApproved ? 'done' : isFlagged ? 'flagged' : isReview ? 'review' : ''
                  return (
                    <li className={`forms-mini-item forms-mini-separate ${itemClass}`}>
                      <div className="forms-mini-check" aria-hidden="true">
                        {isApproved && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                        {isReview && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <polyline points="12 6 12 12 16 14"/>
                          </svg>
                        )}
                        {isFlagged && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <line x1="12" y1="8" x2="12" y2="13"/>
                          </svg>
                        )}
                      </div>
                      <span className="forms-mini-name">Security Clearance</span>
                      <span className="forms-sr-only">: {ROW_STATUS_TEXT[status]}</span>
                      <span className="forms-mini-tag">Tracked separately</span>
                    </li>
                  )
                })()}
              </ul>

              {allDone ? (
                <div className="forms-complete-state" role="status">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <div>
                    <div className="forms-complete-title">All forms received</div>
                    <div className="forms-complete-text">HR is reviewing. If anything needs a fix, the form will be marked here and you can resave it.</div>
                  </div>
                </div>
              ) : !loading && (
                <div className="forms-submit-note">
                  {total - doneCount} required form{total - doneCount !== 1 ? 's' : ''} left. Each is sent to HR when you save it.
                </div>
              )}
            </div>
          </div>

          <div className="forms-help-card">
            <div className="forms-help-title">Need help?</div>
            <div className="forms-help-text">
              If you have questions about any of the forms or need to make a correction, reach out to HR directly.
            </div>
            <a href="mailto:hr@aemltd.com" className="forms-help-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              hr@aemltd.com
            </a>
          </div>

          <div className="forms-security-card">
            <div className="forms-security-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <div className="forms-security-title">Your data is secure</div>
              <div className="forms-security-text">
                Sensitive fields like your SIN and banking details are encrypted with AES-256 before storage. Only HR can access them.
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
