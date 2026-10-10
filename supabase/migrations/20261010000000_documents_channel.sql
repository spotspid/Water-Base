-- A fourth Slack channel, for documents.
--
-- The sales channel is for sold jobs and nothing else. Unsigned quote
-- reminders and customer views and declines were landing there, so the notify
-- function now sends those to documents, and the notifications table has to
-- accept the name before the first one is claimed.

alter table public.notifications drop constraint notifications_channel_check;

alter table public.notifications add constraint notifications_channel_check
  check (channel in ('new_sale', 'scheduling', 'stock', 'documents'));
