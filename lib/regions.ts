// Project regions. Must match the CHECK constraints on profiles.region and manager_plans.project_region.
export const REGIONS = ['Ontario', 'New Brunswick', 'Nova Scotia'] as const
export type Region = typeof REGIONS[number]
