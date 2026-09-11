require("dotenv").config();

// ==================================================
// PRODUCTION SAFETY NETS
// ==================================================
// Defense-in-depth alongside bot.catch() below: log anything unexpected
// that still slips through (from either bot, or any stray promise
// anywhere in the app) instead of silently crashing the whole service.
// Deliberately does NOT call process.exit() — the specific known crash
// causes (bot.catch missing, setMyCommands unawaited) are fixed at their
// source below; this is only a last-resort net for genuinely unexpected
// errors so a single bad event doesn't take down both the bot and the
// Admin/Super Admin panels running in the same process. Never logs
// request/response bodies, headers, or env vars — only the error itself.
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
});


// ==================================================
// RUNTIME INSTANCE IDENTITY
// ==================================================
// A short random id generated fresh every time this process starts, plus
// its OS process id. Both are stamped on every polling-lifecycle log
// line below so that IF two processes are ever both polling the same
// BOT_TOKEN (the exact scenario a 409 Conflict indicates), the logs
// themselves prove it: two different (instance, pid) pairs logging
// "Telegram polling started" is definitive evidence of two processes,
// regardless of what's causing there to be two of them. Never derived
// from, or logged alongside, any secret/token value.
const crypto = require("crypto");
const INSTANCE_ID = crypto.randomUUID().slice(0, 8);

function instanceTag() {
    return `[instance=${INSTANCE_ID} pid=${process.pid}]`;
}


const { Bot, InlineKeyboard, Keyboard, webhookCallback } = require("grammy");
const supabase = require("./supabase");

const express = require("express");
const adminRouter = require("./admin");
const superAdminRouter = require("./superadmin");
const { startWorkshopBot } = require("./workshopBot");

const {
    SUPPORTED_LANGS,
    DEFAULT_LANG,
    LANGUAGE_LABELS,
    normalizeLang,
    resolveLangFromTelegram,
    t,
    statusLabel
} = require("./locales");

const bot = new Bot(process.env.BOT_TOKEN);

// grammY's default behavior with NO error handler registered is to let an
// error thrown inside any handler propagate out of bot.start()'s internal
// loop as an unhandled promise rejection — which, on Node 18+, terminates
// the whole process by default. Since this process also runs the Express
// admin/super-admin servers, that means one bad Telegram update (e.g. the
// very common "message is not modified" error from a double-tapped button)
// could take down the entire app, not just the bot. This is the single
// most important production-safety fix in this file — never remove it.
bot.catch((err) => {

    console.error(
        "Telegram bot error (update not fully processed, bot keeps running):",
        err.message
    );
});


// ==================================================
// TELEGRAM POLLING SUPERVISOR
// ==================================================
// bot.catch() above only handles errors thrown while processing an
// update that has already been received by grammY — it does NOT protect
// bot.start() itself. grammY deliberately does not retry a 409 Conflict
// (another process is polling with the same token) or a 401 (bad
// token): it rethrows, which rejects bot.start()'s returned promise and
// permanently stops polling — nothing else ever calls bot.start() again.
//
// This matters because Render's normal rolling deploy briefly runs the
// outgoing and incoming instances side by side, so both poll with the
// same BOT_TOKEN for a few seconds — enough to trigger exactly one 409.
// Before this supervisor existed, that one 409 would silently end
// polling for the rest of that process's life, while the Express
// server (admin/super admin/health) kept working normally, since it
// runs independently in the same process.
//
// This function is what makes polling restartable: it wraps bot.start()
// in a loop that catches that rejection, waits a few seconds, and
// starts polling again — for as long as the process is alive and not
// shutting down. It never creates a second Bot instance and never runs
// more than one copy of this loop (see pollingSupervisorStarted below).

let pollingSupervisorStarted = false;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPollingWithRecovery(botInstance) {

    // Defensive guard: this function is only ever called once, from the
    // bottom of this file, but if that ever changed, this prevents two
    // overlapping supervisor loops (and therefore two competing
    // bot.start() calls) from ever running in the same process.
    if (pollingSupervisorStarted) {
        console.warn(`Telegram polling supervisor is already running — ignoring duplicate start request. ${instanceTag()}`);
        return;
    }
    pollingSupervisorStarted = true;

    const MIN_RETRY_DELAY_MS = 5000;
    const RETRY_JITTER_MS = 5000; // total retry delay lands in the 5-10s range requested

    let shuttingDown = false;
    let stoppedPermanently = false;
    let hasStartedOnce = false;

    async function shutdown(signal) {

        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`Telegram polling: received ${signal}, shutting down — no further retries will be scheduled. ${instanceTag()}`);

        try {
            // Cleanly cancels the in-flight getUpdates call, if any, and
            // makes bot.start()'s promise resolve (not reject) below.
            await botInstance.stop();
        } catch (err) {
            console.error("Telegram polling: error while stopping:", err.message, instanceTag());
        }

        // Registering a signal handler at all replaces Node's default
        // "exit immediately" behavior for that signal, so we must exit
        // explicitly once the bot has stopped, or the process could
        // hang until the host force-kills it.
        process.exit(0);
    }

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));

    console.log(`Telegram polling starting... ${instanceTag()}`);

    while (!shuttingDown) {

        try {

            await botInstance.start({
                onStart: (botInfo) => {

                    const identity = `[bot=@${botInfo.username} id=${botInfo.id}] ${instanceTag()}`;

                    console.log(
                        (hasStartedOnce ? "Telegram polling resumed." : "Telegram polling started.") +
                        ` ${identity}`
                    );

                    hasStartedOnce = true;
                }
            });

            // bot.start() only resolves when polling was stopped on
            // purpose (bot.stop(), e.g. from shutdown() above) — an
            // actual polling failure rejects instead, and is handled in
            // the catch block below. So if we get here, there is
            // nothing to recover from.
            console.log(`Telegram polling stopped. ${instanceTag()}`);

        } catch (err) {

            console.log(`Telegram polling stopped. ${instanceTag()}`);

            if (shuttingDown) {
                break;
            }

            // A 401 means the token itself is invalid/revoked — retrying
            // cannot ever succeed, so unlike every other error, this one
            // stops polling permanently for this process instead of
            // entering the retry loop. The web server keeps running
            // regardless; fixing this requires a valid BOT_TOKEN and a
            // restart.
            if (err && err.error_code === 401) {

                console.error(
                    "Telegram polling error 401 (invalid or revoked bot token) — " +
                    `stopping polling permanently for this process. Fix BOT_TOKEN, then restart. ${instanceTag()}`
                );

                stoppedPermanently = true;
                break;
            }

            const delay = MIN_RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MS);
            const seconds = Math.round(delay / 1000);

            if (err && err.error_code === 409) {
                console.error(`Telegram polling error 409 (another instance is using this bot token), retrying in ${seconds}s... ${instanceTag()}`);
            } else {
                console.error(`Telegram polling error (${(err && err.message) || err}), retrying in ${seconds}s... ${instanceTag()}`);
            }

            // Paced, not tight: this is the only place a failed attempt
            // leads to another one, and it always waits first.
            await sleep(delay);
        }
    }

    console.log(
        (stoppedPermanently
            ? "Telegram polling supervisor exiting (stopped permanently — invalid bot token)."
            : "Telegram polling supervisor exiting (shutdown in progress).")
        + ` ${instanceTag()}`
    );
}


// ==================================================
// LANGUAGE RESOLUTION
// ==================================================

// In-memory cache so a language choice takes effect immediately and works
// even for Telegram users who don't have a `customers` row yet.
// Once a customer row exists, the choice is also persisted to the DB.
const languageCache = new Map();


async function getLang(ctx) {

    const telegramId = ctx.from.id;

    if (languageCache.has(telegramId)) {
        return languageCache.get(telegramId);
    }

    let stored = null;

    const { data: customer, error } = await supabase
        .from("customers")
        .select("language")
        .eq("telegram_id", telegramId)
        .maybeSingle();

    if (!error && customer) {
        stored = customer.language;
    }

    const lang = normalizeLang(stored) || resolveLangFromTelegram(ctx);

    languageCache.set(telegramId, lang);

    return lang;
}


async function setLang(ctx, lang) {

    const telegramId = ctx.from.id;

    languageCache.set(telegramId, lang);

    // Best-effort persistence. If the `language` column hasn't been added
    // to `customers` yet, or the customer doesn't exist yet, this simply
    // does nothing — the in-memory cache still keeps the choice for the
    // rest of the process lifetime.
    await supabase
        .from("customers")
        .update({ language: lang })
        .eq("telegram_id", telegramId);
}


// ==================================================
// ARCHIVED COMPANY GATE
// ==================================================
// An archived company (Super Admin > Archive, see migrations/003) must
// not keep operating as if active — this is distinct from Suspend, which
// only ever blocked the admin panel. Gracefully treats a missing
// `archived_at` column as "not archived" so nothing breaks pre-migration.

async function isCompanyArchived(companyId) {

    if (!companyId) return false;

    const { data, error } = await supabase
        .from("companies")
        .select("archived_at")
        .eq("id", companyId)
        .maybeSingle();

    if (error || !data) return false;

    return !!data.archived_at;
}


// ==================================================
// PERSISTENT BOTTOM KEYBOARD
// ==================================================
// Two buttons, always visible under the text input: Status (re-opens the
// existing car menu) and Language (re-opens the existing language picker).
// Telegram only allows ONE reply_markup per message (either this
// ReplyKeyboardMarkup or an InlineKeyboardMarkup, never both), so this
// can't be attached to messages that already carry their own inline
// keyboard (car cards, connect/cancel prompts) — but once sent on any
// message it stays visible under the input box for every later message
// in the chat regardless of what those carry, so it only needs to be set
// at a few natural entry points (see callers).

function mainReplyKeyboard(lang) {

    return new Keyboard()
        .text(t(lang, "menu_btn_status"))
        .text(t(lang, "menu_btn_language"))
        .resized();
}


// ==================================================
// CUSTOMER MENU
// ==================================================

async function showCustomerCars(ctx, edit = false) {

    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);

    const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();

    if (customerError || !customer) {

        const message = t(lang, "no_car_linked");

        if (edit) {
            await ctx.editMessageText(message);
        } else {
            await ctx.reply(message);
        }

        return;
    }


    if (await isCompanyArchived(customer.company_id)) {

        const message = t(lang, "company_archived");

        if (edit) {
            await ctx.editMessageText(message);
        } else {
            await ctx.reply(message);
        }

        return;
    }


    const { data: cars, error: carsError } = await supabase
        .from("cars")
        .select("*")
        .eq("customer_id", customer.id)
        .order("updated_at", {
            ascending: false
        });


    if (carsError || !cars || cars.length === 0) {

        const message = t(lang, "no_cars");

        if (edit) {
            await ctx.editMessageText(message);
        } else {
            await ctx.reply(message);
        }

        return;
    }


    for (let i = 0; i < cars.length; i++) {

        const car = cars[i];

        const keyboard = new InlineKeyboard()

            .text(
                t(lang, "btn_status_check"),
                `car_status_${car.id}`
            )

            .row()

            .text(
                t(lang, "btn_history"),
                `car_history_${car.id}`
            )

            .row()

            .text(
                t(lang, "btn_info"),
                `car_info_${car.id}`
            )

            .row()

            .text(
                t(lang, "btn_contact"),
                `contact_service_${car.id}`
            )

            .row()

            .text(
                t(lang, "btn_delete"),
                `delete_car_confirm_${car.id}`
            );


        const message = t(lang, "car_card", {
            brand: car.brand,
            model: car.model,
            registration: car.registration || "-",
            status: statusLabel(lang, car.status)
        });


        // Only the first car can reuse the message being edited (e.g. the
        // "⬅️ Back" button click) — additional cars must be sent as new
        // messages, otherwise each edit overwrites the previous one and
        // customers with more than one car only ever see the last one.
        if (edit && i === 0) {

            await ctx.editMessageText(
                message,
                {
                    parse_mode: "Markdown",
                    reply_markup: keyboard
                }
            );

        } else {

            await ctx.reply(
                message,
                {
                    parse_mode: "Markdown",
                    reply_markup: keyboard
                }
            );
        }
    }
}


// ==================================================
// LANGUAGE COMMAND
// ==================================================

async function showLanguageMenu(ctx) {

    const lang = await getLang(ctx);

    const keyboard = new InlineKeyboard();

    for (const code of SUPPORTED_LANGS) {
        keyboard.text(LANGUAGE_LABELS[code], `set_lang_${code}`).row();
    }

    await ctx.reply(
        t(lang, "language_prompt"),
        {
            reply_markup: keyboard
        }
    );
}


bot.command("language", async (ctx) => {
    await showLanguageMenu(ctx);
});


bot.callbackQuery(/^set_lang_(en|az|tr|pl|ru)$/, async (ctx) => {

    const lang = ctx.match[1];

    await setLang(ctx, lang);

    await ctx.answerCallbackQuery();

    await ctx.editMessageText(
        t(lang, "language_set", {
            language: LANGUAGE_LABELS[lang]
        })
    );

    // editMessageText can only ever carry an InlineKeyboardMarkup (Telegram
    // doesn't allow switching a message to a ReplyKeyboardMarkup via edit),
    // so refreshing the persistent bottom keyboard's labels into the new
    // language needs a fresh message — then hand back to the customer's
    // usual status menu, per the "return cleanly" requirement.
    await ctx.reply(
        t(lang, "keyboard_hint"),
        {
            reply_markup: mainReplyKeyboard(lang)
        }
    );

    await showCustomerCars(ctx);
});


// Persistent bottom keyboard buttons send their label as plain text, in
// whatever language the customer's keyboard was last drawn in — match all
// supported languages' labels so this keeps working even right after a
// language change (before the keyboard has been redrawn) or if Telegram
// serves a stale cached keyboard.
bot.hears(SUPPORTED_LANGS.map((code) => t(code, "menu_btn_status")), async (ctx) => {
    await showCustomerCars(ctx);
});

bot.hears(SUPPORTED_LANGS.map((code) => t(code, "menu_btn_language")), async (ctx) => {
    await showLanguageMenu(ctx);
});


// ==================================================
// START
// ==================================================

bot.command("start", async (ctx) => {

    const payload = ctx.match;
    const lang = await getLang(ctx);


    // ----------------------------------------------
    // NORMAL START
    // ----------------------------------------------

    if (!payload) {

        // This bot is multi-tenant — a bare /start with no QR/deep-link
        // payload has no way to know which workshop the user means, so it
        // must never guess or default to any single company. The only
        // company a bare /start can safely show is the one an ALREADY
        // linked customer belongs to (via their own customers.company_id);
        // everyone else gets a generic, tenant-neutral onboarding message
        // that points them at their workshop's QR/deep link instead.
        const telegramId = ctx.from.id;

        const { data: customer, error: customerError } = await supabase
            .from("customers")
            .select("company_id")
            .eq("telegram_id", telegramId)
            .maybeSingle();


        if (customerError || !customer) {

            await ctx.reply(
                t(lang, "onboarding_generic"),
                {
                    parse_mode: "Markdown",
                    reply_markup: mainReplyKeyboard(lang)
                }
            );

            return;
        }


        if (await isCompanyArchived(customer.company_id)) {

            await ctx.reply(
                t(lang, "company_archived"),
                {
                    reply_markup: mainReplyKeyboard(lang)
                }
            );

            return;
        }


        const { data, error } = await supabase
            .from("companies")
            .select("*")
            .eq("id", customer.company_id)
            .maybeSingle();


        if (error || !data) {

            console.error("Supabase error:", error);

            await ctx.reply(t(lang, "db_error"));

            return;
        }


        await ctx.reply(

            t(lang, "welcome", {
                name: data.name,
                address: data.address,
                phone: data.phone
            }),

            {
                parse_mode: "Markdown",
                reply_markup: mainReplyKeyboard(lang)
            }
        );

        return;
    }


    // ----------------------------------------------
    // QR CAR LINK
    // ----------------------------------------------

    if (payload.startsWith("car_")) {

        const carId = payload.replace("car_", "");


        const { data: car, error } = await supabase
            .from("cars")
            .select(`
                *,
                customers (
                    name,
                    phone
                )
            `)
            .eq("id", carId)
            .single();


        if (error || !car) {

            console.error("Car lookup error:", error);

            await ctx.reply(t(lang, "car_not_found"));

            return;
        }


        if (await isCompanyArchived(car.company_id)) {

            await ctx.reply(t(lang, "company_archived"));

            return;
        }


        const keyboard = new InlineKeyboard()

            .text(
                t(lang, "btn_connect"),
                `connect_car_${car.id}`
            )

            .row()

            .text(
                t(lang, "btn_cancel"),
                "cancel"
            );


        await ctx.reply(

            t(lang, "connect_confirm", {
                brand: car.brand,
                model: car.model,
                registration: car.registration || "-"
            }),

            {
                parse_mode: "Markdown",
                reply_markup: keyboard
            }
        );

        return;
    }


    await ctx.reply(t(lang, "unknown_link"));
});


// ==================================================
// /STATUS
// ==================================================

bot.command("status", async (ctx) => {

    await showCustomerCars(ctx);

});


// ==================================================
// CONNECT CAR
// ==================================================

bot.callbackQuery(/^connect_car_(\d+)$/, async (ctx) => {

    const carId = ctx.match[1];
    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);

    const name =
        [ctx.from.first_name, ctx.from.last_name]
            .filter(Boolean)
            .join(" ");


    // Look up the car first so we can tell whether it is already linked
    // to somebody else before touching anything.

    const { data: targetCar, error: carLookupError } = await supabase
        .from("cars")
        .select("id, customer_id, company_id")
        .eq("id", carId)
        .maybeSingle();


    if (carLookupError || !targetCar) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_not_found"),
            show_alert: true
        });

        return;
    }


    if (await isCompanyArchived(targetCar.company_id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "company_archived"),
            show_alert: true
        });

        return;
    }


    // Find customer

    let { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();


    // A Telegram account's customer identity belongs to exactly one
    // company (see getLang/showCustomerCars, which look a customer up by
    // telegram_id alone with no company scoping). Reusing an existing
    // customer row to connect a car from a DIFFERENT company would silently
    // cross-link two tenants' data — the customer's own company_id would
    // still point at their original workshop while a car from another
    // workshop now carried their customer_id. Must be rejected before any
    // of the car-linking checks below.
    if (customer && customer.company_id !== targetCar.company_id) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_different_company"),
            show_alert: true
        });

        return;
    }


    // Car IDs are sequential and guessable — refuse to hand over a car
    // that is already linked to a different customer's account.

    if (targetCar.customer_id && (!customer || targetCar.customer_id !== customer.id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_already_linked"),
            show_alert: true
        });

        return;
    }


    // Create customer

    if (!customer) {

        // The new customer belongs to whichever company owns the car
        // they're actually connecting — never a hardcoded default. This
        // is what keeps a customer visible in the right company's admin
        // panel (e.g. the "select customer" dropdown on Add Car).
        const { data: newCustomer, error } = await supabase
            .from("customers")
            .insert({
                company_id: targetCar.company_id,
                name: name || "Telegram Customer",
                telegram_id: telegramId
            })
            .select()
            .single();


        if (error) {

            console.error("Customer creation error:", error);

            await ctx.answerCallbackQuery({
                text: t(lang, "customer_create_error"),
                show_alert: true
            });

            return;
        }

        customer = newCustomer;

        // Best-effort: persist the language the customer is already using.
        await supabase
            .from("customers")
            .update({ language: lang })
            .eq("id", customer.id);
    }


    // Connect car

    const { error: updateError } = await supabase
        .from("cars")
        .update({
            customer_id: customer.id
        })
        .eq("id", carId);


    if (updateError) {

        console.error("Car connection error:", updateError);

        await ctx.answerCallbackQuery({
            text: t(lang, "car_connect_error"),
            show_alert: true
        });

        return;
    }


    await ctx.answerCallbackQuery({
        text: t(lang, "car_connected_alert")
    });


    await ctx.editMessageText(

        t(lang, "car_connected_text"),

        {
            parse_mode: "Markdown"
        }
    );


    // editMessageText (above) can only ever carry an InlineKeyboardMarkup,
    // never a ReplyKeyboardMarkup — this is the first moment a brand-new,
    // QR-first customer (who never typed a bare /start) can be handed the
    // persistent bottom keyboard, so it needs its own fresh message.
    await ctx.reply(
        t(lang, "keyboard_hint"),
        {
            reply_markup: mainReplyKeyboard(lang)
        }
    );


    await showCustomerCars(ctx);

});


// ==================================================
// CANCEL
// ==================================================

bot.callbackQuery("cancel", async (ctx) => {

    const lang = await getLang(ctx);

    await ctx.answerCallbackQuery();

    await ctx.editMessageText(t(lang, "cancelled_text"));

});


// ==================================================
// CAR STATUS
// ==================================================

bot.callbackQuery(/^car_status_(\d+)$/, async (ctx) => {

    const carId = ctx.match[1];
    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);


    const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();


    if (!customer) {

        await ctx.answerCallbackQuery({
            text: t(lang, "customer_not_found"),
            show_alert: true
        });

        return;
    }


    if (await isCompanyArchived(customer.company_id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "company_archived"),
            show_alert: true
        });

        return;
    }


    const { data: car } = await supabase
        .from("cars")
        .select("*")
        .eq("id", carId)
        .eq("customer_id", customer.id)
        .single();


    if (!car) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_not_linked_to_you"),
            show_alert: true
        });

        return;
    }


    await ctx.answerCallbackQuery();


    await ctx.editMessageText(

        t(lang, "status_block", {
            brand: car.brand,
            model: car.model,
            registration: car.registration || "-",
            status: statusLabel(lang, car.status),
            date: new Date(car.updated_at).toLocaleString(lang)
        }),

        {
            parse_mode: "Markdown",

            reply_markup: new InlineKeyboard()

                .text(
                    t(lang, "btn_history"),
                    `car_history_${car.id}`
                )

                .row()

                .text(
                    t(lang, "btn_back"),
                    "customer_menu"
                )
        }
    );

});


// ==================================================
// CAR HISTORY
// ==================================================

bot.callbackQuery(/^car_history_(\d+)$/, async (ctx) => {

    const carId = ctx.match[1];
    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);


    const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();


    if (!customer) {

        await ctx.answerCallbackQuery({
            text: t(lang, "customer_not_found"),
            show_alert: true
        });

        return;
    }


    if (await isCompanyArchived(customer.company_id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "company_archived"),
            show_alert: true
        });

        return;
    }


    const { data: car } = await supabase
        .from("cars")
        .select("*")
        .eq("id", carId)
        .eq("customer_id", customer.id)
        .single();


    if (!car) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_not_found"),
            show_alert: true
        });

        return;
    }


    const { data: history } = await supabase
        .from("status_history")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", {
            ascending: true
        });


    let message = t(lang, "history_title", {
        brand: car.brand,
        model: car.model
    });


    if (!history || history.length === 0) {

        message += t(lang, "history_empty");

    } else {

        for (const item of history) {

            message += t(lang, "history_item", {
                status: statusLabel(lang, item.new_status),
                date: new Date(item.created_at).toLocaleString(lang)
            });
        }
    }


    await ctx.answerCallbackQuery();


    await ctx.editMessageText(

        message,

        {
            parse_mode: "Markdown",

            reply_markup: new InlineKeyboard()

                .text(
                    t(lang, "btn_status_check"),
                    `car_status_${car.id}`
                )

                .row()

                .text(
                    t(lang, "btn_back"),
                    "customer_menu"
                )
        }
    );

});


// ==================================================
// CAR INFO
// ==================================================

bot.callbackQuery(/^car_info_(\d+)$/, async (ctx) => {

    const carId = ctx.match[1];
    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);


    const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();


    if (!customer) {

        await ctx.answerCallbackQuery({
            text: t(lang, "customer_not_found"),
            show_alert: true
        });

        return;
    }


    if (await isCompanyArchived(customer.company_id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "company_archived"),
            show_alert: true
        });

        return;
    }


    const { data: car } = await supabase
        .from("cars")
        .select("*")
        .eq("id", carId)
        .eq("customer_id", customer.id)
        .single();


    if (!car) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_not_found"),
            show_alert: true
        });

        return;
    }


    await ctx.answerCallbackQuery();


    const message =

        t(lang, "info_title") +
        t(lang, "info_brand", { brand: car.brand }) +
        t(lang, "info_model", { model: car.model }) +
        t(lang, "info_registration", { registration: car.registration || "-" }) +
        t(lang, "info_vin", { vin: car.vin || "-" }) +
        t(lang, "info_problem_label") +
        (car.problem || t(lang, "info_not_specified"));


    await ctx.editMessageText(

        message,

        {
            parse_mode: "Markdown",

            reply_markup: new InlineKeyboard()

                .text(
                    t(lang, "btn_back"),
                    "customer_menu"
                )
        }
    );

});


// ==================================================
// CONTACT SERVICE
// ==================================================

bot.callbackQuery(/^contact_service_(\d+)$/, async (ctx) => {

    const carId = ctx.match[1];
    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);


    const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();


    if (!customer) {

        await ctx.answerCallbackQuery({
            text: t(lang, "customer_not_found"),
            show_alert: true
        });

        return;
    }


    if (await isCompanyArchived(customer.company_id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "company_archived"),
            show_alert: true
        });

        return;
    }


    const { data: car } = await supabase
        .from("cars")
        .select(`
            *,
            companies (
                name,
                phone,
                address
            )
        `)
        .eq("id", carId)
        .eq("customer_id", customer.id)
        .single();


    if (!car) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_not_found"),
            show_alert: true
        });

        return;
    }


    await ctx.answerCallbackQuery();


    const message =

        t(lang, "contact_title") +
        `🏢 ${car.companies?.name || "-"}\n\n` +
        `📞 ${car.companies?.phone || t(lang, "contact_phone_missing")}\n\n` +
        `📍 ${car.companies?.address || t(lang, "contact_address_missing")}`;


    await ctx.editMessageText(

        message,

        {
            parse_mode: "Markdown",

            reply_markup: new InlineKeyboard()

                .text(
                    t(lang, "btn_back"),
                    "customer_menu"
                )
        }
    );

});


// ==================================================
// DELETE VEHICLE
// ==================================================

bot.callbackQuery(/^delete_car_confirm_(\d+)$/, async (ctx) => {

    const carId = ctx.match[1];
    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);


    const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();


    if (!customer) {

        await ctx.answerCallbackQuery({
            text: t(lang, "customer_not_found"),
            show_alert: true
        });

        return;
    }


    if (await isCompanyArchived(customer.company_id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "company_archived"),
            show_alert: true
        });

        return;
    }


    // Ownership check server-side — a customer can never manipulate
    // another customer's vehicle by editing the callback_data's car id
    // manually, since this always re-verifies against their own
    // customer_id rather than trusting the id alone.
    const { data: car } = await supabase
        .from("cars")
        .select("*")
        .eq("id", carId)
        .eq("customer_id", customer.id)
        .maybeSingle();


    if (!car) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_not_linked_to_you"),
            show_alert: true
        });

        return;
    }


    await ctx.answerCallbackQuery();


    await ctx.editMessageText(

        t(lang, "delete_confirm", {
            brand: car.brand,
            model: car.model,
            registration: car.registration || "-"
        }),

        {
            parse_mode: "Markdown",

            reply_markup: new InlineKeyboard()

                .text(
                    t(lang, "btn_delete_confirm"),
                    `delete_car_execute_${car.id}`
                )

                .row()

                .text(
                    t(lang, "btn_delete_cancel"),
                    `delete_car_cancel_${car.id}`
                )
        }
    );

});


bot.callbackQuery(/^delete_car_execute_(\d+)$/, async (ctx) => {

    const carId = ctx.match[1];
    const telegramId = ctx.from.id;
    const lang = await getLang(ctx);


    const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("telegram_id", telegramId)
        .maybeSingle();


    if (!customer) {

        await ctx.answerCallbackQuery({
            text: t(lang, "customer_not_found"),
            show_alert: true
        });

        return;
    }


    if (await isCompanyArchived(customer.company_id)) {

        await ctx.answerCallbackQuery({
            text: t(lang, "company_archived"),
            show_alert: true
        });

        return;
    }


    // Re-verify ownership again at the moment of deletion, not just at the
    // confirm step — the delete query itself is scoped to customer_id, so
    // even a forged callback_data car id can only ever affect a car that
    // is genuinely linked to this Telegram user's own customer record.
    // (status_history for this car is cleaned up automatically via the
    // database's ON DELETE CASCADE — verified empirically before this was
    // implemented, see migrations/ and the FK relationships they assume.)
    const { data: deletedRows, error: deleteError } = await supabase
        .from("cars")
        .delete()
        .eq("id", carId)
        .eq("customer_id", customer.id)
        .select();


    if (deleteError) {

        console.error("Car deletion error:", deleteError);

        await ctx.answerCallbackQuery({
            text: t(lang, "delete_error"),
            show_alert: true
        });

        return;
    }


    if (!deletedRows || deletedRows.length === 0) {

        await ctx.answerCallbackQuery({
            text: t(lang, "car_not_linked_to_you"),
            show_alert: true
        });

        return;
    }


    await ctx.answerCallbackQuery({
        text: t(lang, "delete_success")
    });


    await ctx.editMessageText(t(lang, "delete_success"));


    await showCustomerCars(ctx);

});


bot.callbackQuery(/^delete_car_cancel_(\d+)$/, async (ctx) => {

    const lang = await getLang(ctx);

    await ctx.answerCallbackQuery();

    await ctx.editMessageText(t(lang, "delete_cancelled"));

    await showCustomerCars(ctx);

});


// ==================================================
// BACK TO CUSTOMER MENU
// ==================================================

bot.callbackQuery("customer_menu", async (ctx) => {

    await ctx.answerCallbackQuery();

    await showCustomerCars(ctx, true);

});


// ==================================================
// WEB SERVER
// ==================================================

const app = express();

// Render (and most cloud hosts) terminate TLS at a proxy in front of the
// app and forward plain HTTP internally. Trusting the first hop lets
// Express report req.protocol/req.secure correctly from the
// X-Forwarded-* headers — this is what the super admin panel's
// dynamically-generated login URL and the "secure" session cookies
// (see admin.js / superadmin.js) rely on in production. Harmless
// locally, since there's no proxy in front of a local dev server.
app.set("trust proxy", 1);

app.use(express.urlencoded({
    extended: true
}));

app.use(express.json());


// ==================================================
// HEALTH CHECK
// ==================================================
// Used by the hosting provider to confirm the app is alive. Deliberately
// exposes nothing about the database, Telegram, or session config.

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});


app.use("/admin", adminRouter);
app.use("/superadmin", superAdminRouter);


app.get("/", (req, res) => {

    res.send(
        "🚗 AutoCore is running!"
    );

});


// ==================================================
// TELEGRAM BOT
// ==================================================
// Runs in long-polling mode by default (bot.start()) — this is the
// existing, already-tested behavior and stays the default with zero
// config changes required.
//
// To switch to webhook mode instead (recommended once Render horizontal
// scaling or a multi-instance setup is ever used, since long polling
// only supports a single consumer per bot token), set BOTH:
//   TELEGRAM_WEBHOOK_URL    = https://app.autocore.pl
//   TELEGRAM_WEBHOOK_SECRET = <a long random string>
// and see the deployment notes for the exact `setWebhook` call to run
// once, after deploying with those set. The webhook route must be
// registered here — before the catch-all/error handlers below — or
// Express would never reach it.

bot.api.setMyCommands([
    { command: "start", description: "Start" },
    { command: "status", description: "My cars" },
    { command: "language", description: "Change language" }
]).catch((err) => {
    // A transient failure here (e.g. a momentary network blip at startup)
    // must not crash the whole process — this call's result was never
    // awaited before, and an unhandled rejection here is exactly the
    // class of bug fixed by bot.catch() above, just for a non-update call.
    console.error("setMyCommands failed (non-fatal):", err.message);
});

const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const usingWebhook = !!(webhookUrl && webhookSecret);

if (usingWebhook) {

    app.post(`/telegram/webhook/${webhookSecret}`, webhookCallback(bot, "express"));

} else if (webhookUrl || webhookSecret) {

    console.warn(
        "⚠️  Both TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET must be set to enable " +
        "webhook mode — falling back to long polling."
    );
}


// Catch-all for unknown paths.
app.use((req, res) => {
    res.status(404).send("Not found");
});

// Final error handler — must be declared last, with 4 arguments.
// Never leak stack traces, credentials, or internal details to clients;
// full details still go to the server logs for debugging.
app.use((err, req, res, next) => {

    console.error("Unhandled error:", err);

    res.status(500).send("Something went wrong. Please try again.");
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    const publicUrl = process.env.APP_URL || `http://localhost:${PORT}`;

    console.log(`🌐 AutoCore web server listening on port ${PORT} ${instanceTag()}`);
    console.log(`🌐 Admin panel: ${publicUrl}/admin`);
    console.log(`🛡️  Super admin panel: ${publicUrl}/superadmin`);

    if (usingWebhook) {
        console.log("🤖 AutoCore Telegram Bot ready in webhook mode (route registered).");
        console.log("    Make sure setWebhook has been called — see deployment notes.");
    } else {
        console.log("🚀 AutoCore Telegram Bot: long polling mode enabled (starting below).");
    }
});

if (!usingWebhook) {
    runPollingWithRecovery(bot);
}

// Second, independent bot (own token, own long-polling loop) — does
// nothing if WORKSHOP_BOT_TOKEN isn't set. See workshopBot.js.
startWorkshopBot();
