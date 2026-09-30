# Deploying, and the trap that cost eight days

Water Base ships in **two halves that deploy separately**. Forgetting that is
how a change can be finished, merged, correct in the database, and still not
be what a customer sees.

| Half | What is in it | How it ships |
|---|---|---|
| The app and the database | Pages, forms, tables, views, triggers, functions | Pushed to the branch, plus migrations applied to the project |
| The edge functions | `send-agreement`, `ghl-sync`, `docuseal-webhook`, `notify` | A separate deploy, per function |

Anything a customer reads on a quote, a customer agreement or a work order is
built by `send-agreement`. **A change to the wording of those documents is not
live until that function is deployed**, no matter how green the checks are.

## What happened on 2026-09-30

David reported for the second time that quotes still printed the short build
sheet name, "Filtration Only", instead of the long descriptive one.

Everything in Water Base was correct. The long names were written on every
sheet, and each job carried its composed long name. What printed the document
was `send-agreement` **version 36, deployed 17 September**, which reads
`system_template` and has never heard of a long name.

Five finished pieces of work were sitting behind that one deploy:

- Long system names on quotes, agreements and work orders
- Drain run and main line material on work orders
- The Not sure yet wording removal
- A quote sending with a blank address
- Carbon type reaching the documents

## The trap

Every deploy attempt from 22 September onwards failed with:

> Your account does not have the necessary privileges to access this endpoint.

That message was read as "this token lacks permission to deploy functions",
and reported that way for eight days. It was wrong. The token on the machine
**belongs to a different Supabase account**. It can see Launch Control,
Performance Pulse and Workhorse Water. It cannot see the Water Base project at
all, so every project-scoped call fails the same way.

Two things hid it:

1. **The error names a privilege, not an account.** A token with no access to a
   project gives the same 403 as a token with the wrong role on the right one.
2. **The database kept working.** Migrations, triggers and views are applied
   through the MCP connection, which does have access. Only the edge function
   deploys failed, which made "functions are restricted" believable.

**The check that would have found it on day one** is one call, listing what the
token can actually see:

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects | grep -o '"id":"[^"]*"'
```

If `vztoleozeqlloaadppnt` is not in that list, the token is for the wrong
account and no amount of extra permissions on it will help.

## Before trusting any 403

Run `npm run check:deploy` first. It answers, in order:

1. Is there a token at all?
2. Can that token see **this** project? If not, it says which projects it can
   see, which is the sentence that identifies a wrong-account token instantly.
3. Is the deployed `send-agreement` the same as the one in this repo, file by
   file?

It exits non-zero on any of those, so it can sit in front of a deploy rather
than being something somebody remembers to run.

## Deploying

```bash
npm run check:deploy
npx supabase functions deploy send-agreement --project-ref vztoleozeqlloaadppnt
npm run check:deploy
```

The second run is the point: it proves what is live matches the repo, rather
than assuming the command that printed no error did what it said.

`scripts/deploy-function.js` does the same thing from disk and refuses to
deploy to a project other than the one `.env.local` points at, because a
deploy that lands somewhere else reads as success and is worse than a failure.

## The rule

**A document wording change is not done when it is merged. It is done when
`npm run check:deploy` says the deployed function matches the repo.**

If the deploy cannot be run, say so in the same message that reports the work
as finished, and say which customer-facing thing is still printing the old
way. Do not describe it as shipped.
