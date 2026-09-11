const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");

const supabase = require("./supabase");

const { ADMIN_LANGS, ADMIN_LANGUAGE_LABELS, DEFAULT_ADMIN_LANG, normalizeAdminLang } = require("./locales");
const { escapeHtml, escapeJsString } = require("./utils");

const router = express.Router();


// ==========================================
// SESSION
// ==========================================
// Deliberately a *separate* express-session instance from the company
// admin panel (admin.js): its own cookie name, its own path, its own
// secret. This keeps Super Admin authentication fully isolated — a
// company admin's cookie is never even sent to /superadmin/*, and vice
// versa, so neither panel can be reached using the other's session.

if (!process.env.SUPER_ADMIN_SESSION_SECRET) {
    console.warn(
        "⚠️  SUPER_ADMIN_SESSION_SECRET is not set in .env — using a fallback. " +
        "Set a dedicated SUPER_ADMIN_SESSION_SECRET for production."
    );
}

// `secure` cookies require HTTPS and rely on index.js's `app.set("trust
// proxy", 1)` so Express can see the real protocol behind Render's proxy.
// Gated on NODE_ENV so local http://localhost dev logins keep working —
// a secure cookie is silently dropped by the browser over plain HTTP.
const isProduction = process.env.NODE_ENV === "production";

router.use(
    session({
        name: "autocore.superadmin.sid",
        secret: process.env.SUPER_ADMIN_SESSION_SECRET || "autocore-dev-superadmin-session-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 8,
            path: "/superadmin",
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax"
        }
    })
);


// ==========================================
// LAYOUT
// ==========================================

const LAYOUT_CSS = `
    * { box-sizing: border-box; }

    body {
        font-family: Arial, sans-serif;
        margin: 0;
        background: #f4f6f8;
        color: #111827;
    }

    a { color: inherit; }

    .layout {
        display: flex;
        min-height: 100vh;
    }

    .sidebar {
        width: 230px;
        background: #0b1220;
        color: #e5e7eb;
        flex-shrink: 0;
        padding: 20px 0;
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        overflow-y: auto;
    }

    .sidebar .brand {
        font-size: 18px;
        font-weight: bold;
        padding: 0 20px 20px;
        color: white;
    }

    .sidebar .brand span {
        display: block;
        font-size: 12px;
        font-weight: normal;
        color: #9ca3af;
        margin-top: 2px;
    }

    .sidebar nav a {
        display: block;
        padding: 12px 20px;
        text-decoration: none;
        color: #cbd5e1;
        font-size: 15px;
    }

    .sidebar nav a.active {
        background: #1f2937;
        color: white;
        border-left: 3px solid #6366f1;
    }

    .sidebar nav a:hover {
        background: #1f2937;
        color: white;
    }

    .sidebar form {
        margin: 0;
    }

    .sidebar .logout-btn {
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        font-size: 15px;
        cursor: pointer;
        font-family: inherit;
    }

    .main {
        margin-left: 230px;
        padding: 25px;
        width: 100%;
    }

    @media (max-width: 768px) {

        .layout {
            flex-direction: column;
        }

        .sidebar {
            position: static;
            width: 100%;
            height: auto;
            padding: 10px 0;
        }

        .sidebar .brand {
            padding: 0 15px 10px;
        }

        .sidebar nav {
            display: flex;
            overflow-x: auto;
        }

        .sidebar nav a {
            white-space: nowrap;
            padding: 10px 14px;
            border-left: none !important;
            border-bottom: 3px solid transparent;
        }

        .sidebar nav a.active {
            border-bottom: 3px solid #6366f1;
        }

        .main {
            margin-left: 0;
            padding: 16px;
        }
    }

    h1, h2, h3 { margin-top: 0; }

    .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 14px;
        margin-bottom: 25px;
    }

    .card {
        background: white;
        border-radius: 12px;
        padding: 18px;
        box-shadow: 0 3px 12px rgba(0,0,0,0.05);
    }

    .card .value {
        font-size: 28px;
        font-weight: bold;
    }

    .card .label {
        color: #6b7280;
        font-size: 13px;
        margin-top: 4px;
    }

    .panel {
        background: white;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 3px 12px rgba(0,0,0,0.05);
        margin-bottom: 20px;
    }

    .table-wrap {
        overflow-x: auto;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        min-width: 720px;
    }

    th, td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid #eee;
        font-size: 14px;
        vertical-align: top;
    }

    th {
        color: #6b7280;
        font-weight: 600;
        font-size: 12px;
        text-transform: uppercase;
    }

    .badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: bold;
    }

    .badge.active {
        background: #dcfce7;
        color: #166534;
    }

    .badge.suspended {
        background: #fee2e2;
        color: #991b1b;
    }

    .badge.archived {
        background: #e5e7eb;
        color: #374151;
    }

    .filter-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 14px;
    }

    .filter-tabs a {
        padding: 6px 12px;
        border-radius: 999px;
        text-decoration: none;
        font-size: 13px;
        background: #f3f4f6;
        color: #374151;
    }

    .filter-tabs a.active {
        background: #111827;
        color: white;
    }

    .actions-cell {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }

    .btn {
        display: inline-block;
        padding: 8px 12px;
        border-radius: 7px;
        text-decoration: none;
        font-size: 13px;
        border: none;
        cursor: pointer;
        font-family: inherit;
    }

    .btn-primary { background: #111827; color: white; }
    .btn-indigo { background: #4f46e5; color: white; }
    .btn-green { background: #16a34a; color: white; }
    .btn-red { background: #dc2626; color: white; }
    .btn-outline { background: white; color: #111827; border: 1px solid #d1d5db; }

    form.inline { display: inline; }

    .notice {
        padding: 12px 14px;
        border-radius: 8px;
        font-size: 14px;
        margin-bottom: 16px;
    }

    .notice.warn { background: #fef9c3; color: #854d0e; }
    .notice.error { background: #fee2e2; color: #991b1b; }
    .notice.success { background: #dcfce7; color: #166534; }

    label {
        display: block;
        font-size: 13px;
        color: #374151;
        margin: 14px 0 4px;
        font-weight: 600;
    }

    input, select, textarea {
        width: 100%;
        padding: 11px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 14px;
        font-family: inherit;
    }

    .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 20px;
    }

    @media (max-width: 600px) {
        .form-grid { grid-template-columns: 1fr; }
    }

    .section-title {
        margin-top: 10px;
        padding-top: 14px;
        border-top: 1px solid #eee;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
    }

    .section-title:first-child {
        border-top: none;
        padding-top: 0;
    }

    .top-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 20px;
    }
`;


function renderLayout({ active, title, adminName, body }) {

    const links = [
        { key: "dashboard", href: "/superadmin", label: "🏠 Dashboard" },
        { key: "companies", href: "/superadmin", label: "🏢 Companies" },
        { key: "new", href: "/superadmin/companies/new", label: "➕ New Service" }
    ];

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${escapeHtml(title)} — AutoCore Super Admin</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>${LAYOUT_CSS}</style>
        </head>
        <body>

            <div class="layout">

                <div class="sidebar">

                    <div class="brand">
                        🚗 AutoCore
                        <span>Super Admin${adminName ? " · " + escapeHtml(adminName) : ""}</span>
                    </div>

                    <nav>
                        ${links.map(link => `
                            <a href="${link.href}" class="${active === link.key ? "active" : ""}">
                                ${link.label}
                            </a>
                        `).join("")}

                        <form method="POST" action="/superadmin/logout">
                            <button type="submit" class="logout-btn">🚪 Logout</button>
                        </form>
                    </nav>

                </div>

                <div class="main">
                    ${body}
                </div>

            </div>

        </body>
        </html>
    `;
}


function renderErrorPage({ title, message, backHref = "/superadmin", backLabel = "← Back to dashboard" }) {

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${escapeHtml(title)} — AutoCore Super Admin</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial, sans-serif; background: #f4f6f8; padding: 40px 20px; }
                .box { max-width: 480px; margin: auto; background: white; padding: 30px; border-radius: 12px; }
                a { color: #4f46e5; }
                pre { white-space: pre-wrap; word-break: break-word; background: #f9fafb; padding: 10px; border-radius: 6px; font-size: 13px; }
            </style>
        </head>
        <body>
            <div class="box">
                <h2>${escapeHtml(title)}</h2>
                ${message ? `<pre>${escapeHtml(message)}</pre>` : ""}
                <p><a href="${backHref}">${backLabel}</a></p>
            </div>
        </body>
        </html>
    `;
}


// ==========================================
// LOGIN PAGE
// ==========================================

router.get("/login", (req, res) => {

    const invalid = req.query.error === "1";
    const suspended = req.query.suspended === "1";

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Super Admin Login — AutoCore</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: #0b1220;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                }

                .box {
                    background: white;
                    padding: 40px;
                    border-radius: 15px;
                    width: 320px;
                    max-width: 90vw;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                }

                h1 { margin-top: 0; }

                input {
                    width: 100%;
                    padding: 12px;
                    margin: 10px 0;
                    box-sizing: border-box;
                    border: 1px solid #d1d5db;
                    border-radius: 8px;
                }

                button {
                    width: 100%;
                    padding: 12px;
                    background: #4f46e5;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 15px;
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
            <div class="box">

                <h1>🛡️ Super Admin</h1>
                <p style="color:#6b7280;margin-top:-8px;">AutoCore control panel</p>

                ${invalid ? `<div class="notice">❌ Invalid username or password.</div>` : ""}
                ${suspended ? `<div class="notice">❌ This account has been disabled.</div>` : ""}

                <form method="POST" action="/superadmin/login">

                    <input type="text" name="username" placeholder="Username" required />
                    <input type="password" name="password" placeholder="Password" required />

                    <button type="submit">Login</button>

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

    const { username, password } = req.body;

    if (!username || !password) {
        return res.redirect("/superadmin/login?error=1");
    }

    const { data: superAdmin, error } = await supabase
        .from("super_admins")
        .select("*")
        .eq("username", username)
        .maybeSingle();

    if (error || !superAdmin) {
        return res.redirect("/superadmin/login?error=1");
    }

    if (!superAdmin.is_active) {
        return res.redirect("/superadmin/login?suspended=1");
    }

    const validPassword = await bcrypt.compare(password, superAdmin.password_hash);

    if (!validPassword) {
        return res.redirect("/superadmin/login?error=1");
    }

    // Regenerate the session on login to avoid session fixation.
    req.session.regenerate((regenError) => {

        if (regenError) {
            console.error("Super admin session regenerate error:", regenError);
            return res.redirect("/superadmin/login?error=1");
        }

        req.session.superAdminLoggedIn = true;
        req.session.superAdminId = superAdmin.id;
        req.session.superAdminName = superAdmin.name || superAdmin.username;

        res.redirect("/superadmin");
    });
});


// ==========================================
// LOGOUT
// ==========================================

router.post("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/superadmin/login");
    });

});


// ==========================================
// AUTH MIDDLEWARE
// ==========================================

async function requireSuperAdmin(req, res, next) {

    if (!req.session.superAdminLoggedIn) {
        return res.redirect("/superadmin/login");
    }

    // Re-verify on every request, so disabling a super admin account
    // takes effect immediately rather than only at the next login.
    const { data: superAdmin, error } = await supabase
        .from("super_admins")
        .select("is_active")
        .eq("id", req.session.superAdminId)
        .maybeSingle();

    if (error || !superAdmin || !superAdmin.is_active) {

        return req.session.destroy(() => {
            res.redirect("/superadmin/login?suspended=1");
        });
    }

    next();
}


// ==========================================
// COMPANY STATUS HELPERS
// ==========================================

// Returns { companies, isActiveColumnAvailable, isArchivedColumnAvailable }.
// If a column hasn't been added yet (see migrations/002 and 003), the
// corresponding companies all behave as active/not-archived and the flag
// is set to false so the UI can show a "migration needed" notice instead
// of buttons that would just fail.
async function fetchCompanies() {

    const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    const isActiveColumnAvailable = data.length === 0 || Object.prototype.hasOwnProperty.call(data[0], "is_active");
    const isArchivedColumnAvailable = data.length === 0 || Object.prototype.hasOwnProperty.call(data[0], "archived_at");

    return { companies: data, isActiveColumnAvailable, isArchivedColumnAvailable };
}


function isMissingColumnError(error) {
    return !!error && (error.code === "42703" || /column .* does not exist/i.test(error.message || ""));
}


// ==========================================
// DASHBOARD
// ==========================================

router.get("/", requireSuperAdmin, async (req, res) => {

    let companies, isActiveColumnAvailable, isArchivedColumnAvailable;

    try {
        ({ companies, isActiveColumnAvailable, isArchivedColumnAvailable } = await fetchCompanies());
    } catch (error) {
        console.error("Companies fetch error:", error);
        return res.send(renderErrorPage({ title: "❌ Database error", message: error.message }));
    }

    const totalCompanies = companies.length;

    const archivedCompanies = isArchivedColumnAvailable
        ? companies.filter(c => !!c.archived_at).length
        : 0;

    const activeCompanies = companies.filter(c => {
        const archived = isArchivedColumnAvailable ? !!c.archived_at : false;
        const active = isActiveColumnAvailable ? c.is_active !== false : true;
        return !archived && active;
    }).length;

    const suspendedCompanies = companies.filter(c => {
        const archived = isArchivedColumnAvailable ? !!c.archived_at : false;
        const active = isActiveColumnAvailable ? c.is_active !== false : true;
        return !archived && !active;
    }).length;

    const { count: totalCars } = await supabase
        .from("cars")
        .select("id", { count: "exact", head: true });

    const { count: totalCustomers } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true });

    // Per-company car/customer counts.
    const companiesWithCounts = await Promise.all(companies.map(async (company) => {

        const [{ count: carsCount }, { count: customersCount }] = await Promise.all([
            supabase.from("cars").select("id", { count: "exact", head: true }).eq("company_id", company.id),
            supabase.from("customers").select("id", { count: "exact", head: true }).eq("company_id", company.id)
        ]);

        return { ...company, carsCount: carsCount || 0, customersCount: customersCount || 0 };
    }));

    // Simple query-param filter over an already-small list — no need for
    // a DB-level filter at this scale.
    const filter = ["active", "archived"].includes(req.query.filter) ? req.query.filter : "all";

    const filteredCompanies = companiesWithCounts.filter(company => {

        const isArchived = isArchivedColumnAvailable ? !!company.archived_at : false;

        if (filter === "archived") return isArchived;
        if (filter === "active") return !isArchived;
        return true;
    });

    const rows = filteredCompanies.map(company => {

        const isActive = isActiveColumnAvailable ? company.is_active !== false : true;
        const isArchived = isArchivedColumnAvailable ? !!company.archived_at : false;

        const createdDate = company.created_at
            ? new Date(company.created_at).toLocaleDateString()
            : "-";

        let statusBadge;

        if (isArchived) {
            statusBadge = `<span class="badge archived">Archived</span>`;
        } else if (!isActiveColumnAvailable) {
            statusBadge = `<span class="badge active">Active</span>`;
        } else if (isActive) {
            statusBadge = `<span class="badge active">Active</span>`;
        } else {
            statusBadge = `<span class="badge suspended">Suspended</span>`;
        }

        let actionButtons;

        if (isArchived) {

            actionButtons = `
                <form class="inline" method="POST" action="/superadmin/companies/${company.id}/restore">
                    <button class="btn btn-green" type="submit">Restore</button>
                </form>
                <a class="btn btn-red" href="/superadmin/companies/${company.id}/delete-permanently">Delete…</a>
            `;

        } else {

            const suspendToggle = !isActiveColumnAvailable
                ? `<span style="color:#9ca3af;font-size:12px;">migration required</span>`
                : isActive
                    ? `
                        <form class="inline" method="POST" action="/superadmin/companies/${company.id}/suspend"
                              onsubmit="return confirm('Suspend ${escapeJsString(company.name)} (ID #${company.id})? Their admin panel will stop working until reactivated.');">
                            <button class="btn btn-red" type="submit">Suspend</button>
                        </form>
                    `
                    : `
                        <form class="inline" method="POST" action="/superadmin/companies/${company.id}/activate">
                            <button class="btn btn-green" type="submit">Activate</button>
                        </form>
                    `;

            const archiveButton = !isArchivedColumnAvailable
                ? ""
                : `
                    <form class="inline" method="POST" action="/superadmin/companies/${company.id}/archive"
                          onsubmit="return confirm('Archive ${escapeJsString(company.name)} (ID #${company.id})? Their admin panel and customer bot access will stop working, but no data is deleted. You can restore it later.');">
                        <button class="btn btn-outline" type="submit">Archive</button>
                    </form>
                `;

            actionButtons = suspendToggle + archiveButton;
        }

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(company.name)}</strong>
                    <div style="color:#9ca3af;font-size:12px;">ID #${company.id}</div>
                </td>
                <td>${escapeHtml(company.phone) || "-"}</td>
                <td>${escapeHtml(company.address) || "-"}</td>
                <td>${statusBadge}</td>
                <td>${company.carsCount}</td>
                <td>${company.customersCount}</td>
                <td>${createdDate}</td>
                <td>
                    <div class="actions-cell">
                        <a class="btn btn-outline" href="/superadmin/companies/${company.id}/edit">Edit</a>
                        ${actionButtons}
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    const body = `
        <div class="top-row">
            <h1>Dashboard</h1>
            <a class="btn btn-indigo" href="/superadmin/companies/new">➕ New Service</a>
        </div>

        ${!isActiveColumnAvailable ? `
            <div class="notice warn">
                ⚠️ The <code>companies.is_active</code> column doesn't exist yet, so every company is
                shown as Active and Suspend/Activate is disabled. Run
                <code>migrations/002_add_company_is_active.sql</code> in the Supabase SQL editor to enable it.
            </div>
        ` : ""}

        ${!isArchivedColumnAvailable ? `
            <div class="notice warn">
                ⚠️ The <code>companies.archived_at</code> column doesn't exist yet, so Archive/Restore is
                disabled. Run <code>migrations/003_add_company_archive.sql</code> in the Supabase SQL editor
                to enable it.
            </div>
        ` : ""}

        <div class="cards">
            <div class="card"><div class="value">${totalCompanies}</div><div class="label">Total companies</div></div>
            <div class="card"><div class="value">${activeCompanies}</div><div class="label">Active companies</div></div>
            <div class="card"><div class="value">${suspendedCompanies}</div><div class="label">Suspended companies</div></div>
            <div class="card"><div class="value">${totalCars || 0}</div><div class="label">Total cars</div></div>
            <div class="card"><div class="value">${totalCustomers || 0}</div><div class="label">Total customers</div></div>
        </div>

        <div class="panel">
            <h2>Companies</h2>

            <div class="filter-tabs">
                <a href="/superadmin" class="${filter === "all" ? "active" : ""}">All (${totalCompanies})</a>
                <a href="/superadmin?filter=active" class="${filter === "active" ? "active" : ""}">Active (${totalCompanies - archivedCompanies})</a>
                <a href="/superadmin?filter=archived" class="${filter === "archived" ? "active" : ""}">Archived (${archivedCompanies})</a>
            </div>

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Address</th>
                            <th>Status</th>
                            <th>Cars</th>
                            <th>Customers</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || `<tr><td colspan="8">No companies in this view.</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    res.send(renderLayout({
        active: "dashboard",
        title: "Dashboard",
        adminName: req.session.superAdminName,
        body
    }));
});


// ==========================================
// NEW SERVICE — FORM
// ==========================================

function renderNewServiceForm({ values = {}, errorMessage = null }) {

    const languageOptions = ADMIN_LANGS
        .map(code => `
            <option value="${code}" ${(values.language || DEFAULT_ADMIN_LANG) === code ? "selected" : ""}>
                ${ADMIN_LANGUAGE_LABELS[code]}
            </option>
        `)
        .join("");

    const body = `
        <div class="top-row">
            <h1>➕ New Service</h1>
        </div>

        <div class="panel" style="max-width:640px;">

            ${errorMessage ? `<div class="notice error">${escapeHtml(errorMessage)}</div>` : ""}

            <form method="POST" action="/superadmin/companies">

                <div class="section-title">Service information</div>

                <div class="form-grid">
                    <div>
                        <label>Service / company name</label>
                        <input name="name" value="${escapeHtml(values.name)}" required />
                    </div>
                    <div>
                        <label>Phone</label>
                        <input name="phone" value="${escapeHtml(values.phone)}" />
                    </div>
                </div>

                <label>Address</label>
                <input name="address" value="${escapeHtml(values.address)}" />

                <label>Default language</label>
                <select name="language">
                    ${languageOptions}
                </select>

                <div class="section-title">Admin information</div>

                <div class="form-grid">
                    <div>
                        <label>Admin name</label>
                        <input name="admin_name" value="${escapeHtml(values.admin_name)}" required />
                    </div>
                    <div>
                        <label>Admin username</label>
                        <input name="admin_username" value="${escapeHtml(values.admin_username)}" required autocomplete="off" />
                    </div>
                </div>

                <label>Admin password</label>
                <input type="text" name="admin_password" required minlength="8" autocomplete="off" />
                <p style="font-size:12px;color:#6b7280;margin:4px 0 0;">
                    At least 8 characters. Shown once on the next screen — write it down.
                </p>

                <div style="margin-top:22px;">
                    <button class="btn btn-indigo" type="submit">🚗 Create service</button>
                </div>

            </form>

        </div>
    `;

    return body;
}


router.get("/companies/new", requireSuperAdmin, (req, res) => {

    res.send(renderLayout({
        active: "new",
        title: "New Service",
        adminName: req.session.superAdminName,
        body: renderNewServiceForm({ values: { language: DEFAULT_ADMIN_LANG } })
    }));
});


// ==========================================
// CREATE SERVICE
// ==========================================

router.post("/companies", requireSuperAdmin, async (req, res) => {

    const {
        name,
        phone,
        address,
        language,
        admin_name,
        admin_username,
        admin_password
    } = req.body;

    const values = { name, phone, address, language, admin_name, admin_username };


    // --------------------------------------
    // VALIDATION
    // --------------------------------------

    const errors = [];

    if (!name || !name.trim()) errors.push("Service name is required.");
    if (!admin_name || !admin_name.trim()) errors.push("Admin name is required.");
    if (!admin_username || !admin_username.trim()) errors.push("Admin username is required.");
    if (!admin_password || admin_password.length < 8) errors.push("Admin password must be at least 8 characters.");

    const lang = normalizeAdminLang(language) || DEFAULT_ADMIN_LANG;

    if (errors.length) {

        return res.send(renderLayout({
            active: "new",
            title: "New Service",
            adminName: req.session.superAdminName,
            body: renderNewServiceForm({ values, errorMessage: errors.join(" ") })
        }));
    }

    const trimmedUsername = admin_username.trim();


    // --------------------------------------
    // DUPLICATE USERNAME CHECK
    // --------------------------------------

    const { data: existingAdmin } = await supabase
        .from("admin_accounts")
        .select("id")
        .eq("username", trimmedUsername)
        .maybeSingle();

    if (existingAdmin) {

        return res.send(renderLayout({
            active: "new",
            title: "New Service",
            adminName: req.session.superAdminName,
            body: renderNewServiceForm({ values, errorMessage: `Username "${trimmedUsername}" is already taken.` })
        }));
    }


    // --------------------------------------
    // CREATE COMPANY
    // --------------------------------------

    const { data: company, error: companyError } = await supabase
        .from("companies")
        .insert({
            name: name.trim(),
            phone: phone && phone.trim() ? phone.trim() : null,
            address: address && address.trim() ? address.trim() : null
        })
        .select()
        .single();

    if (companyError) {

        console.error("Company creation error:", companyError);

        return res.send(renderLayout({
            active: "new",
            title: "New Service",
            adminName: req.session.superAdminName,
            body: renderNewServiceForm({ values, errorMessage: "Could not create the company: " + companyError.message })
        }));
    }


    // --------------------------------------
    // CREATE ADMIN ACCOUNT (compensating rollback if this fails)
    // --------------------------------------

    const passwordHash = await bcrypt.hash(admin_password, 12);

    const { data: admin, error: adminError } = await supabase
        .from("admin_accounts")
        .insert({
            company_id: company.id,
            username: trimmedUsername,
            password_hash: passwordHash,
            name: admin_name.trim(),
            language: lang
        })
        .select()
        .single();

    if (adminError) {

        console.error("Admin account creation error, rolling back company:", adminError);

        const { error: rollbackError } = await supabase
            .from("companies")
            .delete()
            .eq("id", company.id);

        if (rollbackError) {
            console.error("Rollback of company also failed:", rollbackError);
        }

        const friendlyMessage = adminError.code === "23505"
            ? `Username "${trimmedUsername}" is already taken.`
            : adminError.message;

        return res.send(renderLayout({
            active: "new",
            title: "New Service",
            adminName: req.session.superAdminName,
            body: renderNewServiceForm({
                values,
                errorMessage: `The admin account could not be created (${friendlyMessage}). No company was left behind — please try again.`
            })
        }));
    }


    // --------------------------------------
    // SUCCESS — the plain password is shown here ONLY, never stored.
    // --------------------------------------

    const loginUrl = `${req.protocol}://${req.get("host")}/admin/login`;

    res.send(renderSuccessPage({
        companyName: company.name,
        username: admin.username,
        password: admin_password,
        loginUrl
    }));
});


// ==========================================
// SUCCESS PAGE
// ==========================================

function renderSuccessPage({ companyName, username, password, loginUrl }) {

    const combined = `Service: ${companyName}\nLogin: ${loginUrl}\nUsername: ${username}\nPassword: ${password}`;

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Service created — AutoCore Super Admin</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { box-sizing: border-box; }
                body {
                    font-family: Arial, sans-serif;
                    background: #f4f6f8;
                    margin: 0;
                    padding: 20px;
                }
                .box {
                    max-width: 480px;
                    margin: auto;
                    background: white;
                    padding: 28px 22px;
                    border-radius: 15px;
                    box-shadow: 0 3px 12px rgba(0,0,0,0.06);
                }
                h1 { font-size: 20px; margin-top: 0; }
                .field {
                    background: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 10px;
                    padding: 12px 14px;
                    margin-bottom: 12px;
                }
                .field .k {
                    font-size: 12px;
                    text-transform: uppercase;
                    color: #6b7280;
                    letter-spacing: 0.04em;
                }
                .field .v {
                    font-size: 16px;
                    font-weight: bold;
                    word-break: break-all;
                    margin-top: 2px;
                }
                button, .btn {
                    display: block;
                    width: 100%;
                    padding: 13px;
                    margin-top: 10px;
                    border-radius: 9px;
                    border: none;
                    font-size: 15px;
                    cursor: pointer;
                    text-align: center;
                    text-decoration: none;
                    font-family: inherit;
                }
                .btn-copy { background: #eef2ff; color: #4338ca; }
                .btn-primary { background: #4f46e5; color: white; }
                .btn-outline { background: white; color: #111827; border: 1px solid #d1d5db; }
                .warn {
                    background: #fef9c3;
                    color: #854d0e;
                    padding: 10px 12px;
                    border-radius: 8px;
                    font-size: 13px;
                    margin-bottom: 16px;
                }
            </style>
        </head>
        <body>
            <div class="box">

                <h1>✅ Service created successfully</h1>

                <div class="warn">
                    ⚠️ This password is shown only once and is not stored anywhere. Save it now.
                </div>

                <div class="field">
                    <div class="k">Service</div>
                    <div class="v">${escapeHtml(companyName)}</div>
                </div>

                <div class="field">
                    <div class="k">Login URL</div>
                    <div class="v" style="font-size:14px;">${escapeHtml(loginUrl)}</div>
                </div>

                <div class="field">
                    <div class="k">Username</div>
                    <div class="v">${escapeHtml(username)}</div>
                </div>

                <div class="field">
                    <div class="k">Password</div>
                    <div class="v">${escapeHtml(password)}</div>
                </div>

                <button class="btn-copy" onclick="copyText('${escapeJsString(username)}', this, 'Username')">📋 Copy username</button>
                <button class="btn-copy" onclick="copyText('${escapeJsString(password)}', this, 'Password')">📋 Copy password</button>
                <button class="btn-copy" onclick="copyText('${escapeJsString(combined)}', this, 'Login info')">📋 Copy login information</button>

                <a class="btn btn-outline" href="/superadmin/companies/new">➕ Create another service</a>
                <a class="btn btn-primary" href="/superadmin">🏠 Back to dashboard</a>

            </div>

            <script>
                function copyText(text, btn, label) {
                    navigator.clipboard.writeText(text).then(() => {
                        const original = btn.textContent;
                        btn.textContent = "✅ " + label + " copied!";
                        setTimeout(() => { btn.textContent = original; }, 1500);
                    }).catch(() => {
                        alert(text);
                    });
                }
            </script>
        </body>
        </html>
    `;
}


// ==========================================
// EDIT COMPANY
// ==========================================

async function getPrimaryAdmin(companyId) {

    const { data } = await supabase
        .from("admin_accounts")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: true })
        .limit(1);

    return data && data[0] ? data[0] : null;
}


router.get("/companies/:id/edit", requireSuperAdmin, async (req, res) => {

    const { data: company, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", req.params.id)
        .maybeSingle();

    if (error || !company) {
        return res.send(renderErrorPage({ title: "❌ Company not found" }));
    }

    const primaryAdmin = await getPrimaryAdmin(company.id);

    const languageOptions = ADMIN_LANGS
        .map(code => `
            <option value="${code}" ${(primaryAdmin?.language || DEFAULT_ADMIN_LANG) === code ? "selected" : ""}>
                ${ADMIN_LANGUAGE_LABELS[code]}
            </option>
        `)
        .join("");

    const body = `
        <div class="top-row">
            <h1>Edit company</h1>
        </div>

        <div class="panel" style="max-width:560px;">

            <form method="POST" action="/superadmin/companies/${company.id}/edit">

                <label>Company name</label>
                <input name="name" value="${escapeHtml(company.name)}" required />

                <label>Phone</label>
                <input name="phone" value="${escapeHtml(company.phone)}" />

                <label>Address</label>
                <input name="address" value="${escapeHtml(company.address)}" />

                <label>Default language ${primaryAdmin ? "(admin panel)" : ""}</label>
                <select name="language" ${primaryAdmin ? "" : "disabled"}>
                    ${languageOptions}
                </select>
                ${!primaryAdmin ? `<p style="font-size:12px;color:#6b7280;">No admin account exists for this company yet.</p>` : ""}

                <div style="margin-top:22px;">
                    <button class="btn btn-indigo" type="submit">Save changes</button>
                </div>

            </form>

        </div>
    `;

    res.send(renderLayout({
        active: "companies",
        title: "Edit company",
        adminName: req.session.superAdminName,
        body
    }));
});


router.post("/companies/:id/edit", requireSuperAdmin, async (req, res) => {

    const companyId = req.params.id;
    const { name, phone, address, language } = req.body;

    if (!name || !name.trim()) {
        return res.send(renderErrorPage({
            title: "❌ Company name is required",
            backHref: `/superadmin/companies/${companyId}/edit`,
            backLabel: "← Back to edit form"
        }));
    }

    const { error: updateError } = await supabase
        .from("companies")
        .update({
            name: name.trim(),
            phone: phone && phone.trim() ? phone.trim() : null,
            address: address && address.trim() ? address.trim() : null
        })
        .eq("id", companyId);

    if (updateError) {

        console.error("Company update error:", updateError);

        return res.send(renderErrorPage({
            title: "❌ Could not update company",
            message: updateError.message,
            backHref: `/superadmin/companies/${companyId}/edit`,
            backLabel: "← Back to edit form"
        }));
    }

    const lang = normalizeAdminLang(language);

    if (lang) {

        const primaryAdmin = await getPrimaryAdmin(companyId);

        if (primaryAdmin) {

            const { error: langError } = await supabase
                .from("admin_accounts")
                .update({ language: lang })
                .eq("id", primaryAdmin.id);

            if (langError) {
                console.error("Admin language update error:", langError);
            }
        }
    }

    res.redirect("/superadmin");
});


// ==========================================
// ACTIVATE / SUSPEND
// ==========================================

async function setCompanyActive(req, res, isActive) {

    const companyId = req.params.id;

    const { error } = await supabase
        .from("companies")
        .update({ is_active: isActive })
        .eq("id", companyId);

    if (error) {

        console.error("Company activate/suspend error:", error);

        const message = isMissingColumnError(error)
            ? "The `companies.is_active` column doesn't exist yet. Run migrations/002_add_company_is_active.sql in the Supabase SQL editor, then try again."
            : error.message;

        return res.send(renderErrorPage({
            title: isActive ? "❌ Could not activate company" : "❌ Could not suspend company",
            message
        }));
    }

    res.redirect("/superadmin");
}


router.post("/companies/:id/activate", requireSuperAdmin, (req, res) => setCompanyActive(req, res, true));
router.post("/companies/:id/suspend", requireSuperAdmin, (req, res) => setCompanyActive(req, res, false));


// ==========================================
// ARCHIVE / RESTORE
// ==========================================
// Deliberately separate from Suspend/Activate above (different column,
// different meaning): Suspend is a temporary operational block; Archive
// means the company is no longer active but its data is fully retained
// and it can be Restored later. Neither one ever deletes anything.

router.post("/companies/:id/archive", requireSuperAdmin, async (req, res) => {

    const companyId = req.params.id;

    const { error } = await supabase
        .from("companies")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", companyId);

    if (error) {

        console.error("Company archive error:", error);

        const message = isMissingColumnError(error)
            ? "The `companies.archived_at` column doesn't exist yet. Run migrations/003_add_company_archive.sql in the Supabase SQL editor, then try again."
            : error.message;

        return res.send(renderErrorPage({ title: "❌ Could not archive company", message }));
    }

    res.redirect("/superadmin?filter=archived");
});


router.post("/companies/:id/restore", requireSuperAdmin, async (req, res) => {

    const companyId = req.params.id;

    const { error } = await supabase
        .from("companies")
        .update({ archived_at: null })
        .eq("id", companyId);

    if (error) {

        console.error("Company restore error:", error);

        const message = isMissingColumnError(error)
            ? "The `companies.archived_at` column doesn't exist yet. Run migrations/003_add_company_archive.sql in the Supabase SQL editor, then try again."
            : error.message;

        return res.send(renderErrorPage({ title: "❌ Could not restore company", message }));
    }

    res.redirect("/superadmin");
});


// ==========================================
// PERMANENT DELETE
// ==========================================
// Separate, deliberately dangerous-looking path from Archive. Requires
// typing the exact company name to confirm. This is a real, irreversible
// delete — the database cascades it to that company's customers, cars,
// status_history, and admin_accounts (verified empirically: all four
// have ON DELETE CASCADE back to companies.id). Only reachable through
// /superadmin/*, which normal company admins have no session/cookie
// access to at all.

router.get("/companies/:id/delete-permanently", requireSuperAdmin, async (req, res) => {

    const { data: company, error } = await supabase
        .from("companies")
        .select("*")
        .eq("id", req.params.id)
        .maybeSingle();

    if (error || !company) {
        return res.send(renderErrorPage({ title: "❌ Company not found" }));
    }

    const [{ count: carsCount }, { count: customersCount }, { count: adminsCount }] = await Promise.all([
        supabase.from("cars").select("id", { count: "exact", head: true }).eq("company_id", company.id),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("company_id", company.id),
        supabase.from("admin_accounts").select("id", { count: "exact", head: true }).eq("company_id", company.id)
    ]);

    const body = `
        <div class="top-row">
            <h1 style="color:#991b1b;">☠️ Permanently delete company</h1>
        </div>

        <div class="panel" style="max-width:560px; border: 2px solid #fecaca;">

            <div class="notice error">
                <strong>This cannot be undone.</strong> Deleting
                <strong>${escapeHtml(company.name)}</strong> will permanently remove:
                <ul style="margin:8px 0 0 18px; padding:0;">
                    <li>${customersCount || 0} customer${customersCount === 1 ? "" : "s"}</li>
                    <li>${carsCount || 0} vehicle${carsCount === 1 ? "" : "s"} and their full status history</li>
                    <li>${adminsCount || 0} admin account${adminsCount === 1 ? "" : "s"}</li>
                </ul>
                If you want to keep this data but stop the company from operating, use
                <strong>Archive</strong> instead — go back and choose that.
            </div>

            <form method="POST" action="/superadmin/companies/${company.id}/delete-permanently">

                <label>
                    Type the exact company name (<strong>${escapeHtml(company.name)}</strong>) to confirm
                </label>
                <input name="confirm_name" autocomplete="off" required />

                <div style="margin-top:22px; display:flex; gap:10px;">
                    <a class="btn btn-outline" href="/superadmin" style="flex:1; text-align:center;">Cancel</a>
                    <button class="btn btn-red" type="submit" style="flex:1;">Permanently delete</button>
                </div>

            </form>

        </div>
    `;

    res.send(renderLayout({
        active: "companies",
        title: "Delete company",
        adminName: req.session.superAdminName,
        body
    }));
});


router.post("/companies/:id/delete-permanently", requireSuperAdmin, async (req, res) => {

    const companyId = req.params.id;
    const { confirm_name } = req.body;

    const { data: company, error: lookupError } = await supabase
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .maybeSingle();

    if (lookupError || !company) {
        return res.send(renderErrorPage({ title: "❌ Company not found" }));
    }

    if (!confirm_name || confirm_name.trim() !== company.name) {

        return res.send(renderErrorPage({
            title: "❌ Name did not match — nothing was deleted",
            message: `You typed "${confirm_name || ""}", which doesn't exactly match "${company.name}". Go back and try again.`,
            backHref: `/superadmin/companies/${company.id}/delete-permanently`,
            backLabel: "← Back"
        }));
    }

    const { error: deleteError } = await supabase
        .from("companies")
        .delete()
        .eq("id", companyId);

    if (deleteError) {

        console.error("Permanent company delete error:", deleteError);

        return res.send(renderErrorPage({
            title: "❌ Could not delete company",
            message: deleteError.message
        }));
    }

    res.send(renderLayout({
        active: "companies",
        title: "Company deleted",
        adminName: req.session.superAdminName,
        body: `
            <div class="notice success">
                ✅ <strong>${escapeHtml(company.name)}</strong> and all of its data have been permanently deleted.
            </div>
            <a class="btn btn-indigo" href="/superadmin">🏠 Back to dashboard</a>
        `
    }));
});


module.exports = router;
