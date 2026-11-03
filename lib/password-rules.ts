// Password rules for the set-password page. Shared by the browser (live checklist) and the server
// (POST /api/auth/password/set enforces the same rules). Never logs or stores a password.

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

// Very common passwords and the words they are built from, lower case. A password is refused when
// it is one of these, or one of these with only digits and symbols added around it.
const COMMON = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'monkey', 'dragon', 'football',
  'baseball', 'hockey', 'soccer', 'master', 'sunshine', 'princess', 'shadow', 'superman',
  'trustno1', 'starwars', 'whatever', 'computer', 'internet', 'changeme', 'secret', 'login',
  'abc', 'abcdef', 'abcdefg', 'abcdefgh', 'abcdefghijkl', 'qazwsx', 'qweasd', 'aaaaaa',
  'onboarding', 'aem', 'aemltd', 'welcometoaem', 'canada', 'toronto', 'halifax', 'moncton',
  'oakville', 'dartmouth', 'summer', 'winter', 'spring', 'autumn', 'january', 'october',
  'mypassword', 'newpassword', 'password1', 'passwordpassword', 'iloveyouiloveyou',
  'qwertyqwerty', 'letmeinletmein', 'welcomewelcome', 'hello', 'helloworld', 'freedom',
  'mustang', 'jordan', 'michael', 'jennifer', 'charlie', 'ashley', 'thomas', 'hunter',
])
// Digits-only and keyboard runs that are long enough to pass the length rule
const COMMON_EXACT = new Set([
  '123456789012', '1234567890123', '12345678901234', '111111111111', '000000000000',
  '123123123123', '123412341234', '1q2w3e4r5t6y', 'qwerty123456', '1qaz2wsx3edc',
  'qwertyuiop12', 'qwertyuiop123', 'asdfghjkl123', 'zaq12wsxcde3', 'abcd12345678',
])

export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase()
  if (COMMON_EXACT.has(lower) || COMMON.has(lower)) return true
  if (/^[^a-z]*$/.test(lower)) return /^(.)\1*$/.test(lower) || /^(?:0123456789|1234567890|9876543210)/.test(lower)
  // Strip digits and symbols from both ends, then look the word up again
  const core = lower.replace(/^[^a-z]+|[^a-z]+$/g, '')
  if (COMMON.has(core)) return true
  // The same common word repeated ("passwordpassword1")
  const half = core.length % 2 === 0 ? core.slice(0, core.length / 2) : ''
  return !!half && half + half === core && COMMON.has(half)
}

// The part of the email before the @, lower case ('' when there is none)
export function emailName(email: string | null | undefined): string {
  return (email ?? '').split('@')[0].trim().toLowerCase()
}

function containsEmailName(password: string, name: string): boolean {
  return name.length >= 3 && password.toLowerCase().includes(name)
}

export type PasswordRuleId = 'length' | 'common' | 'email' | 'match'
export type PasswordRule   = { id: PasswordRuleId; label: string; ok: boolean }

// The live checklist. name: the part of the email before the @ ('' hides that rule's check)
export function passwordChecklist(password: string, confirm: string, name: string): PasswordRule[] {
  return [
    { id: 'length', label: `${PASSWORD_MIN} to ${PASSWORD_MAX} characters`, ok: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX },
    { id: 'common', label: 'Not a common password',                         ok: password.length > 0 && !isCommonPassword(password) },
    { id: 'email',  label: 'Does not include your email name',              ok: password.length > 0 && !containsEmailName(password, name) },
    { id: 'match',  label: 'Both passwords match',                          ok: password.length > 0 && password === confirm },
  ]
}

// The first rule broken, as a friendly sentence; null when the password is acceptable
export function passwordError(password: string, confirm: string, name: string): string | null {
  if (password.length < PASSWORD_MIN) return `Your password needs at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `Your password can be at most ${PASSWORD_MAX} characters.`
  if (isCommonPassword(password))     return 'That password is too common and easy to guess. Try a few unrelated words together.'
  if (containsEmailName(password, name)) return 'Your password must not include the part of your email before the @.'
  if (password !== confirm)           return 'The two passwords do not match.'
  return null
}

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong'
export const STRENGTH_LABELS: Record<PasswordStrength, string> = {
  weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong',
}

// A rough hint only (length and variety); the rules above decide what is accepted
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN || isCommonPassword(password)) return 'weak'
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length
  const unique = new Set(password).size
  if (unique < 6) return 'weak'
  if (password.length >= 20 || (password.length >= 16 && kinds >= 3)) return 'strong'
  if (password.length >= 14 || kinds >= 3) return 'good'
  return 'fair'
}
