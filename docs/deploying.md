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

## It should not be manual, and now it is not

The app half has deployed itself on every push since the start, through Vercel.
The functions half never did, for no better reason than that nobody set it up.
That asymmetry is the whole failure: a push that changed a page was live in a
minute and a push that changed a customer's quote sat in the repo for eight
days, and both looked the same from here.

`.github/workflows/deploy-edge.yml` deploys any function whose code changed on
a push to master or the production branch, records what it sent, proves the
live copies match that commit, and commits the records back.

It needs two things set once, under Settings, Secrets and variables, Actions:

| | |
|---|---|
| `SUPABASE_ACCESS_TOKEN` (secret) | A token from the account that **owns** this project |
| `SUPABASE_PROJECT_REF` (variable) | `vztoleozeqlloaadppnt` |

Until both exist, the first push touching a function fails the workflow, which
is the intended behaviour: a red run is a fair description of "this change is
not live".

Deploying by hand still works and is still the way to ship something without a
push.

## Deploy by hand through the script

```bash
npm run deploy:edge send-agreement    # one function
npm run deploy:edge                   # all of them
```

It refuses a token that cannot see this project, deploys, then writes
`supabase/functions/<slug>/deployed.json`: the sha256 of every file it sent and
the version Supabase gave back. That record is what makes "is the live copy
this code" a question with an exact answer, and it is why deploys should not be
made with the bare CLI. One that is shows up as a version mismatch, which
check:deploy reports rather than silently trusting.

## Before trusting any 403

Run `npm run check:deploy` first. It answers, in order:

1. Is there a token at all?
2. Can that token see **this** project? If not, it says which projects it can
   see, which is the sentence that identifies a wrong-account token instantly.
3. For every function: are today's files the ones the last deploy recorded,
   and is the live version the one that record describes?

It exits non-zero on any of those, so it can sit in front of a deploy rather
than being something somebody remembers to run.

## Deploying

```bash
npm run deploy:edge send-agreement
npm run check:deploy
```

The second line is the point: it proves what is live is this code, rather than
assuming the command that printed no error did what it said.

`npm run check:deploy` also runs inside `npm run check`, so a function left
undeployed fails the same suite as a broken test rather than waiting for
somebody to notice on a customer's quote.

### Three ways it has been got wrong

The check has been written three times, and the first two were worse than
nothing:

1. **Looking for a line of each file in the deployed bundle.** Three files
   passed while eight days stale, because the line it picked had not changed.
2. **Comparing the deploy time to the last commit.** Two current functions
   failed, because deploying and then committing is the normal order and
   leaves the commit looking newer.
3. **Hashing the files at deploy time and comparing.** Exact, and what runs
   now.

A check that cries wolf gets ignored as surely as one that sleeps.

## The rule

**A document wording change is not done when it is merged. It is done when
`npm run check:deploy` says the deployed function matches the repo.**

If the deploy cannot be run, say so in the same message that reports the work
as finished, and say which customer-facing thing is still printing the old
way. Do not describe it as shipped.
