-- Required for the Super Admin "Activate / Suspend" feature and for
-- blocking a suspended company's admin panel access.
--
-- This is purely additive: it adds one new column with a default of
-- `true`, so every existing company (and every company created before
-- this migration is applied) is treated as active. No existing rows or
-- columns are modified or removed.
--
-- Run this once in the Supabase SQL editor (or via `psql`).
--
-- Until this is applied, the Super Admin dashboard will show every
-- company as "Active" and the Activate/Suspend buttons will show a
-- clear error explaining that this migration is required, instead of
-- silently failing.

alter table companies
    add column if not exists is_active boolean not null default true;
