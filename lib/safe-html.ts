import { createElement, Fragment, type ReactNode } from 'react'

// Audit and activity messages are stored as text with <strong>…</strong> markers.
// Every user-supplied value interpolated into a message goes through esc(), so the only
// tags that can appear are the ones the server wrote. SafeMessage renders them without
// dangerouslySetInnerHTML: <strong> becomes an element, everything else is plain text.

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}
const UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPES).map(([char, entity]) => [entity, char])
)

export function esc(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch])
}

// Reverses esc() only — the result is rendered as a React text node, never as HTML
function unesc(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => UNESCAPES[entity])
}

export function SafeMessage({ message }: { message: string }) {
  const nodes: ReactNode[] = []
  let bold = false

  message.split(/(<\/?strong>)/).forEach((part, i) => {
    if (part === '<strong>')  { bold = true;  return }
    if (part === '</strong>') { bold = false; return }
    // Older rows wrapped reasons in <em>; drop the tags rather than show them
    const text = unesc(part.replace(/<\/?em>/g, ''))
    if (!text) return
    nodes.push(bold ? createElement('strong', { key: i }, text) : text)
  })

  return createElement(Fragment, null, ...nodes)
}
