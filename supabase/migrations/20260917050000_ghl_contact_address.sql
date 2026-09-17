-- The synced CRM copy keeps the contact's address.
--
-- Seven jobs have no city. Every one of them matches exactly one GoHighLevel
-- contact on the last ten digits of the phone, and GHL is where the address
-- was typed, but the sync only kept the contact's name, email and phone, so
-- answering "what city is this" meant a live lookup every time.
--
-- Three columns, named as GHL names them so nobody has to translate: address1,
-- city, postal_code.
--
-- Nullable and never backfilled by this file. A row written before these
-- existed keeps null until the next sync sees that opportunity again, and null
-- here means "not synced yet or not in GHL", which is the truth rather than a
-- guess.
--
-- Whether GHL's opportunity search actually carries the contact address is not
-- something this migration can decide. ghl.ts reads it from the contact object
-- when it is there; if it is not, these stay null and the fix is a per contact
-- fetch, not a column that lies.

alter table public.ghl_opportunities
  add column if not exists address1    text,
  add column if not exists city        text,
  add column if not exists postal_code text;

comment on column public.ghl_opportunities.city is
  'The contact city as GoHighLevel holds it. Null means not synced yet or absent in GHL.';

notify pgrst, 'reload schema';
