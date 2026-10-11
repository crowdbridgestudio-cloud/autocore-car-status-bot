const express = require("express");
const QRCode = require("qrcode");
const session = require("express-session");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

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
const { HEAD_META, BASE_STYLES, statusBadgeStyle, DOUBLE_SUBMIT_GUARD_SCRIPT, icon, renderAppShell } = require("./adminStyles");

const notificationBot = new Bot(process.env.BOT_TOKEN);

const router = express.Router();


// ==========================================
// CREATE-VEHICLE IDEMPOTENCY GUARD
// ==========================================
// In-process only (matches the existing in-memory languageCache pattern
// in index.js — this app runs as a single Render instance, no
// multi-process/Redis concern here). Keyed by a random token minted
// fresh every time the Add Car FORM is rendered (GET /add-car) and
// carried through as a hidden field, so: a double-click or Enter-key
// resubmit of the SAME page load reuses the SAME token and is deduped;
// reloading the page (or opening a second tab) mints a NEW token, so an
// intentionally separate vehicle is never blocked. A naive "reject if
// this registration already exists" rule was deliberately avoided — two
// companies, or even one, can legitimately have duplicate registrations
// (already true of real data in this system).
//
// Entries are pruned lazily (on the next POST) once older than 10
// minutes — plenty for even a very slow double-click, tiny enough to
// never be a real memory concern for an admin-panel form.
const pendingCarCreations = new Map();
const CREATE_CAR_TOKEN_TTL_MS = 10 * 60 * 1000;

function pruneExpiredCarTokens() {

    const now = Date.now();

    for (const [key, entry] of pendingCarCreations) {
        if (now - entry.startedAt > CREATE_CAR_TOKEN_TTL_MS) {
            pendingCarCreations.delete(key);
        }
    }
}


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

// Status groupings for the 3-section navigation (Repairs / Ready /
// Archive). Purely a display grouping — every one of these is still a
// plain value from STATUS_KEYS above, nothing new is introduced at the
// data layer. "Active Repairs" deliberately excludes "ready" (it gets
// its own section) and excludes delivered/cancelled (those are Archive).
const ARCHIVE_STATUSES = ["delivered", "cancelled"];

// Deliberately lenient (5-17 alphanumeric characters, not a strict
// 17-character/check-digit VIN validator) — real-world data already
// includes older and non-standard vehicles where a textbook 17-char VIN
// doesn't apply, and this is a workshop tool, not a vehicle-registry
// authority. The goal is to reject missing/empty/garbage input, not to
// certify VIN correctness.
function isValidVin(vin) {
    if (!vin || typeof vin !== "string") return false;
    const trimmed = vin.trim();
    return trimmed.length >= 5 && trimmed.length <= 17 && /^[A-Za-z0-9]+$/.test(trimmed);
}

// Produces the digit string wa.me needs (no "+", no spaces/punctuation),
// or null if the input can't be trusted to be a complete, real number.
// Deliberately conservative — a loose 8-15 digit sanity bound (realistic
// international phone number lengths), never padding/guessing a country
// code or any other digit that isn't already in the input. Stripping a
// leading "+" is removing a formatting character, not inventing data.
function toWhatsappDigits(phone) {
    if (!phone || typeof phone !== "string") return null;
    const digits = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
    return /^\d{8,15}$/.test(digits) ? digits : null;
}

// Real Telegram username rules: 5-32 characters, starts with a letter,
// letters/digits/underscores only. Returns the cleaned username (a
// leading "@" is stripped — that's how people naturally type it, not
// part of the username itself), or the literal string "INVALID" if
// something was entered but doesn't look like a real username — the
// caller distinguishes "nothing entered" (null, fine, optional field)
// from "entered but wrong" (must be rejected, not silently dropped).
function sanitizeTelegramUsername(input) {
    if (!input || typeof input !== "string") return null;
    const trimmed = input.trim();
    if (trimmed === "") return null;
    const cleaned = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(cleaned) ? cleaned : "INVALID";
}

const CONTACT_METHODS = ["telegram", "whatsapp"];

function sanitizeContactMethod(input) {
    return CONTACT_METHODS.includes(input) ? input : null;
}
const READY_STATUSES = ["ready"];
const ACTIVE_STATUSES = STATUS_KEYS.filter(
    (s) => !ARCHIVE_STATUSES.includes(s) && !READY_STATUSES.includes(s)
);


// ==========================================
// SHARED PAGE SHELL (bottom nav / sidebar)
// ==========================================

function navLabels(lang) {
    return {
        repairs: at(lang, "nav_repairs"),
        ready: at(lang, "nav_ready"),
        archive: at(lang, "nav_archive"),
        customers: at(lang, "nav_customers"),
        more: at(lang, "nav_more")
    };
}

function renderShellPage({ lang, activeKey, pageTitle, bodyHtml, headerRight = "", extraStyles = "" }) {

    const safeTitle = escapeHtml(pageTitle);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${safeTitle}</title>
            ${HEAD_META}
            <style>${BASE_STYLES}${extraStyles}</style>
        </head>
        <body>
            ${renderAppShell({
                activeKey,
                pageTitle: safeTitle,
                navLabels: navLabels(lang),
                bodyHtml,
                headerRight
            })}
            ${DOUBLE_SUBMIT_GUARD_SCRIPT}
        </body>
        </html>
    `;
}

// Deliberately locale-agnostic "Xd Yh" shorthand rather than a fully
// translated duration string — kept simple for this preview; every
// language already renders the surrounding label (time_in_service_label)
// translated, only the number+unit shorthand itself is not.
function formatDurationSince(isoString) {

    if (!isoString) return null;

    const ms = Date.now() - new Date(isoString).getTime();

    if (!(ms >= 0)) return null;

    const hours = Math.floor(ms / 3600000);

    if (hours < 1) return "<1h";
    if (hours < 24) return `${hours}h`;

    const days = Math.floor(hours / 24);
    const remHours = hours % 24;

    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

// The single "Message customer" action on a card/row — driven by the
// customer's OWN chosen contact_method, never both channels at once and
// never a fabricated link:
//   - contact_method = "whatsapp": a real wa.me link ONLY when the
//     stored phone number normalizes to a complete, valid number
//     (toWhatsappDigits) — otherwise an honest "no valid number" state
//     pointing at `fallbackHref` (where staff can fix the phone number).
//   - contact_method = "telegram": a real t.me/<username> link ONLY
//     when a public username is on file — a bare telegram_id can never
//     reliably produce one. Otherwise points at `fallbackHref` (the
//     existing QR/connect route) and says so plainly — it does NOT
//     claim to open a chat.
//   - no contact_method chosen (legacy customers, or never set): a
//     plain disabled state explaining nothing has been selected yet.
// `fallbackHref` is supplied by the caller because what "go fix this"
// should point to differs by context (a specific vehicle's detail page
// on a vehicle card; that customer's edit page on the Customers list).
function renderMessageAction(customer, lang, fallbackHref) {

    if (!customer || !customer.contact_method) {
        return `<span class="icon-btn disabled" aria-label="${at(lang, "no_contact_method")}">${icon("message")}</span>`;
    }

    if (customer.contact_method === "whatsapp") {

        const digits = toWhatsappDigits(customer.phone);

        if (digits) {
            return `<a class="icon-btn icon-btn-accent" href="https://wa.me/${digits}" target="_blank" rel="noopener noreferrer" aria-label="${at(lang, "message_on_whatsapp")}">${icon("whatsapp")}</a>`;
        }

        return `<a class="icon-btn" href="${fallbackHref}" aria-label="${at(lang, "whatsapp_no_valid_number")}">${icon("whatsapp")}</a>`;
    }

    // contact_method === "telegram"
    if (customer.telegram_username) {
        return `<a class="icon-btn icon-btn-accent" href="https://t.me/${encodeURIComponent(customer.telegram_username)}" target="_blank" rel="noopener noreferrer" aria-label="${at(lang, "chat_on_telegram")}">${icon("telegram")}</a>`;
    }

    return `<a class="icon-btn" href="${fallbackHref}" aria-label="${at(lang, "telegram_not_linked")}">${icon("telegram")}</a>`;
}

// Fuller version of the same 3-state logic for the vehicle detail page
// — not linked shows the existing, already-secure QR/deep-link flow
// (unchanged mechanism, see index.js's connect_car_ handler); linked
// shows either a real "Chat on Telegram" button (username known) or an
// honest "connected, but no public username" note (username unknown) —
// never a fabricated link either way.
function renderTelegramSection({ car, lang, qr, telegramLink }) {

    const customer = car.customers;

    if (!customer || !customer.telegram_id) {
        return `
            <p>${at(lang, "telegram_not_linked_instructions")}</p>
            <img class="qr-img" src="${qr}" />
            <p style="text-align:center;color:var(--text-muted);font-size:14px;">${at(lang, "qr_instructions")}</p>
            <p class="telegram-link">${telegramLink}</p>
            <button onclick="window.print()" class="btn btn-outline btn-block">${at(lang, "qr_print_button")}</button>
        `;
    }

    if (customer.telegram_username) {
        return `
            <p class="notice-banner success">${at(lang, "telegram_linked_notice")}</p>
            <a class="btn btn-primary btn-block" href="https://t.me/${encodeURIComponent(customer.telegram_username)}" target="_blank" rel="noopener noreferrer">
                ${at(lang, "chat_on_telegram")}
            </a>
        `;
    }

    return `
        <p class="notice-banner success">${at(lang, "telegram_linked_notice")}</p>
        <p style="color:var(--text-muted);font-size:14px;">${at(lang, "telegram_linked_no_username_hint")}</p>
    `;
}

function renderVehicleCard(car, lang, opts = {}) {

    const { showStatusForm = true, showTimeInService = true } = opts;

    const customerName = car.customers?.name;
    const phone = car.customers?.phone;

    const callAction = phone
        ? `<a class="icon-btn" href="tel:${escapeHtml(phone)}" aria-label="${at(lang, "call_customer_label")}">${icon("phone")}</a>`
        : `<span class="icon-btn disabled" aria-label="${at(lang, "call_customer_label")}">${icon("phone")}</span>`;

    const messageAction = renderMessageAction(car.customers, lang, `/admin/car/${car.id}`);

    let timeBadge = "";

    if (showTimeInService && car.created_at) {

        const duration = formatDurationSince(car.created_at);

        if (duration) {
            timeBadge = `<span class="meta-item">${icon("clock")} ${at(lang, "time_in_service_label", { duration })}</span>`;
        }
    }

    const statusForm = showStatusForm ? `
        <form class="status-form" method="POST" action="/admin/status">
            <input type="hidden" name="car_id" value="${car.id}" />
            <select name="status">
                ${STATUS_KEYS.map((value) => `
                    <option value="${value}" ${car.status === value ? "selected" : ""}>${statusLabel(lang, value)}</option>
                `).join("")}
            </select>
            <button class="btn btn-outline">${at(lang, "change_status_button")}</button>
        </form>
    ` : "";

    const searchKey = escapeHtml(
        [car.brand, car.model, car.registration, customerName].filter(Boolean).join(" ").toLowerCase()
    );

    return `
        <div class="vcard" data-search="${searchKey}" data-status="${car.status}">

            <div class="vcard-top">
                <div>
                    <div class="vcard-title">${escapeHtml(car.brand)} ${escapeHtml(car.model)}</div>
                    <div class="vcard-reg">${escapeHtml(car.registration) || at(lang, "registration_missing")}</div>
                    <div class="vcard-vin">${at(lang, "vin_label")}: ${car.vin ? escapeHtml(car.vin) : `<span class="vin-missing">${at(lang, "vin_not_on_file")}</span>`}</div>
                </div>
                <div class="status-badge" style="${statusBadgeStyle(car.status)}">${statusLabel(lang, car.status)}</div>
            </div>

            <div class="vcard-meta-row">
                <span class="meta-item">${icon("customers")} ${escapeHtml(customerName) || at(lang, "customer_missing")}</span>
                ${timeBadge}
            </div>

            <div class="vcard-actions">
                ${statusForm}
                ${callAction}
                ${messageAction}
                <a class="icon-btn" href="/admin/car/${car.id}" aria-label="${at(lang, "details_button_label")}">${icon("info")}</a>
            </div>

        </div>
    `;
}

// Shared client-side filter script: free-text search (on .vcard's
// data-search) combined with an optional status-pill filter (on
// data-status) via simple AND logic. Vanilla JS, same inline-script
// pattern already used by the pre-redesign dashboard's search box — no
// new framework/build step introduced.
function renderFilterScript({ searchInputId, hasPills, cardSelector = ".vcard" }) {
    return `
        <script>
        (function () {
            var search = document.getElementById("${searchInputId}");
            var pills = document.querySelectorAll(".filter-pill");
            var cards = document.querySelectorAll("${cardSelector}");
            var activeStatus = "all";

            function applyFilters() {
                var q = search ? search.value.toLowerCase() : "";
                cards.forEach(function (card) {
                    var matchesSearch = !q || card.dataset.search.indexOf(q) !== -1;
                    var matchesStatus = activeStatus === "all" || card.dataset.status === activeStatus;
                    card.style.display = (matchesSearch && matchesStatus) ? "" : "none";
                });
            }

            if (search) search.addEventListener("input", applyFilters);

            ${hasPills ? `
            pills.forEach(function (pill) {
                pill.addEventListener("click", function () {
                    activeStatus = pill.dataset.status;
                    pills.forEach(function (p) { p.setAttribute("aria-pressed", p === pill ? "true" : "false"); });
                    applyFilters();
                });
            });
            ` : ""}
        })();
        </script>
    `;
}


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

            ${DOUBLE_SUBMIT_GUARD_SCRIPT}

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


    const { data: allCars, error } = await supabase
        .from("cars")
        .select(`
            *,
            customers (
                id,
                name,
                phone,
                telegram_id,
                telegram_username,
                contact_method
            )
        `)
        .eq("company_id", req.session.companyId)
        .order("updated_at", {
            ascending: false
        });


    if (error) {

        console.error(error);

        return res.send(at(lang, "database_error"));
    }


    // Active Repairs excludes "ready" (its own section, see GET /ready)
    // and delivered/cancelled (Archive, see GET /archive) — see
    // ACTIVE_STATUSES above.
    const cars = allCars.filter((car) => ACTIVE_STATUSES.includes(car.status));

    const inProgressCount = cars.filter((c) => c.status !== "waiting_parts").length;
    const waitingPartsCount = cars.filter((c) => c.status === "waiting_parts").length;
    const readyCount = allCars.filter((c) => c.status === "ready").length;


    const statPills = STATUS_KEYS.filter((s) => s !== "ready" && !ARCHIVE_STATUSES.includes(s));

    const filterPillsHtml = `
        <button type="button" class="filter-pill" data-status="all" aria-pressed="true">${at(lang, "filter_all")}</button>
        ${statPills.map((s) => `
            <button type="button" class="filter-pill" data-status="${s}" aria-pressed="false">${statusLabel(lang, s)}</button>
        `).join("")}
    `;

    const cardsHtml = cars.map((car) => renderVehicleCard(car, lang)).join("");

    const emptyState = `
        <div class="empty-state">
            ${icon("repairs")}
            <p>${at(lang, "empty_active_repairs")}</p>
        </div>
    `;

    const bodyHtml = `
        ${req.query.deleted ? `<div class="notice-banner success">${at(lang, "delete_success_notice")}</div>` : ""}

        <div class="top-row">
            <h2>${at(lang, "nav_cars_heading")}</h2>
            <a class="btn btn-primary" href="/admin/add-car">${at(lang, "nav_add_car")}</a>
        </div>

        <div class="stat-row">
            <div class="stat-tile"><div class="stat-value">${inProgressCount}</div><div class="stat-label">${at(lang, "active_stat_in_progress")}</div></div>
            <div class="stat-tile"><div class="stat-value">${waitingPartsCount}</div><div class="stat-label">${at(lang, "active_stat_waiting_parts")}</div></div>
            <div class="stat-tile"><div class="stat-value">${readyCount}</div><div class="stat-label">${at(lang, "active_stat_ready")}</div></div>
        </div>

        ${cars.length > 0 ? `
            <div class="search-box">
                <input type="search" id="vehicleSearch" placeholder="${at(lang, "search_placeholder")}" />
            </div>
            <div class="filter-row">${filterPillsHtml}</div>
        ` : ""}

        <div id="carList">
            ${cardsHtml || emptyState}
        </div>

        ${renderFilterScript({ searchInputId: "vehicleSearch", hasPills: true })}
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "repairs",
        pageTitle: at(lang, "nav_repairs"),
        bodyHtml
    }));
});


// ==========================================
// READY FOR PICKUP
// ==========================================

router.get("/ready", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const { data: cars, error } = await supabase
        .from("cars")
        .select(`*, customers ( id, name, phone, telegram_id, telegram_username, contact_method )`)
        .eq("company_id", req.session.companyId)
        .eq("status", "ready")
        .order("updated_at", { ascending: false });

    if (error) {
        console.error(error);
        return res.send(at(lang, "database_error"));
    }

    const cardsHtml = cars.map((car) => renderVehicleCard(car, lang, { showTimeInService: false })).join("");

    const emptyState = `
        <div class="empty-state">
            ${icon("ready")}
            <p>${at(lang, "empty_ready")}</p>
        </div>
    `;

    const bodyHtml = `
        <div class="top-row">
            <h2>${at(lang, "ready_page_title")}</h2>
        </div>
        <div id="readyList">
            ${cardsHtml || emptyState}
        </div>
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "ready",
        pageTitle: at(lang, "nav_ready"),
        bodyHtml
    }));
});


// ==========================================
// ARCHIVE (delivered + cancelled)
// ==========================================

router.get("/archive", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const { data: cars, error } = await supabase
        .from("cars")
        .select(`*, customers ( id, name, phone, telegram_id, telegram_username, contact_method )`)
        .eq("company_id", req.session.companyId)
        .in("status", ARCHIVE_STATUSES)
        .order("updated_at", { ascending: false });

    if (error) {
        console.error(error);
        return res.send(at(lang, "database_error"));
    }

    const cardsHtml = cars.map((car) => renderVehicleCard(car, lang, { showStatusForm: false, showTimeInService: false })).join("");

    const emptyState = `
        <div class="empty-state">
            ${icon("archive")}
            <p>${at(lang, "empty_archive")}</p>
        </div>
    `;

    const bodyHtml = `
        <div class="top-row">
            <h2>${at(lang, "archive_page_title")}</h2>
        </div>

        ${cars.length > 0 ? `
            <div class="search-box">
                <input type="search" id="archiveSearch" placeholder="${at(lang, "archive_search_placeholder")}" />
            </div>
        ` : ""}

        <div id="archiveList">
            ${cardsHtml || emptyState}
        </div>

        ${renderFilterScript({ searchInputId: "archiveSearch", hasPills: false })}
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "archive",
        pageTitle: at(lang, "nav_archive"),
        bodyHtml
    }));
});


// ==========================================
// CUSTOMERS DIRECTORY
// ==========================================

router.get("/customers", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const { data: customers, error } = await supabase
        .from("customers")
        .select("id, name, phone, telegram_id, telegram_username, contact_method")
        .eq("company_id", req.session.companyId)
        .order("name");

    if (error) {
        console.error(error);
        return res.send(at(lang, "database_error"));
    }

    const { data: cars } = await supabase
        .from("cars")
        .select("id, brand, model, registration, vin, customer_id")
        .eq("company_id", req.session.companyId);

    const carsByCustomer = {};

    for (const car of (cars || [])) {
        if (!car.customer_id) continue;
        if (!carsByCustomer[car.customer_id]) carsByCustomer[car.customer_id] = [];
        carsByCustomer[car.customer_id].push(car);
    }

    const customerCardsHtml = customers.map((customer) => {

        const vehicles = carsByCustomer[customer.id] || [];

        const vehiclesHtml = vehicles.length > 0
            ? vehicles.map((v) => `<span class="pill-muted">${escapeHtml(v.brand)} ${escapeHtml(v.model)}${v.registration ? ` · ${escapeHtml(v.registration)}` : ""} · ${at(lang, "vin_label")}: ${v.vin ? escapeHtml(v.vin) : at(lang, "vin_not_on_file")}</span>`).join(" ")
            : `<span class="pill-muted">${at(lang, "customers_no_vehicles")}</span>`;

        const callAction = customer.phone
            ? `<a class="icon-btn" href="tel:${escapeHtml(customer.phone)}" aria-label="${at(lang, "call_customer_label")}">${icon("phone")}</a>`
            : `<span class="icon-btn disabled" aria-label="${at(lang, "call_customer_label")}">${icon("phone")}</span>`;

        // Where "go fix this" should point depends on the channel: a
        // WhatsApp number is fixed on this customer's own edit page;
        // completing a Telegram connection needs the QR code, which only
        // ever lives on one of their vehicle's detail pages (reusing the
        // existing, already-secure per-vehicle QR/connect flow rather
        // than inventing a separate customer-level linking mechanism). A
        // customer can only ever be created alongside a vehicle in this
        // app today, so "zero vehicles" is a rare edge (e.g. historical
        // data), not a normal flow — falls back to the edit page then.
        const messageFallbackHref = customer.contact_method === "whatsapp" || vehicles.length === 0
            ? `/admin/customer/${customer.id}/edit`
            : `/admin/car/${vehicles[0].id}`;

        const messageAction = renderMessageAction(customer, lang, messageFallbackHref);

        const searchKey = escapeHtml(
            [customer.name, customer.phone, ...vehicles.map((v) => `${v.brand} ${v.model} ${v.registration || ""} ${v.vin || ""}`)]
                .filter(Boolean).join(" ").toLowerCase()
        );

        return `
            <div class="customer-card" data-search="${searchKey}">
                <div class="customer-name">${escapeHtml(customer.name)}</div>
                <div class="customer-vehicles">${vehiclesHtml}</div>
                <div class="vcard-actions">
                    ${callAction}
                    ${messageAction}
                </div>
            </div>
        `;
    }).join("");

    const emptyState = `
        <div class="empty-state">
            ${icon("customers")}
            <p>${at(lang, "empty_customers")}</p>
        </div>
    `;

    const bodyHtml = `
        <div class="top-row">
            <h2>${at(lang, "customers_page_title")}</h2>
        </div>

        ${customers.length > 0 ? `
            <div class="search-box">
                <input type="search" id="customerSearch" placeholder="${at(lang, "search_placeholder")}" />
            </div>
        ` : ""}

        <div id="customerList">
            ${customerCardsHtml || emptyState}
        </div>

        ${renderFilterScript({ searchInputId: "customerSearch", hasPills: false, cardSelector: ".customer-card" })}
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "customers",
        pageTitle: at(lang, "nav_customers"),
        bodyHtml
    }));
});


// ==========================================
// MORE (settings / secondary tools)
// ==========================================

router.get("/more", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const bodyHtml = `
        <div class="top-row">
            <h2>${at(lang, "more_page_title")}</h2>
        </div>

        <div class="more-list">
            <a class="more-item" href="/admin/telegram-setup">
                ${icon("telegram")}
                <span>${at(lang, "nav_telegram_setup")}</span>
                ${icon("chevron", "chevron")}
            </a>
        </div>

        <p style="color:var(--text-muted);font-size:13px;margin:20px 0 8px;">${at(lang, "language_label")}</p>
        <div class="card" style="padding:12px;">
            ${renderLanguageSwitcher(lang, "/admin/more")}
        </div>

        <div class="more-list" style="margin-top:16px;">
            <a class="more-item" href="/admin/logout">
                ${icon("logout")}
                <span>${at(lang, "logout_button")}</span>
                ${icon("chevron", "chevron")}
            </a>
        </div>
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "more",
        pageTitle: at(lang, "more_page_title"),
        bodyHtml
    }));
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


    // Minted fresh on every page render — see pendingCarCreations above.
    const idempotencyKey = crypto.randomUUID();


    const bodyHtml = `
            <div class="container" style="max-width:600px;padding:0;">

                <div class="card">

                    <h1>${at(lang, "add_car_title")}</h1>

                    <form method="POST" action="/admin/add-car">

                        <input type="hidden" name="idempotency_key" value="${idempotencyKey}" />

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

                        <p style="color:var(--text-muted);font-size:12px;margin:2px 0 14px;">${at(lang, "phone_whatsapp_hint")}</p>

                        <label>${at(lang, "contact_method_label")}</label>

                        <div class="contact-method-row">
                            <label class="contact-method-option">
                                <input type="radio" name="contact_method" value="telegram" checked onchange="document.getElementById('telegramUsernameField').style.display = this.checked ? '' : 'none';" />
                                ${at(lang, "contact_method_telegram")}
                            </label>
                            <label class="contact-method-option">
                                <input type="radio" name="contact_method" value="whatsapp" onchange="document.getElementById('telegramUsernameField').style.display = this.checked ? 'none' : '';" />
                                ${at(lang, "contact_method_whatsapp")}
                            </label>
                        </div>

                        <div id="telegramUsernameField">

                            <label>${at(lang, "label_telegram_username")}</label>

                            <input
                                name="telegram_username"
                                placeholder="johnsmith"
                            />

                            <p style="color:var(--text-muted);font-size:12px;margin:2px 0 0;">${at(lang, "telegram_username_hint")}</p>

                        </div>


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
                            required
                            minlength="5"
                            maxlength="17"
                            pattern="[A-Za-z0-9]+"
                            title="${at(lang, "vin_format_hint")}"
                        />


                        <label>${at(lang, "label_problem")}</label>

                        <textarea
                            name="problem"
                            placeholder="${at(lang, "placeholder_problem")}"
                        ></textarea>


                        <button
                            class="btn btn-primary btn-block"
                            style="margin-top:16px;"
                            data-loading-text="${at(lang, "create_car_loading")}"
                        >
                            ${at(lang, "create_car_button")}
                        </button>

                    </form>

                </div>

            </div>
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "repairs",
        pageTitle: at(lang, "add_car_title"),
        bodyHtml
    }));
});


// ==========================================
// CREATE CAR
// ==========================================

router.post("/add-car", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const {
        idempotency_key: idempotencyKey,
        customer_id,
        new_customer_name,
        new_customer_phone,
        contact_method: contactMethodInput,
        telegram_username: telegramUsernameInput,
        brand,
        model,
        registration,
        vin,
        problem
    } = req.body;


    // ------------------------------------------------------------
    // DUPLICATE-SUBMISSION GUARD
    // ------------------------------------------------------------
    // The check-then-claim below is synchronous (no `await` in between),
    // so it's atomic with respect to any other request Node might be
    // handling — a genuinely simultaneous double-click can't have both
    // requests see "not claimed yet" and both proceed to insert a car.
    pruneExpiredCarTokens();

    if (idempotencyKey) {

        const existing = pendingCarCreations.get(idempotencyKey);

        if (existing) {

            if (existing.status === "done") {
                return res.redirect(`/admin/car/${existing.carId}`);
            }

            // Still in flight (the near-simultaneous case) — wait briefly
            // for the request that's actually doing the insert to finish,
            // rather than starting a second one. Bounded so a genuinely
            // stuck request can't hang this one forever.
            const deadline = Date.now() + 5000;

            while (Date.now() < deadline) {

                await new Promise((resolve) => setTimeout(resolve, 150));

                const current = pendingCarCreations.get(idempotencyKey);

                if (!current) break; // the other request failed and cleared it — fall through and try fresh

                if (current.status === "done") {
                    return res.redirect(`/admin/car/${current.carId}`);
                }
            }

            // Timed out or the other attempt failed — fall through to
            // create fresh rather than leaving the admin stuck.
        }

        pendingCarCreations.set(idempotencyKey, { status: "pending", startedAt: Date.now() });
    }


    // VIN is required for every NEWLY created vehicle (the client-side
    // `required`/pattern attributes on the form are a convenience only —
    // a POST can be crafted directly, so this is re-checked here before
    // any database write, same placement as every other validation check
    // in this route). Existing vehicles created before this check existed
    // keep whatever vin value (including null/empty) they already have —
    // this only ever rejects a NEW submission, never touches old rows.
    if (!isValidVin(vin)) {

        if (idempotencyKey) pendingCarCreations.delete(idempotencyKey);

        return res.send(`
            <h2>${at(lang, "car_create_error_title")}</h2>
            <p>${at(lang, "invalid_vin")}</p>
            <a href="/admin/add-car">${at(lang, "go_back")}</a>
        `);
    }


    // Contact method is allow-listed (never trusted as an arbitrary
    // string); anything else is treated as "not set" rather than
    // rejecting the whole form over it — a missing/garbled preference
    // only degrades the "Message customer" button to its disabled
    // state, nothing destructive. The Telegram username, if entered, DOES
    // get hard-validated — a free-text field a human might mistype is
    // worth catching, same reasoning as the VIN check above. Only
    // relevant for the inline NEW-customer path below; an EXISTING
    // customer picked from the dropdown keeps whatever it already has —
    // editing it happens on its own edit page, not silently overwritten
    // here.
    const resolvedContactMethod = sanitizeContactMethod(contactMethodInput);
    const sanitizedTelegramUsername = sanitizeTelegramUsername(telegramUsernameInput);

    if (sanitizedTelegramUsername === "INVALID") {

        if (idempotencyKey) pendingCarCreations.delete(idempotencyKey);

        return res.send(`
            <h2>${at(lang, "car_create_error_title")}</h2>
            <p>${at(lang, "invalid_telegram_username")}</p>
            <a href="/admin/add-car">${at(lang, "go_back")}</a>
        `);
    }


    // Picking an existing customer always wins over the new-customer
    // fields, even if both were somehow submitted — the dropdown holds
    // only this company's own customers (see the GET handler above), but
    // a POST can be crafted directly, so customer_id is NEVER trusted
    // as-is: it's re-verified against req.session.companyId below, the
    // same company-scoped lookup pattern already used by
    // POST /customer/:id/edit and every other mutation route in this
    // file. Without this, a forged customer_id belonging to a different
    // company would silently attach that company's real customer (name,
    // phone, Telegram ID) to this company's new car.
    let resolvedCustomerId = null;

    if (customer_id) {

        const { data: existingCustomer, error: customerLookupError } = await supabase
            .from("customers")
            .select("id")
            .eq("id", customer_id)
            .eq("company_id", req.session.companyId)
            .maybeSingle();

        if (customerLookupError || !existingCustomer) {

            if (idempotencyKey) pendingCarCreations.delete(idempotencyKey);

            return res.send(`
                <h2>${at(lang, "car_create_error_title")}</h2>
                <p>${at(lang, "invalid_customer_selection")}</p>
                <a href="/admin/add-car">${at(lang, "go_back")}</a>
            `);
        }

        resolvedCustomerId = existingCustomer.id;

    } else if (new_customer_name && new_customer_name.trim()) {

        const { data: newCustomer, error: customerError } = await supabase
            .from("customers")
            .insert({
                company_id: req.session.companyId,
                name: new_customer_name.trim(),
                phone: (new_customer_phone || "").trim() || null,
                contact_method: resolvedContactMethod,
                telegram_username: sanitizedTelegramUsername
            })
            .select()
            .single();

        if (customerError) {

            console.error(customerError);

            // Clear the claim so a genuine retry (new page load, or the
            // admin fixing something and pressing the browser's retry)
            // isn't permanently blocked by a failed attempt.
            if (idempotencyKey) pendingCarCreations.delete(idempotencyKey);

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
            vin: vin.trim(),
            problem,
            status: "received"
        })
        .select()
        .single();


    if (error) {

        console.error(error);

        if (idempotencyKey) pendingCarCreations.delete(idempotencyKey);

        return res.send(`
            <h2>${at(lang, "car_create_error_title")}</h2>
            <pre>${escapeHtml(error.message)}</pre>
            <a href="/admin/add-car">${at(lang, "go_back")}</a>
        `);
    }


    if (idempotencyKey) {
        pendingCarCreations.set(idempotencyKey, { status: "done", carId: car.id, startedAt: Date.now() });
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
                phone,
                telegram_id,
                telegram_username,
                contact_method
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


    // Service notes belong to the physical vehicle, not this particular
    // visit — see migrations/009_vehicle_service_notes.sql. Under the
    // CURRENT schema (no separate vehicle-profile/visit split — that
    // remains a proposed, unapproved future migration) "the physical
    // vehicle" and "this cars row" are the same thing, so notes are
    // scoped by car_id exactly like everything else on this page. If a
    // returning vehicle is later entered as a brand-new cars row (today's
    // existing behavior for repeat visits), its notes would start fresh
    // under that new id — carrying them across requires the vehicle-
    // profile/visit model, not implemented in this phase.
    const { data: serviceNotes, error: notesError } = await supabase
        .from("vehicle_service_notes")
        .select(`*, admin_accounts ( name )`)
        .eq("car_id", carId)
        .eq("company_id", req.session.companyId)
        .order("created_at", { ascending: false });

    if (notesError) {
        console.error("Service notes lookup error:", notesError.message);
    }


    const botUsername = "AutoCoreServiceBot";

    const telegramLink =
        `https://t.me/${botUsername}?start=car_${car.id}`;


    const qr = car.customers?.telegram_id ? null : await QRCode.toDataURL(telegramLink);


    const bodyHtml = `
            <div class="container" style="max-width:560px;padding:0;">

                <div class="card">

                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                        <h1 style="margin-bottom:0;">🚗 ${escapeHtml(car.brand)} ${escapeHtml(car.model)}</h1>
                        <a class="icon-btn" href="/admin/car/${car.id}/edit" aria-label="${at(lang, "edit_vehicle_title")}">${icon("edit")}</a>
                    </div>

                    <p class="car-reg">🔢 ${escapeHtml(car.registration) || at(lang, "registration_missing")}</p>

                    <p class="car-vin">${at(lang, "vin_label")}: ${car.vin ? escapeHtml(car.vin) : `<span class="vin-missing">${at(lang, "vin_not_on_file")}</span>`}</p>

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

                    <h2>${at(lang, "telegram_section_heading")}</h2>

                    ${renderTelegramSection({ car, lang, qr, telegramLink })}

                    <hr class="section-divider" />

                    <h2>${at(lang, "service_notes_heading")}</h2>

                    <p style="color:var(--text-muted);font-size:13px;margin-top:-4px;">${at(lang, "service_notes_subtitle")}</p>

                    ${notesError ? `<p class="notice-banner error">${at(lang, "service_notes_unavailable")}</p>` : `

                        <form method="POST" action="/admin/car/${car.id}/notes" style="margin-bottom:18px;">

                            <label>${at(lang, "label_mileage")}</label>
                            <input name="mileage_km" type="number" inputmode="numeric" min="0" step="1" placeholder="184250" required />

                            <label>${at(lang, "label_service_note")}</label>
                            <textarea name="note" placeholder="${at(lang, "service_note_placeholder")}" required></textarea>

                            <button class="btn btn-outline btn-block" style="margin-top:10px;" data-loading-text="${at(lang, "save_button")}...">
                                ${at(lang, "add_service_note_button")}
                            </button>

                        </form>

                        <div class="service-notes-list">
                            ${(serviceNotes && serviceNotes.length > 0) ? serviceNotes.map((n) => `
                                <div class="service-note">
                                    <div class="service-note-top">
                                        <span class="pill-muted">${at(lang, "mileage_value", { mileage: Number(n.mileage_km).toLocaleString(lang) })}</span>
                                        <span class="service-note-date">${new Date(n.created_at).toLocaleString(lang)}</span>
                                    </div>
                                    <p class="service-note-text">${escapeHtml(n.note)}</p>
                                    ${n.admin_accounts?.name ? `<p class="service-note-author">${at(lang, "recorded_by_label", { name: escapeHtml(n.admin_accounts.name) })}</p>` : ""}
                                </div>
                            `).join("") : `<p style="color:var(--text-muted);font-size:14px;">${at(lang, "service_notes_empty")}</p>`}
                        </div>
                    `}

                    <a href="/admin" class="btn btn-outline btn-block" style="margin-top:16px;">
                        ${at(lang, "back_to_admin")}
                    </a>

                </div>

            </div>
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "repairs",
        pageTitle: `${car.brand} ${car.model}`,
        bodyHtml,
        extraStyles: `
            .qr-img { width: 260px; max-width: 100%; display: block; margin: 12px auto; }
            .telegram-link { word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 16px; }
            .section-divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
        `
    }));
});


// ==========================================
// EDIT VEHICLE
// ==========================================
// Reuses the Add Vehicle form's exact field set and validation rules
// (customer association, brand, model, registration, VIN) — deliberately
// does NOT include the inline "create new customer" section (that stays
// add-car's job) and does NOT touch the customer's own contact fields
// (phone/contact_method/telegram_username) at all — those are only ever
// shown here read-only with a link to the existing customer-edit page,
// so this form can never silently change a customer's Telegram link or
// contact method as a side effect of fixing a vehicle's VIN.

router.get("/car/:id/edit", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;
    const carId = req.params.id;

    const { data: car, error } = await supabase
        .from("cars")
        .select(`*, customers ( id, name, phone, contact_method )`)
        .eq("id", carId)
        .eq("company_id", req.session.companyId)
        .maybeSingle();

    if (error || !car) {

        return res.send(`
            <h2>${at(lang, "car_not_found_title")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }

    const { data: customers, error: customersError } = await supabase
        .from("customers")
        .select("id, name")
        .eq("company_id", req.session.companyId)
        .order("name");

    if (customersError) {
        return res.send(at(lang, "database_error"));
    }

    const customerOptions = customers.map((customer) => `
        <option value="${customer.id}" ${car.customer_id === customer.id ? "selected" : ""}>
            ${escapeHtml(customer.name)}
        </option>
    `).join("");

    const bodyHtml = `
            <div class="container" style="max-width:600px;padding:0;">

                <div class="card">

                    <h1>${at(lang, "edit_vehicle_title")}</h1>

                    <form method="POST" action="/admin/car/${car.id}/edit">

                        <label>${at(lang, "label_customer")}</label>

                        <select name="customer_id">
                            <option value="">${at(lang, "select_customer_placeholder")}</option>
                            ${customerOptions}
                        </select>

                        ${car.customers ? `
                            <p style="color:var(--text-muted);font-size:12px;margin:4px 0 0;">
                                ${escapeHtml(car.customers.name)}${car.customers.phone ? ` · ${escapeHtml(car.customers.phone)}` : ""}
                                &nbsp;·&nbsp;
                                <a href="/admin/customer/${car.customers.id}/edit">${at(lang, "edit_customer_link")}</a>
                            </p>
                        ` : ""}

                        <label>${at(lang, "label_brand")}</label>

                        <input name="brand" value="${escapeHtml(car.brand)}" placeholder="BMW" required />

                        <label>${at(lang, "label_model")}</label>

                        <input name="model" value="${escapeHtml(car.model)}" placeholder="320" required />

                        <label>${at(lang, "label_registration")}</label>

                        <input name="registration" value="${escapeHtml(car.registration)}" placeholder="EL 12345" />

                        <label>${at(lang, "label_vin")}</label>

                        <input
                            name="vin"
                            value="${escapeHtml(car.vin)}"
                            placeholder="VIN"
                            required
                            minlength="5"
                            maxlength="17"
                            pattern="[A-Za-z0-9]+"
                            title="${at(lang, "vin_format_hint")}"
                        />

                        <label>${at(lang, "label_problem")}</label>

                        <textarea name="problem" placeholder="${at(lang, "placeholder_problem")}">${escapeHtml(car.problem)}</textarea>

                        <button class="btn btn-primary btn-block" style="margin-top:16px;" data-loading-text="${at(lang, "save_button")}...">
                            ${at(lang, "save_button")}
                        </button>

                    </form>

                    <a href="/admin/car/${car.id}" class="btn btn-outline btn-block" style="margin-top:12px;">
                        ${at(lang, "back_to_admin")}
                    </a>

                </div>

            </div>
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "repairs",
        pageTitle: at(lang, "edit_vehicle_title"),
        bodyHtml
    }));
});


router.post("/car/:id/edit", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;
    const carId = req.params.id;

    const { customer_id, brand, model, registration, vin, problem } = req.body;


    // Ownership re-verified here, exactly like every other mutation in
    // this file — never trust the URL's :id alone. A forged id belonging
    // to another company fails this lookup and the request is rejected
    // before any field is validated or written.
    const { data: existingCar, error: lookupError } = await supabase
        .from("cars")
        .select("id, company_id")
        .eq("id", carId)
        .eq("company_id", req.session.companyId)
        .maybeSingle();

    if (lookupError || !existingCar) {

        return res.send(`
            <h2>${at(lang, "car_not_found_title")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }


    if (!brand || !brand.trim() || !model || !model.trim()) {

        return res.send(`
            <h2>${at(lang, "vehicle_update_error_title")}</h2>
            <p>${at(lang, "required_fields_missing")}</p>
            <a href="/admin/car/${carId}/edit">${at(lang, "go_back")}</a>
        `);
    }

    if (!isValidVin(vin)) {

        return res.send(`
            <h2>${at(lang, "vehicle_update_error_title")}</h2>
            <p>${at(lang, "invalid_vin")}</p>
            <a href="/admin/car/${carId}/edit">${at(lang, "go_back")}</a>
        `);
    }


    // Same company-scoped re-verification as /add-car's customer_id
    // check — a forged customer_id belonging to another company is
    // rejected rather than silently attached. Blank selection (no
    // customer) is an explicit, visible choice in the dropdown, not a
    // silent side effect — intentionally supported, same as /add-car.
    let resolvedCustomerId = null;

    if (customer_id) {

        const { data: existingCustomer, error: customerLookupError } = await supabase
            .from("customers")
            .select("id")
            .eq("id", customer_id)
            .eq("company_id", req.session.companyId)
            .maybeSingle();

        if (customerLookupError || !existingCustomer) {

            return res.send(`
                <h2>${at(lang, "vehicle_update_error_title")}</h2>
                <p>${at(lang, "invalid_customer_selection")}</p>
                <a href="/admin/car/${carId}/edit">${at(lang, "go_back")}</a>
            `);
        }

        resolvedCustomerId = existingCustomer.id;
    }


    // Only ever writes to `cars` — never touches the `customers` table,
    // so a customer's phone/contact_method/telegram_username/telegram_id
    // can never be altered as a side effect of editing a vehicle.
    const { error: updateError } = await supabase
        .from("cars")
        .update({
            customer_id: resolvedCustomerId,
            brand: brand.trim(),
            model: model.trim(),
            registration: (registration || "").trim() || null,
            vin: vin.trim(),
            problem: problem || null
        })
        .eq("id", carId)
        .eq("company_id", req.session.companyId);

    if (updateError) {

        console.error("Vehicle update error:", updateError);

        return res.send(`
            <h2>${at(lang, "vehicle_update_error_title")}</h2>
            <pre>${escapeHtml(updateError.message)}</pre>
            <a href="/admin/car/${carId}/edit">${at(lang, "go_back")}</a>
        `);
    }

    res.redirect(`/admin/car/${carId}`);
});


// ==========================================
// ADD SERVICE NOTE (vehicle-level, mileage required)
// ==========================================
// Requires migrations/009_vehicle_service_notes.sql to have been applied
// — see that file's own header for why this is additive-only and safe.
// Until it's applied, this fails with a clear "feature not available yet"
// error (same PGRST205-style handling pattern used elsewhere in this
// project) rather than crashing.

router.post("/car/:id/notes", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;
    const carId = req.params.id;

    const { mileage_km: mileageInput, note } = req.body;


    // Car ownership re-verified here too, exactly like every other
    // mutation in this file — never trust the URL's :id alone.
    const { data: car, error: carError } = await supabase
        .from("cars")
        .select("id, company_id")
        .eq("id", carId)
        .eq("company_id", req.session.companyId)
        .maybeSingle();

    if (carError || !car) {

        return res.send(`
            <h2>${at(lang, "car_not_found_title")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }


    // Mileage must be a whole, non-negative number — reject missing,
    // negative, decimal, or non-numeric input server-side (the <input
    // type="number" min="0" step="1" required> on the form is a
    // convenience only, never trusted as the real check).
    const mileageKm = Number(mileageInput);

    const mileageValid =
        mileageInput !== undefined &&
        mileageInput !== null &&
        String(mileageInput).trim() !== "" &&
        Number.isInteger(mileageKm) &&
        mileageKm >= 0;

    const noteValid = typeof note === "string" && note.trim().length > 0;

    if (!mileageValid || !noteValid) {

        return res.send(`
            <h2>${at(lang, "service_note_error_title")}</h2>
            <p>${at(lang, "invalid_service_note")}</p>
            <a href="/admin/car/${carId}">${at(lang, "go_back")}</a>
        `);
    }


    const { error: insertError } = await supabase
        .from("vehicle_service_notes")
        .insert({
            car_id: car.id,
            company_id: req.session.companyId,
            mileage_km: mileageKm,
            note: note.trim(),
            created_by_admin_id: req.session.adminId
        });

    if (insertError) {

        console.error("Service note insert error:", insertError.message);

        return res.send(`
            <h2>${at(lang, "service_note_error_title")}</h2>
            <p>${at(lang, "service_notes_unavailable")}</p>
            <a href="/admin/car/${carId}">${at(lang, "go_back")}</a>
        `);
    }


    res.redirect(`/admin/car/${carId}`);
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
        .select("id, name, phone, contact_method, telegram_username")
        .eq("id", req.params.id)
        .eq("company_id", req.session.companyId)
        .maybeSingle();


    if (error || !customer) {

        return res.send(`
            <h2>${at(lang, "customer_missing")}</h2>
            <a href="/admin">${at(lang, "back_to_admin")}</a>
        `);
    }


    const bodyHtml = `
            <div class="container" style="max-width:500px;padding:0;">

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

                        <p style="color:var(--text-muted);font-size:12px;margin:2px 0 14px;">${at(lang, "phone_whatsapp_hint")}</p>

                        <label>${at(lang, "contact_method_label")}</label>

                        <div class="contact-method-row">
                            <label class="contact-method-option">
                                <input type="radio" name="contact_method" value="telegram" ${customer.contact_method === "whatsapp" ? "" : "checked"} onchange="document.getElementById('telegramUsernameField').style.display = this.checked ? '' : 'none';" />
                                ${at(lang, "contact_method_telegram")}
                            </label>
                            <label class="contact-method-option">
                                <input type="radio" name="contact_method" value="whatsapp" ${customer.contact_method === "whatsapp" ? "checked" : ""} onchange="document.getElementById('telegramUsernameField').style.display = this.checked ? 'none' : '';" />
                                ${at(lang, "contact_method_whatsapp")}
                            </label>
                        </div>

                        <div id="telegramUsernameField" style="${customer.contact_method === "whatsapp" ? "display:none;" : ""}">

                            <label>${at(lang, "label_telegram_username")}</label>

                            <input
                                name="telegram_username"
                                value="${escapeHtml(customer.telegram_username)}"
                                placeholder="johnsmith"
                            />

                            <p style="color:var(--text-muted);font-size:12px;margin:2px 0 0;">${at(lang, "telegram_username_hint")}</p>

                        </div>

                        <button class="btn btn-primary btn-block" style="margin-top:16px;">
                            ${at(lang, "save_button")}
                        </button>

                    </form>

                    <a href="/admin" class="btn btn-outline btn-block" style="margin-top:12px;">
                        ${at(lang, "back_to_admin")}
                    </a>

                </div>

            </div>
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "customers",
        pageTitle: at(lang, "edit_customer_title"),
        bodyHtml
    }));
});


router.post("/customer/:id/edit", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    const { name, phone, contact_method: contactMethodInput, telegram_username: telegramUsernameInput } = req.body;

    const sanitizedTelegramUsername = sanitizeTelegramUsername(telegramUsernameInput);

    if (sanitizedTelegramUsername === "INVALID") {

        return res.send(`
            <h2>${at(lang, "customer_update_error_title")}</h2>
            <p>${at(lang, "invalid_telegram_username")}</p>
            <a href="/admin/customer/${req.params.id}/edit">${at(lang, "go_back")}</a>
        `);
    }

    const { error } = await supabase
        .from("customers")
        .update({
            name,
            phone: (phone || "").trim() || null,
            contact_method: sanitizeContactMethod(contactMethodInput),
            telegram_username: sanitizedTelegramUsername
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
                            <button type="submit" class="btn btn-danger btn-block" data-loading-text="${at(lang, "delete_car_button")}...">${at(lang, "btn_delete_confirm")}</button>
                        </form>
                        <a class="btn btn-outline btn-block" href="/admin">${at(lang, "btn_delete_cancel")}</a>
                    </div>
                </div>
            </div>
            ${DOUBLE_SUBMIT_GUARD_SCRIPT}
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


    // The <select> on both the dashboard and the QR page only ever offers
    // these 9 values, but a POST can be crafted directly — never trust it
    // as-is. Same reasoning as /add-car's customer_id re-verification:
    // without this, an arbitrary string would be written straight to
    // cars.status and status_history.new_status, silently breaking
    // statusLabel()'s display fallback and any later logic that matches
    // on an exact status string.
    if (!STATUS_KEYS.includes(status)) {

        return res.send(`
            <h2>${at(lang, "status_update_error_title")}</h2>
            <p>${at(lang, "invalid_status_selection")}</p>
            <a href="/admin">${at(lang, "go_back")}</a>
        `);
    }


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
            `🚗 *${car.brand} ${car.model}*` +
            (car.registration ? ` (${car.registration})` : "") +
            `\n\n` +

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


// ==========================================
// TELEGRAM GROUP CONNECT — admin-side bridge
// ==========================================
// Links this admin's web session to a Telegram account via a one-time
// token, which the Workshop Bot's /start handler consumes (see
// workshopBot.js). The actual group-connection UX (picking a Workshop/
// Manager group) happens entirely inside Telegram after that — this
// page only ever starts that bridge; it never touches
// workshop_telegram_groups directly.

const WORKSHOP_BOT_TOKEN = process.env.WORKSHOP_BOT_TOKEN;
const workshopApiBot = WORKSHOP_BOT_TOKEN ? new Bot(WORKSHOP_BOT_TOKEN) : null;

// Resolved lazily via getMe() (never hardcoded, never guessed) and
// cached for the life of the process — the username is public info
// returned by Telegram itself, not a secret, so caching it in memory
// carries no more risk than the token already being in env vars.
let cachedWorkshopBotUsername = null;

async function getWorkshopBotUsername() {

    if (!workshopApiBot) return null;

    if (cachedWorkshopBotUsername) return cachedWorkshopBotUsername;

    const me = await workshopApiBot.api.getMe();

    cachedWorkshopBotUsername = me.username;

    return cachedWorkshopBotUsername;
}


const CONNECT_TOKEN_TTL_MS = 15 * 60 * 1000;


router.get("/telegram-setup", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    let errorMessage = null;

    const { data: admin, error: adminError } = await supabase
        .from("admin_accounts")
        .select("telegram_id")
        .eq("id", req.session.adminId)
        .maybeSingle();

    if (adminError) {

        console.error("telegram-setup: admin_accounts lookup error:", adminError.message);

        errorMessage = at(lang, "telegram_setup_error");
    }

    const botUsername = await getWorkshopBotUsername();

    let liveToken = null;

    if (!errorMessage && !admin?.telegram_id && botUsername) {

        const { data, error: tokenError } = await supabase
            .from("telegram_connect_tokens")
            .select("*")
            .eq("admin_id", req.session.adminId)
            .is("consumed_at", null)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (tokenError) {

            console.error("telegram-setup: telegram_connect_tokens lookup error:", tokenError.message);

            errorMessage = at(lang, "telegram_setup_error");

        } else {

            liveToken = data;
        }
    }

    let qr = null;
    let telegramLink = null;

    if (liveToken && botUsername) {

        telegramLink = `https://t.me/${botUsername}?start=${liveToken.token}`;
        qr = await QRCode.toDataURL(telegramLink);
    }


    const bodyHtml = `
            <div class="container" style="max-width:560px;padding:0;">

                <div class="card">

                    <h1>${at(lang, "telegram_setup_title")}</h1>

                    ${errorMessage ? `<p class="notice-banner error">${errorMessage}</p>` : ""}

                    ${!botUsername ? `
                        <p>${at(lang, "telegram_setup_bot_not_configured")}</p>
                    ` : admin?.telegram_id ? `
                        <p class="notice-banner success">${at(lang, "telegram_setup_linked")}</p>
                        <p>${at(lang, "telegram_setup_linked_instructions")}</p>
                    ` : liveToken ? `
                        <p>${at(lang, "telegram_setup_scan_instructions")}</p>
                        <img class="qr-img" src="${qr}" />
                        <p class="telegram-link">${telegramLink}</p>
                        <form method="POST" action="/admin/telegram-setup/generate">
                            <button class="btn btn-outline btn-block">${at(lang, "telegram_setup_generate_button")}</button>
                        </form>
                    ` : `
                        <p>${at(lang, "telegram_setup_not_linked_instructions")}</p>
                        <form method="POST" action="/admin/telegram-setup/generate">
                            <button class="btn btn-primary btn-block">${at(lang, "telegram_setup_generate_button")}</button>
                        </form>
                    `}

                    <a href="/admin" class="btn btn-outline btn-block" style="margin-top:12px;">
                        ${at(lang, "back_to_admin")}
                    </a>

                </div>

            </div>
    `;

    res.send(renderShellPage({
        lang,
        activeKey: "more",
        pageTitle: at(lang, "telegram_setup_title"),
        bodyHtml,
        extraStyles: `
            .qr-img { width: 260px; max-width: 100%; display: block; margin: 12px auto; }
            .telegram-link { word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 16px; }
        `
    }));
});


router.post("/telegram-setup/generate", requireLogin, async (req, res) => {

    const lang = req.session.adminLang || DEFAULT_ADMIN_LANG;

    // At most one live token per admin — generating a new one makes any
    // prior unconsumed token for this admin unusable, rather than
    // leaving multiple valid codes floating around. Non-fatal if this
    // fails (e.g. nothing to delete yet) — the GET page always picks the
    // MOST RECENT unconsumed token, so a stray old row left behind here
    // can't break anything, just logged for visibility.
    const { error: deleteError } = await supabase
        .from("telegram_connect_tokens")
        .delete()
        .eq("admin_id", req.session.adminId)
        .is("consumed_at", null);

    if (deleteError) {
        console.error("telegram-setup/generate: delete error:", deleteError.message);
    }

    const { error: insertError } = await supabase
        .from("telegram_connect_tokens")
        .insert({
            token: crypto.randomUUID(),
            admin_id: req.session.adminId,
            company_id: req.session.companyId,
            expires_at: new Date(Date.now() + CONNECT_TOKEN_TTL_MS).toISOString()
        });

    if (insertError) {

        console.error("telegram-setup/generate: insert error:", insertError.message);

        return res.send(`
            <h2>${at(lang, "telegram_setup_error")}</h2>
            <a href="/admin/telegram-setup">${at(lang, "go_back")}</a>
        `);
    }

    res.redirect("/admin/telegram-setup");
});


module.exports = router;

// Express routers are plain functions, so attaching extra properties
// here changes nothing about how `require("./admin")` behaves as a
// router (index.js's and demo-server.js's `app.use("/admin", adminRouter)`
// is completely unaffected) — this only exposes the pure, already-used
// validation/normalization helpers for direct unit testing, same
// pattern already used for workshopBot.js's managerGroupBelongsToAnotherCompany.
module.exports.isValidVin = isValidVin;
module.exports.toWhatsappDigits = toWhatsappDigits;
module.exports.sanitizeTelegramUsername = sanitizeTelegramUsername;
module.exports.sanitizeContactMethod = sanitizeContactMethod;
