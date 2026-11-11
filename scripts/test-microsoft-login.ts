// Microsoft sign-in: the decision rules and the callback flow, without a real Microsoft login and
// without touching the database. Everything runs against in-memory data.
//
// Usage (from the project root):
//   npx tsx scripts/test-microsoft-login.ts
//
// Prints pass/fail lines and a count only. Exit code 1 on any failure.

import {
  decideMicrosoftSignIn, resolvePmMember, pickPmAccount, staffPasswordLoginOn, passwordSignInAllowed,
  safeRedirectPath, microsoftAuditMessage, emailDomainAllowed, normalizeEmail, sameOwner,
  REFUSAL_REASONS, STAFF_OVER_MEMBER, BREAK_GLASS_AUDIT_MESSAGE, PASSWORD_OFF_AUDIT_MESSAGE, MICROSOFT_REFUSED_MESSAGE,
  type AccountCandidate, type MemberCandidate, type MicrosoftBinding, type MicrosoftClaims, type MicrosoftDecision,
  type RefusalReason,
} from '../lib/microsoft-auth'
import { completeMicrosoftSignIn, type MicrosoftEvent, type MicrosoftFlowDeps } from '../lib/microsoft-flow'
import { newhireSessionAllowed, sessionFromPassword } from '../lib/session-rules'

let passed = 0
let failed = 0
function check(name: string, ok: boolean) {
  if (ok) passed++; else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

const ISS = 'https://login.microsoftonline.com/tenant-a/v2.0'
const claims = (over: Partial<MicrosoftClaims> = {}): MicrosoftClaims =>
  ({ email: 'pat.hr@aemltd.com', subject: 'sub-pat', issuer: ISS, emailVerified: true, ...over })
const hr: AccountCandidate = { id: 'u-hr', roles: ['hr'], active: true }
const decide = (c: MicrosoftClaims, candidates: AccountCandidate[], members: MemberCandidate[] = [], bindings: MicrosoftBinding[] = []) =>
  decideMicrosoftSignIn({ claims: c, candidates, members, bindings })
const reason = (d: MicrosoftDecision) => (d.allow ? 'allow' : d.reason)
const asAccount = (d: MicrosoftDecision) => (d.allow && d.kind === 'account' ? d : null)
const asMember  = (d: MicrosoftDecision) => (d.allow && d.kind === 'member' ? d : null)

// ── 1. Decision rules: staff accounts ──
function testDecisions() {
  check('wrong domain refused', reason(decide(claims({ email: 'pat@gmail.com' }), [hr])) === 'domain')
  check('look-alike domain refused', reason(decide(claims({ email: 'pat@aemltd.com.evil.io' }), [hr])) === 'domain')
  check('subdomain refused', reason(decide(claims({ email: 'pat@x.aemltd.com' }), [hr])) === 'domain')
  check('second allowed domain accepted', emailDomainAllowed('pat@advancedenergymanagement.com'))
  check('email compared trimmed and case-insensitive', normalizeEmail('  Pat.HR@AEMLTD.com ') === 'pat.hr@aemltd.com'
    && reason(decide(claims({ email: ' PAT.HR@AemLtd.Com ' }), [hr])) === 'allow')
  check('unknown email refused', reason(decide(claims(), [])) === 'no_account')
  check('inactive account refused', reason(decide(claims(), [{ ...hr, active: false }])) === 'inactive')
  check('new hire refused', reason(decide(claims(), [{ id: 'u-nh', roles: ['newhire'], active: true }])) === 'newhire')
  check('new hire with another role still refused', reason(decide(claims(), [{ id: 'u-x', roles: ['manager', 'newhire'], active: true }])) === 'newhire')
  check('two matching accounts refused', reason(decide(claims(), [hr, { id: 'u-hr2', roles: ['hr'], active: true }])) === 'ambiguous')
  check('account with no known role refused', reason(decide(claims(), [{ id: 'u-z', roles: ['admin'], active: true }])) === 'wrong_role')
  check('signing in to a shared project-management account directly refused', reason(decide(claims(), [{ id: 'u-pm', roles: ['project_mgmt'], active: true }])) === 'pm_shared')
  check('unverified email refused', reason(decide(claims({ emailVerified: false }), [hr])) === 'unverified')
  check('missing subject refused', reason(decide(claims({ subject: null }), [hr])) === 'bad_claims')
  check('missing email refused', reason(decide(claims({ email: null }), [hr])) === 'bad_claims')

  const first = asAccount(decide(claims(), [hr]))
  check('correct account allowed', first?.userId === 'u-hr')
  check('id bound on first sign-in', first?.bindNow === true)
  for (const role of ['hr', 'stakeholder', 'payroll', 'manager', 'clearance'] as const) {
    check(`${role} account allowed as itself`, asAccount(decide(claims(), [{ id: `u-${role}`, roles: [role], active: true }]))?.userId === `u-${role}`)
  }
  const bound: MicrosoftBinding = { owner: { kind: 'profile', id: 'u-hr' }, subject: 'sub-pat', issuer: ISS }
  const again = asAccount(decide(claims(), [hr], [], [bound]))
  check('same id on a later sign-in allowed without rebinding', again !== null && !again.bindNow)
  check('different subject refused (id_mismatch)', reason(decide(claims({ subject: 'sub-other' }), [hr], [], [bound])) === 'id_mismatch')
  check('different tenant refused (id_mismatch)', reason(decide(claims({ issuer: 'https://login.microsoftonline.com/tenant-b/v2.0' }), [hr], [], [bound])) === 'id_mismatch')
  check('a Microsoft id already bound to another account refused',
    reason(decide(claims(), [hr], [], [{ owner: { kind: 'profile', id: 'u-other' }, subject: 'sub-pat', issuer: ISS }])) === 'id_mismatch')
  check('decision never returns a role', first !== null && !('role' in first) && !('roles' in first))
}

// ── 2. Decision rules: project-management members ──
const teams: (MemberCandidate & { member_email: string })[] = [
  { id: 'm-on',  region: 'Ontario',       member_email: 'olivia@aemltd.com', active: true },
  { id: 'm-ns',  region: 'Nova Scotia',   member_email: 'nora@aemltd.com',   active: true },
  { id: 'm-nb1', region: 'New Brunswick', member_email: 'nick@aemltd.com',   active: true },
  { id: 'm-nb2', region: 'New Brunswick', member_email: 'nadia@aemltd.com',  active: true },
  { id: 'm-nb3', region: 'New Brunswick', member_email: 'noel@aemltd.com',   active: true },
  { id: 'm-old-on', region: 'Ontario',    member_email: 'nick@aemltd.com',   active: false },   // nick's old Ontario row
  { id: 'm-old-ns', region: 'Nova Scotia', member_email: 'nick@aemltd.com',  active: false },   // and an old Nova Scotia one
  { id: 'm-two-a', region: 'Ontario',     member_email: 'sam@aemltd.com',    active: true },
  { id: 'm-two-b', region: 'Nova Scotia', member_email: 'sam@aemltd.com',    active: true },
  { id: 'm-gone', region: 'Ontario',      member_email: 'gone@aemltd.com',   active: false },
]
const rowsFor = (email: string) => teams.filter(t => t.member_email === normalizeEmail(email))

function testMembers() {
  const memberDecision = (email: string) => decide(claims({ email, subject: `sub-${email}` }), [], rowsFor(email))
  const on = asMember(memberDecision('olivia@aemltd.com'))
  check('pm: Ontario single-person region resolves to Ontario', on?.memberId === 'm-on' && on.region === 'Ontario')
  const ns = asMember(memberDecision('nora@aemltd.com'))
  check('pm: Nova Scotia single-person region resolves to Nova Scotia', ns?.memberId === 'm-ns' && ns.region === 'Nova Scotia')
  for (const [email, id] of [['nick@aemltd.com', 'm-nb1'], ['nadia@aemltd.com', 'm-nb2'], ['noel@aemltd.com', 'm-nb3']]) {
    const nb = asMember(memberDecision(email))
    check(`pm: NB member ${id} resolves to their own New Brunswick row`, nb?.memberId === id && nb.region === 'New Brunswick')
  }
  const nick = asMember(memberDecision('NICK@AEMLTD.COM'))
  check('pm: NB member never gets Ontario or Nova Scotia (old inactive rows ignored)',
    nick?.region === 'New Brunswick' && nick.memberId !== 'm-old-on' && nick.memberId !== 'm-old-ns')
  check('pm: member active in two regions refused (ambiguous)', reason(memberDecision('sam@aemltd.com')) === 'ambiguous')
  check('pm: inactive member refused', reason(memberDecision('gone@aemltd.com')) === 'inactive')
  check('pm: unknown member refused', reason(memberDecision('who@aemltd.com')) === 'no_account')
  check('pm: first member sign-in binds the id to the member', on?.bindNow === true)
  const memberBound: MicrosoftBinding = { owner: { kind: 'member', id: 'm-nb1' }, subject: 'sub-nick', issuer: ISS }
  check('pm: member with a different Microsoft id refused (id_mismatch)',
    reason(decide(claims({ email: 'nick@aemltd.com', subject: 'sub-x' }), [], rowsFor('nick@aemltd.com'), [memberBound])) === 'id_mismatch')
  check('pm: a member id bound to a staff account cannot be reused',
    reason(decide(claims({ email: 'nick@aemltd.com', subject: 'sub-pat' }), [], rowsFor('nick@aemltd.com'),
      [{ owner: { kind: 'profile', id: 'u-hr' }, subject: 'sub-pat', issuer: ISS }])) === 'id_mismatch')
  check('pm: resolver alone gives the row region', (r => r.ok && r.region === 'New Brunswick')(resolvePmMember('nadia@aemltd.com', teams)))
  check('pm: shared account picked only when exactly one active', pickPmAccount([{ id: 'a', active: true }]) === 'a'
    && pickPmAccount([]) === null && pickPmAccount([{ id: 'a', active: false }]) === null
    && pickPmAccount([{ id: 'a', active: true }, { id: 'b', active: true }]) === null)

  // Staff account and team member with the same email: the staff account wins, flagged for audit
  const both = decide(claims({ email: 'olivia@aemltd.com', subject: 'sub-o' }), [{ id: 'u-olivia', roles: ['manager'], active: true }], rowsFor('olivia@aemltd.com'))
  check('staff account wins when an email matches both', asAccount(both)?.userId === 'u-olivia')
  check('staff-wins decision is flagged for audit', asAccount(both)?.alsoMember === true)
  const bothRefused = decide(claims({ email: 'olivia@aemltd.com' }), [{ id: 'u-olivia', roles: ['manager'], active: false }], rowsFor('olivia@aemltd.com'))
  check('staff account still wins when it is refused (no fallback to the member)', reason(bothRefused) === 'inactive' && !bothRefused.allow && bothRefused.alsoMember)
  check('sameOwner compares kind and id', sameOwner({ kind: 'member', id: 'x' }, { kind: 'member', id: 'x' }) && !sameOwner({ kind: 'member', id: 'x' }, { kind: 'profile', id: 'x' }))
}

// ── 3. The callback flow against an in-memory database ──
type Db = {
  profiles: { id: string; email: string; roles: string[]; active: boolean; region?: string }[]
  teams: typeof teams
  authUsers: Set<string>
  linkedAzure: Set<string>
  bindings: MicrosoftBinding[]
  events: MicrosoftEvent[]
  audit: { userId: string; message: string }[]
  sessions: { profileId: string; memberId: string | null }[]
}

function makeDeps(db: Db): MicrosoftFlowDeps {
  return {
    decide: async c => {
      const email = normalizeEmail(c.email)
      return decideMicrosoftSignIn({
        claims: c,
        candidates: db.profiles.filter(p => p.email === email).map(p => ({ id: p.id, roles: p.roles, active: p.active })),
        members: db.teams.filter(t => t.member_email === email),
        bindings: db.bindings,
      })
    },
    pmAccount: async region => pickPmAccount(db.profiles
      .filter(p => p.region === region && p.roles.length === 1 && p.roles[0] === 'project_mgmt')
      .map(p => ({ id: p.id, active: p.active }))),
    bind: async (owner, c) => {
      if (db.bindings.some(b => sameOwner(b.owner, owner) || (b.subject === c.subject && b.issuer === c.issuer))) return false
      db.bindings.push({ owner, subject: c.subject!, issuer: c.issuer! })
      return true
    },
    touch: async () => {},
    cleanUp: async id => {
      if (!db.profiles.some(p => p.id === id)) db.authUsers.delete(id)   // stray auth user removed
      else db.linkedAzure.delete(id)                                     // Microsoft unlinked from our account
    },
    createSession: async (profileId, memberId) => {
      db.sessions.push({ profileId, memberId })
      const p = db.profiles.find(x => x.id === profileId)!
      return { role: p.roles[0], roles: p.roles }
    },
    record: async event => {
      db.events.push(event)
      if (!event.userId) return
      const message = event.outcome === 'success' ? microsoftAuditMessage(event.memberId ? 'success_member' : 'success')
        : event.outcome === 'note' ? microsoftAuditMessage(STAFF_OVER_MEMBER) : microsoftAuditMessage(event.reason)
      db.audit.push({ userId: event.userId, message })
    },
  }
}

async function testFlow() {
  const db: Db = {
    profiles: [
      { id: 'u-hr', email: 'pat.hr@aemltd.com', roles: ['hr'], active: true },
      { id: 'u-nh', email: 'new.hire@aemltd.com', roles: ['newhire'], active: true },
      { id: 'u-dual', email: 'dual@aemltd.com', roles: ['manager'], active: true },
      { id: 'pm-on', email: 'pm-ontario@aemltd.com',     roles: ['project_mgmt'], active: true, region: 'Ontario' },
      { id: 'pm-ns', email: 'pm-novascotia@aemltd.com',  roles: ['project_mgmt'], active: true, region: 'Nova Scotia' },
      { id: 'pm-nb', email: 'pm-newbrunswick@aemltd.com', roles: ['project_mgmt'], active: true, region: 'New Brunswick' },
    ],
    // dual@ is a manager AND on the Ontario team (the staff-wins case)
    teams: [...teams, { id: 'm-dual', region: 'Ontario', member_email: 'dual@aemltd.com', active: true }],
    authUsers: new Set(['u-hr', 'u-nh', 'u-dual', 'pm-on', 'pm-ns', 'pm-nb']),
    linkedAzure: new Set(),
    bindings: [], events: [], audit: [], sessions: [],
  }
  const deps = makeDeps(db)
  const profilesBefore = db.profiles.length
  const teamsBefore = db.teams.length

  // Staff
  db.linkedAzure.add('u-hr')
  const r1 = await completeMicrosoftSignIn(deps, 'u-hr', claims())
  check('flow: HR signs in as themselves', r1.ok && r1.userId === 'u-hr' && db.sessions.at(-1)?.profileId === 'u-hr' && db.sessions.at(-1)?.memberId === null)
  check('flow: lands on the HR portal (allow-listed path)', r1.ok && r1.redirect === '/hr/dashboard')
  check('flow: Microsoft id stored on first sign-in', db.bindings.length === 1 && db.bindings[0].owner.id === 'u-hr')
  const r2 = await completeMicrosoftSignIn(deps, 'u-hr', claims())
  check('flow: second sign-in with the same id allowed', r2.ok && db.bindings.length === 1)

  const sessionsBefore = db.sessions.length
  db.linkedAzure.add('u-hr')
  const r3 = await completeMicrosoftSignIn(deps, 'u-hr', claims({ subject: 'sub-attacker' }))
  check('flow: mismatched id refused', !r3.ok && r3.reason === 'id_mismatch')
  check('flow: mismatch creates no session', db.sessions.length === sessionsBefore)
  check('flow: mismatch audited on the account as a security event',
    db.audit.some(a => a.userId === 'u-hr' && a.message.includes('security event') && a.message.includes('id_mismatch')))
  check('flow: mismatch unlinks Microsoft from the account', !db.linkedAzure.has('u-hr'))

  db.authUsers.add('u-stray')
  const r4 = await completeMicrosoftSignIn(deps, 'u-stray', claims({ email: 'stranger@aemltd.com', subject: 'sub-s' }))
  check('flow: unknown email refused, stray auth user removed', !r4.ok && r4.reason === 'no_account' && !db.authUsers.has('u-stray'))

  db.linkedAzure.add('u-nh')
  const r5 = await completeMicrosoftSignIn(deps, 'u-nh', claims({ email: 'new.hire@aemltd.com', subject: 'sub-nh' }))
  check('flow: new hire refused, no session, no Microsoft link', !r5.ok && r5.reason === 'newhire'
    && !db.sessions.some(s => s.profileId === 'u-nh') && !db.linkedAzure.has('u-nh'))

  // Project-management members: each region, signed in on their region's shared account
  const memberCases: [string, string, string, string][] = [
    ['olivia@aemltd.com', 'm-on', 'pm-on', 'Ontario'],
    ['nora@aemltd.com',  'm-ns',  'pm-ns', 'Nova Scotia'],
    ['nick@aemltd.com',  'm-nb1', 'pm-nb', 'New Brunswick'],
    ['nadia@aemltd.com', 'm-nb2', 'pm-nb', 'New Brunswick'],
  ]
  for (const [email, memberId, account, region] of memberCases) {
    const stray = `u-stray-${memberId}`
    db.authUsers.add(stray)
    const r = await completeMicrosoftSignIn(deps, stray, claims({ email, subject: `sub-${memberId}` }))
    const s = db.sessions.at(-1)
    check(`flow: ${region} member ${memberId} signs in on the ${region} shared account only`,
      r.ok && r.userId === account && r.memberId === memberId && s?.profileId === account && s?.memberId === memberId)
    check(`flow: ${memberId} lands on the project management portal`, r.ok && r.redirect === '/project-mgmt/dashboard')
    check(`flow: ${memberId} throwaway auth user removed`, !db.authUsers.has(stray))
    check(`flow: ${memberId} Microsoft id bound to the member`, db.bindings.some(b => b.owner.kind === 'member' && b.owner.id === memberId))
  }
  check('flow: no NB member session was ever on the Ontario or Nova Scotia account',
    db.sessions.filter(s => s.memberId?.startsWith('m-nb')).every(s => s.profileId === 'pm-nb'))
  check('flow: member success recorded with the member id', db.events.some(e => e.outcome === 'success' && e.memberId === 'm-nb2'))

  // Region with no single active shared account
  db.profiles.find(p => p.id === 'pm-on')!.active = false
  db.teams = [...db.teams, { id: 'm-on2', region: 'Ontario', member_email: 'otto@aemltd.com', active: true }]
  db.authUsers.add('u-stray-otto')
  const r6 = await completeMicrosoftSignIn(deps, 'u-stray-otto', claims({ email: 'otto@aemltd.com', subject: 'sub-otto' }))
  check('flow: member refused when the region has no active shared account', !r6.ok && r6.reason === 'no_pm_account' && !db.authUsers.has('u-stray-otto'))
  db.profiles.find(p => p.id === 'pm-on')!.active = true

  // Member active in two regions
  db.authUsers.add('u-stray-sam')
  const r7 = await completeMicrosoftSignIn(deps, 'u-stray-sam', claims({ email: 'sam@aemltd.com', subject: 'sub-sam' }))
  check('flow: member on two regions refused as ambiguous', !r7.ok && r7.reason === 'ambiguous')

  // Staff account and member with the same email: staff wins, audit entry written
  db.linkedAzure.add('u-dual')
  const auditBefore = db.audit.length
  const r8 = await completeMicrosoftSignIn(deps, 'u-dual', claims({ email: 'dual@aemltd.com', subject: 'sub-dual' }))
  check('flow: staff account wins over the Ontario team row', r8.ok && r8.userId === 'u-dual' && r8.memberId === null
    && db.sessions.at(-1)?.profileId === 'u-dual' && db.sessions.at(-1)?.memberId === null)
  const note = db.events.find(e => e.outcome === 'note')
  check('flow: staff_over_member recorded on the staff account', note?.reason === STAFF_OVER_MEMBER && note.userId === 'u-dual')
  check('flow: staff_over_member audit entry written (code only, no email)',
    db.audit.slice(auditBefore).some(a => a.userId === 'u-dual' && a.message.includes('staff_over_member') && !a.message.includes('@')))

  // Only otto's row was added, by this test itself
  check('flow: no account, profile or team member is ever created', db.profiles.length === profilesBefore && db.teams.length === teamsBefore + 1)
}

// ── 4. New-hire sessions must come from a password sign-in ──
function testNewhireSessions() {
  check('session: new hire with a password session allowed', newhireSessionAllowed(['newhire'], [{ method: 'password', timestamp: 1 }]))
  check('session: new hire with a Microsoft (oauth) session refused', !newhireSessionAllowed(['newhire'], [{ method: 'oauth', timestamp: 1 }]))
  check('session: new hire with a magic-link session refused', !newhireSessionAllowed(['newhire'], [{ method: 'otp', timestamp: 1 }]))
  check('session: new hire with no amr refused', !newhireSessionAllowed(['newhire'], undefined) && !newhireSessionAllowed(['newhire'], []))
  check('session: plain-string amr accepted', sessionFromPassword(['pwd']) && sessionFromPassword(['password']))
  check('session: staff unaffected by this rule (gated by the signed cookie instead)', newhireSessionAllowed(['hr'], [{ method: 'otp', timestamp: 1 }]))
}

// ── 5. Staff password sign-in setting ──
function testPasswordSetting() {
  check('setting: unset means on', staffPasswordLoginOn(undefined) && staffPasswordLoginOn(''))
  check('setting: "on" is on', staffPasswordLoginOn('on'))
  check('setting: "off" (any case, trimmed) is off', !staffPasswordLoginOn('off') && !staffPasswordLoginOn(' OFF '))
  check('password: staff allowed while on', passwordSignInAllowed({ roles: ['hr'], settingOn: true, breakGlass: false }).allow)
  check('password: shared pm accounts keep working while on', passwordSignInAllowed({ roles: ['project_mgmt'], settingOn: true, breakGlass: false }).allow)
  check('password: staff blocked when off', !passwordSignInAllowed({ roles: ['hr'], settingOn: false, breakGlass: false }).allow)
  check('password: shared pm account blocked when off', !passwordSignInAllowed({ roles: ['project_mgmt'], settingOn: false, breakGlass: false }).allow)
  const bg = passwordSignInAllowed({ roles: ['hr'], settingOn: false, breakGlass: true })
  check('password: break-glass allowed when off, and marked for audit', bg.allow && bg.breakGlassUsed)
  check('password: new hire unaffected when off', passwordSignInAllowed({ roles: ['newhire'], settingOn: false, breakGlass: false }).allow)
}

// ── 6. Redirects ──
function testRedirects() {
  for (const bad of ['https://evil.example/hr/dashboard', '//evil.example', '/\\evil.example', 'javascript:alert(1)',
    '/hr/dashboard?x=//evil', '/hr/../admin', '', null, 42]) {
    check(`redirect rejected: ${JSON.stringify(bad)}`, safeRedirectPath(bad, '/hr/dashboard') === '/hr/dashboard')
  }
  check('redirect: allow-listed portal path kept', safeRedirectPath('/payroll/dashboard', '/hr/dashboard') === '/payroll/dashboard')
  check('redirect: unsafe fallback replaced by /login', safeRedirectPath('https://evil.example', 'https://evil.example') === '/login')
}

// ── 7. Audit and refusal text ──
function testAuditText() {
  const texts = [
    ...REFUSAL_REASONS.map(r => microsoftAuditMessage(r as RefusalReason)),
    microsoftAuditMessage('success'), microsoftAuditMessage('success_member'), microsoftAuditMessage(STAFF_OVER_MEMBER),
    BREAK_GLASS_AUDIT_MESSAGE, PASSWORD_OFF_AUDIT_MESSAGE, MICROSOFT_REFUSED_MESSAGE,
  ]
  check('audit text has no emails', texts.every(t => !t.includes('@')))
  check('audit text has no tokens or long ids', texts.every(t => !/[A-Za-z0-9_-]{24,}/.test(t) && !/eyJ/.test(t)))
  check('audit text has no HTML', texts.every(t => !/[<>]/.test(t)))
  check('refusal message is the exact agreed text', MICROSOFT_REFUSED_MESSAGE === 'Your Microsoft account is not set up for this portal yet. Please contact HR.')
}

async function main() {
  testDecisions()
  testMembers()
  await testFlow()
  testNewhireSessions()
  testPasswordSetting()
  testRedirects()
  testAuditText()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exitCode = failed ? 1 : 0
}

main().catch(() => { console.log('FAIL  script error'); process.exitCode = 1 })
