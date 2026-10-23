# The rebuild, and the question asked of every change

Water Base was built for one business and it shows. Not in the obvious places
but in the small ones: a regular expression that recognises our own staff by
`@michiganwaterpros.com`, a payment list that was right until somebody wanted
Zelle, a service area seeded with sixteen cities that turned out to be a
guess. None of those were mistakes at the time. All of them are mistakes now
that the target is a hundred water businesses rather than one.

So the rebuild has one standing rule, and it is a question rather than a
principle.

## The fleet test

**Before any change: does this work for a fleet, or only for Michigan Water
Pros?**

It is asked out loud, every time, including on changes that look too small to
deserve it. The small ones are where single-tenant assumptions hide, because
nobody stops to think about a regular expression.

Three answers, and the third is the one people forget:

1. **It already works for a fleet.** Carry on.
2. **It needs to flex.** The thing being hardcoded is really a setting, and it
   belongs in a table keyed on the organisation so each business owns its own.
3. **It needs a guardrail.** The thing being made flexible should not be. More
   choice here makes a worse product, and the right move is to decide once, on
   everybody's behalf, and refuse the rest.

Three is the one that gets missed, because flexibility feels generous and
constraint feels rude. It is usually backwards. A dealer who can invent their
own job statuses will invent eleven of them, and then no report in the product
can say anything true about any of them. A dealer who cannot change the
statuses has one fewer decision to make on a Tuesday and a product that can
answer questions.

### How to tell which

Ask what breaks when a hundred businesses each answer differently.

**If the answer is "nothing, they just differ"** it is a setting. Prices, system
names, what to call a part, who the suppliers are, which cities they serve,
how the business is named on a document. A hundred different answers here cost
nothing because nothing is computed across them.

**If the answer is "the product can no longer say anything"** it is a
guardrail. Job statuses, what counts as sold, what an install means, the
shape of the ledger, how a document is sent. A hundred different answers here
mean a hundred different products, no shared reports, no shared support, and
every bug report starting from scratch.

**If the answer is "somebody gets hurt"** it is a guardrail with a refusal
attached, and the refusal says why in words the dealer can act on. Stock going
negative is allowed on purpose. A job installing twice is not.

### Worked examples from this codebase

| | Which | Why |
|---|---|---|
| System presets and prices | Setting | Every dealer sells different kit at different prices, and nothing is computed across them |
| Payment types | Setting | The list was fixed and wrong within three weeks of one business using it |
| Supplier names and part codes | Setting | What one supplier calls a part is not what another calls it |
| Which company a document comes from | Setting | It is hardcoded today, and `docusealScan.js` identifies our own staff by email domain, which silently misreads every document for anybody else |
| Job statuses | Guardrail | Five, fixed. Every list, filter, report and check in the product depends on them meaning the same thing everywhere |
| What marking a job installed does | Guardrail | It is the moment revenue is recognised. A dealer redefining it redefines their own books |
| Append only ledger | Guardrail | The whole costing model rests on a stamped cost never moving |
| Parts resolving to stock | Guardrail, removed | Making it a precondition of finishing a job hid $21,842 for three weeks. Parts are text now and gate nothing |

## Decisions already made

These are settled unless somebody reopens them deliberately.

**The rebuild lives in a schema beside the live one.** `v2`, in the same
database, renamed over `public` at cutover. Nothing in it may reference
`public`, which `check:v2` enforces in CI.

**Every table carries `org_id` from the day it is created.** Policies check
membership, not whether somebody is signed in. Adding tenancy later means
revisiting every row to decide who owns it, on a live system.

**Nothing may block a core verb.** Saving a job, scheduling it and marking it
installed must work whatever else is unknown. This is the rule the old system
broke, and the one most likely to be broken again by accident, because every
individual guard that does it looks sensible on its own.

**Only a name is required to save a quote.** A form that refuses to keep what
somebody actually knows sends them to do the work somewhere else. On
2026-10-10 that is exactly what happened and a $3,399 sale went through
DocuSeal without Water Base hearing about it.

**A price nobody set is not a price of zero.** The same rule as an unknown
installer payout not being free labour. Blanks stay blank and say so.

## Decisions still open

**Navigation: left sidebar or top bar.**

Every comparable product, Jobber, Housecall Pro, ServiceTitan, Booking Koala,
uses a left sidebar. A dealer evaluating this spends ten seconds deciding
whether it looks like the category they already know. A sidebar also scales:
the top bar holds about seven items before it crowds, and there are fourteen
today. It can collapse to icons on the two width-hungry pages, the schedule
and the job list.

Against: a sidebar costs about 240px on a 1280px laptop, on every page,
forever. And the people using it today know the top bar.

Mobile is not part of this. Both collapse to a drawer.

Not decided. The quoting page currently uses the existing `AppShell`, which is
the top bar, and that is inheritance rather than a choice.

**What the dashboard is for.** Unanswered, and it decides whether it is the
first page built or the last.

**Whether expenses and the profit and loss come back at all**, or whether a
dealer's accounting lives in the accounting software they already pay for.

## How a decision gets recorded

In this file, in the table or the list above, with the reason rather than just
the ruling. A decision without its reason gets re-litigated every time
somebody new reads the code, and the second argument is always worse than the
first because the context is gone.
