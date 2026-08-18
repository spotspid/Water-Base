import { createClient } from '@supabase/supabase-js'

// Sets an existing user's password with the service role key.
// Usage:
//   node --env-file=.env.local scripts/set-password.js <email> <new-password>
//
// The password is read from argv and never written to this file or logged.
// Note that argv is visible in shell history and to other processes on this
// machine, so prefer the Supabase dashboard for anything shared.

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const [email, password] = process.argv.slice(2)

if (!email || !password) {
  console.error('Usage: node --env-file=.env.local scripts/set-password.js <email> <new-password>')
  process.exit(1)
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserByEmail(target) {
  const perPage = 200
  const wanted = target.toLowerCase()

  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listing users failed: ${error.message}`)

    const match = data.users.find(u => (u.email || '').toLowerCase() === wanted)
    if (match) return match
    if (data.users.length < perPage) return null
  }
}

const user = await findUserByEmail(email)

if (!user) {
  console.error(`\n  ERROR no user found with email ${email}\n`)
  process.exit(1)
}

const { error } = await supabase.auth.admin.updateUserById(user.id, {
  password,
  email_confirm: true,
})

if (error) {
  console.error(`\n  ERROR ${user.email}: ${error.message}\n`)
  process.exit(1)
}

console.log(`\n  OK    password updated for ${user.email}`)
console.log('  The new password is not printed or stored by this script.\n')
