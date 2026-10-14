'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import '../../../../styles/pages/form-pages.css'
import '../../../../styles/components/portal-theme.css'
import '../../../../styles/pages/manager.css'
import PortalHeader from '@/components/ui/PortalHeader'
import { PlanStatusBadge, OverdueBadge, formatPlanDate } from '@/components/ui/PlanBadges'
import { REGIONS } from '@/lib/regions'
import { BRANCHES } from '@/lib/branches'
import {
  EMPTY_PLAN, MAX_PLAN_TEXT, PlanDraftSchema, PlanSubmitSchema, fieldErrors,
  CLEARANCE_TYPES, CLEARANCE_LABELS, TRAINING_DELIVERY, TRAINING_DELIVERY_LABELS,
  type PlanAnswers, type TrainingDelivery,
} from '@/lib/manager-plan'
import type { ManagerPlanStatus } from '@/types'

type Hire = { id: string; name: string; position: string | null; start_date: string | null; office_location: string | null }
type PlanMeta = { status: ManagerPlanStatus; due_date: string | null; submitted_at: string | null; overdue: boolean }
type Errors = Partial<Record<keyof PlanAnswers, string>>
type TextKey = Exclude<keyof PlanAnswers, 'training_delivery' | 'clearance_type'>

const FIELD_LABELS: Partial<Record<keyof PlanAnswers, string>> = {
  training_needed:   'Training needed',
  training_delivery: 'How they will get it',
  week1: 'Week 1', week2: 'Week 2', week3: 'Week 3',
  project_number: 'Project number', project_name: 'Project name', project_region: 'Project region',
  project_location: 'Location', project_branch: 'Branch',
}

function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <span id={id} className="plan-field-error">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {message}
    </span>
  )
}

function TextAreaField({
  field, label, hint, required, value, error, onChange, rows = 4, placeholder,
}: {
  field: TextKey; label: string; hint?: string; required?: boolean; value: string; error?: string
  onChange: (v: string) => void; rows?: number; placeholder?: string
}) {
  const id = `plan-${field}`
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="form-field span-2">
      <label className="form-label" htmlFor={id}>
        {label} {required && <span className="form-label-required" aria-hidden="true">*</span>}
      </label>
      <textarea
        id={id}
        className={`plan-textarea${error ? ' invalid' : ''}`}
        rows={rows}
        maxLength={MAX_PLAN_TEXT}
        value={value}
        placeholder={placeholder}
        aria-required={required || undefined}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        onChange={e => onChange(e.target.value)}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        {hint ? <span id={`${id}-hint`} className="form-input-hint">{hint}</span> : <span />}
        <span className={`plan-counter${value.length > MAX_PLAN_TEXT - 200 ? ' near' : ''}`} aria-hidden="true">
          {value.length}/{MAX_PLAN_TEXT}
        </span>
      </div>
      <ErrorText id={`${id}-error`} message={error} />
    </div>
  )
}

function SectionCard({ icon, tone, title, sub, children, footer }: {
  icon: React.ReactNode; tone: 'navy' | 'amber' | 'green'; title: string; sub: string
  children: React.ReactNode; footer?: React.ReactNode
}) {
  return (
    <section className="form-section-card" aria-label={title}>
      <div className="form-section-header">
        <div className={`form-section-icon ${tone}`} aria-hidden="true">{icon}</div>
        <div>
          <h2 className="form-section-heading" style={{ margin: 0 }}>{title}</h2>
          <div className="form-section-heading-sub">{sub}</div>
        </div>
      </div>
      <div className="form-section-body">{children}</div>
      {footer}
    </section>
  )
}

export default function ManagerPlanPage() {
  const params = useParams()
  const hireId = params?.id as string

  const [load, setLoad]       = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [hire, setHire]       = useState<Hire | null>(null)
  const [meta, setMeta]       = useState<PlanMeta | null>(null)
  const [answers, setAnswers] = useState<PlanAnswers>(EMPTY_PLAN)
  const [errors, setErrors]   = useState<Errors>({})
  const [saving, setSaving]   = useState<'draft' | 'submit' | null>(null)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice]   = useState('')
  const summaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/manager/hires/${hireId}/plan`, { cache: 'no-store' })
      .then(async r => {
        if (cancelled) return
        if (r.status === 404) { setLoad('notfound'); return }
        if (!r.ok) { setLoad('error'); return }
        const data = await r.json()
        setHire(data.hire)
        setMeta({ status: data.plan.status, due_date: data.plan.due_date, submitted_at: data.plan.submitted_at, overdue: data.plan.overdue })
        setAnswers(data.plan.answers)
        setLoad('ready')
      })
      .catch(() => { if (!cancelled) setLoad('error') })
    return () => { cancelled = true }
  }, [hireId, attempt])

  function set<K extends keyof PlanAnswers>(field: K, value: PlanAnswers[K]) {
    setAnswers(a => ({ ...a, [field]: value }))
    setNotice('')
    if (errors[field]) setErrors(e => { const next = { ...e }; delete next[field]; return next })
  }

  function toggleDelivery(option: TrainingDelivery) {
    const has = answers.training_delivery.includes(option)
    set('training_delivery', has
      ? answers.training_delivery.filter(d => d !== option)
      : TRAINING_DELIVERY.filter(d => d === option || answers.training_delivery.includes(d)))
  }

  async function save(action: 'draft' | 'submit') {
    setSaveError('')
    setNotice('')
    const check = (action === 'submit' ? PlanSubmitSchema : PlanDraftSchema).safeParse(answers)
    if (!check.success) {
      setErrors(fieldErrors(check.error))
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    setErrors({})
    setSaving(action)
    try {
      const res = await fetch(`/api/manager/hires/${hireId}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, plan: check.data }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 404) { setLoad('notfound'); return }
      if (!res.ok) {
        if (data.fields) {
          setErrors(data.fields)
          requestAnimationFrame(() => summaryRef.current?.focus())
        }
        setSaveError(data.error ?? 'Could not save the plan. Please try again.')
        return
      }
      const wasSubmitted = meta?.status === 'submitted'
      setMeta(m => m ? { ...m, status: data.status, submitted_at: data.submitted_at ?? m.submitted_at, overdue: data.status === 'submitted' ? false : m.overdue } : m)
      setNotice(action === 'draft' ? 'Draft saved. You can come back and finish it any time.'
        : wasSubmitted ? 'Changes saved. HR will see the updated plan.'
        : 'Plan submitted. HR has been notified. You can still update it.')
    } catch {
      setSaveError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(null)
    }
  }

  const errorList = (Object.keys(errors) as (keyof PlanAnswers)[]).filter(k => errors[k])
  const submitted = meta?.status === 'submitted'

  return (
    <div className="form-page" data-portal="manager">
      <PortalHeader portal="manager" />

      <header className="form-page-header">
        <div className="form-page-header-orb" />
        <div className="form-page-header-inner">
          <Link href="/manager/dashboard" className="form-page-back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to my new hires
          </Link>
          <div className="form-page-step-tag">Onboarding plan</div>
          <h1 className="form-page-title">
            {load === 'ready' && hire ? `Plan for ${hire.name}` : 'Onboarding plan'}
          </h1>
          <p className="form-page-sub">
            {load === 'ready' && hire
              ? [hire.position, hire.start_date && `Starts ${formatPlanDate(hire.start_date)}`, hire.office_location].filter(Boolean).join(' · ')
              : 'Tell HR how this person will be trained and supported in their first three weeks.'}
          </p>
          {load === 'ready' && meta && (
            <div className="plan-header-badges">
              <PlanStatusBadge status={meta.status} submittedAt={meta.submitted_at} onDark />
              {meta.overdue && <OverdueBadge />}
              {meta.due_date && !submitted && (
                <span className="plan-badge on-dark requested">Due {formatPlanDate(meta.due_date)}</span>
              )}
            </div>
          )}
        </div>
      </header>

      {load === 'loading' && (
        <div className="form-page-body" aria-busy="true" aria-label="Loading plan">
          <div className="mgr-skeleton block" /><div className="mgr-skeleton block" /><div className="mgr-skeleton block" />
        </div>
      )}

      {load === 'notfound' && (
        <div className="form-page-body">
          <div className="mgr-empty">
            <div className="mgr-empty-icon" aria-hidden="true">🔍</div>
            <div className="mgr-empty-title">We couldn&apos;t find that plan</div>
            <div className="mgr-empty-text">It may have been moved to another manager. Your current plans are on your dashboard.</div>
            <div style={{ marginTop: '16px' }}>
              <Link href="/manager/dashboard" className="form-btn-secondary">← Back to my new hires</Link>
            </div>
          </div>
        </div>
      )}

      {load === 'error' && (
        <div className="form-page-body">
          <div className="mgr-error" role="alert">
            The plan could not be loaded. Check your connection and try again.
            <button type="button" onClick={() => { setLoad('loading'); setAttempt(a => a + 1) }}>Try again</button>
          </div>
        </div>
      )}

      {load === 'ready' && (
        <form className="form-page-body" noValidate onSubmit={e => { e.preventDefault(); save('submit') }}>

          {errorList.length > 0 && (
            <div className="plan-summary" role="alert" tabIndex={-1} ref={summaryRef}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div>
                <strong>{errorList.length === 1 ? 'One answer needs attention' : `${errorList.length} answers need attention`}</strong>
                <ul>
                  {errorList.map(k => (
                    <li key={k}><a href={`#plan-${k === 'training_delivery' ? 'training_delivery-on_the_job' : k === 'clearance_type' ? 'clearance_type-none' : k}`}>{FIELD_LABELS[k] ?? k}: {errors[k]}</a></li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {notice && (
            <div className="plan-saved" role="status">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              {notice}
            </div>
          )}

          {/* ── TRAINING ── */}
          <SectionCard
            tone="amber" title="Training" sub="What they need to learn and how they will learn it"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>}
          >
            <TextAreaField
              field="training_needed" label="What training does this person need?" required
              value={answers.training_needed} error={errors.training_needed}
              onChange={v => set('training_needed', v)}
              placeholder="e.g. Site safety orientation, Jonas time entry, equipment certification"
            />

            <fieldset className="plan-fieldset span-2" aria-describedby={errors.training_delivery ? 'plan-training_delivery-error' : undefined}>
              <legend className="form-label">How will they get it? <span className="form-label-required" aria-hidden="true">*</span></legend>
              <div className="plan-options">
                {TRAINING_DELIVERY.map(option => (
                  <label key={option} className={`plan-option${errors.training_delivery ? ' invalid' : ''}`}>
                    <input
                      id={`plan-training_delivery-${option}`}
                      type="checkbox"
                      checked={answers.training_delivery.includes(option)}
                      onChange={() => toggleDelivery(option)}
                    />
                    <span>
                      <span className="plan-mark box" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </span>
                      {TRAINING_DELIVERY_LABELS[option]}
                    </span>
                  </label>
                ))}
              </div>
              <ErrorText id="plan-training_delivery-error" message={errors.training_delivery} />
            </fieldset>

            <TextAreaField
              field="training_notes" label="Training notes" rows={3}
              hint="Optional: course names, who delivers it, timing"
              value={answers.training_notes} error={errors.training_notes}
              onChange={v => set('training_notes', v)}
            />
          </SectionCard>

          {/* ── FIRST THREE WEEKS ── */}
          <SectionCard
            tone="navy" title="First three weeks" sub="What they will be doing each week"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
          >
            {(['week1', 'week2', 'week3'] as const).map((w, i) => (
              <TextAreaField
                key={w} field={w} label={`Week ${i + 1}`} required rows={3}
                value={answers[w]} error={errors[w]} onChange={v => set(w, v)}
              />
            ))}
          </SectionCard>

          {/* ── DAY ONE ── */}
          <SectionCard
            tone="green" title="Day one" sub="Help them feel welcome from the first morning"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
          >
            <TextAreaField
              field="day_one_contact" label="Who will meet them and show them around?" rows={2}
              value={answers.day_one_contact} error={errors.day_one_contact}
              onChange={v => set('day_one_contact', v)}
            />
            <TextAreaField
              field="first_day_gear" label="Any gear they need on day one (PPE, tools, vehicle)?" rows={2}
              value={answers.first_day_gear} error={errors.first_day_gear}
              onChange={v => set('first_day_gear', v)}
            />
          </SectionCard>

          {/* ── CLEARANCE ── */}
          <SectionCard
            tone="navy" title="Security clearance" sub="Whether this role needs a clearance before they can start on site"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>}
          >
            <fieldset className="plan-fieldset span-2">
              <legend className="form-label">Clearance needed</legend>
              <div className="plan-options">
                {CLEARANCE_TYPES.map(type => (
                  <label key={type} className="plan-option">
                    <input
                      id={`plan-clearance_type-${type}`}
                      type="radio"
                      name="clearance_type"
                      value={type}
                      checked={answers.clearance_type === type}
                      onChange={() => set('clearance_type', type)}
                    />
                    <span>
                      <span className="plan-mark round" aria-hidden="true"><span className="dot" /></span>
                      {CLEARANCE_LABELS[type]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {answers.clearance_type === 'pspc_rcmp' && (
              <div className="plan-reveal">
                <div className="plan-reveal-title">Project details for the PSPC &amp; RCMP clearance</div>
                {(['project_number', 'project_name'] as const).map(f => (
                  <div key={f} className="form-field">
                    <label className="form-label" htmlFor={`plan-${f}`}>
                      {FIELD_LABELS[f]} <span className="form-label-required" aria-hidden="true">*</span>
                    </label>
                    <input
                      id={`plan-${f}`} className={`form-input${errors[f] ? ' invalid' : ''}`}
                      value={answers[f]} maxLength={MAX_PLAN_TEXT}
                      aria-required="true" aria-invalid={!!errors[f] || undefined}
                      aria-describedby={errors[f] ? `plan-${f}-error` : undefined}
                      onChange={e => set(f, e.target.value)}
                    />
                    <ErrorText id={`plan-${f}-error`} message={errors[f]} />
                  </div>
                ))}

                <div className="form-field">
                  <label className="form-label" htmlFor="plan-project_region">
                    Project region <span className="form-label-required" aria-hidden="true">*</span>
                  </label>
                  <select
                    id="plan-project_region" className={`form-input${errors.project_region ? ' invalid' : ''}`}
                    value={answers.project_region}
                    aria-required="true" aria-invalid={!!errors.project_region || undefined}
                    aria-describedby={errors.project_region ? 'plan-project_region-error' : undefined}
                    onChange={e => set('project_region', e.target.value)}
                  >
                    <option value="">Select a region</option>
                    {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <ErrorText id="plan-project_region-error" message={errors.project_region} />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="plan-project_branch">
                    Branch <span className="form-label-required" aria-hidden="true">*</span>
                  </label>
                  <select
                    id="plan-project_branch" className={`form-input${errors.project_branch ? ' invalid' : ''}`}
                    value={answers.project_branch}
                    aria-required="true" aria-invalid={!!errors.project_branch || undefined}
                    aria-describedby={errors.project_branch ? 'plan-project_branch-error' : undefined}
                    onChange={e => set('project_branch', e.target.value)}
                  >
                    <option value="">Select a branch</option>
                    {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <ErrorText id="plan-project_branch-error" message={errors.project_branch} />
                </div>

                <div className="form-field span-2">
                  <label className="form-label" htmlFor="plan-project_location">
                    Location <span className="form-label-required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="plan-project_location" className={`form-input${errors.project_location ? ' invalid' : ''}`}
                    value={answers.project_location} maxLength={MAX_PLAN_TEXT}
                    placeholder="Site or building"
                    aria-required="true" aria-invalid={!!errors.project_location || undefined}
                    aria-describedby={errors.project_location ? 'plan-project_location-error' : undefined}
                    onChange={e => set('project_location', e.target.value)}
                  />
                  <ErrorText id="plan-project_location-error" message={errors.project_location} />
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── ANYTHING ELSE ── */}
          <SectionCard
            tone="amber" title="Anything else" sub="Optional"
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
            footer={
              <div className="form-actions">
                <div className="form-save-note">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                  </svg>
                  {submitted ? 'Submitted plans can still be updated' : 'Drafts can be left incomplete'}
                </div>
                <div className="form-action-btns">
                  {saveError && <div className="login-error" role="alert" style={{ margin: 0 }}>{saveError}</div>}
                  {!submitted && (
                    <button type="button" className="form-btn-secondary" disabled={!!saving} onClick={() => save('draft')}>
                      {saving === 'draft' ? 'Saving…' : 'Save draft'}
                    </button>
                  )}
                  <button type="submit" className="form-btn-primary" disabled={!!saving}>
                    {saving === 'submit' ? 'Saving…' : submitted ? 'Save changes' : 'Submit plan →'}
                  </button>
                </div>
              </div>
            }
          >
            <TextAreaField
              field="anything_else" label="Anything else HR should know?" rows={3}
              value={answers.anything_else} error={errors.anything_else}
              onChange={v => set('anything_else', v)}
            />
          </SectionCard>
        </form>
      )}
    </div>
  )
}
