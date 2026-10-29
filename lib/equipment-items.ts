// Equipment the HR hire page provisions. Moved unchanged from app/hr/newhire/[id]/page.tsx so the
// overview endpoint counts progress with the same list and rule. No server imports.

export const EQUIPMENT_LIST = [
  { category: 'Office & Tech', items: [
    { id:'laptop',   label:'Laptop / Computer',    note:'Check with IT' },
    { id:'phone',    label:'Mobile Phone',          note:'Company plan' },
    { id:'software', label:'Software Licenses',     note:'Role-dependent' },
  ]},
  { category: 'Access & Security', items: [
    { id:'access',   label:'Access Card / Key Fob', note:'Facilities' },
  ]},
  { category: 'Field & Vehicle', items: [
    { id:'vehicle',  label:'Company Vehicle',         note:'If role requires' },
  ]},
  { category: 'Safety', items: [
    { id:'training', label:'Safety Training',         note:'Mandatory first week' },
  ]},
  { category: 'Software — Jonas', items: [
    { id:'jonas_regular', label:'Jonas Access — Regular', note:'Marley Element' },
    { id:'jonas_emobile', label:'Jonas Access — e-Mobile', note:'Marley Element' },
  ]},
  { category: 'HR & Admin', items: [
    { id:'benefits',  label:'Benefits Setup',   note:'HR to complete' },
    { id:'timesheet', label:'Timesheet Access', note:'HR to complete' },
  ]},
]

export const ALL_EQUIPMENT_ITEMS = EQUIPMENT_LIST.flatMap(c => c.items)

// Same rule as the page's progress bar: an item with stakeholder tasks is done when every task is
// confirmed; an HR-only item (no tasks) is done when HR has ticked it. Company Vehicle with a vehicle
// request (Rob → Heather → Marley) is done only when the request is complete: the next person's task
// does not exist until their turn, so "all tasks confirmed" would be true too early.
export function equipmentProgress(
  checked: Record<string, boolean>,
  tasks: { task_key: string; status: string }[],
  vehicleStep?: string | null,
): { done: number; total: number; awaiting: number } {
  const byKey: Record<string, { status: string }[]> = {}
  for (const t of tasks) (byKey[t.task_key] ??= []).push(t)
  let done = 0
  let awaiting = 0
  for (const item of ALL_EQUIPMENT_ITEMS) {
    if (item.id === 'vehicle' && vehicleStep) {
      if (vehicleStep === 'complete') done++
      else awaiting++
      continue
    }
    const itemTasks = byKey[item.id] ?? []
    if (itemTasks.length > 0) {
      if (itemTasks.every(t => t.status === 'confirmed')) done++
      else awaiting++
    } else if (checked[item.id]) done++
  }
  return { done, total: ALL_EQUIPMENT_ITEMS.length, awaiting }
}
