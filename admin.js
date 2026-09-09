const express = require("express");
const QRCode = require("qrcode");
const session = require("express-session");
const bcrypt = require("bcrypt");

const supabase = require("./supabase");

const { Bot } = require("grammy");

const {
    DEFAULT_LANG,
    normalizeLang,
    t,
    statusLabel,
    statusMessage,

    ADMIN_LANGS,
    DEFAULT_ADMIN_LANG,
    ADMIN_LANGUAGE_LABELS,
    normalizeAdminLang,
    at
} = require("./locales");

const { escapeHtml } = require("./utils");

const notificationBot = new Bot(process.env.BOT_TOKEN);

const router = express.Router();


// ==========================================
// CONSTANTS
// ==========================================

const STATUS_KEYS = [
    "received",
    "diagnostics",
    "repair",
    "waiting_parts",
    "testing",
    "payment",
    "ready",
    "delivered",
    "cancelled"
];


// ==========================================
// LANGUAGE SWITCHER (rendered inside the panel, after login)
// ==========================================

function renderLanguageSwitcher(lang, redirectPath) {

    const options = ADMIN_LANGS
        .map(code => `
            <option value="${code}" ${code === lang ? "selected" : ""}>
                ${ADMIN_LANGUAGE_LABELS[code]}
            </option>
        `)
        .join("");

    return `
        <form method="POST" action="/admin/language" class="lang-switcher">
            <input type="hidden" name="redirect" value="${escapeHtml(redirectPath)}" />
            <select name="lang" onchange="this.form.submit()">
                ${options}
            </select>
        </form>
    `;
}


// LANGUAGE SWITCHER for the (unauthenticated) login page — no session/DB
// write available yet, so this just re-navigates with a ?lang= query param.

function renderLoginLanguageSwitcher(lang) {

    const options = ADMIN_LANGS
        .map(code => `
            <option value="${code}" ${code === lang ? "selected" : ""}>
                ${ADMIN_LANGUAGE_LABELS[code]}
            </option>
        `)
        .join("");

    return `
        <select
            class="lang-switcher-login"
            onchange="window.location.href = '/admin/login?lang=' + this.value"
        >
            ${options}
        </select>
    `;
}


// ==========================================
// SESSION
// ==========================================

if (!process.env.SESSION_SECRET) {
    console.warn(
        "⚠️  SESSION_SECRET is not set in .env — using a fallback. " +
        "Set a dedicated SESSION_SECRET for production."
    );
}

// `secure` cookies require HTTPS and rely on index.js's `app.set("trust
// proxy", 1)` so Express can see the real protocol behind Render's proxy.
// Gated on NODE_ENV so local http://localhost dev logins keep working —
// a secure cookie is silently dropped by the browser over plain HTTP.
const isProduction = process.env.NODE_ENV === "production";

router.use(
    session({
        secret: process.env.SESSION_SECRET || "autocore-dev-session-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 8,
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax"
        }
    })
);


// ==========================================
// LOGIN PAGE
// ==========================================

router.get("/login", (req, res) => {

    const lang = normalizeAdminLang(req.query.lang) || DEFAULT_ADMIN_LANG;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>AutoCore Login</title>

            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: #f4f6f8;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    position: relative;
                }

                .lang-switcher-login {
                    position: absolute;
                    top: 20px;
                    right: 20px;
                    padding: 8px;
                    border-radius: 6px;
                }

                .box {
                    background: white;
                    padding: 40px;
                    border-radius: 15px;
                    width: 320px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                }

                h1 {
                    margin-top: 0;
                }

                input {
                    width: 100%;
                    padding: 12px;
                    margin: 10px 0;
                    box-sizing: border-box;
                }

                button {
                    width: 100%;
                    padding: 12px;
                    background: #111827;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                }

                .notice {
                    background: #fee2e2;
                    color: #991b1b;
                    padding: 10px;
                    border-radius: 8px;
                    font-size: 14px;
                    margin-bottom: 10px;
                }
            </style>
        </head>

        <body>

            ${renderLoginLanguageSwitcher(lang)}

            <div class="box">

                <h1>🚗 AutoCore</h1>

                <p>${at(lang, "login_subtitle")}</p>

                ${req.query.suspended ? `<div class="notice">${at(lang, "account_suspended")}</div>` : ""}
                ${req.query.archived ? `<div class="notice">${at(lang, "account_archived")}</div>` : ""}

                <form method="POST" action="/admin/login">

                    <input type="hidden" name="lang" value="${lang}" />

                    <input
                        type="text"
                        name="username"
                        placeholder="${at(lang, "login_username_placeholder")}"
                        required
                    />

                    <input
                        type="password"
                        name="password"
                        placeholder="${at(lang, "login_password_placeholder")}"
                        required
                    />

                    <button type="submit">
                        ${at(lang, "login_button")}
                    </button>

                </form>

            </div>

        </body>
        </html>
    `);
});


// ==========================================
// LOGIN
// ==========================================

router.post("/login", async (req, res) => {

    const {
        username,
        password,
        lang: formLang
    } = req.body;

    const lang = normalizeAdminLang(formLang) || DEFAULT_ADMIN_LANG;


    const { data: admin, error } = await supabase
        .from("admin_accounts")
        .select("*")
        .eq("username", username)
        .maybeSingle();


    if (error || !admin) {

        return res.send(`
            <h2>${at(lang, "login_error_title")}</h2>
            <a href="/admin/login?lang=${lang}">${at(lang, "go_back")}</a>
        `);
    }


    const validPassword = await bcrypt.compare(
        password,
        admin.password_hash
    );


    if (!validPassword) {

        return res.send(`
            <h2>${at(lang, "login_error_title")}</h2>
            <a href="/admin/login?lang=${lang}">${at(lang, "go_back")}</a>
        `);
    }


    // A suspended OR archived company's admins must not be able to log
    // in. If the relevant column hasn't been added yet, it simply comes
    // back undefined and that specific check is skipped — every company
    // behaves as active/not-archived until each migration is applied.
    const { data: company } = await supabase
        .from("companies")
        .select("is_active, archived_at")
        .eq("id", admin.company_id)
        .maybeSingle();

    if (company && company.is_active === false) {

        return res.send(`
            <h2>${at(lang, "account_suspended")}</h2>
            <a href="/admin/login?lang=${lang}">${at(lang, "go_back")}</a>
        `);
    }

    if (company && company.archived_at) {

        return res.send(`
            <h2>${at(lang, "account_archived")}</h2>
            <a href="/admin/login?lang=${lang}">${at(lang, "go_back")}</a>
        `);
    }


    req.session.loggedIn = true;

    req.session.adminId = admin.id;

    req.session.companyId = admin.company_id;

    req.session.adminName = admin.name;

    req.session.adminLang = normalizeAdminLang(admin.language) || DEFAULT_ADMIN_LANG;


    res.redirect("/admin");
});


// ==========================================
// LOGOUT
// ==========================================

router.get("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/admin/login");
    });

});


// ==========================================
// LANGUAGE SWITCH (admin panel)
// ==========================================

router.post("/language", requireLogin, async (req, res) => {

    const { lang, redirect } = req.body;

    const normalized = normalizeAdminLang(lang);

    if (normalized) {

        req.session.adminLang = normalized;

        const { error } = await supabase
            .from("admin_accounts")
            .update({ language: normalized })
            .eq("id", req.session.adminId);

        if (error) {
            console.error("Admin language update error:", error);
        }
    }


    // Only ever redirect back within the admin panel.
    const safeRedirect =
        (typeof redirect === "string" && redirect.startsWith("/admin"))
            ? redirect
            : "/admin";

    res.redirect(safeRedirect);
});


// ==========================================
// AUTH MIDDLEWARE
// ==========================================

async function requireLogin(req, res, next) {

    if (!req.session.loggedIn) {
        return res.redirect("/admin/login");
    }

    // Re-check on every request so a company suspended or archived by the
    // super admin mid-session is immediately logged out, not just blocked
    // at the next login. Fails open (skips the check) on a lookup error
    // or if a column doesn't exist yet, so a transient DB hiccup never
    // locks admins out of an otherwise-working panel.
    const { data: company, error } = await supabase
        .from("companies")
        .select("is_active, archived_at")
        .eq("id", req.session.companyId)
        .maybeSingle();

    if (!error && company && company.is_active === false) {

        return req.session.destroy(() => {
            res.redirect("/admin/login?suspended=1");
        });
    }

    if (!error && company && company.archived_at) {

        return req.session.destroy(() => {
            res.redirect("/admin/login?archived=1");
        });
    }

    next();
}


// ==========================================
// ADMIN DASHBOARD
// ==========================================

router.get("/", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;


    const { data: cars, error } = await supabase
        .from("cars")
        .select(`
            *,
            customers (
                name,
                phone,
                telegram_id
            )
        `)
        .eq("company_id", req.session.companyId)
        .order("created_at", {
            ascending: false
        });


    if (error) {

        console.error(error);

        return res.send(at(lang, "database_error"));
    }


    const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", req.session.companyId)
        .maybeSingle();

    const companyName = company?.name || "AutoCore";


    const carCards = cars.map(car => {

        return `
            <div class="car">

                <div>

                    <h3>
                        ${escapeHtml(car.brand)} ${escapeHtml(car.model)}
                    </h3>

                    <p>
                        🔢 ${escapeHtml(car.registration) || at(lang, "registration_missing")}
                    </p>

                    <p>
                        👤 ${escapeHtml(car.customers?.name) || at(lang, "customer_missing")}
                    </p>

                    <p>
                        ${statusLabel(lang, car.status)}
                    </p>

                </div>


                <div class="actions">

                    <form method="POST" action="/admin/status">

                        <input
                            type="hidden"
                            name="car_id"
                            value="${car.id}"
                        />

                        <select name="status">

                            ${STATUS_KEYS
                                .map(value => `
                                    <option
                                        value="${value}"
                                        ${car.status === value ? "selected" : ""}
                                    >
                                        ${statusLabel(lang, value)}
                                    </option>
                                `)
                                .join("")}

                        </select>

                        <button>
                            ${at(lang, "change_status_button")}
                        </button>

                    </form>


                    <a
                        href="/admin/car/${car.id}"
                        class="qr"
                    >
                        ${at(lang, "qr_button")}
                    </a>

                    <a
                        href="/admin/car/${car.id}/delete"
                        class="qr delete-link"
                    >
                        ${at(lang, "delete_car_button")}
                    </a>

                </div>

            </div>
        `;
    }).join("");


    res.send(`
        <!DOCTYPE html>

        <html>

        <head>

            <title>${at(lang, "dashboard_title")}</title>

            <meta name="viewport" content="width=device-width, initial-scale=1">

            <style>

                * {
                    box-sizing: border-box;
                }

                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    background: #f4f6f8;
                }

                header {
                    background: #111827;
                    color: white;
                    padding: 20px;

                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 15px;
                    flex-wrap: wrap;
                }

                header h1 {
                    margin: 0;
                }

                .header-right {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .lang-switcher select {
                    padding: 8px;
                    border-radius: 6px;
                    border: none;
                }

                .logout-link {
                    color: white;
                    text-decoration: none;
                    background: rgba(255,255,255,0.15);
                    padding: 8px 14px;
                    border-radius: 6px;
                }

                .container {
                    max-width: 1000px;
                    margin: auto;
                    padding: 25px;
                }

                .top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 25px;
                }

                .add {
                    background: #111827;
                    color: white;
                    text-decoration: none;
                    padding: 12px 18px;
                    border-radius: 8px;
                }

                .car {
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 15px;

                    display: flex;
                    justify-content: space-between;
                    align-items: center;

                    box-shadow: 0 3px 12px rgba(0,0,0,0.05);
                }

                .car h3 {
                    margin-top: 0;
                }

                select {
                    padding: 10px;
                }

                button {
                    padding: 10px;
                    cursor: pointer;
                }

                .qr {
                    display: inline-block;
                    margin-top: 10px;
                    padding: 10px;
                    background: #e5e7eb;
                    text-decoration: none;
                    color: black;
                    border-radius: 7px;
                }

                .qr.delete-link {
                    background: #fee2e2;
                    color: #991b1b;
                    margin-left: 8px;
                }

                .notice-banner {
                    max-width: 1000px;
                    margin: 15px auto 0;
                    padding: 12px 16px;
                    border-radius: 8px;
                    font-size: 14px;
                }

                .notice-banner.success {
                    background: #dcfce7;
                    color: #166534;
                }

                @media(max-width:700px) {

                    .car {
                        flex-direction: column;
                        align-items: flex-start;
                    }

                    .actions {
                        margin-top: 15px;
                    }

                }

            </style>

        </head>


        <body>

            <header>

                <div>
                    <h1>🚗 ${escapeHtml(companyName)}</h1>
                    <p>${at(lang, "app_tagline")}</p>
                </div>

                <div class="header-right">
                    ${renderLanguageSwitcher(lang, "/admin")}
                    <a class="logout-link" href="/admin/logout">${at(lang, "logout_button")}</a>
                </div>

            </header>

            ${req.query.deleted ? `<div class="notice-banner success">${at(lang, "delete_success_notice")}</div>` : ""}

            <div class="container">

                <div class="top">

                    <h2>${at(lang, "nav_cars_heading")}</h2>

                    <a
                        class="add"
                        href="/admin/add-car"
                    >
                        ${at(lang, "nav_add_car")}
                    </a>

                </div>


                ${carCards || `<p>${at(lang, "no_cars_yet")}</p>`}

            </div>

        </body>

        </html>
    `);
});


// ==========================================
// ADD CAR PAGE
// ==========================================

router.get("/add-car", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;


    const { data: customers, error } = await supabase
        .from("customers")
        .select("*")
        .eq("company_id", req.session.companyId)
        .order("name");


    if (error) {
        return res.send(at(lang, "database_error"));
    }


    const customerOptions = customers.map(customer => `
        <option value="${customer.id}">
            ${escapeHtml(customer.name)}
        </option>
    `).join("");


    res.send(`
        <!DOCTYPE html>

        <html>

        <head>

            <title>${at(lang, "add_car_page_title")}</title>

            <meta name="viewport" content="width=device-width, initial-scale=1">

            <style>

                body {
                    font-family: Arial;
                    background: #f4f6f8;
                    padding: 30px;
                }

                .box {
                    max-width: 600px;
                    margin: auto;
                    background: white;
                    padding: 30px;
                    border-radius: 15px;
                }

                .top-bar {
                    max-width: 600px;
                    margin: 0 auto 15px;
                    display: flex;
                    justify-content: flex-end;
                }

                input, select, textarea {
                    width: 100%;
                    padding: 12px;
                    margin: 8px 0 18px;
                }

                button {
                    padding: 14px;
                    width: 100%;
                    background: #111827;
                    color: white;
                    border: none;
                    border-radius: 8px;
                }

            </style>

        </head>


        <body>

            <div class="top-bar">
                ${renderLanguageSwitcher(lang, "/admin/add-car")}
            </div>

            <div class="box">

                <h1>${at(lang, "add_car_title")}</h1>


                <form method="POST" action="/admin/add-car">

                    <label>${at(lang, "label_customer")}</label>

                    <select name="customer_id">

                        <option value="">
                            ${at(lang, "select_customer_placeholder")}
                        </option>

                        ${customerOptions}

                    </select>


                    <label>${at(lang, "label_brand")}</label>

                    <input
                        name="brand"
                        placeholder="BMW"
                        required
                    />


                    <label>${at(lang, "label_model")}</label>

                    <input
                        name="model"
                        placeholder="320"
                        required
                    />


                    <label>${at(lang, "label_registration")}</label>

                    <input
                        name="registration"
                        placeholder="EL 12345"
                    />


                    <label>${at(lang, "label_vin")}</label>

                    <input
                        name="vin"
                        placeholder="VIN"
                    />


                    <label>${at(lang, "label_problem")}</label>

                    <textarea
                        name="problem"
                        placeholder="${at(lang, "placeholder_problem")}"
                    ></textarea>


                    <button>
                        ${at(lang, "create_car_button")}
                    </button>

                </form>

            </div>

        </body>

        </html>
    `);
});


// ==========================================
// CREATE CAR
// ==========================================

router.post("/add-car", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const {
        customer_id,
        brand,
        model,
        registration,
        vin,
        problem
    } = req.body;


    const { data: car, error } = await supabase
        .from("cars")
        .insert({
            company_id: req.session.companyId,
            customer_id: customer_id || null,
            brand,
            model,
            registration,
            vin,
            problem,
            status: "received"
        })
        .select()
        .single();


    if (error) {

        console.error(error);

        return res.send(`
            <h2>${at(lang, "car_create_error_title")}</h2>
            <pre>${escapeHtml(error.message)}</pre>
            <a href="/admin/add-car">${at(lang, "go_back")}</a>
        `);
    }


    res.redirect(`/admin/car/${car.id}`);
});


// ==========================================
// QR PAGE
// ==========================================

router.get("/car/:id", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const carId = req.params.id;


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
        .eq("company_id", req.session.companyId)
        .single();


    if (error || !car) {

        return res.send(`
            <h2>${at(lang, "car_not_found_title")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }


    const botUsername = "AutoCoreServiceBot";

    const telegramLink =
        `https://t.me/${botUsername}?start=car_${car.id}`;


    const qr = await QRCode.toDataURL(telegramLink);


    res.send(`
        <!DOCTYPE html>

        <html>

        <head>

            <title>${escapeHtml(car.brand)} ${escapeHtml(car.model)}</title>

            <style>

                body {
                    font-family: Arial;
                    text-align: center;
                    background: #f4f6f8;
                    padding: 40px;
                    position: relative;
                }

                .top-bar {
                    max-width: 500px;
                    margin: 0 auto 15px;
                    display: flex;
                    justify-content: flex-end;
                }

                .box {
                    background: white;
                    max-width: 500px;
                    margin: auto;
                    padding: 30px;
                    border-radius: 15px;
                }

                img {
                    width: 300px;
                    max-width: 100%;
                }

                .link {
                    word-break: break-all;
                    background: #eee;
                    padding: 10px;
                }

                button {
                    padding: 12px 20px;
                    cursor: pointer;
                }

            </style>

        </head>


        <body>

            <div class="top-bar">
                ${renderLanguageSwitcher(lang, `/admin/car/${car.id}`)}
            </div>

            <div class="box">

                <h1>🚗 ${escapeHtml(car.brand)} ${escapeHtml(car.model)}</h1>

                <p>
                    🔢 ${escapeHtml(car.registration)}
                </p>

                <p>
                    👤 ${escapeHtml(car.customers?.name) || at(lang, "customer_missing")}
                </p>


                <h2>${at(lang, "qr_heading")}</h2>

                <img src="${qr}" />


                <p>
                    ${at(lang, "qr_instructions")}
                </p>


                <p class="link">
                    ${telegramLink}
                </p>


                <button onclick="window.print()">
                    ${at(lang, "qr_print_button")}
                </button>


                <br><br>

                <a href="/admin">
                    ${at(lang, "back_to_admin")}
                </a>

            </div>

        </body>

        </html>
    `);
});


// ==========================================
// DELETE CAR — CONFIRMATION PAGE
// ==========================================

router.get("/car/:id/delete", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const carId = req.params.id;

    const { data: car, error } = await supabase
        .from("cars")
        .select("*")
        .eq("id", carId)
        .eq("company_id", req.session.companyId)
        .maybeSingle();

    if (error || !car) {

        return res.send(`
            <h2>${at(lang, "car_not_found_title")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${at(lang, "delete_confirm_title")}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial, sans-serif; background: #f4f6f8; padding: 40px 20px; }
                .box { max-width: 440px; margin: auto; background: white; padding: 30px; border-radius: 15px; text-align: center; }
                h1 { color: #991b1b; font-size: 20px; margin-top: 0; }
                p { color: #374151; }
                .car-name { font-weight: bold; font-size: 17px; margin: 10px 0 20px; }
                .actions { display: flex; gap: 10px; margin-top: 20px; }
                button, a.btn { flex: 1; padding: 13px; border-radius: 8px; border: none; font-size: 15px; cursor: pointer; text-decoration: none; text-align: center; font-family: inherit; }
                .btn-delete { background: #dc2626; color: white; width: 100%; }
                .btn-cancel { background: #e5e7eb; color: #111827; }
            </style>
        </head>
        <body>
            <div class="box">
                <h1>${at(lang, "delete_confirm_title")}</h1>
                <div class="car-name">
                    🚗 ${escapeHtml(car.brand)} ${escapeHtml(car.model)}
                    ${car.registration ? `(${escapeHtml(car.registration)})` : ""}
                </div>
                <p>${at(lang, "delete_confirm_warning")}</p>
                <div class="actions">
                    <a class="btn btn-cancel" href="/admin">${at(lang, "btn_delete_cancel")}</a>
                    <form method="POST" action="/admin/car/${car.id}/delete" style="flex:1; margin:0;">
                        <button type="submit" class="btn-delete">${at(lang, "btn_delete_confirm")}</button>
                    </form>
                </div>
            </div>
        </body>
        </html>
    `);
});


// ==========================================
// DELETE CAR — EXECUTE
// ==========================================

router.post("/car/:id/delete", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const carId = req.params.id;

    // Ownership check IS the WHERE clause — this can never delete a car
    // belonging to another company, no matter what id is in the URL.
    // status_history for this car cascades automatically at the database
    // level (empirically verified — ON DELETE CASCADE on
    // status_history.car_id — before this route was written).
    const { data: deletedRows, error } = await supabase
        .from("cars")
        .delete()
        .eq("id", carId)
        .eq("company_id", req.session.companyId)
        .select();

    if (error) {

        console.error("Car deletion error:", error);

        return res.send(`
            <h2>${at(lang, "delete_error_title")}</h2>
            <pre>${escapeHtml(error.message)}</pre>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }

    if (!deletedRows || deletedRows.length === 0) {

        return res.send(`
            <h2>${at(lang, "car_not_found_title")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }

    res.redirect("/admin?deleted=1");
});


// ==========================================
// CHANGE STATUS + SEND TELEGRAM NOTIFICATION
// ==========================================

router.post("/status", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const {
        car_id,
        status
    } = req.body;


    // --------------------------------------
    // GET CAR + CUSTOMER
    // --------------------------------------

    const { data: car, error: carError } = await supabase
        .from("cars")
        .select(`
            *,
            customers (
                id,
                name,
                phone,
                telegram_id
            ),
            companies (
                name
            )
        `)
        .eq("id", car_id)
        .eq("company_id", req.session.companyId)
        .single();


    if (carError || !car) {

        console.error("Car error:", carError);

        return res.send(`
            <h2>${at(lang, "car_not_found_title")}</h2>
            <a href="/admin">${at(lang, "go_back")}</a>
        `);
    }


    const oldStatus = car.status;


    // --------------------------------------
    // UPDATE CAR STATUS
    // --------------------------------------

    const { error: updateError } = await supabase
        .from("cars")
        .update({
            status: status,
            updated_at: new Date().toISOString()
        })
        .eq("id", car_id)
        .eq("company_id", req.session.companyId)


    if (updateError) {

        console.error("Status update error:", updateError);

        return res.send(`
            <h2>${at(lang, "status_update_error_title")}</h2>
            <pre>${escapeHtml(updateError.message)}</pre>
            <a href="/admin">${at(lang, "go_back")}</a>
        `);
    }


    // --------------------------------------
    // SAVE STATUS HISTORY
    // --------------------------------------

    const { error: historyError } = await supabase
        .from("status_history")
        .insert({
            car_id: car_id,
            old_status: oldStatus,
            new_status: status
        });


    if (historyError) {
        console.error("History error:", historyError);
    }


    // --------------------------------------
    // SEND TELEGRAM NOTIFICATION (in the customer's own language —
    // this uses the customer-facing locale system and is unrelated to
    // the admin panel's language, which only affects this admin's UI).
    // --------------------------------------

    const telegramId = car.customers?.telegram_id;

    if (telegramId) {

        let customerLang = DEFAULT_LANG;

        const { data: langRow } = await supabase
            .from("customers")
            .select("language")
            .eq("id", car.customers.id)
            .maybeSingle();

        if (langRow && langRow.language) {
            customerLang = normalizeLang(langRow.language) || DEFAULT_LANG;
        }


        const message =
            `🚗 *${car.brand} ${car.model}*\n\n` +

            t(customerLang, "status_updated_title") +

            `${statusLabel(customerLang, status)}\n\n` +

            `${statusMessage(customerLang, status)}\n\n` +

            `📍 ${car.companies?.name || "AutoCore"}`;


        try {

            await notificationBot.api.sendMessage(
                telegramId,
                message,
                {
                    parse_mode: "Markdown"
                }
            );

            console.log(
                `📨 Telegram notification sent to ${telegramId}`
            );

        } catch (telegramError) {

            console.error(
                "Telegram notification error:",
                telegramError
            );
        }

    } else {

        console.log(
            "ℹ️ Customer has no Telegram account connected."
        );
    }


    // --------------------------------------
    // BACK TO ADMIN
    // --------------------------------------

    res.redirect("/admin");
});

module.exports = router;
