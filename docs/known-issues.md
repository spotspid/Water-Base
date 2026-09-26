# Known issues

Everything the page guides found, in one list, ordered by what it costs rather
than by how annoying it is. Item 1 is fixed. Nothing else on this list is, and
the numbering is left alone so a fault keeps the number it was reported under.

The order is roughly: money that comes out wrong, then work that gets lost,
then work that gets blocked or misdirected, then noise.

Collected 2026-09-26 from the Quotes, Jobs, Inventory, Documents and Schedule
guides. Each entry says where it shows, so a fix can be checked in every place
it appears rather than only in the one where it was noticed.

## Faults that show on more than one page

These are one fault each, seen from several places. Fixing the cause fixes all
the symptoms; fixing one page leaves the others lying.

### 1. Unknown is counted as zero, so profit reads high. Fixed 2026-09-26

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

### 3. Closing something throws away what was typed in it

**Where:** Jobs (the job drawer and the Edit job form inside it), Schedule (the
job window on top of the day window).

Windows stack, and both listen for Escape, so one press closes both. On Jobs
the confirm even asks "Close without saving?" and answering Cancel does not
save you, because the outer window has already gone. Clicking outside the job
drawer discards unsaved crew, pay or site conditions with no question at all.

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

### 16. The DocuSeal gap scan is only found by scrolling

**Where:** Documents.

Nothing on the dashboard says gaps exist, so the panel that finds signed
customers with no job is found only by somebody who already knows it is there.
That fault is how eight signed agreements went unnoticed for a month.

**Harm:** the check exists but nobody is prompted to run it.

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
