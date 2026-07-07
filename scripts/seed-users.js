import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
  return Array.from(randomBytes(16))
    .map(b => chars[b % chars.length])
    .join('')
}

const users = [
  'steve@michiganwaterpros.com',
  'david@michiganwaterpros.com',
  'cameron@michiganwaterpros.com',
]

console.log('\nCreating users...\n')

const results = []

for (const email of users) {
  const password = generatePassword()
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    if (error.message.includes('already been registered')) {
      console.log(`  SKIP  ${email} (already exists)`)
    } else {
      console.error(`  ERROR ${email}: ${error.message}`)
    }
  } else {
    results.push({ email, password })
    console.log(`  OK    ${email}`)
  }
}

if (results.length > 0) {
  console.log('\n--- Temporary credentials (copy now, not stored anywhere) ---\n')
  for (const { email, password } of results) {
    console.log(`  ${email}`)
    console.log(`  Password: ${password}\n`)
  }
  console.log('-------------------------------------------------------------')
  console.log('Users can change their password after first login.\n')
}
