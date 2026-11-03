// Career Circuit content: the /welcome/careers page and the career sections of the welcome page.
// Everything marked PLACEHOLDER is starting content from the approved design (Nov 3); HR will
// replace it. Plain text only: it is rendered as React text, never as HTML. No server imports.

export type TrackId = 't' | 'c' | 'p' | 'b'
export type StageIndex = 0 | 1 | 2 | 3 | 4
export type StageId = `${TrackId}${StageIndex}`

export type Track = {
  id:    TrackId
  label: string
  short: string
}

export type Stage = {
  id:     StageId
  track:  TrackId
  index:  StageIndex
  title:  string
  blurb:  string
  builds: readonly [string, string, string]   // "What you build here"
  timing: string
}

export type Person = {
  id:      string
  name:    string
  journey: string            // one line
  track:   TrackId           // the track they started on (avatar colour)
  route:   readonly StageId[]
}

// Track order is the map's top-to-bottom order. Colours come from the theme tokens
// (--cc-track-t, --cc-track-c, --cc-track-p, --cc-track-b in styles/globals.css).
export const TRACKS: readonly Track[] = [
  { id: 't', label: 'Technical & Field',      short: 'Field' },
  { id: 'c', label: 'Controls & Engineering', short: 'Controls' },
  { id: 'p', label: 'Project & Delivery',     short: 'Projects' },
  { id: 'b', label: 'Leadership & Business',  short: 'Leadership' },
]

// PLACEHOLDER: timing labels, one per column
const TIMING = ['Day 1 and beyond', 'Years 1 to 3', 'Years 3 to 6', 'Years 6 to 10', 'Years 10 and up'] as const

function stage(track: TrackId, index: StageIndex, title: string, blurb: string, builds: [string, string, string]): Stage {
  return { id: `${track}${index}`, track, index, title, blurb, builds, timing: TIMING[index] }
}

// Five stages per track, left to right
export const STAGES: readonly Stage[] = [
  // PLACEHOLDER: Technical & Field job titles, descriptions and tags
  stage('t', 0, 'Apprentice / Installer',   'Learn the trade on real job sites next to seasoned technicians.', ['Safe work habits', 'Wiring and piping basics', 'Reading drawings']),
  stage('t', 1, 'Service Technician',       'Keep customers’ buildings running: diagnose, repair and tune.',    ['Troubleshooting', 'Customer relationships', 'Controls fundamentals']),
  stage('t', 2, 'Senior Technician',        'The go-to person on site, mentoring newer teammates.',            ['Mentoring', 'Complex systems', 'Quality sign-off']),
  stage('t', 3, 'Inside Technical Support', 'Bring field know-how indoors and support teams across the country.', ['Remote diagnostics', 'Training others', 'Documentation']),
  stage('t', 4, 'Field Supervisor',         'Lead crews, plan the day and keep everyone safe and on schedule.', ['Crew leadership', 'Scheduling', 'Safety leadership']),

  // PLACEHOLDER: Controls & Engineering job titles, descriptions and tags
  stage('c', 0, 'Designer',             'Turn customer needs into control drawings and sequences.', ['CAD and drawings', 'Sequences of operation', 'Reading specs']),
  stage('c', 1, 'Automation Installer', 'Build and commission the systems you learned to design.',  ['Panel build', 'Commissioning', 'Field wiring']),
  stage('c', 2, 'Controls Programmer',  'Write the logic that makes a building smart.',             ['Programming', 'Graphics and trends', 'Testing']),
  stage('c', 3, 'Technical Specialist', 'Go deep. The expert people call when it gets tough.',      ['Integration', 'Cyber hygiene', 'Training']),
  stage('c', 4, 'Engineering Lead',     'Set technical direction and guide the design team.',       ['Standards', 'Design reviews', 'Mentoring']),

  // PLACEHOLDER: Project & Delivery job titles, descriptions and tags
  stage('p', 0, 'Coordinator',            'Keep projects organized: orders, schedules and paperwork.', ['Order tracking', 'Schedules', 'Customer comms']),
  stage('p', 1, 'Estimator',              'Price the work accurately from drawings and scope.',        ['Takeoffs', 'Pricing', 'Spotting risk']),
  stage('p', 2, 'Technical Sales',        'Pair technical knowledge with customer relationships.',     ['Discovery', 'Proposals', 'Negotiation']),
  stage('p', 3, 'Project Manager',        'Own a project from kickoff to handover.',                   ['Budgets', 'Teams', 'Delivery']),
  stage('p', 4, 'Senior Project Manager', 'Run the biggest projects and coach other PMs.',             ['Program oversight', 'Coaching', 'Strategy']),

  // PLACEHOLDER: Leadership & Business job titles, descriptions and tags
  stage('b', 0, 'Team Lead',         'Your first step into leading people.',                      ['Coaching', 'Planning', 'Communication']),
  stage('b', 1, 'Account Manager',   'Own long-term customer relationships.',                     ['Relationships', 'Renewals', 'Growth']),
  stage('b', 2, 'Operations Lead',   'Keep a department running smoothly.',                       ['Operations', 'Hiring', 'Budgets']),
  stage('b', 3, 'Branch Manager',    'Run a branch: people, customers and results.',              ['Results', 'Culture', 'Community']),
  stage('b', 4, 'President / Owner', 'Some people go on to own a company or lead the business.',  ['Vision', 'Ownership', 'Legacy']),
]

// PLACEHOLDER: people, their one-line journeys and their routes (HR will send the real ones)
export const PEOPLE: readonly Person[] = [
  { id: 'wayne',    name: 'Wayne Scott',   track: 't', journey: 'Service Tech to Inside Technical Support',                                         route: ['t0', 't1', 't3'] },
  { id: 'scott',    name: 'Scott LeBlanc', track: 'c', journey: 'Design to Automation to Technical Sales to Branch Manager',                         route: ['c0', 'c1', 'p2', 'b3'] },
  { id: 'brent',    name: 'Brent',         track: 'c', journey: 'Design to Estimating to Project Manager',                                         route: ['c0', 'p1', 'p3'] },
  { id: 'nathalie', name: 'Nathalie',      track: 'p', journey: 'Designer to Estimating to Leadership',                                            route: ['c0', 'p1', 'b2'] },
  { id: 'greg',     name: 'Greg Dunsing',  track: 't', journey: 'Electrician to Account Management to Project Management to Leadership',           route: ['t0', 'b1', 'p3', 'p4'] },
  { id: 'blaine',   name: 'Blaine',        track: 'c', journey: 'Automation to Technical Sales to Branch Manager to Owner',                        route: ['c1', 'p2', 'b3', 'b4'] },
  { id: 'jason',    name: 'Jason Fowler',  track: 'c', journey: 'Designer to Programmer to Technical Specialist',                                  route: ['c0', 'c2', 'c3'] },
]

// PLACEHOLDER: the dotted cross-track links (where people switch tracks most)
export const CROSS_LINKS: readonly (readonly [StageId, StageId])[] = [
  ['t1', 'c2'],
  ['c1', 'p2'],
  ['p2', 'b3'],
  ['t3', 'p4'],
]

// PLACEHOLDER: "Your foundation" under the Day one marker
export const FOUNDATION: readonly string[] = ['Onboarding', 'Training', 'Real-world experience', 'Supportive teams']

export type ValueItem = { id: 'valued' | 'respected' | 'empowered'; number: string; title: string; text: string }

// PLACEHOLDER: the three values and their one-line text
export const VALUES: readonly ValueItem[] = [
  { id: 'valued',    number: '01', title: 'Valued',    text: 'Your work is seen, your ideas count, and your wins get noticed.' },
  { id: 'respected', number: '02', title: 'Respected', text: 'We listen first, trust each other, and treat every teammate well.' },
  { id: 'empowered', number: '03', title: 'Empowered', text: 'You get the training, tools and room to grow into what is next.' },
]

// ring: how much of the decorative ring is filled (decoration only, not data)
export type StatItem = { value: string; label: string; ring: number }

// PLACEHOLDER: the four stats
export const STATS: readonly StatItem[] = [
  { value: '9+',  label: 'years average tenure',  ring: 78 },
  { value: '8+',  label: 'fun events every year', ring: 62 },
  { value: '5+',  label: 'charity initiatives',   ring: 45 },
  { value: '19+', label: 'benefits for you',      ring: 92 },
]

// ── Lookups ──
export const TRACK_BY_ID: Record<TrackId, Track> = Object.fromEntries(TRACKS.map(t => [t.id, t])) as Record<TrackId, Track>
export const STAGE_BY_ID: Record<StageId, Stage> = Object.fromEntries(STAGES.map(s => [s.id, s])) as Record<StageId, Stage>

export function nextStage(s: Stage): Stage | null {
  return s.index < 4 ? STAGE_BY_ID[`${s.track}${(s.index + 1) as StageIndex}`] : null
}

export function peopleThrough(stageId: StageId): Person[] {
  return PEOPLE.filter(p => p.route.includes(stageId))
}

export function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
