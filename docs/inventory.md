# Inventory

What is on the shelf, what is promised to booked jobs, and what is on order.

The number on hand is never typed in. It is the sum of every movement ever
logged for that part, so a new item starts at zero and gets its count from a
logged purchase. That is also why stock can be corrected but never rewritten.

Walked through on 2026-09-26 against the live app.

## Getting there

Inventory is in the top bar under Stock. The dashboard's shortage panel links
here too.

## The six figures at the top

They follow the category filter, so filtering to Faucet gives the figures for
faucets only.

| Figure | What it is |
|---|---|
| Value on hand | On hand multiplied by unit cost, added up. |
| Items | How many parts are in the list. |
| Promised to booked jobs | Units set aside for scheduled jobs that have not installed. Still on the shelf, not free to sell. |
| Needs reordering | Parts at or below their reorder point. |
| Short | Parts where more is promised than is on the shelf. This is not the same as needing a reorder: short means a promise the shelf cannot keep. |
| On order | Units bought and not arrived. |

Under the figures, **At the reorder point** lists the parts worth buying, with
the same category filter applied.

## The table

One row per part, sorted by category then name. Click any row for its history.

| Column | What it shows |
|---|---|
| Part | Name, then SKU and variant underneath. An inactive part says so. |
| Category | Softener, RO, Faucet, Valve, Media, Consumable and so on. |
| Available | A bar: what is free once promises are taken off. |
| On hand | The ledger total, with a "Reorder" tag when it is at or below the reorder point. |
| Promised | Units held for booked jobs. |
| On order | Units on a supplier order, with the earliest expected date. |
| Unit cost | What one costs today. |
| Value | On hand at that cost. |

## Adding a part

**+ Add item** asks for SKU, name, category, variant, unit cost, reorder
threshold, active, and notes.

- **SKU, name and category are required.** Leave one out and you get "SKU is
  required.", "Name is required." or "Category is required."
- **Unit cost** must be zero or more: "Unit cost must be zero or greater."
- **Reorder threshold** must be a whole number: "Reorder threshold must be a
  whole number, zero or greater."
- **A SKU already in use** is refused by name: `SKU "SALT-40" already exists.
  Pick a different SKU.`

A new part starts at zero on hand whatever you type elsewhere, because stock
comes from movements.

## Logging a movement

**Log a movement** is how stock changes by hand. It asks for the part, the type
of movement, a quantity, and optionally a reference and a note.

The types come from Settings, and each one knows which way it moves stock:

| Type | Direction |
|---|---|
| Purchase | in |
| Return | in |
| Install | out |
| Damage | out |
| Warranty replacement | out, and must name the job the failed part went in on |
| Adjustment | either, so the form asks add or remove |

What it refuses, before anything is written:

- "Pick an item."
- "Pick a transaction type."
- "Quantity must be greater than zero."
- "Quantity must be a whole number."
- "This transaction would not change stock."
- "Pick the job the failed part was installed on. A warranty replacement is
  always traced to its install."

The form shows what the count will be afterwards, and warns when a movement
would take a part below zero. **It does not stop you.** The database allows a
negative count, because a shelf that has been counted wrong is a real thing and
refusing to record it would leave the app and the shelf disagreeing with no way
to say so.

## Changing a unit cost

Open a part and edit its cost there. Saving says what it did: "Saved. 4 on hand
now values at $30.72.", or if nothing is on hand, "Saved. Nothing is on hand, so
this takes effect when some arrives."

Changing the cost does **not** rewrite history. Every movement keeps the cost it
was logged at, which is why an installed job's parts cost never moves again.

## The history of a part

Clicking a row opens its movements, newest first, with a running balance beside
each so you can see what the count was after every step. The columns are date,
type, quantity, balance, unit cost at the time, reference and note. The unit
cost editor sits at the top of the same window.

The job a movement belongs to is **not** shown here. An install logged against
a job carries that job's invoice number in the reference, which is the only
hint. To see what a job consumed, open the job instead.

## What cannot be changed, and what happens if you try

**The ledger is append only.** There is no edit and no delete on a movement,
anywhere in the app. At the database level a signed-in user's attempt to change
or remove one silently matches no rows, and anything with more privilege is
refused outright:

> The inventory ledger is append only. A movement is corrected by logging
> another one, never by changing or removing a row.

**To correct a mistake, log the opposite movement.** An adjustment in the other
direction, with a note saying why, leaves both the error and the correction on
the record.

**A part that has ever moved cannot be deleted.** The database refuses because
its history points at it, and the app shows "Another record still points at
this one, so it cannot be removed." Switch it to inactive instead: it stops
appearing on new build sheets and keeps its history.

**An installed job's parts cannot be edited.** That is the same rule seen from
the other side, and it is why reversing an install is how a wrong parts list
gets fixed.

## What moves stock, and when

| Action | Effect |
|---|---|
| Booking a job | Promises parts. Nothing leaves the shelf. |
| Marking a job installed | Writes install movements at the cost stamped on each row. On hand falls. |
| Reversing an install | Writes return movements. On hand rises again. |
| Cancelling a job | Releases the promises. The shelf does not move. |
| Receiving a supplier order | Writes purchase movements, and updates the part's unit cost to what was actually paid. |

## Things people try that do not work

**Typing a new on hand count.** There is no such box. Log an adjustment and the
count follows.

**Editing a movement that was logged wrong.** Log the opposite one. The history
is meant to show that a mistake happened.

**Deleting a part to tidy the list.** Make it inactive.

**Expecting available to match on hand.** Available is on hand minus what booked
jobs have promised.

**Expecting a booked job to have taken stock already.** It has not. Only
installing moves the ledger.

**Reading "Short" as "needs reordering".** Short means more is promised than
exists. Needs reordering is a threshold warning, and a part can be one without
the other.

## Rough edges

Found while walking the page. These are faults or decisions, not instructions.

1. **"Needs reordering" counts more than the list beneath it shows.** The figure
   counts every row at or below its reorder point, including inactive parts and
   any part sitting at zero with a threshold of zero. The "At the reorder point"
   list under it leaves those out, so the card can read 14 while the list shows
   2.

2. **"Short" can disagree with the dashboard.** This page counts any part with
   negative availability, including inactive ones. The dashboard only counts
   active parts actually promised to a job, so Inventory can say "Short 3" while
   the dashboard says parts are clear.

3. **A new part defaults to a unit cost of zero, and a zero cost counts as
   known.** A $300 tank added without a cost prices every job that uses it $300
   too high in gross profit, with no warning anywhere. The two control valves
   are deliberately zero, which makes a real mistake harder to spot.

4. **A part can go below zero on hand with only a warning.** Useful for honesty,
   dangerous by accident: nothing afterwards flags a negative count on this page
   except the availability bar.

5. **Nothing here shows what a part is promised to.** The Promised column gives
   a number with no way to see which jobs hold it. Finding that out means
   opening jobs one at a time.

6. **A reorder point cannot be changed after the part is added.** It is set on
   the Add item form and there is no way to edit it afterwards, short of the
   database. Hovering the "Reorder" tag tells you what the number is, described
   as one job's worth.

7. **Value on hand uses today's cost, not what was paid.** It is a valuation at
   current prices, which will not match what the ledger says those units cost
   when they arrived.
