// "N/5" ring: the banner (gold, with DONE under the number) and station 5 (green). The value is the
// hire's real progress from computeHireStatus; the ring is drawn with a conic gradient.

export default function ProgressRing({ done, total, variant }: { done: number; total: number; variant: 'banner' | 'forms' }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div
      className={`wl-ring wl-ring-${variant}`}
      style={{ '--p': `${pct}%` } as React.CSSProperties}
      role="img"
      aria-label={`${done} of ${total} onboarding items complete`}
    >
      <span className="wl-ring-arc" aria-hidden="true" />
      <span className="wl-ring-value" aria-hidden="true">
        <b>{done}/{total}</b>
        {variant === 'banner' && <span>DONE</span>}
      </span>
    </div>
  )
}
