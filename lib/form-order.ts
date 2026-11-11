// The order of the five onboarding items, in ONE place. Everything that shows or walks the items in
// order uses this list: the checklist cards and sidebar, the welcome page steps, the "Step N of 5"
// tags, the "next item to do" logic, reminders, flag sections and HR's form list. No server imports.
//
// Order only ever changes what is SHOWN first. Completion never depends on it: a hire is complete
// when all five items are sent, whichever is finished last (lib/submission.ts). Documents is one item.

export const ONBOARDING_ITEMS = ['personal', 'banking', 'sin', 'documents', 'policy'] as const
export type OnboardingItem = typeof ONBOARDING_ITEMS[number]

export const ONBOARDING_ITEM_COUNT = ONBOARDING_ITEMS.length   // 5

export const ONBOARDING_ITEM_TITLES: Record<OnboardingItem, string> = {
  personal:  'Personal Information',
  banking:   'Banking & Direct Deposit',
  sin:       'Social Insurance Number',
  documents: 'Documents',
  policy:    'Policy Acknowledgement',
}

// Short labels (the welcome page's steps)
export const ONBOARDING_ITEM_SHORT: Record<OnboardingItem, string> = {
  personal:  'Personal Info',
  banking:   'Banking',
  sin:       'SIN',
  documents: 'Documents',
  policy:    'Policies',
}

export function isOnboardingItem(value: unknown): value is OnboardingItem {
  return typeof value === 'string' && (ONBOARDING_ITEMS as readonly string[]).includes(value)
}

// 1-based position: personal 1 … policy 5
export function stepOf(item: OnboardingItem): number {
  return ONBOARDING_ITEMS.indexOf(item) + 1
}

// "Step 4 of 5"
export function stepLabel(item: OnboardingItem): string {
  return `Step ${stepOf(item)} of ${ONBOARDING_ITEM_COUNT}`
}

// Any list of item keys, sorted into onboarding order; keys that are not items (e.g. clearance) keep
// their relative order after them
export function inOnboardingOrder<T extends string>(keys: readonly T[]): T[] {
  const rank = (k: string) => {
    const i = (ONBOARDING_ITEMS as readonly string[]).indexOf(k)
    return i === -1 ? ONBOARDING_ITEMS.length : i
  }
  return keys.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map(x => x.k)
}
