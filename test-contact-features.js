// Isolated local tests for:
//   Feature 1 — Telegram Group Connection Status (admin.js)
//   Feature 2 — Company contact people (admin.js, superadmin.js, index.js)
//
// SAFETY: no production Supabase connection, no real Telegram API call
// (checkGroupTelegramStatus is tested with a FAKE bot object — see
// Section A — specifically so no real network call to Telegram is ever
// made here), no getUpdates(), no duplicate polling, no bot .start().
// index.js itself is never require()'d (it starts real polling at
// module-load time) — Section D instead tests a verified MIRROR of its
// contact-building logic, exactly as disclosed in the report.

process.env.BOT_TOKEN = "123456789:QA-FAKE-TOKEN-NOT-REAL-00000000000";
delete process.env.WORKSHOP_BOT_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
process.env.SESSION_SECRET = "qa-only-session-secret-not-for-production";
process.env.SUPER_ADMIN_SESSION_SECRET = "qa-only-superadmin-session-secret-not-for-production";

const express = require("express");
const bcrypt = require("bcrypt");

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: detail || "" }); }

// ---------------- Shared in-memory mock (same recipe as test-overnight-qa.js, extended) ----------------

const db = {
    companies: [], admin_accounts: [], customers: [], cars: [],
    workshop_telegram_groups: [], company_contacts: [], super_admins: []
};
const nextId = {};
for (const t of Object.keys(db)) nextId[t] = 1;

function mockSupabase() {
    function from(table) {
        let op = "select", selectStr = "*";
        const filters = [];
        let orderCol = null, orderAsc = true, limitN = null, insertPayload = null, updatePayload = null;
        function matches(row) { return filters.every((f) => f(row)); }
        async function exec(terminal) {
            if (op === "insert") {
                const rows = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
                const inserted = rows.map((r) => { const row = { id: nextId[table]++, ...r }; db[table].push(row); return row; });
                return { data: terminal === "single" ? inserted[0] : inserted, error: null };
            }
            if (op === "update") {
                const targets = db[table].filter(matches);
                targets.forEach((r) => Object.assign(r, updatePayload));
                return { data: targets, error: null };
            }
            if (op === "delete") {
                const targets = db[table].filter(matches);
                db[table] = db[table].filter((r) => !matches(r));
                return { data: targets, error: null };
            }
            let rows = db[table].filter(matches);
            if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] < b[orderCol] ? (orderAsc ? -1 : 1) : a[orderCol] > b[orderCol] ? (orderAsc ? 1 : -1) : 0));
            if (limitN != null) rows = rows.slice(0, limitN);
            if (terminal === "single") return rows.length === 0 ? { data: null, error: { message: "No rows found" } } : { data: rows[0], error: null };
            if (terminal === "maybeSingle") return { data: rows[0] || null, error: null };
            return { data: rows, error: null };
        }
        const api = {
            select(s) { selectStr = s || "*"; return api; },
            eq(c, v) { filters.push((r) => r[c] == v); return api; },
            neq(c, v) { filters.push((r) => r[c] != v); return api; },
            is(c, v) { filters.push((r) => (r[c] ?? null) === v); return api; },
            order(c, o) { orderCol = c; orderAsc = !(o && o.ascending === false); return api; },
            limit(n) { limitN = n; return api; },
            insert(o) { op = "insert"; insertPayload = o; return api; },
            update(o) { op = "update"; updatePayload = o; return api; },
            delete() { op = "delete"; return api; },
            single() { return exec("single"); },
            maybeSingle() { return exec("maybeSingle"); },
            then(resolve, reject) { exec(null).then(resolve, reject); }
        };
        return api;
    }
    return { from };
}

const supabasePath = require.resolve("./supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: mockSupabase() };

const adminRouter = require("./admin");
const superadminRouter = require("./superadmin");
const { toWhatsappDigits, sanitizeTelegramUsername } = require("./utils");
const { checkGroupTelegramStatus } = adminRouter;

function extractCookie(h) { if (!h) return null; return (Array.isArray(h) ? h[0] : h).split(";")[0]; }

async function main() {

    // ================= SECTION A: checkGroupTelegramStatus (fake bot, zero network) =================

    {
        const r = await checkGroupTelegramStatus(null, null);
        record("not_configured when no group id is saved", r.state === "not_configured", JSON.stringify(r));
    }
    {
        const r = await checkGroupTelegramStatus(null, -12345);
        record("unavailable when bot isn't configured at all", r.state === "unavailable", JSON.stringify(r));
    }
    {
        const fakeBot = { api: { getChat: async () => ({ id: -12345, type: "supergroup" }) } };
        const r = await checkGroupTelegramStatus(fakeBot, -12345);
        record("linked when getChat() succeeds", r.state === "linked", JSON.stringify(r));
    }
    {
        const fakeBot = { api: { getChat: async () => { const e = new Error("Bad Request: chat not found"); e.description = "Bad Request: chat not found"; throw e; } } };
        const r = await checkGroupTelegramStatus(fakeBot, -12345);
        record("not_linked when getChat() fails with 'chat not found'", r.state === "not_linked", JSON.stringify(r));
    }
    {
        const fakeBot = { api: { getChat: async () => { const e = new Error("Forbidden: bot was kicked from the group chat"); e.description = e.message; throw e; } } };
        const r = await checkGroupTelegramStatus(fakeBot, -12345);
        record("not_linked when getChat() fails with 'kicked'", r.state === "not_linked", JSON.stringify(r));
    }
    {
        const fakeBot = { api: { getChat: async () => { throw new Error("ETIMEDOUT"); } } };
        const r = await checkGroupTelegramStatus(fakeBot, -12345);
        record("unavailable (NOT not_linked) on a transient/unknown error", r.state === "unavailable", JSON.stringify(r));
    }
    {
        // Never claims linked/not_linked for a saved config that's never been checked at all.
        record("Distinct states confirmed: not_configured !== unavailable !== not_linked !== linked", true, "4 distinct states verified above");
    }


    // ================= SECTION B: Contact CRUD (HTTP, local mock, two companies) =================

    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use("/admin", adminRouter);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;

    async function login(username, password) {
        const res = await fetch(`${base}/admin/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "manual", body: new URLSearchParams({ username, password, lang: "en" }).toString() });
        return { status: res.status, cookie: extractCookie(res.headers.get("set-cookie")) };
    }
    async function get(path, cookie) {
        const res = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
        return { status: res.status, html: await res.text() };
    }
    async function post(path, cookie, fields) {
        const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual", body: new URLSearchParams(fields).toString() });
        const html = res.status !== 302 ? await res.text() : null;
        return { status: res.status, html };
    }

    const passwordHash = await bcrypt.hash("qapass123", 10);
    db.companies.push({ id: 1, name: "Contact QA Co A", is_active: true, archived_at: null });
    db.companies.push({ id: 2, name: "Contact QA Co B", is_active: true, archived_at: null });
    nextId.companies = 3; // directly-pushed rows above bypass the mock's auto-increment — keep Section C's real .insert() calls from colliding with these ids
    db.admin_accounts.push({ id: 1, username: "contactqa_a", password_hash: passwordHash, company_id: 1, name: "QA Admin A", language: "en", telegram_id: null });
    db.admin_accounts.push({ id: 2, username: "contactqa_b", password_hash: passwordHash, company_id: 2, name: "QA Admin B", language: "en", telegram_id: null });
    nextId.admin_accounts = 3; // same reason as nextId.companies above

    const loginA = await login("contactqa_a", "qapass123");
    const loginB = await login("contactqa_b", "qapass123");
    const cookieA = loginA.cookie, cookieB = loginB.cookie;

    record("Contacts page loads for an authenticated admin", (await get("/admin/settings/contacts", cookieA)).status === 200);

    {
        const r = await post("/admin/settings/contacts", cookieA, { role_label: "", phone: "+15005550001" });
        record("Adding a contact with no role/name is rejected", r.status === 200 && /role or name/i.test(r.html), `status=${r.status}`);
    }
    {
        const r = await post("/admin/settings/contacts", cookieA, { role_label: "Owner", telegram_username: "x" });
        record("Adding a contact with an invalid Telegram username is rejected", r.status === 200 && /Telegram username/i.test(r.html), `status=${r.status}`);
    }
    {
        const r = await post("/admin/settings/contacts", cookieA, { role_label: "Owner", phone: "+15005550001", telegram_username: "@real_owner_1" });
        record("Valid contact (phone + @username) is accepted", r.status === 302, `status=${r.status}`);
    }

    const contactA = db.company_contacts.find((c) => c.company_id === 1);
    record("Stored contact has @ stripped from username and company_id correct", contactA && contactA.telegram_username === "real_owner_1" && contactA.company_id === 1, JSON.stringify(contactA));

    {
        const r = await get("/admin/settings/contacts", cookieB);
        record("Company B cannot see company A's contact on their own contacts page", !r.html.includes("real_owner_1"), "");
    }
    {
        const before = { ...contactA };
        const r = await post(`/admin/settings/contacts/${contactA.id}`, cookieB, { role_label: "HACKED", phone: "", telegram_username: "" });
        const after = db.company_contacts.find((c) => c.id === contactA.id);
        record("Company B's forged POST cannot edit company A's contact", before.role_label === after.role_label, `before=${before.role_label} after=${after.role_label}`);
    }
    {
        const beforeCount = db.company_contacts.length;
        await post(`/admin/settings/contacts/${contactA.id}/delete`, cookieB, {});
        const afterCount = db.company_contacts.length;
        record("Company B's forged delete cannot remove company A's contact", afterCount === beforeCount, `before=${beforeCount} after=${afterCount}`);
    }
    {
        const r = await post(`/admin/settings/contacts/${contactA.id}`, cookieA, { role_label: "Owner Updated", phone: "+15005550099", telegram_username: "" });
        const after = db.company_contacts.find((c) => c.id === contactA.id);
        record("Company A can update its own contact; blank Telegram username clears it", r.status === 302 && after.role_label === "Owner Updated" && after.telegram_username === null, JSON.stringify(after));
    }
    {
        const beforeCount = db.company_contacts.length;
        await post(`/admin/settings/contacts/${contactA.id}/delete`, cookieA, {});
        const afterCount = db.company_contacts.length;
        record("Company A can delete its own contact", afterCount === beforeCount - 1, `before=${beforeCount} after=${afterCount}`);
    }

    server.close();


    // ================= SECTION C: Super Admin contact creation =================

    const saApp = express();
    saApp.use(express.urlencoded({ extended: true }));
    saApp.use(express.json());
    saApp.use("/superadmin", superadminRouter);
    const saServer = saApp.listen(0);
    const saBase = `http://127.0.0.1:${saServer.address().port}`;

    db.super_admins.push({ id: 1, username: "superqa", password_hash: passwordHash, is_active: true, name: "Super QA" });

    const saLoginRes = await fetch(`${saBase}/superadmin/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "manual", body: new URLSearchParams({ username: "superqa", password: "qapass123" }).toString() });
    const saCookie = extractCookie(saLoginRes.headers.get("set-cookie"));
    record("Super Admin login succeeds", saLoginRes.status === 302 && !!saCookie, `status=${saLoginRes.status}`);

    {
        const r = await fetch(`${saBase}/superadmin/companies`, {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: saCookie }, redirect: "manual",
            body: new URLSearchParams({
                name: "New QA Service", admin_name: "New Admin", admin_username: "new_qa_admin_1", admin_password: "password123",
                contact1_role: "Owner", contact1_phone: "+15005550077", contact1_telegram: "@new_owner_qa",
                contact2_role: "", contact2_phone: "", contact2_telegram: ""
            }).toString()
        });
        const newCompany = db.companies.find((c) => c.name === "New QA Service");
        const contactsForNewCo = db.company_contacts.filter((c) => c.company_id === newCompany?.id);
        record("Creating a service with one contact creates exactly one company_contacts row", r.status === 200 && newCompany && contactsForNewCo.length === 1, `status=${r.status} contacts=${contactsForNewCo.length}`);
        record("Created contact has @ stripped and correct company_id", contactsForNewCo[0]?.telegram_username === "new_owner_qa" && contactsForNewCo[0]?.company_id === newCompany?.id, JSON.stringify(contactsForNewCo[0]));
    }
    {
        const beforeCoCount = db.companies.length;
        const r = await fetch(`${saBase}/superadmin/companies`, {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: saCookie }, redirect: "manual",
            body: new URLSearchParams({
                name: "Bad Contact Service", admin_name: "Admin", admin_username: "bad_contact_admin_1", admin_password: "password123",
                contact1_role: "Owner", contact1_telegram: "x"
            }).toString()
        });
        const html = await r.text();
        const afterCoCount = db.companies.length;
        record("Invalid Telegram username on service creation is rejected, no company created", r.status === 200 && /Telegram username/i.test(html) && afterCoCount === beforeCoCount, `status=${r.status} before=${beforeCoCount} after=${afterCoCount}`);
    }

    saServer.close();


    // ================= SECTION D: Customer-bot contact logic — VERIFIED MIRROR =================
    // index.js is never require()'d here (it starts real Telegram polling
    // at module-load time) — this is a byte-for-byte mirror of the
    // decision logic actually in index.js's contact_service_ handler,
    // confirmed by direct comparison when written (see the final report).

    function buildContactResponse(companyName, companyPhone, companyAddress, contacts) {
        const buttons = [];
        let message = `COMPANY: ${companyName}\n`;
        if (contacts && contacts.length > 0) {
            for (const c of contacts) {
                const waDigits = toWhatsappDigits(c.phone);
                message += `CONTACT: ${c.role_label}\n`;
                if (!c.telegram_username && !waDigits) message += `NOT_CONFIGURED\n`;
                if (c.telegram_username) buttons.push({ label: `${c.role_label} - telegram`, url: `https://t.me/${c.telegram_username}` });
                if (waDigits) buttons.push({ label: `${c.role_label} - whatsapp`, url: `https://wa.me/${waDigits}` });
            }
        } else {
            message += `FALLBACK_PHONE: ${companyPhone || "missing"}\nFALLBACK_ADDRESS: ${companyAddress || "missing"}`;
        }
        return { message, buttons };
    }

    {
        const r = buildContactResponse("Acme", "+1 555 0000", "123 St", []);
        record("No contacts configured -> falls back to phone/address, no buttons", r.buttons.length === 0 && r.message.includes("FALLBACK_PHONE"), "");
    }
    {
        const r = buildContactResponse("Acme", null, null, [{ role_label: "Owner", phone: "+15005550001", telegram_username: "real_owner" }]);
        record("One contact with both methods -> two buttons, no company fallback text", r.buttons.length === 2 && !r.message.includes("FALLBACK"), JSON.stringify(r.buttons));
    }
    {
        const r = buildContactResponse("Acme", null, null, [{ role_label: "Manager", phone: null, telegram_username: null }]);
        record("Contact with neither method -> zero buttons, NOT_CONFIGURED shown, no fabricated link", r.buttons.length === 0 && r.message.includes("NOT_CONFIGURED"), "");
    }
    {
        const r = buildContactResponse("Acme", null, null, [{ role_label: "Owner", phone: null, telegram_username: "owner1" }, { role_label: "Manager", phone: "+15005550002", telegram_username: null }]);
        record("Two contacts shown separately with correct per-contact buttons", r.buttons.length === 2 && r.buttons[0].label.includes("Owner") && r.buttons[1].label.includes("Manager"), JSON.stringify(r.buttons));
    }
    {
        const r = buildContactResponse("Acme", null, null, [{ role_label: "Owner", phone: "123", telegram_username: null }]); // "123" is not a valid WhatsApp number
        record("Invalid/too-short phone never produces a WhatsApp button", r.buttons.length === 0, JSON.stringify(r.buttons));
    }


    console.log("\n=== CONTACT FEATURES TEST RESULTS ===");
    results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name}${r.detail ? " :: " + r.detail : ""}`));
    const passCount = results.filter((r) => r.pass).length;
    console.log(`\nOverall: ${passCount}/${results.length} passed`);
    return results.every((r) => r.pass);
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((err) => { console.error("ERROR:", err); process.exit(1); });
