export function timeAgo(timestamp: string | null, nullText = 'Not yet submitted'): string {
  if (!timestamp) return nullText

  const diffMs   = Date.now() - new Date(timestamp).getTime()
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1)  return 'just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays <= 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`

  return new Date(timestamp).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}
