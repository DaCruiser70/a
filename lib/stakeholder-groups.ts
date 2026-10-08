export type StakeholderAssignee = {
  task_id: string
  name: string
  status: 'pending' | 'confirmed'
  confirmed_at: string | null
  has_note: boolean
}

export type GroupedStakeholderItem = {
  task_key: string
  task_name: string
  assignees: StakeholderAssignee[]
  confirmedCount: number
  totalCount: number
  isComplete: boolean
  latestConfirmedAt: string | null
}

export function groupStakeholderTasks(
  tasks: Array<{
    id: string
    task_key: string
    task_name: string
    status: string
    confirmed_at: string | null
    has_note: boolean
    stakeholder_name: string | null
  }>
): GroupedStakeholderItem[] {
  const map = new Map<string, GroupedStakeholderItem>()

  for (const t of tasks) {
    if (!map.has(t.task_key)) {
      map.set(t.task_key, {
        task_key:          t.task_key,
        task_name:         t.task_name,
        assignees:         [],
        confirmedCount:    0,
        totalCount:        0,
        isComplete:        false,
        latestConfirmedAt: null,
      })
    }
    const group = map.get(t.task_key)!
    group.assignees.push({
      task_id:      t.id,
      name:         t.stakeholder_name ?? '—',
      status:       t.status as 'pending' | 'confirmed',
      confirmed_at: t.confirmed_at,
      has_note:     t.has_note,
    })
    group.totalCount++
    if (t.status === 'confirmed') {
      group.confirmedCount++
      if (t.confirmed_at && (!group.latestConfirmedAt || t.confirmed_at > group.latestConfirmedAt)) {
        group.latestConfirmedAt = t.confirmed_at
      }
    }
  }

  for (const group of map.values()) {
    group.isComplete = group.totalCount > 0 && group.confirmedCount === group.totalCount
  }

  return [...map.values()]
}
