-- Removes the global UNIQUE constraint on customers.telegram_id and
-- replaces it with a composite UNIQUE(company_id, telegram_id).
--
-- Why: AutoCore is sold to multiple independent repair shops. A real
-- end customer may legitimately use several of them with the same
-- Telegram account, and previously could not — the bot showed "Your
-- Telegram account is already registered with a different workshop"
-- the moment they tried to connect a second company's vehicle. The
-- identity model is now (company_id, telegram_id), not telegram_id
-- alone: the same Telegram account can hold one customer row per
-- company, never more than one within a single company.
--
-- Confirmed empirically before writing this migration: attempting to
-- insert a second customers row with a telegram_id already used by a
-- DIFFERENT company currently fails with
-- 'duplicate key value violates unique constraint "customers_telegram_id_key"'
-- — this migration removes exactly that constraint and nothing else.
--
-- Safe to run against current data: the OLD constraint already
-- guaranteed at most one row per telegram_id across the whole table,
-- so every existing row trivially satisfies the NEW, looser
-- (company_id, telegram_id) constraint too — this cannot fail on
-- current data, and no rows are modified.
--
-- Postgres treats NULL as distinct from every other NULL for UNIQUE
-- purposes, so this still allows unlimited customers with
-- telegram_id = NULL per company (an admin-created placeholder that
-- hasn't connected Telegram yet) — unchanged from today.
--
-- Run this once in the Supabase SQL editor. Until it's applied, the
-- code changes that accompany it still work correctly for every
-- existing single-company case (nothing regresses); connecting the
-- SAME Telegram account to a genuinely NEW second company will fail
-- with a generic "could not create customer" error instead of
-- succeeding, until this migration runs.

alter table customers drop constraint if exists customers_telegram_id_key;

alter table customers
    add constraint customers_company_id_telegram_id_key unique (company_id, telegram_id);
