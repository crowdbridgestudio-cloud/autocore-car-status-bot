// ==================================================
// WORKSHOP MEDIA BOT
// ==================================================
// A SECOND, independent grammY bot — separate from the customer/status
// bot in index.js, with its own token (WORKSHOP_BOT_TOKEN), running
// alongside it in the same process via long polling (matching the main
// bot's current mode; see index.js for the webhook-readiness notes,
// which apply equally here if that's ever revisited).
//
// It has NO mandatory workflow and does not watch every message in a
// workshop's internal Telegram group — it only ever reacts to an
// explicit `/save <registration>` command sent as a reply to the
// photo/video/message someone wants to keep, plus the "Send to
// customer" button it posts in the manager group afterwards. Nothing
// else it sees is read, stored, or forwarded.
//
// Config is entirely DB-driven (workshop_telegram_groups, see
// migrations/004_workshop_media_bot.sql) so one bot/token can serve
// every company's workshop group — never hardcode a group or company
// here. If WORKSHOP_BOT_TOKEN isn't set, this module simply does
// nothing when started (the feature is off by default).

const { Bot, InlineKeyboard, InputFile } = require("grammy");
const supabase = require("./supabase");

const WORKSHOP_BOT_TOKEN = process.env.WORKSHOP_BOT_TOKEN;

let workshopBot = null;

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // Telegram Bot API's own file-download ceiling


if (WORKSHOP_BOT_TOKEN) {

    workshopBot = new Bot(WORKSHOP_BOT_TOKEN);

    // Same critical fix as the main bot (see index.js) — without this, a
    // single bad update (e.g. copyMessage failing because the bot was
    // removed from a group) would crash the whole process.
    workshopBot.catch((err) => {

        console.error(
            "Workshop bot error (update not fully processed, bot keeps running):",
            err.message
        );
    });


    // A second Bot object, built from the MAIN customer bot's token, used
    // ONLY for outbound API calls (customerBot.api.*) — mirrors the exact
    // pattern already used successfully in admin.js's `notificationBot`.
    // This is what lets the Workshop Bot actually reach a customer:
    // customers only ever start a conversation with the main bot, never
    // this one, so Telegram would refuse any message sent as the
    // Workshop Bot directly to a customer chat.
    //
    // Deliberately NEVER call .start(), .stop(), or .catch() on this
    // instance — doing so would start a second, competing polling loop
    // for BOT_TOKEN, which is exactly the bug that was just fixed in
    // index.js. This object exists purely to make outbound API calls.
    const customerBot = new Bot(process.env.BOT_TOKEN);


    function displayName(from) {

        return (
            [from.first_name, from.last_name].filter(Boolean).join(" ") ||
            (from.username ? "@" + from.username : null) ||
            `User ${from.id}`
        );
    }


    // copyMessage() only ever returns { message_id } — never the actual
    // content — so whatever the later "Send to customer" step needs must
    // be captured here, from the original reply source, at /save time.
    // There is no Bot API call to fetch an arbitrary message by id later
    // on. `message` is either a full reply_to_message or an external_reply
    // — both expose photo/video/document in the same shape, but only
    // reply_to_message carries .caption/.text; external_reply carries
    // neither, so `quoteText` (ctx.message.quote?.text, when present) is
    // the best-effort fallback for a plain text original in that case.
    function extractMediaInfo(message, quoteText) {

        if (message.photo && message.photo.length > 0) {

            // Telegram sends multiple resolutions; the last entry is the
            // largest/best available.
            const best = message.photo[message.photo.length - 1];

            return {
                media_type: "photo",
                workshop_file_id: best.file_id,
                caption: message.caption || null,
                text_content: null
            };
        }

        if (message.video) {

            return {
                media_type: "video",
                workshop_file_id: message.video.file_id,
                caption: message.caption || null,
                text_content: null
            };
        }

        if (message.document) {

            return {
                media_type: "document",
                workshop_file_id: message.document.file_id,
                caption: message.caption || null,
                text_content: null
            };
        }

        if (message.text) {

            return {
                media_type: "text",
                workshop_file_id: null,
                caption: null,
                text_content: message.text
            };
        }

        // No photo/video/document/text on `message` itself — this is the
        // external_reply case for a plain text original (it never carries
        // its own .text). quote.text is the quoted excerpt Telegram does
        // provide for such a reply; not guaranteed to be the message's
        // full text, but the closest available substitute.
        if (quoteText) {

            return {
                media_type: "text",
                workshop_file_id: null,
                caption: null,
                text_content: quoteText
            };
        }

        // Some other message type (voice, sticker, audio, ...) — still
        // copied into the manager group for humans to see, but /save
        // doesn't know how to relay it to a customer via the button.
        return {
            media_type: null,
            workshop_file_id: null,
            caption: message.caption || null,
            text_content: null
        };
    }


    // Performs the actual cross-bot relay: downloads the file bytes via
    // the Workshop Bot (which owns workshop_file_id) and re-uploads them
    // fresh through the main customer bot. Never uses copyMessage here —
    // the main bot isn't a member of the manager group (so it has no
    // "from_chat_id" to copy from), and a Workshop Bot file_id is never
    // valid when handed to a different bot's API in the first place.
    // A customer may have more than one vehicle at this workshop — without
    // this, a bare photo/video with no caption from the mechanic arrives
    // with zero context about which car it's for. Emoji + registration
    // needs no translation, so this doesn't require per-customer language
    // lookup (unlike the rest of the customer-facing bot).
    function vehicleContextLine(row) {

        const car = row.cars;

        if (!car) return null;

        const label = [car.brand, car.model].filter(Boolean).join(" ");

        if (!label && !car.registration) return null;

        return `🚗 ${label}${car.registration ? ` (${car.registration})` : ""}`;
    }


    async function relayToCustomer(row, customerTelegramId) {

        const contextLine = vehicleContextLine(row);

        if (row.media_type === "text") {

            if (!row.text_content) {
                throw new Error("No text content was stored for this saved item.");
            }

            const textMessage = contextLine
                ? `${contextLine}\n\n${row.text_content}`
                : row.text_content;

            await customerBot.api.sendMessage(customerTelegramId, textMessage);
            return;
        }

        if (!row.media_type || !row.workshop_file_id) {
            throw new Error(`This saved item's content type ("${row.media_type || "unknown"}") can't be sent to a customer yet.`);
        }

        // Ask the Workshop Bot (the only bot that can) where this file lives.
        const file = await workshopBot.api.getFile(row.workshop_file_id);

        if (file.file_size && file.file_size > MAX_DOWNLOAD_BYTES) {
            const tooLarge = new Error("File exceeds the 20MB bot download limit.");
            tooLarge.code = "FILE_TOO_LARGE";
            throw tooLarge;
        }

        const fileUrl = `https://api.telegram.org/file/bot${WORKSHOP_BOT_TOKEN}/${file.file_path}`;

        const response = await fetch(fileUrl);

        if (!response.ok) {
            throw new Error(`Failed to download file from Telegram (HTTP ${response.status}).`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        if (buffer.length > MAX_DOWNLOAD_BYTES) {
            const tooLarge = new Error("Downloaded file exceeds the 20MB bot download limit.");
            tooLarge.code = "FILE_TOO_LARGE";
            throw tooLarge;
        }

        const inputFile = new InputFile(buffer);

        const caption = [contextLine, row.caption].filter(Boolean).join("\n\n") || undefined;
        const sendOptions = caption ? { caption } : undefined;

        if (row.media_type === "photo") {
            await customerBot.api.sendPhoto(customerTelegramId, inputFile, sendOptions);
        } else if (row.media_type === "video") {
            await customerBot.api.sendVideo(customerTelegramId, inputFile, sendOptions);
        } else if (row.media_type === "document") {
            await customerBot.api.sendDocument(customerTelegramId, inputFile, sendOptions);
        } else {
            throw new Error(`Unsupported media_type "${row.media_type}".`);
        }
    }


    // ==================================================
    // /save <registration>
    // ==================================================

    workshopBot.command("save", async (ctx) => {

        const groupId = ctx.chat.id;

        // Telegram represents "this message replies to X" in one of two
        // ways. The classic `reply_to_message` (a full Message) is only
        // populated when the original message was itself already visible
        // to the bot. Under Privacy Mode — the default for every Telegram
        // bot — a plain photo with no caption/command/mention is never
        // delivered to the bot as its own update, so a LATER command
        // replying to it arrives with `external_reply` instead: a lighter
        // structure that still carries the actual photo/video/document,
        // just not under the same field name. Confirmed against a real
        // production /save reply that Telegram's own FAQ describes this
        // exact behavior, and verified `external_reply` exposes
        // photo/video/document in the same shape extractMediaInfo already
        // expects (it does not carry a caption or plain text, though —
        // see extractMediaInfo's quoteText fallback for that case).
        const replyToMessage = ctx.message.reply_to_message;
        const externalReply = ctx.message.external_reply;
        const replied = replyToMessage || externalReply || null;

        const registrationInput = (ctx.match || "").trim();

        const replyOptions = { reply_to_message_id: ctx.message.message_id };


        if (!replied) {

            await ctx.reply(
                "⚠️ Reply to the photo, video, or message you want to save, then send /save <registration>.\n\nExample: /save EL12345",
                replyOptions
            );

            return;
        }


        // message_id is always present on reply_to_message, but on
        // external_reply it's only guaranteed when the original chat is a
        // supergroup/channel — true for every group this bot is
        // configured for, but checked explicitly rather than assumed.
        const sourceMessageId = replyToMessage ? replyToMessage.message_id : externalReply.message_id;

        if (!sourceMessageId) {

            await ctx.reply(
                "⚠️ Could not identify the message you replied to. Please try again.",
                replyOptions
            );

            return;
        }


        if (!registrationInput) {

            await ctx.reply(
                "⚠️ Please include the vehicle's registration number.\n\nExample: /save EL12345",
                replyOptions
            );

            return;
        }


        // Which company does this Telegram group belong to? This is the
        // only thing that determines which vehicles /save can ever touch
        // — a workshop group can never reach another company's data,
        // because the vehicle lookup below is always scoped to this.
        const { data: groupConfig, error: groupError } = await supabase
            .from("workshop_telegram_groups")
            .select("*")
            .eq("workshop_group_id", groupId)
            .eq("is_active", true)
            .maybeSingle();

        if (groupError) {

            console.error("Workshop group lookup error:", groupError.message);

            await ctx.reply(
                "⚠️ Something went wrong looking up this group's setup. Please try again.",
                replyOptions
            );

            return;
        }

        if (!groupConfig) {

            await ctx.reply(
                "⚠️ This group isn't set up as a workshop group yet. Ask an admin to configure it.",
                replyOptions
            );

            return;
        }


        // Already saved? Don't re-copy into the manager group and spam
        // it a second time for the same original message.
        const { data: existing } = await supabase
            .from("saved_media")
            .select("id, saved_at")
            .eq("source_chat_id", groupId)
            .eq("source_message_id", sourceMessageId)
            .maybeSingle();

        if (existing) {

            await ctx.reply(
                `ℹ️ This was already saved on ${new Date(existing.saved_at).toLocaleString()}.`,
                replyOptions
            );

            return;
        }


        // Vehicle lookup — scoped to this group's company_id only. The
        // customer (name/phone/telegram_id) comes from THIS SAME
        // company-scoped row via the join, never a separate lookup, so
        // there's no way for it to resolve to another company's customer.
        const { data: vehicle, error: vehicleError } = await supabase
            .from("cars")
            .select("*, customers ( id, name, phone, telegram_id )")
            .eq("company_id", groupConfig.company_id)
            .ilike("registration", registrationInput)
            .maybeSingle();

        if (vehicleError) {

            console.error("Vehicle lookup error:", vehicleError.message);

            await ctx.reply(
                "⚠️ Something went wrong looking up that vehicle. Please try again.",
                replyOptions
            );

            return;
        }

        if (!vehicle) {

            await ctx.reply(
                `❌ No vehicle found with registration "${registrationInput}" for this workshop.`,
                replyOptions
            );

            return;
        }


        // Copy (not forward) the original content into the manager group
        // — copyMessage doesn't carry a "Forwarded from" tag, which reads
        // cleaner in a manager-facing group.
        let copiedMessage;

        try {

            copiedMessage = await ctx.api.copyMessage(
                groupConfig.manager_group_id,
                groupId,
                sourceMessageId
            );

        } catch (copyError) {

            console.error("copyMessage to manager group failed:", copyError.message);

            await ctx.reply(
                "⚠️ Could not forward this to the manager group. Make sure the bot is still a member there.",
                replyOptions
            );

            return;
        }


        const savedByName = displayName(ctx.from);

        // Captured from the ORIGINAL reply source (not copiedMessage,
        // which is only ever { message_id } — see extractMediaInfo's
        // comment). ctx.message.quote?.text is the best-effort fallback
        // for plain text when the source came via external_reply, which
        // never carries a .text field of its own.
        const mediaInfo = extractMediaInfo(replied, ctx.message.quote?.text);


        const { data: savedRow, error: insertError } = await supabase
            .from("saved_media")
            .insert({
                company_id: groupConfig.company_id,
                vehicle_id: vehicle.id,
                source_chat_id: groupId,
                source_message_id: sourceMessageId,
                manager_chat_id: groupConfig.manager_group_id,
                manager_message_id: copiedMessage.message_id,
                saved_by_telegram_user_id: ctx.from.id,
                saved_by_name: savedByName,
                media_type: mediaInfo.media_type,
                workshop_file_id: mediaInfo.workshop_file_id,
                caption: mediaInfo.caption,
                text_content: mediaInfo.text_content
            })
            .select()
            .single();

        if (insertError) {

            console.error("saved_media insert error:", insertError.message);

            // The content is already in the manager group at this point,
            // but without a row there's no id for the "Send to customer"
            // button to reference — flag it clearly rather than silently
            // posting a button that can never work.
            await ctx.reply(
                "⚠️ Saved to the manager group, but there was a problem recording it, so \"Send to customer\" may not work. Please tell an admin.",
                replyOptions
            );

            return;
        }


        // Every field here comes from `vehicle.customers` — the same
        // company-scoped row fetched above — never a fresh lookup, so a
        // manager can never see another customer's (let alone another
        // company's) phone or Telegram ID by any accident here.
        const customerPhoneLine = vehicle.customers?.phone || "Not provided";
        const customerTelegramLine = vehicle.customers?.telegram_id || "Not connected";

        const metadataText =
            `🚗 *${vehicle.brand} ${vehicle.model}* (${vehicle.registration || registrationInput})\n\n` +
            `👤 Customer: ${vehicle.customers?.name || "No customer on file"}\n` +
            `📱 Phone: ${customerPhoneLine}\n` +
            `💬 Telegram ID: ${customerTelegramLine}\n\n` +
            `💾 Saved by: ${savedByName}\n` +
            `🕐 ${new Date(savedRow.saved_at).toLocaleString()}`;

        try {

            await ctx.api.sendMessage(
                groupConfig.manager_group_id,
                metadataText,
                {
                    parse_mode: "Markdown",
                    reply_to_message_id: copiedMessage.message_id,
                    reply_markup: new InlineKeyboard()
                        .text("📤 Send to customer", `send_customer_${savedRow.id}`)
                }
            );

        } catch (metaError) {

            console.error("Failed to send metadata message to manager group:", metaError.message);
        }


        await ctx.reply(
            `✅ Saved to ${vehicle.registration || registrationInput} and sent to the manager group.`,
            replyOptions
        );
    });


    // ==================================================
    // "📤 Send to customer" button (pressed in the manager group)
    // ==================================================

    workshopBot.callbackQuery(/^send_customer_(\d+)$/, async (ctx) => {

        const savedMediaId = ctx.match[1];

        const { data: row, error } = await supabase
            .from("saved_media")
            .select("*, cars ( id, brand, model, registration, customer_id )")
            .eq("id", savedMediaId)
            .maybeSingle();

        if (error || !row) {

            await ctx.answerCallbackQuery({
                text: "❌ Could not find this saved item.",
                show_alert: true
            });

            return;
        }


        // Defense-in-depth: this button is only ever posted into the one
        // manager group it belongs to, but double-check anyway rather
        // than trusting callback_data plus message placement alone.
        if (ctx.chat.id !== row.manager_chat_id) {

            await ctx.answerCallbackQuery({
                text: "❌ Not available here.",
                show_alert: true
            });

            return;
        }


        if (row.sent_to_customer) {

            await ctx.answerCallbackQuery({
                text: "ℹ️ Already sent to the customer.",
                show_alert: true
            });

            return;
        }


        const customerId = row.cars?.customer_id;

        const { data: customer, error: customerError } = customerId
            ? await supabase
                .from("customers")
                .select("id, telegram_id")
                .eq("id", customerId)
                .maybeSingle()
            : { data: null, error: null };

        if (customerError || !customer || !customer.telegram_id) {

            await ctx.answerCallbackQuery({
                text: "❌ This customer hasn't started the main AutoCore bot yet, so they can't receive Telegram messages.",
                show_alert: true
            });

            return;
        }


        try {

            // Always via the main customer bot, never copyMessage — see
            // relayToCustomer's own comment for exactly why.
            await relayToCustomer(row, customer.telegram_id);

        } catch (sendError) {

            console.error("Failed to send saved media to customer:", sendError.message);

            let alertText = "❌ Could not send this to the customer. Please try again.";

            if (sendError && sendError.code === "FILE_TOO_LARGE") {
                alertText = "❌ This file is too large to forward (over 20MB). Please share it with the customer another way.";
            } else if (sendError && sendError.error_code === 403) {
                alertText = "❌ The customer has blocked the main AutoCore bot or hasn't started it — they can't receive Telegram messages right now.";
            }

            await ctx.answerCallbackQuery({
                text: alertText,
                show_alert: true
            });

            // Do NOT mark sent_to_customer / sent_at — the button stays
            // available so a manager can retry once the underlying issue
            // (file too large, customer needs to message the main bot,
            // transient network error, ...) is resolved.
            return;
        }


        // Idempotency guard: only the request that actually flips
        // sent_to_customer from false to true "wins", so two managers
        // pressing the button at nearly the same moment can't both
        // succeed (the loser's update affects zero rows).
        const { data: updatedRows, error: updateError } = await supabase
            .from("saved_media")
            .update({
                sent_to_customer: true,
                sent_at: new Date().toISOString(),
                sent_by_telegram_user_id: ctx.from.id
            })
            .eq("id", row.id)
            .eq("sent_to_customer", false)
            .select();

        if (updateError) {
            console.error("Failed to mark saved_media as sent:", updateError.message);
        }

        if (!updatedRows || updatedRows.length === 0) {
            console.warn(`saved_media ${row.id} was sent twice nearly simultaneously — customer received it once, but the row was already marked sent by another manager.`);
        }


        await ctx.answerCallbackQuery({
            text: "✅ Sent to customer!"
        });

        try {

            // Remove the button so it can't be pressed again — the DB
            // flag above is the real source of truth either way.
            await ctx.editMessageReplyMarkup({
                reply_markup: new InlineKeyboard()
            });

        } catch (editError) {
            // Non-fatal — cosmetic only.
        }
    });
}


function startWorkshopBot() {

    if (!workshopBot) {

        console.log("ℹ️  WORKSHOP_BOT_TOKEN not set — workshop media bot is disabled.");

        return;
    }

    workshopBot.api.setMyCommands([
        { command: "save", description: "Save replied media to a vehicle, e.g. /save EL12345" }
    ]).catch((err) => {
        console.error("Workshop bot setMyCommands failed (non-fatal):", err.message);
    });

    workshopBot.start();

    console.log("🔧 Workshop media bot started (long polling).");
}


module.exports = { startWorkshopBot };
