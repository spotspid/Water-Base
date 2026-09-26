# Quotes

A quote is a price a customer has not agreed to yet. It is not a sale, so it
holds no parts, sits on no calendar, and counts toward no revenue or profit.
The Quotes page is the list of them.

Walked through on 2026-09-26 against the live app.

## Getting there

Quotes is its own page in the top bar, under Operations. The dashboard's
quotes tile links here too.

Slack reminders about an unsigned quote link to the Jobs page. That is fine:
the Jobs page notices the link is a quote and sends you straight here, with the
quote open.

Two addresses matter:

- `/quotes` shows every quote.
- `/quotes?view=out` shows only quotes that have been **sent** and are not signed.
  This is what the dashboard tile counts, so the tile's number and this list
  are always the same jobs. When this filter is on, the page says so and offers
  "Show every quote".

## What the list shows

Newest first, one row per quote.

| Column | What it is |
|---|---|
| Customer | Name, with the city underneath. If there is no city it says "City not set". |
| Build sheet | The system being quoted. |
| Price | The quoted price. |
| Agreement | Where the paperwork stands: Not sent, Awaiting signature, Opened, Signed, Declined, Expired or Send failed. Underneath, how long ago the quote went out ("sent today", "sent 4 days ago"). |
| Written up | The day the quote was created. |

Under the table: a reminder that none of this counts as revenue or gross
profit.

**Show test quotes.** If any quote is flagged as a test, a checkbox appears
with the count. Test quotes are hidden until you tick it.

**Nothing to show.** With no quotes at all the page says "No quotes yet". With
the sent filter on and nothing out, it says "No quotes are out", and explains
that every quote has either been signed or has not been sent.

## Writing a new quote

The **New quote** button at the top right goes to the New job form. That form
is a separate page with its own guide, and it is where the customer, address,
system, price and the sales checklist answers are entered.

## Opening a quote

Click any row, or press Enter on it. The job drawer opens, the same drawer as
on the Jobs page. The address bar gains `?job=...`, so the link can be pasted
to someone else and it will open on that quote.

If a quote has since been sold or cancelled, opening an old link says: **"That
quote is not here any more. It may have been sold, cancelled or removed. Sold
and booked work is on the jobs page."**

### What is in the drawer, for a quote

**Status.** Says "Quoted", and explains: a quote promises no parts and counts
toward no revenue. It becomes sold when the customer signs, or you can mark it
sold here if they closed on the phone.

Two buttons: **Mark sold** and **Cancel job**.

**Edit job details.** Customer, address, city, phone, email, system, price,
deposit, payment type, invoice number and notes.

**Payments.** Deposits can be recorded against a quote, though normally nothing
has been paid yet. The deposit *term* is what the quote email mentions.

**Customer agreement.** This is where the quote goes out. See below.

**Sales checklist.** The questions asked in the house. On a quote these can all
be answered, including "Not sure yet", which is a real answer at this stage.

**Site conditions.** Notes for the crew, printed on the work order later.

**Crew, pay and invoice number.** Present on a quote, though nobody should need
it yet. See Rough edges.

**Work order.** Present but cannot be sent on a quote. See Rough edges.

**Reminders.** Pause the chasing for this quote for a set number of days.

**Parts to deduct** and the **stock history** are shown for reference. Nothing
is reserved or deducted while the job is a quote.

## Sending the quote

In the Customer agreement section, press **Send quote**. It asks to confirm:
"This emails [customer] the quote with the agreement to sign. Send it?" Press
"Yes, send it".

What the customer gets is the installation agreement itself, sent by DocuSeal,
with the quote written into the email:

> Subject: Your Michigan Water Pros quote: [system]
>
> Hi [first name],
>
> Here is your quote for the [system].
>
> What is included:
> - [each part on the build sheet]
>
> Price: $X
> Deposit due at signing: $Y (or "No deposit is due at signing.")
>
> To go ahead, review and sign the agreement:
> [signing link]

Signing that agreement **is** accepting the quote.

After sending, the panel says "Quote sent [date and time]", and the list shows
"sent today". Send it again and the button reads **Resend quote**; the panel
then counts the sends.

### What stops the quote going out

The button is greyed out when the job has no customer email, or when the
agreement has already been signed.

If something goes wrong after you press send, the message says what:

- **"A quote needs the customer email. Add it to the job first."**
- **"This job is not a quote any more, so there is no quote to send. Send the agreement instead."** Somebody marked it sold, or it was signed, while you had the drawer open.
- **"This job has no customer email, so there is nowhere to send the agreement. Add one to the job first."**
- **"Customer Install Agreement is turned off. Turn it on in Settings first."**
- **"Customer Install Agreement has no DocuSeal template id. Paste one on the Settings page first."**
- **"DocuSeal rejected the API key. Check DOCUSEAL_API_KEY."** Not something you can fix; send it to whoever maintains the app.

If the email went but the app could not record it, the message says so and
tells you **not** to resend, because the customer already has it.

## What happens after it is signed

The customer signs in DocuSeal. Without anyone touching the app:

1. The quote becomes **Sold**, dated at the moment of signature.
2. It disappears from the Quotes page and appears on the Jobs page.
3. The agreement shows as Signed, and the signed document is on the job.

If they agree on the phone instead, press **Mark sold** in the drawer. The
message reads: **"Marked sold. The quote is now a sale dated today."**

Either way it is a sale from that point: it can be given a date, a crew and an
install.

## Reminders

A quote that has been sent and not signed is chased in Slack on the mornings it
is **2, 5 and 10 days old**, and then never again. After ten days it appears on
the dashboard's Needs attention list as "Quote unsigned N days".

Pausing reminders on the quote stops those, and test quotes are never chased.

## Things people try that do not work

**Giving a quote a date.** Refused: **"A quote cannot have a scheduled date. Mark it sold first."**

**Marking a quote scheduled or installed.** Refused: **"This job is still a quote. Mark it sold, or have the customer sign, before it can be scheduled or installed."** The same message comes back from the schedule page.

**Finding a quote on the Jobs page.** Quotes are not there. That page is sold
and booked work. Likewise a sold job is no longer on the Quotes page.

**Resending after signing.** The send button is gone once the agreement is
signed, and the panel says signed agreements are not resent from here. Start a
new one in DocuSeal if the contract genuinely changed.

**Sending a work order.** It will refuse until the job is sold, has a crew, a
payout, a date, a build sheet with parts on it, and an invoice number.

**Expecting the quote to reserve stock.** It does not. Parts are promised only
when a sold job is given a date, and they leave the shelf only when it is
marked installed. Two quotes for the last tank in stock will both quote it.

**Expecting quotes in the P&L.** They are in neither revenue nor profit,
anywhere, until the job is installed.

## Rough edges

Found while walking the page. These are faults or decisions, not instructions.

1. **"Show test quotes" and the Needs attention list disagree about what a test is.** This page hides a quote only when it carries the test flag. The dashboard's Needs attention rule also treats any name containing "test" or "ZZ" as a test. Today there is a quote called "ZZ Test - Sept 17 quote" that is **not** flagged, so it shows here as a real quote, with its $3,799 in the tile. Either flag it, or make both places use the same rule.

2. **A quote shows a "Crew, pay and invoice number" section.** Nothing on a quote needs a crew, and saving one does nothing useful until it is sold. It is also the one place a quote can be given a payout, which then counts against the margin of a sale that has not happened.

3. **A quote shows a Work order section that can never send.** It sits there listing everything missing. On a quote the answer is always "it is not a sale yet", which the panel does not say.

4. **The drawer says "Change the date on the schedule" on a quote**, and links there, but the schedule refuses quotes. The link should not be shown until the job is sold.

5. **The Quotes list has no total.** A column of prices with nothing adding them up, when the dashboard tile does total them. Anyone comparing the two has to add the column by hand.

6. **A quote can be given a deposit payment.** The Payments panel accepts money against a price nobody has agreed to. Probably harmless, possibly wrong, and worth a decision rather than an accident.

7. **Both quotes on the system today have never been sent**, so the page has never been seen in its normal working state: a list of quotes out with ages against them. Worth sending one real quote before relying on this page.
