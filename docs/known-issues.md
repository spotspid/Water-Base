# Known issues

Everything the page guides found, in one list, ordered by what it costs rather
than by how annoying it is. The numbering is left alone so a fault keeps the
number it was reported under.

The order is roughly: money that comes out wrong, then work that gets lost,
then work that gets blocked or misdirected, then noise.

Collected 2026-09-26 from the Quotes, Jobs, Inventory, Documents and Schedule
guides. Each entry says where it shows, so a fix can be checked in every place
it appears rather than only in the one where it was noticed.

**Re-checked 2026-10-07**, against the code and the database rather than
against this file's own claims. Of the eighteen:

| | |
|---|---|
| Fixed | **1** |
| Half fixed | **3** |
| Partly addressed from another direction | **16** |
| Unchanged | the other fifteen |

Nothing has regressed. The two fixes this file already claimed both hold up
under checking, and item 16 improved by a route nobody planned: the deploy
work of 2026-09-30 added a push, which is a different fix to the one the entry
asks for. Each of the three says below what was checked and what proves it.

A second section, **What exists and what does not**, audits twelve features
people keep asking after. It is on the end rather than mixed in here, because
a thing that was never built is not a fault.

## Faults that show on more than one page

These are one fault each, seen from several places. Fixing the cause fixes all
the symptoms; fixing one page leaves the others lying.

### 1. Unknown is counted as zero, so profit reads high. FIXED 2026-09-26

**Still fixed on 2026-10-07.** `job_margin` carries `pay_known`,
`uncosted_parts_lines` and `profit_basis`, and `src/lib/jobColumns.js` reads
all three, so the page can still tell a blank from a zero.

**Where it was:** Jobs (gross profit, and the figures at the top), Inventory
(unit cost and value), and through job margins into Profit and loss.

A job with no installer payout was costed as though the crew worked for
nothing. A part added without a unit cost was priced at zero, so every job
using it showed a profit that was too high, and nothing warned about either. A
$300 tank entered without a cost was $300 of invented profit per job.

**What it does now.** A part can be saved with no cost at all, which is not the
same as a cost of zero. The two control valves are genuinely free, because the
valve is already inside the landed cost of the system it arrives in, and they
still cost zero. Everything built on either blank now says so rather than
counting it as nothing:

- A job with no payout shows "Not set" where the pay goes and "Pay not set"
  where the profit would be. Four booked jobs were showing an expected profit
  that assumed a free crew, $8,584 of it, and now show none.
- A job using a part nobody has priced reads "at least this much" for parts and
  shows no profit figure.
- Value on hand leaves unpriced parts out and says how many, rather than
  valuing them at nothing.
- The installer pay totals on Jobs and on Profit and loss leave out the jobs
  with no payout and name the count.
- The warranty bill does the same for a replacement deducted before anybody
  priced the part.

Nothing that was already right moved: the five installed jobs and both months
of the profit and loss read exactly as before.

### 2. The same question answered two different ways

**Where:** Schedule against the dashboard, Quotes against Needs attention,
Inventory against its own lists and the dashboard, Documents against the
dashboard, and the Jobs summary against itself.

Each of these is one label computed twice:

- **Parts readiness.** The Schedule's Ready badge reads the job's build sheet,
  while the parts actually promised come from the job's own parts list when it
  has one. A job can read Ready on the board and short on the dashboard. This
  is the costly one: it is the number somebody loads a van against.
- **What counts as a test job.** Quotes hides a job only when it carries the
  test flag; the Needs attention rule also treats any name containing "test" or
  "ZZ" as one. A test typed in without the flag counts as real revenue.
- **Needs reordering.** The Inventory card counts inactive parts and parts at
  zero with a zero threshold; the list beneath it does not. The card can read
  14 over a list of 2.
- **Short.** Inventory counts any part with negative availability including
  inactive ones; the dashboard counts only active parts promised to a job. One
  can say "Short 3" while the other says parts are clear.
- **Paperwork counts.** The Documents cards count the whole book; the dashboard
  counts what somebody is sitting on. Neither is wrong and they never match.
- **The four figures on Jobs.** Contracted value and Parts include jobs that
  cannot be costed, while Gross profit leaves them out, so price less parts less
  pay does not equal the profit shown.

**Harm:** two screens disagree, so people stop trusting both, and the one case
that matters (readiness) can put a crew on the road without parts.

### 3. Closing something throws away what was typed in it. HALF FIXED

**Where:** Jobs (the job drawer and the Edit job form inside it), Schedule (the
job window on top of the day window).

Windows stack, and both listen for Escape, so one press closes both. On Jobs
the confirm even asks "Close without saving?" and answering Cancel does not
save you, because the outer window has already gone.

**Half fixed on 2026-09-27.** Clicking beside the job drawer, the edit form or
the schedule's job window no longer closes them: a click outside is how you
finish typing in a box, and it was closing the drawer and landing the reader
on the jobs list. Escape still closes both windows at once, which is the half
that remains.

**Checked again 2026-10-07, and that is still exactly the split.** The
backdrop guard is real: `Modal.jsx` takes `dismissOnBackdrop` and the surfaces
holding work pass it false. The Escape half is untouched. Every modal adds its
own `keydown` listener on `document` (`src/components/Modal.jsx:18`) and
nothing tracks which one is on top, so one press still reaches all of them.
The fix is a stack: only the topmost modal should answer Escape.

**Harm:** typed work disappears with no error and no way to get it back.

### 4. Panels and links appear in states where they cannot work

**Where:** Quotes (crew and pay, the work order panel, the schedule link),
Jobs (the schedule link on installed and cancelled jobs), Documents (quotes
listed as documents).

A quote shows a Crew, pay and invoice number section, which is also the only
place a quote can be given a payout, counting against the margin of a sale that
has not happened. It shows a work order panel that can never send and does not
say why. Both Quotes and Jobs offer "Change the date on the schedule" where the
schedule will refuse the job. Documents lists a quote's agreement beside real
jobs' paperwork.

**Harm:** time spent on controls that cannot work, and one of them can put a
payout on something that is not a sale.

## Faults on a single page

### 5. Saving a new job as Installed can create a duplicate

**Where:** New job, reached from Jobs.

The row is saved first and the install runs second. If the install is refused,
the form stays filled in with Save still active, so pressing it again writes a
second job carrying the same revenue and the same reservations.

**Harm:** duplicated revenue and double-promised stock, from a natural retry.

### 6. Pay cannot be corrected after installing, and nothing warns first

**Where:** Jobs.

Crew and pay show only on open jobs, and marking installed does not check that
a payout exists. A job can be recorded at $0 pay with an overstated profit, and
the only way back is to reverse the install, which moves stock.

**Harm:** wrong profit on finished work, and an expensive correction.

### 7. Reverse install and Back to sold run on one click

**Where:** Jobs.

Both move stock or release promised parts. Cancel, the button beside them, does
ask first.

**Harm:** one misclick moves the ledger.

### 8. Stock can go below zero on a warning alone

**Where:** Inventory.

The form says what the count will be and warns, but nothing stops the save, and
afterwards nothing on the page flags a negative count except the availability
bar.

**Harm:** a wrong count that nobody is told about again.

### 9. Moving a job out of the visible range makes it vanish

**Where:** Schedule.

The page reloads only the dates on screen, so dragging a job into next month,
or saving a new date in the job window, removes it from sight before the
confirmation can be read.

**Harm:** it looks like the job was lost, and the confirming message is gone.

### 10. A shortage is announced once and then forgotten

**Where:** Schedule.

Moving a job that leaves a part oversold still succeeds, and says so in a
notice above the board that disappears on the next action. Nothing on the card
afterwards says the move caused it.

**Harm:** the shortage is real and the only mention of it is gone.

### 11. A blocked document row that can never clear

**Where:** Documents.

The owner's own house has no customer email and never will, so its customer
agreement sits in "Cannot send yet" for good. There is no way to dismiss a row
or mark it not needed.

**Harm:** permanent noise in the list that is supposed to be a to-do list.

### 12. "Out for signature" counts documents nobody has sent

**Where:** Documents, and the same count on the dashboard.

A document with nothing blocking it is counted as out before anyone presses
Send. Today's single row in that section says "Not sent" while sitting under
"Out for signature".

**Harm:** the paperwork backlog looks smaller than it is.

### 13. Refusals written for a developer

**Where:** Jobs (the missing pick message), Documents (DocuSeal failures).

The install refusal says "customer_pick line for Valve" and "template lines"
when the fix is to choose a valve type on the job. A DocuSeal failure can
arrive in DocuSeal's own words, and a template problem lists the template's
field names on screen.

**Harm:** the reader is sent looking in the wrong place, or to somebody else.

### 14. Nothing shows which jobs are holding a part

**Where:** Inventory.

The Promised column gives a number with no way to see which jobs hold it.
Finding out means opening jobs one at a time. The Schedule's parts check does
name the competing jobs, which shows the shape the Inventory page is missing.

**Harm:** slow, and it makes a shortage hard to resolve.

### 15. A reorder point cannot be changed once the part exists

**Where:** Inventory.

It is set on the Add item form and can only be changed in the database
afterwards.

**Harm:** the reorder signal drifts out of date and cannot be corrected.

### 16. The DocuSeal gap scan is only found by scrolling. PARTLY ADDRESSED

**Where:** Documents.

Nothing on the dashboard says gaps exist, so the panel that finds signed
customers with no job is found only by somebody who already knows it is there.
That fault is how eight signed agreements went unnoticed for a month.

**Harm:** the check exists but nobody is prompted to run it.

**Partly addressed 2026-09-30, by a different route.** The entry asks for the
dashboard to advertise the scan. That has not been done: `DocumentsGaps` is
still reachable only by scrolling the Documents page, and `Dashboard.jsx` does
not mention it.

What changed instead is that the gap now comes to you. `docuseal-webhook`
announces any completed or declined document matching no job in Water Base, to
the new_sale channel, within a second of the signature. The waiting check is
still only found by somebody who knows it is there; the waiting is no longer
how a gap gets noticed.

It proved itself on 2026-10-03, on the first real case after it shipped:

    2026-10-03 21:40:23 | docuseal.unmatched | sent
    A document was signed in DocuSeal that matches no job in Water Base.
    daniel.olmstead.5@us.af.mil, submission 11543590.

Signed at 21:40:22, announced at 21:40:23, about five hours before the nightly
reconciliation would have said the same thing. It is still worth doing what
this entry actually asks, because the push only covers signatures arriving
from now on. Anything already sitting unmatched is found only by the scan.

### 17. Value on hand is priced at today's cost

**Where:** Inventory.

It is a valuation at current prices, which will not match what the ledger says
those units cost when they arrived.

**Harm:** a stock figure that cannot be reconciled with what was paid.

### 18. Smaller things

- **The Quotes list has no total**, while the dashboard tile totals the same
  quotes.
- **The unscheduled rail exists only in Calendar view**; the List view mixes
  undated jobs in at the top instead.
- **The Schedule shows no money at all**, so a week cannot be judged by value
  or payout.
- **Drag is the only way to move a job on the board**, with no keyboard
  equivalent.
- **Test jobs are hidden on Documents and Schedule with no toggle**, unlike
  Jobs and Quotes, which offer one.

## Decisions rather than faults

These are not bugs. Somebody has to say what the app should do.

- **A quote can be given a deposit payment.** The Payments panel accepts money
  against a price nobody has agreed to.
- **The DocuSeal scan cannot see prices.** A hand written agreement keeps its
  price as printed text, so creating a missing job still needs a person to read
  the document.
- **Stock below zero is allowed on purpose**, so a miscount can be recorded
  rather than argued with. Item 8 is about it happening unnoticed, not about
  the permission itself.

## About the data, not the app

- **The Quotes page has never been seen working.** One quote exists, named
  "Steve", $2,999, never sent, so nobody has seen a list of quotes out with
  ages against them. It also looks like somebody's own test and neither test
  rule catches it.

# What exists and what does not

Twelve features people keep asking after, checked 2026-10-07 against the code
and the database. A thing that was never built is not a fault, which is why
this is a section of its own rather than more numbered entries.

Each verdict names the file or table that proves it, so the next person can
disagree with the evidence rather than with the summary.

## Built

**No RO option on the RO type.** `settings_options.ro_type` holds Tank Style,
Tankless and No RO. Migration `20260922160003_no_ro`. A job that takes no
drinking water unit can say so, rather than leaving the field blank and
looking unanswered.

**"Not sure yet" on the checklist questions.** `src/lib/salesChecklist.js`
defines `NOT_SURE`, and `20260922165527_not_sure_blocks_scheduling` stops a job
carrying one from taking a date, a crew or an install. The answer means the
question was asked and nobody in the house knew, which is different from
nobody having asked.

**Address optional on a quote.** `src/lib/newJobForm.js` no longer demands one
before Quoted, and `send-agreement`'s `openWhenBlank` hands the empty box to
the customer as a required field at signing. `docuseal-webhook` writes what
they type back, but only onto a job that has none. Shipped 2026-09-30.

**Old equipment removal upcharge.** `src/components/SalesChecklistFields.jsx`
carries `old_equipment_upcharge`, and clears it when the removal answer stops
being yes, so a stale number cannot survive a changed answer.

**Timed snooze on a job.** `jobs.nag_snoozed_until`, set through the
`snooze_job_nag` function and shown by `JobNagPause.jsx`. A job can be taken
out of the 8am message until a date without being taken out of the book.

## Partly built

**Change orders.** Water Base can read one: `src/lib/docusealScan.js`
recognises "service agreement change order" when scanning DocuSeal. One has
been handled, by hand, in `20260916050000_install_prudhvi_yalavarthi.sql`.
There is no table and no screen, so a change order cannot be raised in the
app, and the parts it moves are moved by a migration somebody writes.

**GHL notes sync.** `ghl-sync` in `lookup` mode returns a contact's notes
along with their messages and appointments. It is read only and nothing is
stored: the notes are visible to whoever runs the lookup and are not on the
job, not searchable, and not written back to GHL.

## Not built

**Partial install.** Supplier orders understand a part delivery
(`src/lib/orderState.js`), jobs do not. The install function refuses on
purpose, in its own words: "a partial deduction is worse than none"
(`20260819000100_job_install_functions.sql`). A job that went in half way has
to be recorded as installed or not at all.

**Photos.** No storage bucket, no column, no upload. Install photos are
referred to in job notes as something somebody has elsewhere.

**Customers as records.** There is no customers table. Name, phone, email and
address are columns on `jobs`, repeated per job, so the same person on two
jobs is two unconnected rows. Daniel Olmstead carries three email addresses
across Water Base, GHL and DocuSeal with nothing tying them together.

**Used SKUs.** `inventory_items` has `sku`, `category` and `variant` and no
condition, so a used tank cannot be told from a new one. Donna Burgess's
2026-09-30 job is the live example: used equipment on the Custom sheet at
$2,000, reserving nothing and costing nothing, so its margin is not a figure
anybody should rely on.

**Multiple supplier part numbers per item.** Nothing anywhere holds a
supplier's own code for a part. `supplier_order_lines` points at `item_id`,
so a part that two suppliers call two different things is reconciled by
whoever is reading the invoice.
