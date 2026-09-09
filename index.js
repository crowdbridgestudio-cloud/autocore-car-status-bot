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


const { Bot, InlineKeyboard, webhookCallback } = require("grammy");
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

bot.command("language", async (ctx) => {

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

        const { data, error } = await supabase
            .from("companies")
            .select("*")
            .eq("id", 1)
            .single();


        if (error) {

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
                parse_mode: "Markdown"
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

    console.log(`🌐 AutoCore web server listening on port ${PORT}`);
    console.log(`🌐 Admin panel: ${publicUrl}/admin`);
    console.log(`🛡️  Super admin panel: ${publicUrl}/superadmin`);

    if (usingWebhook) {
        console.log("🤖 AutoCore Telegram Bot ready in webhook mode (route registered).");
        console.log("    Make sure setWebhook has been called — see deployment notes.");
    } else {
        console.log("🚀 AutoCore Telegram Bot started (long polling)!");
    }
});

if (!usingWebhook) {
    bot.start();
}

// Second, independent bot (own token, own long-polling loop) — does
// nothing if WORKSHOP_BOT_TOKEN isn't set. See workshopBot.js.
startWorkshopBot();
