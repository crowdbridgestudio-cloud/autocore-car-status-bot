-- Required for the Workshop Media Bot's customer-relay step (Send to
-- customer button). copyMessage() only ever returns { message_id } (per
-- the Telegram Bot API — confirmed against @grammyjs/types), never the
-- actual media/caption/text, so whatever the eventual relay needs must
-- be captured once, at /save time, from the original replied-to message
-- — there is no "fetch this message again later" API call to fall back
-- on.
--
-- Purely additive: four new nullable columns on the existing saved_media
-- table. No existing columns, tables, or rows are touched.
--
-- Run this once in the Supabase SQL editor (or via `psql`) — NOT applied
-- yet, per instructions.

alter table saved_media
    add column if not exists media_type text,
    add column if not exists caption text,
    add column if not exists text_content text,
    add column if not exists workshop_file_id text;

-- media_type: one of 'photo' | 'video' | 'document' | 'text' | null
--   (null = a message type /save doesn't know how to relay yet, e.g. a
--   voice note or sticker — it's still copied into the manager group
--   for humans to see, it just can't be forwarded via the button).
-- caption: the original media caption, if any (photo/video/document only).
-- text_content: the original message text, for media_type = 'text' only.
-- workshop_file_id: the Workshop Bot's own file_id for photo/video/document.
--   This belongs to the Workshop Bot specifically — Telegram file_ids are
--   bot-scoped and are NEVER valid when passed to a different bot's API
--   (that's the main customer bot, in this case). It exists solely so the
--   Workshop Bot can look the file up again via getFile() and download it
--   at send time; the actual bytes are then re-uploaded fresh through the
--   main bot. See workshopBot.js's relayToCustomer().
