# New job

One form, three possible endings: a quote nobody has agreed to, a sale with no
date, or a job that installed and took its parts off the shelf. Which one you
get is decided by the Status box near the bottom, and everything else on the
page follows from it.

Written on 2026-09-26 from the form and the settings behind it. Unlike the
other guides this one was not clicked through signed in, so the wording quoted
here is the wording in the app rather than wording read off a screen.

## Getting there

**New job** on the Jobs page, **New quote** on the Quotes page, and the
dashboard's Write a job. All three open the same form at `/jobs/new`. New quote
is not a different page: it is this page with the status left on Quoted.

## What it opens with

The first active build sheet is already chosen, with its preset price and a
deposit of thirty percent of that price. Today that means Flagship Bundle,
$2,999.00 and $899.70. Nothing has been saved, but a form that is submitted
without touching the System section will save that.

The build sheets on offer today:

| Build sheet | Preset price | Parts on it |
|---|---|---|
| Flagship Bundle | $2,999.00 | 6 |
| Well Water Bundle | $3,799.00 | 6 |
| Softener Only | $2,999.00 | 3 |
| RO Only | $1,200.00 | 3 |
| Custom | none | none, so nothing is deducted |

## Customer

| Field | What it does |
|---|---|
| Customer name | Required. |
| Phone | Required. |
| Email | Optional to save, required to send anything. Without it the customer agreement sits in "Cannot send yet" on the Documents page for good. |
| Address | Required. |
| City | Required, and typed rather than picked. Settings supplies suggestions as you type: Brighton, Commerce Township, Novi, Troy and White Lake today. Anything else is allowed, which is how Redford Township and Sterling Heights got in. |
| Water source | City or Well. City is the default. |

## Sales checklist

**Only on a quote.** The moment the status is anything other than Quoted the
two checklist sections disappear, because by then the answers belong to the
job and are edited in its drawer.

Ten questions in the order they get asked in a house, split into sizing and
site: people in home, bathrooms, main shutoff location, space confirmed,
receptacle within 6 feet, drain distance in feet, main line size, main line
material, irrigation lines, removing old equipment.

Three rules worth knowing:

- **A blank is allowed and goes amber.** It means nobody asked. Saving is
  never blocked by a blank, because a quote goes out with gaps all the time.
- **"Not sure yet" is not a blank.** It means the question was asked and
  nobody in the house knew. On a quote it clears the amber. It comes back the
  moment the job is sold, and it blocks a date and a crew: see the refusal
  below.
- **The counts must be whole numbers.** People in home, bathrooms and drain
  distance are checked on save.

Faucet finish, RO type and payment type are part of the same conversation but
live in the System section below, so each answer has one home.

## System

| Field | What it does |
|---|---|
| Build sheet | Which parts list the job takes. Choosing one overwrites the price with its preset, and the deposit with thirty percent of that, unless the deposit has been typed in. |
| Sale price ($) | Required. Zero or more. |
| Deposit ($) | Required, and it starts filled. It follows the price at thirty percent until somebody types in the box, and then it is theirs and later price changes leave it alone. A button beside it offers "Use 30 percent" with the amount. Enter 0 for a sale with no deposit. |
| Faucet finish | Chrome, Brushed Nickel, Matte Black, Oil-Rubbed Bronze, Brushed Gold. Decides which faucet the sheet consumes. |
| RO type | Tank Style, Tankless, or No RO. |
| Valve type | Clack or Hankscraft, or left unchosen. Optional here, because an RO only job has no control valve. A sheet with a valve line will not install until one is picked. |
| Payment type | Cash, Check, Credit Card, Financing, Affirm, Zelle, ACH, Wire, Advance (financing). |

**Picking No RO is one choice, not two.** It sets the faucet finish to N/A in
the same keystroke and locks the box, because a job with no RO has no RO
faucet. Choosing an RO type again clears N/A back to blank so a real finish
has to be picked.

Under the section, the **parts preview** resolves the chosen sheet against
those three picks and lists what will be deducted, with a line saying at least
this much where a part has no cost recorded. A line it cannot name, usually
because the valve is unchosen, is shown as missing rather than left out.

## Job details

| Field | What it does |
|---|---|
| Status | Quoted, Sold, Scheduled or Installed. Quoted is the default. Choosing Installed adds a hint: "Saving will deduct the parts list above." |
| Invoice number | Optional. Left blank, the next MWP number is given when the job is saved. |
| Scheduled date | The day it is promised. Hidden on a quote. |
| Time window | Hidden on a quote, and only usable once there is a date. |
| Installer, Helper | Picked from the roster, not typed. Hidden on a quote. |
| Install date | The day it actually happened. Hidden on a quote. |
| Installer pay ($) | Optional, and left blank it reads as not set rather than as a payout of nothing. Hidden on a quote. |
| Site conditions | Access, stairs, a dog, where the shutoff is. Printed on the work order. |
| Notes | For the office. Never leaves the building. |

**Hidden is not cleared.** Filling in a crew and a payout and then switching
the status back to Quoted hides those boxes but still saves what is in them.

The **installer rate card** at the bottom is a reference list of what the
install side of a job costs, closed by default. It sets nothing.

## The buttons

| Button | What it does |
|---|---|
| Cancel | Back to the jobs list. Nothing is saved and nothing is asked. |
| Save quote | Saves and sends nothing. This is also what the Enter key does, on purpose: a keystroke must never email a customer. |
| Save and send quote | Saves, then emails the quote through DocuSeal. Only available while the status is Quoted, and the page says so underneath when it is off. |

## What blocks a save, word for word

The form checks as it goes and stops at the first problem, so a form with two
things wrong shows the first one until it is fixed.

**The required fields:**

> Customer name is required.

> Phone is required.

> Address is required.

> Enter a city.

> Pick a build sheet.

**An email that cannot be one:**

> That email address does not look right.

**Sending without an email, or from the wrong status:**

> A quote is sent by email, so the customer email is required.

> Only a quote can be sent. Set the status to Quoted, or use Save quote.

**A sold, scheduled or installed job missing a pick.** A quote is let through
without them, because the finish is often not decided at the kitchen table:

> Pick a payment type.

> Pick a faucet finish.

> Pick an RO type.

**The two RO picks disagreeing:**

> A job with no RO has no faucet. Its faucet finish is N/A.

> Faucet finish N/A is only for a job with no RO. Pick a finish, or set the RO type to No RO.

**The money:**

> Sale price must be zero or greater.

> Enter the deposit, or 0 if this sale takes no deposit.

> The deposit must be zero or more.

> The deposit is more than the sale price.

> Installer pay must be zero or greater.

**The crew:**

> The installer and the helper cannot be the same person.

**A quote carrying a date:**

> A quote has no scheduled or install date. Clear the date, or mark it sold.

**A window with no date:**

> Pick a scheduled date before picking a time window, or clear the window.

**A build sheet that vanished while the form was open, on an installed job:**

> That build sheet is no longer available, so parts cannot be deducted. Reload and pick another.

**A checklist count that is not a whole number**, named for the question:

> People in home must be a whole number, zero or more.

**An upcharge on a job that is not removing old equipment:**

> An upcharge is only for removing old equipment. Answer yes, or clear the amount.

Past the form, the database has the last word. The one that turns up here is
the checklist:

> This job cannot be given a date, marked scheduled while the sales checklist still has a question marked Not sure yet: Space confirmed for the unit. Answer it on the job's sales checklist first.

## What happens after

- **Saved as Quoted** goes to the Quotes page. Nothing is promised and no
  parts move.
- **Saved as Sold** goes to the Jobs list. Still no parts.
- **Saved as Scheduled** goes to the Jobs list, and the date promises its
  parts for that day. Nothing leaves the shelf.
- **Saved as Installed** is saved as Scheduled first and then installed, which
  is the only path that deducts stock. The message names what came off, for
  example "Marked installed. 6 items deducted, $1,712.16 of parts."
- **Save and send quote** saves, sends, and lands on the Quotes page with the
  new quote open.

If the send fails, the job is still saved:

> The quote was saved but not sent. [what DocuSeal said] Open it from the jobs list to send it.

If the install fails, the job is still saved, one step short:

> [what the refusal said] The job was saved as Scheduled. Fix the problem, then install it from the jobs list.

An invoice number is on the job either way, whether it was typed or given.

## Things people try that do not work

**Saving a quote with a date on it.** A quote is a price, not a booking. Mark
it sold first.

**Sending a quote to a customer with no email.** Nothing goes anywhere.
Everything else about the job saves.

**Picking a faucet finish for a No RO job.** The box locks on N/A.

**Expecting Installed to skip the parts.** It cannot. The deduction is the
whole point of that status, and a sheet that cannot name every part refuses.

**Typing a city that is not on the list.** Allowed. The list is suggestions.

**Pressing Enter to send.** Enter saves. Sending is a button you press on
purpose.

## Rough edges

Found while reading the page. These are faults or decisions, not instructions.

1. **A failed install can leave two jobs.** Saving as Installed writes the row
   first and installs it second. If the install is refused, the form is still
   filled in with Save still active, and pressing it again writes a second job
   with the same price and the same reservations.

2. **Cancel throws the form away with no question.** A long form filled in at
   a kitchen table is one misclick from gone, and there is no draft anywhere.

3. **A quote can carry a crew and a payout invisibly.** The scheduling fields
   are hidden on a quote but not cleared, so a form filled in as Sold and then
   switched back to Quoted saves an installer and a payout that nothing on the
   quote shows. Those figures then count against the job's margin.

4. **The build sheet and the price are already filled in.** A form saved
   without touching the System section is a Flagship Bundle at $2,999 that
   nobody chose, and there is nothing on the page to say the choice was made
   for you.

5. **A sale price of zero saves without a word.** Useful once, for the owner's
   own house, and indistinguishable from a price somebody forgot to type.

6. **The checklist refusal only arrives on save**, and it is worded by the
   database rather than by the page: it names the questions, but it turns up
   after the form is filled in rather than beside the answer that causes it.

7. **The email field explains itself in the wrong place.** It says "needed to
   send an agreement" while a job with no email saves happily and then sits in
   "Cannot send yet" on the Documents page, where nobody is looking.
