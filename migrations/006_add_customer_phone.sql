-- Adds a phone number field to customers, so an Admin/Manager can record
-- how to reach a customer directly (independent of whether they've ever
-- connected the Telegram bot).
--
-- NOTE: as of this migration, `customers.phone` already exists in the
-- production database (it predates the migrations/ folder and has always
-- been nullable) — admin.js and workshopBot.js already select it, they
-- just never displayed or edited it. This migration is still added for
-- completeness/reproducibility (e.g. a fresh database created from
-- scratch) and is a safe no-op against the current production schema.
--
-- Purely additive: one nullable column, no existing rows touched.

alter table customers
    add column if not exists phone text;

-- phone: free-form text (not numeric — international formats, spaces,
-- extensions, etc. are all valid), nullable so existing customers with no
-- phone on file are unaffected.
