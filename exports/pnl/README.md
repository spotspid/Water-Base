# Profit and loss

A monthly profit and loss page: revenue, cost of sales, gross profit, expenses
by category, and net profit, over a chosen range of months. React on the front,
Supabase (Postgres) behind.

Lifted from Water Base with everything specific to that business taken out.
There, revenue came from installed jobs and cost from an inventory ledger and
installer pay. Here, both come from one plain `sales` table.

## What to connect

**1. The database.** Run `schema.sql` once, in the Supabase SQL editor or with
`psql`. It is safe to run again. It creates:

| Object | What it is |
|---|---|
| `sales` | One row per sale: `sale_date`, `amount`, `cost`. **You fill this.** |
| `expenses` | Overheads and one-offs, each with a category |
| `expense_import_batches` | Groups expenses that arrived from one file, so a bad import reverses as a unit |
| `pnl_expense_categories` | View: expenses by month and category |
| `pnl_monthly` | View: revenue, cost of sales, expenses, gross and net profit by month |

`cost` on a sale is what that sale cost you to deliver: goods, subcontracted
labour, anything you would not have spent without it. Rent, software and ads
are overheads. They go in `expenses`.

If your sales already live in another table, don't copy them. Drop the `sales`
table and create a view named `sales` that has the same three columns over
your own data:

```sql
create view public.sales as
select order_date as sale_date, total as amount, cogs as cost
from public.orders
where status = 'complete';
```

**2. The environment.** The page reads two variables at build time:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
```

**3. The dependencies.** `react` and `react-dom` 18 or later, and
`@supabase/supabase-js` 2. Vite is assumed for `import.meta.env`. Any bundler
that supports it will do.

**4. The route.** Mount `src/pages/PnL.jsx` wherever you want it. It is a
default export that takes no props.

**5. A signed-in user.** Row level security is on, and every table lets any
signed-in user read and write. The views run as the caller, so they see only
what those policies allow. Tighten the policies at the bottom of `schema.sql`
if not everyone who can sign in should see the books.

## What is in here

```
schema.sql                     tables, views, row level security
src/pages/PnL.jsx              the page
src/pages/PnL.css              its styles
src/styles/base.css            design tokens, tiles, table, fields, buttons
src/components/AppShell.jsx    a minimal page frame (heading and content)
src/components/StatGrid.jsx    the row of summary tiles
src/components/PnlCategories.jsx   expenses by category and month
src/components/EmptyState.jsx  empty and error states (+ .css)
src/lib/supabase.js            the client
src/lib/errors.js              turns database errors into sentences
src/lib/expenses.js            money and month formatting, amount parsing
src/lib/profit.js              the words "Gross profit" and "Net profit"
src/lib/useFitColumns.js       sizes the tile grid to the width (+ grid.js)
```

## What changed from the original

- **Revenue and cost come from `sales`**, not from jobs, an inventory ledger
  and installer pay. "Parts" and "Installer pay" became one "Cost of sales"
  column, and "Jobs" became "Sales".
- **The cash panel is gone.** It showed payments received against money
  still owed on installed jobs. That needs a payments table this export
  doesn't have.
- **`AppShell.jsx` is a stand-in.** The original drew the whole Water Base top
  bar, with its navigation, settings and account menu. This one keeps the same
  props and draws only a heading. Replace it with your own layout.
- **`errors.js` lost its Water Base messages**, the ones about installer pay,
  deposits and invoice numbers. Its sentences for the constraints in
  `schema.sql` stay.
- **`base.css` is a cut of the global stylesheet.** It has only the rules this
  page uses, plus the design tokens they refer to. It loads Inter and Poppins
  from Google Fonts; remove the `@import` line to use your own.

## Not included

- **Screens for entering sales or expenses.** This page reads; it doesn't
  write. Enter rows however suits you: the Supabase table editor, your own
  forms, or an import.
- **Recurring overheads.** Water Base posts monthly subscriptions and ad spend
  into `expenses` from a separate table. That feature isn't part of this
  export, but any rows it would write land in `expenses` and show up here
  unchanged.
