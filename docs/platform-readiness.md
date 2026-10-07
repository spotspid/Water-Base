# From one business to a hundred

Water Base works. One business runs on it every day, and most of what it does
it does carefully. This document is about the distance between that and a
product a hundred water filtration businesses run on without anybody here
touching their data.

Written 2026-10-07, from the code and the database as they stand that day.
Every number in it came from a query, and the queries are in the appendix so
the next person can disagree with the evidence rather than with the summary.

## The goal, and the two halves of it

**Water Base to 100% first, then standalone product infrastructure.**

Those are different work and the order matters. A fault that costs one
business an afternoon costs a hundred businesses a hundred afternoons, and
every one of them becomes a support conversation. Fixing the app while it has
one user and twenty-nine jobs is the cheapest it will ever be.

## The thing that must happen before business number two

**Every row-level security policy on every table is the same policy:**

```sql
(( SELECT auth.uid() AS uid) IS NOT NULL)
```

Twenty-five tables, RLS switched on for all of them, and the rule on every one
is "are you signed in". There is no organisation column anywhere in the
schema. Signed in, you see everything.

For one business that is correct and deliberate. For two it is a breach:
customers, addresses, prices, margins, installer pay and stock, all readable
across the line. Nothing else in this document matters until that is fixed,
and it gets more expensive with every row added, because the backfill grows
and the number of places that have to be right grows with it.

This is the single hard gate. **No second business touches this system until
tenancy is real.**

## What "runs without intervention" has to mean

In the week of 2026-09-30 to 2026-10-07, eight things were wrong with the live
data and all eight were fixed by hand-written SQL. That is the honest test of
the product, because at a hundred businesses the same week produces a hundred
times the hand-fixing, and there is nobody to do it.

| What went wrong | Fixed by | A user could do it today |
|---|---|---|
| Signed agreement with no job (Faizul, $899) | migration | **No** |
| Signed agreement with no job (Donna, $2,000) | migration | **No** |
| Signed agreement with no job (Daniel, $2,999) | migration | **No** |
| Price revised in a signed agreement, job kept the old one (Sam, $550) | migration | **No** |
| Job not linked to its GHL opportunity (Faizul, Donna) | migration | **No** |
| Parts note saying the opposite of the ledger (Prudhvi) | migration, plus a trigger change | **No** |
| Inventory logged against the wrong SKU (Prudhvi's carbon tank) | still open | **No** |
| Parts listed on a custom job (Donna) | migration | Yes, `JobPartsOverride` |
| Payment recorded (Glen) | SQL | Yes, `JobDepositForm` |

**Six of nine have no path except somebody writing SQL.** That table is the
functionality backlog. It is not a guess about what users might want; it is a
list of what actually happened in one week to one business.

Each one needs a screen:

1. **Create the job from a signed agreement.** The scan already finds these and
   the webhook already announces them within a second of the signature. What
   neither does is offer a button. Everything needed is in the document: name,
   address, phone, email, system description, price.
2. **Reconcile a price against its signed agreement.** DocuSeal returns field
   values as data, so the comparison is a read, not a guess. Sam Abraham's job
   carried $2,749 for three weeks while the signed document said $3,299.
3. **Link a job to a GHL opportunity**, and unlink it. The nightly
   reconciliation already names the mismatches; it cannot resolve them.
4. **Correct a note on a parts line.** Allowed as of 2026-10-07, in the
   database. There is still no screen for it.
5. **Adjust stock with a reason**, including moving a quantity from one SKU to
   another when the wrong one was named. Today the only honest path is an
   append-only ledger entry written by hand.
6. **Record and correct a payment** against a job, which exists, and have the
   rest of the app believe it, which is the open question below.

## Water Base to 100%

### The gap underneath all of it

There are 31 check scripts and every one of them checks code. Nothing checks
data. Every problem listed above was found by somebody running a query by
hand, not by the app noticing.

**This is the first thing to build**, and it is deliberately not clever. The
pattern already exists: `ghl_reconcile()` is a plain SQL function that returns
rows where two systems disagree, and the 3am message reads it. Everything
found by hand this week becomes another rule of exactly that kind:

- a signed agreement with no job
- a job whose price disagrees with its signed agreement
- a completed install still reading scheduled
- a job past its scheduled date with nothing recorded against it
- a sold job with no parts list, or with lines that do not resolve
- an item promised to more jobs than exist on the shelf
- a parts note contradicting the ledger
- a payment against no agreement, or an agreement with no payment after N days

Plain functions, run nightly, surfaced **in the app, per business**. A business
owner cannot read somebody else's notifications table, and will not be told
about their own data in a Slack they are not in.

### What the data says today

Run 2026-10-07, one business, twenty-nine jobs:

| | |
|---|---|
| Jobs past their scheduled date, still not installed | **5** |
| Sold, scheduled or installed jobs with no payment recorded | **20**, **$59,532** |
| Jobs with parts lines that do not resolve | **12** |
| Items promised beyond what is on the shelf | **5** |
| Jobs with no installer payout | 2 |
| Items with no unit cost | 0 |

The last row is worth noticing: it is item 1 of the known issues holding, a
year after it was the most expensive fault in the system. A check that stays
green is what done looks like.

### The question that has to be answered by a person

**Twenty jobs, $59,532 of sales, have no payment recorded.** One payment exists
in the entire system and it was entered on 2026-09-30.

Either Water Base is the record of what customers have paid, in which case
twenty jobs need reconciling and the habit has to change; or it is not, in
which case `balance_due`, `deposit_outstanding`, the outstanding balances
screen and the receipt generator are all presenting figures that mean nothing,
and they should be removed rather than left to be believed.

It cannot be both, and the answer changes what gets built. **This is the
largest open question in the system and it is a business decision, not an
engineering one.**

### The faults, in the order they cost money

From `known-issues.md`, which was re-checked on 2026-10-07: one of eighteen
fixed, one half fixed, one partly addressed, fifteen unchanged.

**First, because they corrupt money or stock**

| | |
|---|---|
| **2** Parts readiness computed two different ways | the number a van is loaded against |
| **5** Saving a new job as installed can duplicate it | duplicated revenue and double-promised stock, from a natural retry |
| **6** Pay cannot be corrected after installing | wrong profit on finished work, and the only fix moves stock |
| **7** Reverse install and Back to sold run on one click | one misclick moves the ledger |
| **8** Stock can go below zero on a warning alone | five items are oversold today and nothing is saying so |
| **4** A quote can be given an installer payout | margin against a sale that has not happened |

**Then, because they lose or hide work**

3 Escape closes both windows · 9 a job dragged out of range vanishes · 10 a
shortage is announced once · 12 "Out for signature" counts documents nobody
sent · 13 refusals written for a developer · 14 nothing shows which jobs hold a
part · 15 a reorder point cannot be changed

**Then the noise**

11 a blocked row that can never clear · 16 the scan still needs scrolling to
find · 17 value on hand priced at today's cost · 18 the five smaller ones

**Item 13 stops being cosmetic at a hundred businesses.** A refusal reading
"customer_pick line for Valve" is a shrug in-house and a support ticket from a
stranger. Every message a user can reach has to be written for them.

## Standalone product infrastructure

In dependency order. Each one is hard to retrofit after the next is built on
top of it.

### 1. Tenancy

An organisation on every table, policies scoped to the caller's membership, and
a membership table with roles. The backfill is small today and will not be
later.

It is not only the obvious tables. **The catalogue is global right now:**
`settings_options`, `system_templates`, `template_lines`, `inventory_items`,
`installer_rates` and `installers` are shared by everyone, because there has
only ever been one everyone. Every business has its own build sheets, its own
SKUs at its own landed costs, its own crew and its own pay rates. All of it
becomes per organisation, and a new business needs a starting catalogue it can
then change.

### 2. Credentials per business

The edge functions read `DOCUSEAL_API_KEY` and `GHL_API_KEY` from the
environment, one value each, because there is one account each. A hundred
businesses have a hundred DocuSeal accounts and a hundred GHL locations.

Those become encrypted rows resolved per request. The webhook changes shape
too: `DOCUSEAL_WEBHOOK_SECRET` is one secret verifying one sender, and it has
to become a lookup from whatever the incoming event identifies itself as,
without trusting the body to say who it is before the signature is checked.

### 3. Identity

"Michigan Water Pros" is in the navigation (`TopNav.jsx:70`), in the quote
email subject and body (`send-agreement/quote.ts:47` and `:64`), and in the
receipt generator.

The subtle one is `src/lib/docusealScan.js:20`:

```js
const COMPANY_EMAIL = /@michiganwaterpros\.com$/i
```

That is how the scan tells our own signature from the customer's. For anybody
else it matches nothing, and the scan quietly misreads every document rather
than failing in a way somebody would notice. **A single-tenant assumption that
fails loudly is a bug; one that fails silently is a trap.** This file is worth
reading for others of the same shape before tenancy lands.

### 4. Where messages go

`notify` posts to three fixed Slack channels in one workspace. Destinations
become per organisation, and email has to be an option, because not every
business runs on Slack.

### 5. Getting started

There is no way to create a business, invite a user, or seed a catalogue.
Today all three are a migration. They have to be a signup, and the first hour
in the product has to end with a business able to quote.

## What this is not

**No part of this depends on an AI reading the data.**

Every check described here is a SQL function or a script with a fixed rule,
run on a schedule, returning rows. `ghl_reconcile()` is the model: it is forty
lines of SQL, it is right every time, it costs nothing to run, and it does not
need anybody's API key or judgement. The invariant checks are to be built the
same way.

This matters beyond cost. A rule written in SQL can be read, argued with,
tested and proved by a migration that asserts its own result. That is how the
rest of this database already works, and the checks should not be the one part
of the system that cannot explain itself.

## The order

1. **Tenancy.** Before a second business exists. Everything else is cheaper
   after it and more expensive before it.
2. **The six missing correction paths.** The list is not speculative: it is
   what one week actually required.
3. **Data invariant checks, surfaced in the app.** So the next week's version
   of that list is found by the product rather than by a person.
4. **The six money-and-stock faults**, 2, 5, 6, 7, 8, 4.
5. **Per-business credentials, identity and message routing.**
6. **Onboarding.**
7. Everything else, reassessed. The order will have changed by then, because
   the checks in step 3 will have said which rules break most often.

**Features wait.** Used SKUs, customers as records, change orders in the app,
partial installs, photos, supplier part numbers: all real, none of them worth
starting before a business can be onboarded without somebody writing SQL.

One exception worth arguing about: **customers as records** is structural
rather than cosmetic, and retrofitting it once a hundred businesses hold data
is far worse than doing it while one does. It belongs with tenancy or not for
a long time.

## Appendix: the queries behind the numbers

Policies, showing the rule is the same everywhere:

```sql
select tablename, policyname, cmd, qual::text
from pg_policies where schemaname = 'public';
```

The state of the data on 2026-10-07:

```sql
-- jobs past their scheduled date, not installed            -> 5
select customer_name, scheduled_date from jobs
where status = 'scheduled' and scheduled_date < current_date and not is_test;

-- sold work with no payment recorded                       -> 20, $59,532
select count(*), sum(sale_price) from jobs j
where not is_test and status in ('sold','scheduled','installed')
  and not exists (select 1 from job_deposits d where d.job_id = j.id);

-- jobs whose parts lines do not resolve                    -> 12
select customer_name, unresolved_lines from job_margin
where not is_test and unresolved_lines > 0
  and status not in ('cancelled','installed');

-- items promised beyond the shelf                          -> 5
select i.sku,
       coalesce((select sum(r.quantity) from job_reservations r
                 where r.item_id = i.id and r.released_at is null), 0)
     - coalesce((select sum(t.quantity) from inventory_transactions t
                 where t.item_id = i.id), 0) as short
from inventory_items i where i.active;
```

Secrets the functions expect, one value each:

```
APP_URL  DOCUSEAL_API_KEY  DOCUSEAL_WEBHOOK_SECRET  GHL_API_KEY
SUPABASE_URL  SUPABASE_ANON_KEY  SUPABASE_SERVICE_ROLE_KEY
```
