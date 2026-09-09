-- Run this once in the Supabase SQL editor (or via `psql`) to enable
-- persistent per-customer language preferences.
--
-- The bot and admin panel already work without this column (they fall
-- back to detecting the language from the customer's Telegram client
-- and to an in-memory cache for the current process), but preferences
-- won't survive a bot restart until this migration is applied.

alter table customers
    add column if not exists language text;
