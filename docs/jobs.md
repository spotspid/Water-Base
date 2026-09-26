# Jobs

A job is a sale. It holds a price, a build sheet, a crew, and the parts that
will leave the shelf when the work is done. The Jobs page is the list of them,
from written up to installed to cancelled.

Quotes are not here. A quote is a price nobody has agreed to, so it lives on
the Quotes page until it is signed or marked sold.

Walked through on 2026-09-26 against the live app.

## Getting there

Jobs is in the top bar under Operations. Three addresses matter:

- `/jobs` shows every job except quotes.
- `/jobs?view=not-booked` shows sold jobs with no date, which is what the
  dashboard's "Sold, not booked" tile counts.
- `/jobs?view=attention` shows jobs missing something that affects the money or
  the paperwork, with the reason on each row. That is the "Needs attention"
  tile.

With a view on, a banner names it and offers "Show all jobs".

Opening a job adds `?job=...` to the address, so the link can be pasted to
somebody else. Slack messages and the dashboard both link that way. If the link
turns out to be a quote, the page sends you to the Quotes page instead of
saying the job is missing.

## The four figures at the top

| Figure | What it is |
|---|---|
| Gross profit | Price less parts less installer pay, added up for the jobs on screen. Jobs that cannot be costed are left out rather than counted as pure profit, and the note underneath says how many are settled and how many are still expected. |
| Contracted value | The sum of the prices, installed or not. **This is not revenue.** Profit and loss counts only installed work. |
| Parts | The ledger figure where a job has installed, the expected figure where it has not. |
| Installer pay | What the crew is owed or was paid on those jobs. Jobs with no payout recorded are left out, and the note underneath says how many. |

The figures follow the filters. Cancelled jobs stay in the list but never in
these totals, and a line under the table says how many were left out.

## Filters

- **Status:** All, Sold, Scheduled, Installed, Cancelled. Quoted is not offered,
  because quotes are not on this page.
- **Search:** customer name, address or invoice number.
- **Show test jobs:** appears only when a job is flagged as a test, with the
  count. Test jobs are hidden until you tick it.

Empty results say which filter emptied them: "Nothing matched that search" or
"No jobs with that status".

## The table

Nine columns, and every heading sorts. Click once for the interesting end of
that column, click again to reverse.

| Column | What it shows |
|---|---|
| Customer | Name, city underneath, and on a filtered view the reason the job is on the list. |
| Build sheet | The system sold. |
| Price | The sale price. |
| Parts | The deducted cost once installed, otherwise the expected cost, tagged so the two are never confused. A job whose parts list cannot name every item reads "Not costed yet" rather than a number. |
| Pay | The installer payout, or "Not set" where nobody has entered one. A payout of $0.00 is a decision; a blank is not read as one. |
| Gross profit | Price less parts less pay, or blank when the job is not costed. A job with no payout recorded reads "Pay not set" rather than showing a profit that assumes the crew worked for nothing. |
| Status | Sold, Scheduled, Installed, Cancelled. |
| Agreement | Where the customer agreement stands. |
| Key date | Installed on, Scheduled for, or Written up, whichever applies. |

Sorting rules worth knowing: a blank cell always sinks to the bottom, whichever
way the column points, so a job with no parts figure is never shown as the
cheapest. Status and Agreement sort by how far along they are, not
alphabetically.

## Opening a job

Click a row, or press Enter on it. The drawer holds, in order: the job's
details and an Edit button, the schedule line, Payments, Customer agreement,
Sales checklist (sold jobs only), Site conditions, Crew and pay, Work order,
earlier signed documents, Reminders, the parts the job will consume, and its
stock history.

The two sections that move a job are **Status** and **Crew, pay and invoice
number**.

### Status, and the buttons that move a job

**Sold:** pick a date and press Mark scheduled. That puts it on the calendar and
promises its parts. Or press Mark installed to record work already done.

**Scheduled:** Mark installed, or Back to sold, which clears the date, takes it
off the calendar and releases the parts.

**Installed:** a "Move back to" choice of Scheduled or Sold, then Reverse
install, which returns every deducted part to inventory.

**Any open job:** Cancel job, behind a confirm that says cancelling releases
every part the job promised.

**Cancelled:** it can be reopened.

## What each action says when it works

- **Mark installed:** "Marked installed. 6 items deducted, $1,712.16 of parts."
  If the sheet has no parts at all it says so instead of pretending.
- **Reverse install:** "Install reversed. 6 items were returned to inventory,
  and the job is now Scheduled with its parts promised again."
- **Back to sold:** "Back to sold. The date is cleared, the job is off the
  calendar, and any parts it had promised are back in available."
- **Cancel:** "Job cancelled. Every part it had promised is released and back in
  available. Nothing moved in the ledger, because a cancelled job never
  consumed anything."
- **Reopen:** "Job reopened as Sold. It has no date, so it promises no parts
  until it is scheduled."

## What blocks a save, word for word

**A pick the build sheet needs is missing.** Marking installed is refused and
nothing is half deducted:

> Nothing was deducted. These template lines have no matching inventory item for
> the choices on this job, finish "N/A", RO type "No RO" and valve type "none
> selected": customer_pick line for Valve.

Set the finish, RO type or valve type on the job and try again.

**The job is already installed:**

> This job was already installed on Aug 19, 2026 at 12:00 PM and its parts were
> already deducted. Reverse the install first if you need to redo it.

**Reversing a job that never installed:**

> This job has no deducted parts to reverse.

**Changing the parts list of an installed job:**

> This job installed on Aug 19, 2026 and its parts are already in the ledger,
> which is append only. Its parts list cannot be changed. Reverse the install
> first if the list was wrong, which returns the parts to inventory.

**Clearing the invoice number:**

> A job always has an invoice number. Type the number you want rather than
> clearing it.

**Emptying a field that already had something in it** (customer name, phone,
address, city, payment type, invoice number, deposit):

> The customer name cannot be emptied once set. Correct it rather than clearing
> it, or leave it as it was.

**Typing a status straight into the database**, which the app never does but a
script might:

> A job becomes installed through mark_job_installed() so its parts are deducted
> from inventory.

**An unanswered sales checklist** stops a sold job being given a date, a crew or
an install, and names the questions:

> This job cannot be given a date while the sales checklist still has a question
> marked Not sure yet: [the question]. Answer it on the job's sales checklist
> first.

## What happens after

- **Marking installed** takes the parts off the shelf at the cost stamped on
  each row, sets the install date, and moves the job into that month's Profit
  and loss. Its parts list is fixed from then on, and so are its crew and pay.
- **Scheduling** promises the parts for that day. They are still on the shelf,
  but no longer free for another job.
- **Cancelling** releases the promises and takes the job out of every total,
  while leaving it in the list.
- The list reloads after every action, so the figures at the top move with it.

## Things people try that do not work

**Editing pay after installing.** Crew and pay only show on open jobs. To
correct them, reverse the install, fix the pay, install again.

**Typing a date and expecting the job to be booked.** The date and the word go
together: Mark scheduled is what claims the parts.

**Finding a quote here.** Quotes are on their own page, and Quoted is not in the
status filter.

**Deleting a job.** There is no delete. Cancel is the way out, and it keeps the
record.

**Changing what an installed job consumed.** The stock history is append only.
Reverse the install first.

**Expecting Contracted value to match Profit and loss.** One is every contract
on the page, the other is installed work in a month.

**Reading Gross profit as final on a job that has not installed.** Until it
does, parts are today's expected costs, tagged as expected.

## Rough edges

Found while walking the page. These are faults or decisions, not instructions.

1. **Saving a new job as Installed can create a duplicate.** On the New job
   form the row is saved first and the install runs second. If the install is
   refused, the form stays filled with Save still active, and pressing it again
   writes a second job with the same revenue and reservations.

2. **Escape throws away edits even after you choose to keep them.** "Edit job
   details" opens inside the job drawer, and both listen for Escape, so one
   press closes both. Answering Cancel to "Close without saving?" does not save
   you.

3. **Closing the drawer discards unsaved crew, pay or site conditions with no
   warning.** Clicking outside it, or pressing Escape, is enough.

4. **Pay cannot be corrected after installing, and nothing warns you first.**
   Marking installed does not check that a payout was entered, so a job can be
   recorded with $0 pay and an overstated profit, and the only way back is to
   reverse the install.

5. **Fixed on 2026-09-26: missing pay counted as zero.** A job with no payout
   showed profit as though the crew worked for nothing. Pay now reads "Not
   set", and the job shows no profit figure until a payout is entered.

6. **Fixed on 2026-09-26: a part added without a cost counted as $0.** A part
   can now be saved with no cost at all, which is different from a cost of
   zero, and a job using one says its parts figure is a floor rather than
   showing a profit that is too high.

7. **Reverse install and Back to sold both run on one click.** They move stock
   and release parts. Cancel, right beside them, does ask first.

8. **The refusal for a missing pick is written for a developer.** It says
   "customer_pick line for Valve" and "template lines", when the fix is to
   choose a valve type on the job.

9. **The four figures at the top do not add up.** Contracted value and Parts
   include jobs that cannot be costed; Gross profit leaves them out. Price
   less parts less pay will not equal the profit shown.

10. **"Change the date on the schedule" is shown on installed and cancelled
    jobs**, where the schedule cannot help: it sends you back here.
