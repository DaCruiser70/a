// New hire forms: Documents completion (Job 1) and field limits and formats (Job 3). Pure checks
// against the real rule code; nothing is written to the database.
//
// Usage (from the project root):
//   npx tsx scripts/test-forms.ts                                     (pure checks only)
//   EMAIL_MODE=console npx tsx --env-file=.env.local scripts/test-forms.ts   (also the completion-order
//                                                                          checks, on temporary hires)
//
// Prints pass/fail lines and a count only. Exit code 1 on any failure. Temporary hires are removed.

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createServiceClient } from '../lib/supabase/server'
import {
  ONBOARDING_ITEMS, ONBOARDING_ITEM_COUNT, stepOf, stepLabel, inOnboardingOrder, isOnboardingItem,
} from '../lib/form-order'
import { REQUIRED_ITEMS } from '../lib/submission'
import { FLAG_SECTIONS } from '../lib/notification-templates'
import { computeSubmission, computeDocumentStatus, documentsAllUploaded } from '../lib/submission'
import { afterHireFormSaved } from '../lib/submission-server'
import type { HireDoc } from '../lib/hire-status'
import {
  FIELD_LIMITS, normalizePhone, normalizePostalCode, normalizeSin, sinChecksumValid, displayFileName, formatPhone,
  dobError, cleanLine, cleanMultiline,
} from '../lib/field-limits'
import {
  zName, zText, zOptionalText, zEmail, zPhone, zPostalCode, zProvince, zDateOfBirth, zSin, zDigits, zPassword,
  readJsonBody,
} from '../lib/field-validation'
import { FormStatusBody, DocumentReviewBody, NoteBody } from '../lib/review-schemas'
import { esc } from '../lib/safe-html'
import { formatPhoneInput, phoneDigitsFromInput, PHONE_ERROR } from '../lib/phone-format'

let passed = 0
let failed = 0
function check(name: string, ok: boolean) {
  if (ok) passed++; else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

// ── Job 1: Documents completes only when every required document is uploaded ──

const FORMS_SENT = { personal: 'review', banking: 'review', sin: 'review', policy: 'review' } as const
const doc = (document_type: string, form_status = 'review'): HireDoc => ({ document_type, form_status })

async function testDocumentsCompletion() {
  const one = [doc('td1_federal')]
  const s1 = computeSubmission(FORMS_SENT, one)
  check('one of several required documents does not complete Documents', !documentsAllUploaded(one) && s1.sent === 4 && !s1.complete)
  check('one upload with others missing shows Documents as still to do (pending)', computeDocumentStatus(one) === 'pending')

  const two = [doc('td1_federal'), doc('td1_provincial')]
  check('two of three still not complete', !computeSubmission(FORMS_SENT, two).complete)

  const all = [doc('td1_federal'), doc('td1_provincial'), doc('drivers_license')]
  const s3 = computeSubmission(FORMS_SENT, all)
  check('all required documents completes Documents', documentsAllUploaded(all) && s3.sent === 5 && s3.complete)

  const altId = [doc('td1_federal'), doc('td1_provincial'), doc('alternative_id')]
  check('OR rule: an Alternative ID satisfies the ID slot', computeSubmission(FORMS_SENT, altId).complete)
  check('company vehicle: an Alternative ID is not enough', !computeSubmission(FORMS_SENT, altId, { companyVehicle: true }).complete)
  check('company vehicle: the Driver’s License completes it', computeSubmission(FORMS_SENT, all, { companyVehicle: true }).complete)
  check('optional documents never complete it', !computeSubmission(FORMS_SENT, [doc('work_permit'), doc('trade_license'), doc('td1_federal')]).complete)

  const rejected = [doc('td1_federal', 'rejected'), doc('td1_provincial'), doc('drivers_license')]
  check('a rejected document still counts as uploaded, shown as action required', documentsAllUploaded(rejected) && computeDocumentStatus(rejected) === 'flagged')
  check('rejected plus missing: flagged, and not complete', computeDocumentStatus([doc('td1_federal', 'rejected')]) === 'flagged'
    && !computeSubmission(FORMS_SENT, [doc('td1_federal', 'rejected')]).complete)

  // The browser can claim anything: the documents status passed in is ignored; only stored rows count
  const claimed = computeSubmission({ ...FORMS_SENT, documents: 'approved' }, one)
  check('server refuses completion when documents are missing even if the client claims otherwise', !claimed.complete && claimed.sent === 4)

  // The server's completion step reads the stored rows (here an in-memory stand-in): missing → not complete
  const fake = fakeAdmin({ forms: 'review', docs: one })
  const result = await afterHireFormSaved(fake as never, '00000000-0000-4000-8000-000000000001')
  check('server completion step refuses with a required document missing', !result.complete && !result.justCompleted)

  // The Documents page never redirects after an upload
  const page = readFileSync('app/newhire/forms/documents/page.tsx', 'utf8')
  check('an upload does not redirect (no router.replace / push to the done page)',
    !/router\.(replace|push)\(\s*COMPLETE_PAGE/.test(page) && !/router\.replace\(/.test(page))
  check('the upload route never returns justCompleted', !/justCompleted/.test(readFileSync('app/api/forms/documents/route.ts', 'utf8')))
}

// A minimal stand-in for the service client: the four form rows and the documents. Form statuses can
// differ per table; audit inserts are accepted and counted.
type FakeState = { forms: string | Record<string, string>; docs: HireDoc[]; audits?: number }
const FORM_TABLE_ITEM: Record<string, string> = {
  personal_info: 'personal', banking_info: 'banking', sin_info: 'sin', policy_acknowledgements: 'policy',
}
function fakeAdmin(state: FakeState) {
  return {
    from(table: string) {
      const formStatus = typeof state.forms === 'string' ? state.forms : state.forms[FORM_TABLE_ITEM[table]] ?? 'pending'
      const rows = table === 'newhire_documents' ? state.docs
        : table === 'equipment_provisioning' ? []
        : [{ form_status: formStatus }]
      const query = {
        select: () => query,
        eq: () => query,
        insert: async () => { state.audits = (state.audits ?? 0) + 1; return { error: null } },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      }
      return query
    },
  }
}

// ── Job 2: one shared order list ──

function testFormOrder() {
  check('order: personal, banking, sin, documents, policy', ONBOARDING_ITEMS.join(',') === 'personal,banking,sin,documents,policy')
  check('order: still 5 items, Documents counted once', ONBOARDING_ITEM_COUNT === 5 && ONBOARDING_ITEMS.filter(i => i === 'documents').length === 1)
  check('order: Documents is step 4, Policy is step 5 (last)', stepOf('documents') === 4 && stepOf('policy') === 5 && stepLabel('policy') === 'Step 5 of 5')
  check('order: step labels for every item', ONBOARDING_ITEMS.map(stepLabel).join('|') === 'Step 1 of 5|Step 2 of 5|Step 3 of 5|Step 4 of 5|Step 5 of 5')
  check('order: required items use the shared list', REQUIRED_ITEMS === ONBOARDING_ITEMS)
  check('order: flag sections use the shared list', FLAG_SECTIONS === ONBOARDING_ITEMS)
  check('order: sorting keeps extras (clearance) last', inOnboardingOrder(['clearance', 'policy', 'documents', 'personal']).join(',') === 'personal,documents,policy,clearance')
  check('order: item check', isOnboardingItem('documents') && !isOnboardingItem('clearance'))
  // No page or list hard-codes the order any more
  const files = ['app/newhire/forms/page.tsx', 'app/newhire/welcome/page.tsx', 'lib/reminders-render.ts', 'app/api/newhire/flag-sources/route.ts']
  check('order: no hard-coded copies of the item order', files.every(f => !/'personal',\s*'banking',\s*'sin',\s*'(policy|documents)'/.test(readFileSync(f, 'utf8'))))
  for (const [file, item] of [['personal', 'personal'], ['banking', 'banking'], ['sin', 'sin'], ['documents', 'documents'], ['policy', 'policy']]) {
    check(`order: the ${item} page shows its step from the shared list`, readFileSync(`app/newhire/forms/${file}/page.tsx`, 'utf8').includes(`stepLabel('${item}')`))
  }
}

// ── Completion never depends on order: finishing Documents last or Policy last both complete the
//    hire exactly once, and queue HR's "all forms received" notice exactly once (the real queue). ──

async function testCompletionOrders() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('INFO  completion-order checks skipped (run with --env-file=.env.local)')
    return
  }
  const admin = createServiceClient()
  const runId = randomBytes(5).toString('hex')
  const tempIds: string[] = []
  try {
    for (const lastItem of ['documents', 'policy'] as const) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: `selftest-order-${lastItem}-${runId}@example.com`, password: randomBytes(24).toString('base64url'),
        email_confirm: true, app_metadata: { role: 'newhire', roles: ['newhire'] },
      })
      if (error || !created.user) { check(`completion (${lastItem} last): temporary hire created`, false); continue }
      const hireId = created.user.id
      tempIds.push(hireId)

      // Finish the five items one save at a time, with lastItem saved last
      const order = [...ONBOARDING_ITEMS.filter(i => i !== lastItem), lastItem]
      const state: FakeState = { forms: { personal: 'pending', banking: 'pending', sin: 'pending', policy: 'pending' }, docs: [], audits: 0 }
      const results: { complete: boolean; justCompleted: boolean }[] = []
      for (const item of order) {
        if (item === 'documents') {
          // Documents arrive one upload at a time; each upload is its own save
          for (const t of ['td1_federal', 'td1_provincial', 'drivers_license']) {
            state.docs = [...state.docs, doc(t)]
            results.push(await afterHireFormSaved(fakeAdmin(state) as never, hireId))
          }
        } else {
          (state.forms as Record<string, string>)[item] = 'review'
          results.push(await afterHireFormSaved(fakeAdmin(state) as never, hireId))
        }
      }
      // A later re-save (e.g. after a flag) must not complete it again
      results.push(await afterHireFormSaved(fakeAdmin(state) as never, hireId))

      const firstComplete = results.findIndex(r => r.complete)
      const just = results.filter(r => r.justCompleted).length
      const { count: notices } = await admin.from('notification_outbox')
        .select('id', { count: 'exact', head: true }).eq('newhire_id', hireId).eq('template', 'onboarding_complete')
      check(`completion (${lastItem} last): not complete until the last item`, firstComplete === results.length - 2)
      check(`completion (${lastItem} last): completes exactly once`, just === 1 && results[results.length - 2].justCompleted)
      check(`completion (${lastItem} last): HR's notice queued exactly once`, notices === 1)
      check(`completion (${lastItem} last): one completion audit entry`, state.audits === 1)
    }
  } finally {
    // Deleting the hire removes its profile, notices and ledger keys
    for (const id of tempIds) await admin.auth.admin.deleteUser(id)
    console.log(`(temporary hires removed: ${tempIds.length})`)
  }
}

// ── Job 3: field limits and formats on the server ──

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success
const out = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, v: unknown) => schema.safeParse(v).data

function testNames() {
  const first = zName('First name')
  for (const v of ['José', 'Zoë', "D'Arcy", 'O’Brien', 'Mary-Jane', 'St. John', 'Nguyễn', 'Ångström', 'Łukasz']) {
    check(`name accepted: ${v}`, ok(first, v))
  }
  check('name: 60 characters accepted', ok(first, 'A'.repeat(60)))
  check('name: 61 characters refused', !ok(first, 'A'.repeat(61)))
  check('name: digits refused', !ok(first, 'John2'))
  check('name: empty refused', !ok(first, '   '))
  check('name: HTML refused', !ok(first, '<b>John</b>'))
  check('name: spaces collapsed and trimmed', out<string>(first, '  Mary   Jane  ') === 'Mary Jane')
  check('name: Unicode normalised to NFC', out<string>(first, 'José') === 'José')
}

function testText() {
  const address = zText('Street address', FIELD_LIMITS.address)
  check('address: 100 accepted', ok(address, 'a'.repeat(100)))
  check('address: 101 refused', !ok(address, 'a'.repeat(101)))
  const city = zText('City', FIELD_LIMITS.city)
  check('city: 60 accepted, 61 refused', ok(city, 'c'.repeat(60)) && !ok(city, 'c'.repeat(61)))
  check('control characters refused', !ok(city, 'Oak\u0007ville'))
  check('zero-width characters refused', !ok(city, 'Oak​ville'))
  check('direction-override characters refused', !ok(city, 'Oak‮ville'))
  const sig = zName('Signature', FIELD_LIMITS.signature)
  check('signature: 100 accepted, 101 refused', ok(sig, 'A'.repeat(100)) && !ok(sig, 'A'.repeat(101)))
  const note = zText('Note', FIELD_LIMITS.note, { multiline: true })
  check('note: 1000 accepted, 1001 refused', ok(note, 'n'.repeat(1000)) && !ok(note, 'n'.repeat(1001)))
  check('note: line breaks kept, spaces collapsed', out<string>(note, 'Line one   here\r\n\r\n\r\nLine  two') === 'Line one here\n\nLine two')
  const long = zText('Details', FIELD_LIMITS.longText, { multiline: true })
  check('long text: 2000 accepted, 2001 refused', ok(long, 'x'.repeat(2000)) && !ok(long, 'x'.repeat(2001)))
  check('optional text: empty becomes null', out(zOptionalText('Note', 10), '   ') === null)
  // HTML or script is stored as plain text and shown escaped
  const html = '<script>alert("x")</script> & <b>bold</b>'
  const stored = out<string>(note, html)
  check('HTML text is stored as plain text, unchanged', stored === html)
  check('HTML text is escaped when shown in an audit message', esc(stored!) === '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;')
  check('cleaners: line', cleanLine('  a \t b \n c ') === 'a b c')
  check('cleaners: multiline', cleanMultiline(' a \n\n\n\n b ') === 'a\n\nb')
}

function testEmail() {
  const email = zEmail('Email')
  check('email: valid accepted and lower-cased', out<string>(email, '  Pat@Example.COM ') === 'pat@example.com')
  check('email: invalid refused', !ok(email, 'pat@'))
  check('email: 254 limit', !ok(email, `${'a'.repeat(250)}@x.co`))
}

function testPhone() {
  for (const [input, digits] of [
    ['(905) 555-0100', '9055550100'], ['905-555-0100', '9055550100'], ['905.555.0100', '9055550100'],
    ['+1 905 555 0100', '9055550100'], ['1-905-555-0100', '9055550100'], ['9055550100', '9055550100'],
  ] as const) {
    check(`phone normalised: ${input}`, normalizePhone(input) === digits && out<string>(zPhone(), input) === digits)
  }
  for (const bad of ['905-555-010', '905-555-01000', '905-ABC-0100', '+44 20 7946 0958', '(055) 555-0100', '905 155 0100', '1'.repeat(21), '']) {
    check(`phone refused: ${JSON.stringify(bad)}`, !ok(zPhone(), bad))
  }
  check('phone shown formatted', formatPhone('9055550100') === '(905) 555-0100' && formatPhone('(905) 555-0100 x12') === '(905) 555-0100 x12')
}

// Phone fields while typing (lib/phone-format.ts), checked against the unchanged server rule
function testPhoneTyping() {
  for (const input of ['905-555-0100', '+1 905 555 0100', '1-905-555-0100', '9055550100', '(905) 555-0100', '+1 (905) 555-0100']) {
    const shown = formatPhoneInput(input)
    check(`typing ${JSON.stringify(input)} shows (905) 555-0100 and the server accepts it`, shown === '(905) 555-0100' && normalizePhone(shown) === '9055550100')
  }
  check('typing: a typed +1 is not counted as a digit', phoneDigitsFromInput('+1') === '' && formatPhoneInput('+1 9') === '(9')
  check('typing: a leading 1 is dropped', formatPhoneInput('1905') === '(905')
  check('typing: partial numbers stay editable', formatPhoneInput('905') === '(905' && formatPhoneInput('9055') === '(905) 5' && formatPhoneInput('9055550') === '(905) 555-0')
  check('typing: never more than 10 digits', formatPhoneInput('90555501009999') === '(905) 555-0100')
  check('typing: letters are dropped from the display', formatPhoneInput('905abc5550100') === '(905) 555-0100')
  const nine = formatPhoneInput('905555010')
  check('a 9-digit number is refused by the server rule', nine === '(905) 555-010' && normalizePhone(nine) === null && !ok(zPhone(), nine))
  check('a 10-digit number with +1 is accepted', out<string>(zPhone(), '+1 905 555 0100') === '9055550100')
  const refused = zPhone().safeParse('905555010')
  check('the friendly message is used, without the value', !refused.success && refused.error.issues[0].message === PHONE_ERROR && !PHONE_ERROR.includes('905555010'))
}

function testPostalAndProvince() {
  check('postal: normalised to upper case with a space', normalizePostalCode('l6j1a1') === 'L6J 1A1' && out<string>(zPostalCode(), ' l6j 1a1 ') === 'L6J 1A1')
  for (const bad of ['L6J 1A', 'D1A 1A1', '12345', 'L6J-1A1x', 'LLL 111']) check(`postal refused: ${bad}`, !ok(zPostalCode(), bad))
  check('province: from the list', ok(zProvince, 'Ontario') && ok(zProvince, 'Nunavut'))
  check('province: free text refused', !ok(zProvince, 'Ontari0'))
}

function testSin() {
  check('SIN checksum: a valid number', sinChecksumValid('046454286'))
  check('SIN: spaces and dashes accepted, stored as 9 digits', normalizeSin('046 454 286') === '046454286' && out<string>(zSin(), '046-454-286') === '046454286')
  check('SIN: wrong checksum refused', !ok(zSin(), '046454287'))
  check('SIN: 8 digits refused', !ok(zSin(), '04645428'))
  check('SIN: letters refused', !ok(zSin(), '046a54286'))
  check('SIN: all zeros refused', !ok(zSin(), '000000000'))
  const parsed = zSin().safeParse('123456789')
  check('SIN error message never contains the value', !parsed.success && !JSON.stringify(parsed.error.issues).includes('123456789'))
}

function testBanking() {
  const inst = zDigits('Institution number', 3)
  const transit = zDigits('Transit number', 5)
  const account = zDigits('Account number', 7, 12)
  check('institution: exactly 3 digits', ok(inst, '003') && !ok(inst, '03') && !ok(inst, '0033') && !ok(inst, '0a3'))
  check('transit: exactly 5 digits', ok(transit, '12345') && !ok(transit, '1234') && !ok(transit, '123456'))
  check('account: 7 to 12 digits', ok(account, '1234567') && ok(account, '123456789012') && !ok(account, '123456') && !ok(account, '1234567890123'))
  check('account: letters refused', !ok(account, '12345a7'))
}

function testDateOfBirth() {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const yearsAgo = (y: number, extraDays = 0) => { const d = new Date(today); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() + extraDays); return iso(d) }
  check('DOB: 30 years old accepted', ok(zDateOfBirth(), yearsAgo(30)))
  check('DOB: in the future refused', dobError(yearsAgo(-1)) !== null)
  check('DOB: 13 years old refused', !ok(zDateOfBirth(), yearsAgo(13)))
  check('DOB: 14 years old accepted', ok(zDateOfBirth(), yearsAgo(14, -1)))
  check('DOB: over 100 refused', !ok(zDateOfBirth(), yearsAgo(101)))
  check('DOB: not a real date refused', !ok(zDateOfBirth(), '1990-02-30') && !ok(zDateOfBirth(), '1990/01/01'))
}

function testPasswordsAndFiles() {
  check('password: not trimmed or changed', out<string>(zPassword, '  pass word  ') === '  pass word  ')
  check('password: 128 accepted, 129 refused', ok(zPassword, 'p'.repeat(128)) && !ok(zPassword, 'p'.repeat(129)))
  const long = `${'r'.repeat(200)}.pdf`
  const shown = displayFileName(long)
  check('file name: shortened to 120 with the extension kept', shown.length <= 120 && shown.endsWith('.pdf'))
  check('file name: path characters and controls removed', displayFileName('a/b\\c\u0000.pdf') === 'a_b_c.pdf')
}

function testReviewBodies() {
  check('flag needs a comment', !ok(FormStatusBody, { formId: 'banking', status: 'flagged' }))
  check('flag with a comment accepted', ok(FormStatusBody, { formId: 'banking', status: 'flagged', reason: 'Transit number looks wrong' }))
  check('flag comment over 1000 refused', !ok(FormStatusBody, { formId: 'banking', status: 'flagged', reason: 'x'.repeat(1001) }))
  check('unknown form refused', !ok(FormStatusBody, { formId: 'payroll', status: 'approved' }))
  check('extra keys refused', !ok(FormStatusBody, { formId: 'sin', status: 'approved', overall: 'approved' }))
  check('reject needs a reason', !ok(DocumentReviewBody, { documentId: '7f6c1a5e-0b8e-4b5f-9a3c-2d7e8f9a0b1c', action: 'reject' }))
  check('document id must be a uuid', !ok(DocumentReviewBody, { documentId: 'abc', action: 'approve' }))
  check('note: empty refused, 1000 accepted', !ok(NoteBody, { noteText: '  ' }) && ok(NoteBody, { noteText: 'n'.repeat(1000) }))
}

async function testBodySize() {
  const big = new Request('http://x/api', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(20_000) }), headers: { 'content-type': 'application/json' } })
  check('body over 16 KB refused with 413', (await readJsonBody(big)).ok === false && ((await readJsonBody(new Request('http://x/api', { method: 'POST', body: 'x'.repeat(20_000) }))) as { status?: number }).status === 413)
  const bad = await readJsonBody(new Request('http://x/api', { method: 'POST', body: '{not json' }))
  check('invalid JSON refused with 400', !bad.ok && bad.status === 400)
  const good = await readJsonBody(new Request('http://x/api', { method: 'POST', body: '{"a":1}' }))
  check('small JSON accepted', good.ok && (good.data as { a: number }).a === 1)
}

async function main() {
  await testDocumentsCompletion()
  testFormOrder()
  await testCompletionOrders()
  testNames()
  testText()
  testEmail()
  testPhone()
  testPhoneTyping()
  testPostalAndProvince()
  testSin()
  testBanking()
  testDateOfBirth()
  testPasswordsAndFiles()
  testReviewBodies()
  await testBodySize()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exitCode = failed ? 1 : 0
}

main().catch(() => { console.log('FAIL  script error'); process.exitCode = 1 })
