# Documents

Every customer agreement and work order in the business, in one list, with the
state each one is in and a way to send the ones that can go.

Two documents belong to a job: the **customer agreement**, which the customer
signs, and the **work order**, which the installer signs. A job waiting on both
is two rows here, because it is two pieces of paper and two things to do.

Walked through on 2026-09-26 against the live app.

## Getting there

Documents is in the top bar under Operations. The dashboard's paperwork panel
links here.

## The four cards

| Card | What it counts |
|---|---|
| Cannot send yet | Documents waiting on the job, not on a person. |
| Out for signature | Sent and not signed back. |
| Signed | Done and on file. |
| Documents | The total, across all jobs. |

These count **documents, not jobs**. Today the page reads 36 documents: 12
cannot be sent, 1 is out, 23 are signed.

Test jobs are left out of this page entirely, and there is no toggle to show
them.

## The tabs

All, Cannot send, Out for signature, Signed. They filter the sections below.

## Cannot send yet, grouped by what is in the way

This section comes first on purpose. A document nobody can send is not waiting
on a person, it is waiting on the job, and that work is invisible everywhere
else. Rows are grouped by the reason, biggest group first, so the backlog reads
as three problems rather than twelve.

Today it groups as 8 waiting on a date, 3 waiting on a crew, and 1 with no
customer email.

**A work order is checked in this order,** and the first thing missing is the
one you are told about:

| Missing | What it says |
|---|---|
| A date | "This job has no date yet, so there is nothing to schedule a crew around." |
| A crew | "No installer is assigned, so there is nobody to send it to." |
| A crew email | "[Installer] has no email address on the roster. Add one in Settings." |
| A build sheet | "This job has no build sheet, so there is no parts list to put on the work order." |
| Parts on that sheet | "The [sheet] sheet has no parts on it, so the work order would tell the installer to bring nothing. Put its parts on the sheet first." |
| A payout | "This job has no installer payout, so the pay on the work order would be blank. Enter the payout on this job first." |
| A job number | "This job has no invoice number, and the work order document requires one. Add it on the job first." |

**A customer agreement has one rule:** "This job has no customer email, so there
is nobody to send the agreement to."

A cancelled job's unsent documents sit here too, with "This job is cancelled."

## Each row

- **The customer name is a link** to the job, so a row that says "waiting on a
  crew" leads straight to where you fix it.
- **The document and the installer** are under the name.
- **The reason** is printed on the row whenever the send button is dead, not
  hidden in a tooltip, because these rows are read on tablets where there is no
  hover.
- **A coloured pill** gives the state: Not sent, Sent unsigned, Signed,
  Declined or Send failed.
- **When it was sent**, for anything out: "Sent today", "Sent 4 days ago".
- **How close the install is**: "Today", "Tomorrow", "In 5 days", "2 days
  overdue", or "No date". Overdue is red, within two days is amber.
- **A Send or Resend button**, dead when the document is blocked. A signed
  document has no button; it reads "On file".

## Sending from here

Press Send. The page says which document went where: "Work order sent to
jay.awoodward@gmail.com."

If it fails, the reason is shown in full rather than a generic failure, and the
list reloads anyway, because a failed send is recorded against the job and
leaving the old state on screen would hide it. The messages come from the
sending function itself, for example:

> This job has no customer email, so there is nowhere to send the agreement.
> Add one to the job first.

> [Installer] has no payout on this job, so the agreed pay on the work order
> would be blank. Enter the payout on the job and send it again.

> Customer Install Agreement is turned off. Turn it on in Settings first.

A resend sends a second document. It does not replace the first, and the copy
already with somebody still shows the values it had when it went.

## Signed in DocuSeal, missing here

At the bottom of the page is a panel that answers a different question: not
"where is each of our documents" but "what has DocuSeal got that we have not".

Press **Scan DocuSeal**. It reads the whole DocuSeal account, signed and
archived included, compares it with this app, and reports two lists:

- **Signed, with no job here.** Somebody signed and the job was never written
  up, so it holds no parts, is on no schedule and counts in no forecast.
- **Signed, job here, document not linked.** The job exists and its signed
  document is not attached, so the job reads as unsigned and keeps being
  chased.

Each row shows the signer, the document title, the date signed, and, where a
work order title carries one, the scheduled day.

It is **read only**. It links nothing and creates nothing, on purpose: what to
do about a gap is a decision. It also runs only when asked, because every scan
reads the entire DocuSeal account.

Crew paperwork, a W9 or a subcontractor agreement, is left out. It is signed,
real, and will never belong to a job.

## Things people try that do not work

**Resending a signed document.** There is no button. A signed agreement is the
end of the story. If the contract genuinely changed, start a new one in
DocuSeal.

**Sending a work order before the job is booked.** A date comes first, then a
crew, then a payout.

**Fixing the blockage from this page.** The reasons are printed here, but the
job is where you fix them. That is what the name link is for.

**Finding a test job.** They are filtered out of this page with no way to show
them.

**Linking a signed DocuSeal document from the scan panel.** It reports; it does
not link. Linking is a change somebody has to ask for.

## Rough edges

Found while walking the page. These are faults or decisions, not instructions.

1. **"Out for signature" includes documents that were never sent.** A document
   with nothing blocking it counts as out even before anyone presses Send. The
   single row in that section today is exactly this case: the quote named
   "Steve" has a customer agreement that says "Not sent" while sitting under
   "Out for signature". The count on the card is wrong in the same way.

2. **Quotes appear here as documents.** A quote is not a sale, but its customer
   agreement shows on this page like any job's. That is how "Steve" is in the
   list at all.

3. **A blocked row that can never clear stays forever.** The owner's own house
   has no customer email and never will, so its customer agreement sits in
   "Cannot send yet" permanently. Nothing lets you dismiss a row or mark it not
   needed.

4. **The cards count documents, the dashboard counts something slightly
   different.** The dashboard's paperwork line counts what somebody is sitting
   on; this page counts the whole book. Two different numbers about paperwork,
   neither wrong, easy to read as a disagreement.

5. **Failure text can be raw.** Most messages are written for a person, but a
   DocuSeal refusal can arrive as its own wording, and a template problem lists
   the template's field names on screen.

6. **The DocuSeal scan is not linked from anywhere else.** Nothing on the
   dashboard says gaps exist, so the panel is only found by somebody who
   already knows to scroll to the bottom of this page.

7. **The scan cannot see prices.** It reports which signed documents are
   missing from the app, but a hand written agreement keeps its price as printed
   text, so creating the missing job still needs somebody to read the document.
