-- Records which channel (Telegram or WhatsApp) staff identified as a
-- customer's preferred contact method, so the admin panel's "Message
-- customer" action knows which one to use — reuses the EXISTING
-- `phone` column for WhatsApp (a WhatsApp number is a phone number; no
-- separate whatsapp_phone column is introduced) and the `telegram_username`
-- column from migrations/010 for Telegram. This migration adds only the
-- one new piece of information that genuinely doesn't exist yet: which
-- of the two a customer actually uses.
--
-- NOT applied by this file running — manual Supabase SQL editor step,
-- same as every other migration in this project; no DDL execution
-- capability exists from the application side.
--
-- Purely additive: one new nullable column with a CHECK constraint
-- limiting it to the two known values (or null, for every existing
-- customer and any new one where staff hasn't chosen yet) — no existing
-- rows touched, no existing column altered.
--
-- Depends on migrations/010_customer_telegram_username.sql having also
-- been applied for the Telegram half of this feature to work (the
-- WhatsApp half only needs this column plus the already-existing
-- `phone` column, so it works even if 010 is applied separately).

alter table customers
    add column if not exists contact_method text null;

alter table customers
    drop constraint if exists customers_contact_method_check;

alter table customers
    add constraint customers_contact_method_check
    check (contact_method is null or contact_method in ('telegram', 'whatsapp'));
