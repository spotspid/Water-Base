import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const updates = [
  { from: 'steve@michiganwaterpros.com',    to: 'the.steve.j.burgess@gmail.com' },
  { from: 'david@michiganwaterpros.com',    to: 'davidcvolpe@gmail.com' },
  { from: 'cameron@michiganwaterpros.com',  to: 'grraeee@gmail.com' },
]

console.log('\nUpdating email addresses...\n')

for (const { from, to } of updates) {
  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) { console.error(`  ERROR listing users: ${listErr.message}`); continue }

  const user = users.find(u => u.email === from)
  if (!user) { console.log(`  SKIP  ${from} (not found)`); continue }

  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    email: to,
    email_confirm: true,
  })

  if (error) {
    console.error(`  ERROR ${from} -> ${to}: ${error.message}`)
  } else {
    console.log(`  OK    ${from} -> ${to}`)
  }
}

console.log('\nFinal email addresses:')
const { data: { users: final } } = await supabase.auth.admin.listUsers()
const targets = new Set(updates.map(u => u.to))
for (const u of final.filter(u => targets.has(u.email))) {
  console.log(`  ${u.email}  (confirmed: ${u.email_confirmed_at ? 'yes' : 'no'})`)
}
console.log()
