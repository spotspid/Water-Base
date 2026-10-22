import { createClient } from '@supabase/supabase-js'

// The client for the rebuild.
//
// A second client bound to the v2 schema, rather than a schema argument on
// every call. Two reasons, and the second is the important one:
//
//   1. A call that forgets to say which schema it means reads public, which is
//      the live system. A separate client cannot forget.
//   2. The old pages and the new pages then share no code path at all. Nothing
//      I write for the rebuild can break a page a business is using today,
//      because there is no line of code between them.
//
// Same URL, same key, same signed in user. Only the schema differs, so David
// is already logged in to both and nothing about auth changes at cutover.
//
// At cutover v2 is renamed over public. This file is then deleted and the new
// pages move to the ordinary client, which is a find and replace rather than a
// migration.
//
// Until the schema is added to Exposed schemas in the Supabase dashboard,
// every call through here fails with a message about the schema not existing.
// That is the expected state before setup, not a bug in a page.

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseV2 = createClient(url, anonKey, {
  db: { schema: 'v2' },
  // The old client owns the session. Two clients both trying to refresh the
  // same token race each other and one of them loses, which logs the user out
  // of a page they are in the middle of using.
  auth: { persistSession: false, autoRefreshToken: false },
})

// The session, taken from the client that owns it.
//
// Called before a v2 read so the request carries the signed in user and the
// policies can see who is asking. Without it every row is filtered out by row
// level security and the page renders as though the business has no jobs,
// which reads as data loss rather than as a missing token.
export async function adoptSession(supabase) {
  const { data, error } = await supabase.auth.getSession()

  if (error || !data?.session) return false

  await supabaseV2.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })

  return true
}
