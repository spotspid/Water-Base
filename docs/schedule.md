# Schedule

Where the work sits in the week, who is doing it, and whether the parts for it
are free. A job appears here the moment it has a date, and the date is what
promises its parts.

Walked through on 2026-09-26 against the live app.

## Getting there

Schedule is in the top bar under Operations.

## The toolbar

- **Back and forward** step a week or a month, depending on the range showing.
- **Today** jumps back to now.
- **Week or Month** changes the range. Month shows the whole six row grid, so a
  job on the last day of the previous month is visible rather than hidden in a
  blank cell.
- **Calendar or List** changes the shape. The list shows unscheduled jobs first,
  then everything with a date.

## The calendar

Each day holds a card per job. A card shows the customer, the address and city,
the time window, the crew, the system, and a readiness badge.

The badge is about parts:

| Badge | What it means |
|---|---|
| Ready | Every part on the list is free for this job. |
| Short N | N units are promised beyond what the shelf holds. |
| No parts listed | The build sheet has no lines on it. |
| No parts list | The job has no build sheet at all. |
| A missing pick | The faucet finish, RO type or valve type has not been chosen, so a line cannot name a part. |

If the readiness check itself fails, a warning appears once at the top: the
dates and crews below are still correct, but no card can say whether its parts
are free. That is deliberate, because a card with no badge otherwise looks the
same as a card that passed.

**Unscheduled** sits beside the calendar: sold jobs with no date yet, waiting to
be dragged onto a day.

**Test jobs are left off the calendar entirely**, with no toggle to show them.

## Moving a job

Hold a card and drag it to another day. That moves the date **only**: the crew
stays as it is, because moving Thursday to Friday says nothing about who is
doing the work.

When it lands, the page says so: "Glen Hooker moved to October 5, 2026." If the
move leaves a part oversold it still moves, and says that too: "…moved to
October 5, 2026, but 1 part is already short. Open the job to see which."

**Installed and cancelled jobs cannot be dragged.** Their date is a record of
what happened, not a plan, and the card says so when you try.

## Opening a job

Click a card, or a day header to see that day in full, then a job from there.
The job window holds the date, the time window, the installer and the helper,
and a parts check for the chosen date.

The parts check runs when the window opens and again after saving. It lists any
part where the promises exceed the shelf, how many are short, and **which other
jobs are holding them**, with their dates. That is the part worth reading: it
names Samuelkutty Abraham on the 24th and Bruce Weislik on the 30th rather than
just saying salt is short.

## What blocks a save, word for word

**A time window that is not on the list:**

> There is no time window called "Morning". Pick one from the list or add it in
> Settings.

**The same person as installer and helper:**

> The installer and the helper cannot be the same person.

**An installer who is not on the roster:**

> That installer is not on the roster. Reload and pick again.

**An installer switched off in Settings:**

> [Name] is turned off on the roster, so they cannot be assigned new work. Turn
> them back on in Settings.

**An installed job:**

> This job is already installed, so its date is a record of what happened.
> Reverse the install before rescheduling it.

**A quote:**

> This job is still a quote. Mark it sold, or have the customer sign, before it
> can be scheduled or installed.

**A job with an unanswered sales checklist** is refused until every question has
a real answer rather than "Not sure yet", and the message names the questions.

**A window with no date** is caught on the form: "Pick a date before picking a
time window, or clear the window."

## What happens after

- **Giving a job a date** makes it Scheduled and promises its parts for that
  day. Nothing leaves the shelf.
- **Clearing the date** puts it back to Sold, takes it off the calendar and
  releases the promises. Checked today: the reservations went to zero.
- **Moving a job** keeps the promises and moves them with it.
- **The parts are consumed only when the job is marked installed**, which
  happens on the job, not here.

## Things people try that do not work

**Dragging an installed job to a new day.** Reverse the install first, on the
job.

**Dragging a quote onto the calendar.** Quotes have no date. Mark it sold first.

**Typing a time window of your own.** The list comes from Settings.

**Expecting a booking to take stock off the shelf.** It reserves; it does not
deduct.

**Expecting a short badge to stop a booking.** It will not. The board books the
job and tells you what is short, because the fix is usually to order a part
rather than to refuse the customer.

**Looking for a test job.** They are filtered out of this page.

## Rough edges

Found while walking the page. These are faults or decisions, not instructions.

1. **The Ready badge and the reservations can disagree.** The badge's shortage
   check reads the job's build sheet, while the parts actually promised come
   from the job's own parts list when it has one. A job listing its own parts
   can therefore show Ready while the dashboard counts it short.

2. **Moving a job out of the range on screen makes it vanish.** The page
   reloads only the dates in view, so dragging into next month, or saving a new
   date from the job window, removes the job from sight before the confirmation
   can be read.

3. **The job window opens on top of the day window.** One press of Escape closes
   both, and any unsaved date or crew goes with it.

4. **A short job books silently as far as the calendar is concerned.** The
   notice naming the shortage appears once, above the board, and is gone on the
   next action. Nothing on the card afterwards says the move caused it.

5. **The unscheduled rail only exists in Calendar view.** Switch to List and
   undated jobs are mixed in at the top instead, which is a different idea of
   the same thing.

6. **Nothing here shows the money.** A day with four installs gives no sense of
   the value or the payout involved, which is what a week's plan is usually
   judged on.

7. **Drag and drop is the only way to move a job on the board.** There is no
   keyboard equivalent, so the calendar cannot be worked without a pointer.
