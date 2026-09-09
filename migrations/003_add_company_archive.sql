-- Required for the Super Admin "Archive / Restore" feature (distinct
-- from the existing Suspend/Activate, which uses companies.is_active
-- and is untouched by this migration).
--
-- Purely additive: one new nullable column, default NULL (= not
-- archived), so every existing company keeps behaving exactly as before
-- until a super admin explicitly archives one. No existing rows or
-- columns are modified or removed.
--
-- Run this once in the Supabase SQL editor (or via `psql`).
--
-- Until this is applied, the Super Admin dashboard shows a notice that
-- Archive/Restore is unavailable, and every company displays as if not
-- archived — nothing crashes or silently misbehaves.

alter table companies
    add column if not exists archived_at timestamptz null;
