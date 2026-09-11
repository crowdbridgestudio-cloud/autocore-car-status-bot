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
const { HEAD_META, BASE_STYLES, statusBadgeStyle } = require("./adminStyles");

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
        <div class="lang-switcher">
            <select onchange="window.location.href = '/admin/login?lang=' + this.value">
                ${options}
            </select>
        </div>
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
            ${HEAD_META}
            <style>${BASE_STYLES}</style>
        </head>

        <body>

            <div class="login-header">
                <div class="brand">🚗 AutoCore</div>
                ${renderLoginLanguageSwitcher(lang)}
            </div>

            <div class="login-wrap">

                <div class="login-box">

                    <h1>${at(lang, "login_subtitle")}</h1>

                    ${req.query.suspended ? `<div class="notice-banner error">${at(lang, "account_suspended")}</div>` : ""}
                    ${req.query.archived ? `<div class="notice-banner error">${at(lang, "account_archived")}</div>` : ""}

                    <form method="POST" action="/admin/login">

                        <input type="hidden" name="lang" value="${lang}" />

                        <label>${at(lang, "login_username_placeholder")}</label>
                        <input
                            type="text"
                            name="username"
                            autocomplete="username"
                            required
                        />

                        <label>${at(lang, "login_password_placeholder")}</label>
                        <input
                            type="password"
                            name="password"
                            autocomplete="current-password"
                            required
                        />

                        <button type="submit" class="btn btn-primary btn-block">
                            ${at(lang, "login_button")}
                        </button>

                    </form>

                </div>

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
                id,
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

        const searchKey = escapeHtml(
            [car.brand, car.model, car.registration, car.customers?.name]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
        );

        return `
            <div class="car-card" data-search="${searchKey}">

                <div class="car-primary">

                    <div class="car-title">
                        🚗 ${escapeHtml(car.brand)} ${escapeHtml(car.model)}
                    </div>

                    <div class="car-reg">
                        🔢 ${escapeHtml(car.registration) || at(lang, "registration_missing")}
                    </div>

                    <div class="status-badge" style="${statusBadgeStyle(car.status)}">
                        ${statusLabel(lang, car.status)}
                    </div>

                </div>

                <div class="car-customer">

                    <div class="car-meta">
                        👤 ${escapeHtml(car.customers?.name) || at(lang, "customer_missing")}
                    </div>

                    ${car.customers ? `
                        <div class="car-meta">
                            📱 ${car.customers.phone
                                ? `<a href="tel:${escapeHtml(car.customers.phone)}">${escapeHtml(car.customers.phone)}</a>`
                                : at(lang, "phone_missing")}
                        </div>
                    ` : ""}

                </div>

                <form class="status-form" method="POST" action="/admin/status">

                    <input type="hidden" name="car_id" value="${car.id}" />

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

                    <button class="btn btn-outline">
                        ${at(lang, "change_status_button")}
                    </button>

                </form>

                <div class="actions-row">

                    <a href="/admin/car/${car.id}" class="btn btn-outline">
                        ${at(lang, "qr_button")}
                    </a>

                    <a href="/admin/car/${car.id}/delete" class="btn btn-danger">
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

            ${HEAD_META}

            <style>${BASE_STYLES}</style>

        </head>


        <body>

            <header class="app-header">

                <div class="brand">
                    🚗 ${escapeHtml(companyName)}
                    <span class="tagline">${at(lang, "app_tagline")}</span>
                </div>

                <div class="header-right">
                    ${renderLanguageSwitcher(lang, "/admin")}
                    <a class="logout-link" href="/admin/logout">${at(lang, "logout_button")}</a>
                </div>

            </header>

            <div class="container">

                ${req.query.deleted ? `<div class="notice-banner success">${at(lang, "delete_success_notice")}</div>` : ""}

                <div class="top-row">

                    <h2>${at(lang, "nav_cars_heading")}</h2>

                    <a class="btn btn-primary" href="/admin/add-car">
                        ${at(lang, "nav_add_car")}
                    </a>

                </div>

                ${cars.length > 0 ? `
                    <div class="search-box">
                        <input
                            type="search"
                            id="carSearch"
                            placeholder="${at(lang, "search_placeholder")}"
                            oninput="
                                var q = this.value.toLowerCase();
                                document.querySelectorAll('.car-card').forEach(function (el) {
                                    el.style.display = el.dataset.search.indexOf(q) === -1 ? 'none' : '';
                                });
                            "
                        />
                    </div>
                ` : ""}

                <div id="carList">
                    ${carCards || `<p>${at(lang, "no_cars_yet")}</p>`}
                </div>

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

            ${HEAD_META}

            <style>${BASE_STYLES}</style>

        </head>


        <body>

            <header class="app-header">

                <div class="brand">🚗 AutoCore</div>

                <div class="header-right">
                    ${renderLanguageSwitcher(lang, "/admin/add-car")}
                </div>

            </header>

            <div class="container" style="max-width:600px;">

                <div class="card">

                    <h1>${at(lang, "add_car_title")}</h1>

                    <form method="POST" action="/admin/add-car">

                        <label>${at(lang, "label_customer")}</label>

                        <select name="customer_id">

                            <option value="">
                                ${at(lang, "select_customer_placeholder")}
                            </option>

                            ${customerOptions}

                        </select>


                        <p style="color:#6b7280;font-size:13px;margin:16px 0 4px;">
                            ${at(lang, "new_customer_heading")}
                        </p>

                        <label>${at(lang, "label_new_customer_name")}</label>

                        <input
                            name="new_customer_name"
                        />

                        <label>${at(lang, "label_new_customer_phone")}</label>

                        <input
                            name="new_customer_phone"
                            type="tel"
                            placeholder="+48 123 456 789"
                        />


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


                        <button class="btn btn-primary btn-block" style="margin-top:16px;">
                            ${at(lang, "create_car_button")}
                        </button>

                    </form>

                </div>

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
        new_customer_name,
        new_customer_phone,
        brand,
        model,
        registration,
        vin,
        problem
    } = req.body;


    // Picking an existing customer always wins over the new-customer
    // fields, even if both were somehow submitted — the dropdown holds
    // only this company's own customers (see the GET handler above), so
    // it's the safer of the two to prefer.
    let resolvedCustomerId = customer_id || null;

    if (!resolvedCustomerId && new_customer_name && new_customer_name.trim()) {

        const { data: newCustomer, error: customerError } = await supabase
            .from("customers")
            .insert({
                company_id: req.session.companyId,
                name: new_customer_name.trim(),
                phone: (new_customer_phone || "").trim() || null
            })
            .select()
            .single();

        if (customerError) {

            console.error(customerError);

            return res.send(`
                <h2>${at(lang, "car_create_error_title")}</h2>
                <pre>${escapeHtml(customerError.message)}</pre>
                <a href="/admin/add-car">${at(lang, "go_back")}</a>
            `);
        }

        resolvedCustomerId = newCustomer.id;
    }


    const { data: car, error } = await supabase
        .from("cars")
        .insert({
            company_id: req.session.companyId,
            customer_id: resolvedCustomerId,
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
                id,
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

            ${HEAD_META}

            <style>
                ${BASE_STYLES}
                .qr-img { width: 260px; max-width: 100%; display: block; margin: 12px auto; }
                .telegram-link { word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 16px; }
                .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
            </style>

        </head>


        <body>

            <header class="app-header">
                <div class="brand">🚗 AutoCore</div>
                <div class="header-right">
                    ${renderLanguageSwitcher(lang, `/admin/car/${car.id}`)}
                </div>
            </header>

            <div class="container" style="max-width:560px;">

                <div class="card">

                    <h1>🚗 ${escapeHtml(car.brand)} ${escapeHtml(car.model)}</h1>

                    <p class="car-reg">🔢 ${escapeHtml(car.registration) || at(lang, "registration_missing")}</p>

                    <div class="status-badge" style="${statusBadgeStyle(car.status)}">
                        ${statusLabel(lang, car.status)}
                    </div>

                    <div style="margin:16px 0;">

                        <div class="car-meta">
                            👤 ${escapeHtml(car.customers?.name) || at(lang, "customer_missing")}
                        </div>

                        ${car.customers ? `
                            <div class="car-meta">
                                📱 ${car.customers.phone
                                    ? `<a href="tel:${escapeHtml(car.customers.phone)}">${escapeHtml(car.customers.phone)}</a>`
                                    : at(lang, "phone_missing")}
                                &nbsp;·&nbsp;
                                <a href="/admin/customer/${car.customers.id}/edit">${at(lang, "edit_customer_link")}</a>
                            </div>
                        ` : ""}

                    </div>

                    <form class="status-form" method="POST" action="/admin/status">

                        <input type="hidden" name="car_id" value="${car.id}" />

                        <select name="status">
                            ${STATUS_KEYS
                                .map(value => `
                                    <option value="${value}" ${car.status === value ? "selected" : ""}>
                                        ${statusLabel(lang, value)}
                                    </option>
                                `)
                                .join("")}
                        </select>

                        <button class="btn btn-primary">
                            ${at(lang, "change_status_button")}
                        </button>

                    </form>

                    <div class="actions-row">
                        <a href="/admin/car/${car.id}/delete" class="btn btn-danger btn-block">
                            ${at(lang, "delete_car_button")}
                        </a>
                    </div>

                    <hr class="section-divider" />

                    <h2>${at(lang, "qr_heading")}</h2>

                    <img class="qr-img" src="${qr}" />

                    <p style="text-align:center;color:var(--text-muted);font-size:14px;">
                        ${at(lang, "qr_instructions")}
                    </p>

                    <p class="telegram-link">
                        ${telegramLink}
                    </p>

                    <button onclick="window.print()" class="btn btn-outline btn-block">
                        ${at(lang, "qr_print_button")}
                    </button>

                    <a href="/admin" class="btn btn-outline btn-block" style="margin-top:10px;">
                        ${at(lang, "back_to_admin")}
                    </a>

                </div>

            </div>

        </body>

        </html>
    `);
});


// ==========================================
// EDIT CUSTOMER (name + phone)
// ==========================================
// No dedicated customer management UI exists elsewhere — this is reached
// from the customer's phone number next to their vehicle(s). Always
// scoped to the logged-in admin's own company, so one company's manager
// can never view or edit another company's customer.

router.get("/customer/:id/edit", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const { data: customer, error } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("id", req.params.id)
        .eq("company_id", req.session.companyId)
        .maybeSingle();


    if (error || !customer) {

        return res.send(`
            <h2>${at(lang, "customer_missing")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }


    res.send(`
        <!DOCTYPE html>

        <html>

        <head>

            <title>${at(lang, "edit_customer_title")}</title>

            ${HEAD_META}

            <style>${BASE_STYLES}</style>

        </head>


        <body>

            <header class="app-header">
                <div class="brand">🚗 AutoCore</div>
            </header>

            <div class="container" style="max-width:500px;">

                <div class="card">

                    <h1>${at(lang, "edit_customer_title")}</h1>

                    <form method="POST" action="/admin/customer/${customer.id}/edit">

                        <label>${at(lang, "label_customer")}</label>

                        <input
                            name="name"
                            value="${escapeHtml(customer.name)}"
                            required
                        />

                        <label>${at(lang, "label_phone")}</label>

                        <input
                            name="phone"
                            type="tel"
                            value="${escapeHtml(customer.phone)}"
                            placeholder="+48 123 456 789"
                        />

                        <button class="btn btn-primary btn-block" style="margin-top:8px;">
                            ${at(lang, "save_button")}
                        </button>

                    </form>

                    <a href="/admin" class="btn btn-outline btn-block" style="margin-top:12px;">
                        ${at(lang, "back_to_admin")}
                    </a>

                </div>

            </div>

        </body>

        </html>
    `);
});


router.post("/customer/:id/edit", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const { name, phone } = req.body;

    const { error } = await supabase
        .from("customers")
        .update({
            name,
            phone: (phone || "").trim() || null
        })
        .eq("id", req.params.id)
        .eq("company_id", req.session.companyId);


    if (error) {

        console.error(error);

        return res.send(`
            <h2>${at(lang, "customer_update_error_title")}</h2>
            <pre>${escapeHtml(error.message)}</pre>
            <a href="/admin/customer/${req.params.id}/edit">${at(lang, "go_back")}</a>
        `);
    }


    res.redirect("/admin");
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
            ${HEAD_META}
            <style>
                ${BASE_STYLES}
                .delete-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
                .delete-box { width: 100%; max-width: 440px; text-align: center; }
                .delete-box h1 { color: #991b1b; font-size: 20px; }
                .delete-box p { color: #374151; }
                .car-name { font-weight: bold; font-size: 17px; margin: 10px 0 20px; }
                .delete-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
                .delete-actions form { margin: 0; }
            </style>
        </head>
        <body>
            <div class="delete-wrap">
                <div class="card delete-box">
                    <h1>${at(lang, "delete_confirm_title")}</h1>
                    <div class="car-name">
                        🚗 ${escapeHtml(car.brand)} ${escapeHtml(car.model)}
                        ${car.registration ? `(${escapeHtml(car.registration)})` : ""}
                    </div>
                    <p>${at(lang, "delete_confirm_warning")}</p>
                    <div class="delete-actions">
                        <form method="POST" action="/admin/car/${car.id}/delete">
                            <button type="submit" class="btn btn-danger btn-block">${at(lang, "btn_delete_confirm")}</button>
                        </form>
                        <a class="btn btn-outline btn-block" href="/admin">${at(lang, "btn_delete_cancel")}</a>
                    </div>
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
