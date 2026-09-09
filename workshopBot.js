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

const { Bot, InlineKeyboard } = require("grammy");
const supabase = require("./supabase");

const WORKSHOP_BOT_TOKEN = process.env.WORKSHOP_BOT_TOKEN;

let workshopBot = null;


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


    function displayName(from) {

        return (
            [from.first_name, from.last_name].filter(Boolean).join(" ") ||
            (from.username ? "@" + from.username : null) ||
            `User ${from.id}`
        );
    }


    // ==================================================
    // /save <registration>
    // ==================================================

    workshopBot.command("save", async (ctx) => {

        const groupId = ctx.chat.id;
        const replied = ctx.message.reply_to_message;
        const registrationInput = (ctx.match || "").trim();

        const replyOptions = { reply_to_message_id: ctx.message.message_id };


        if (!replied) {

            await ctx.reply(
                "⚠️ Reply to the photo, video, or message you want to save, then send /save <registration>.\n\nExample: /save EL12345",
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
            .eq("source_message_id", replied.message_id)
            .maybeSingle();

        if (existing) {

            await ctx.reply(
                `ℹ️ This was already saved on ${new Date(existing.saved_at).toLocaleString()}.`,
                replyOptions
            );

            return;
        }


        // Vehicle lookup — scoped to this group's company_id only.
        const { data: vehicle, error: vehicleError } = await supabase
            .from("cars")
            .select("*, customers ( id, name, telegram_id )")
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
                replied.message_id
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


        const { data: savedRow, error: insertError } = await supabase
            .from("saved_media")
            .insert({
                company_id: groupConfig.company_id,
                vehicle_id: vehicle.id,
                source_chat_id: groupId,
                source_message_id: replied.message_id,
                manager_chat_id: groupConfig.manager_group_id,
                manager_message_id: copiedMessage.message_id,
                saved_by_telegram_user_id: ctx.from.id,
                saved_by_name: savedByName
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


        const metadataText =
            `🚗 *${vehicle.brand} ${vehicle.model}* (${vehicle.registration || registrationInput})\n` +
            `👤 ${vehicle.customers?.name || "No customer on file"}\n` +
            `👷 Saved by: ${savedByName}\n` +
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
                text: "❌ This customer isn't connected to Telegram yet.",
                show_alert: true
            });

            return;
        }


        try {

            await ctx.api.copyMessage(
                customer.telegram_id,
                row.manager_chat_id,
                row.manager_message_id
            );

        } catch (sendError) {

            console.error("Failed to send saved media to customer:", sendError.message);

            await ctx.answerCallbackQuery({
                text: "❌ Could not send to the customer. Please try again.",
                show_alert: true
            });

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
