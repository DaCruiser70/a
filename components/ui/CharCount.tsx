// A small "characters left" line under a long text box. Plain text, never colour alone: the words
// change when the limit is near. Point the box at it with aria-describedby={id}.
export default function CharCount({ id, value, max }: { id: string; value: string; max: number }) {
  const left = max - value.length
  return (
    <div id={id} style={{ fontSize: '11.5px', color: left <= 50 ? '#8E2E24' : '#6B6A66', textAlign: 'right', marginTop: '4px' }}>
      {left >= 0 ? `${left} characters left` : `${-left} characters over the limit`}
    </div>
  )
}
