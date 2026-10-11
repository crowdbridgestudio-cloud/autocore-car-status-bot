// Local-only visual demo of the Admin Panel (admin.js), fully isolated
// from production. Deliberately does NOT require index.js (that's what
// starts the real Telegram long-polling bots) — it mounts ONLY admin.js's
// router in a bare Express app, and admin.js's own require("./supabase")
// is intercepted (via require.cache) to resolve to an in-memory mock
// instead of the real Supabase client, before admin.js is ever required.
//
// No real .env is loaded. BOT_TOKEN is set to an obviously-fake string
// purely so `new Bot(...)` in admin.js can construct without a real
// credential — grammY's Bot constructor is lazy and makes no network call
// on construction, and the one place admin.js would actually call the
// Telegram API (notificationBot.api.sendMessage, in POST /status) is
// never reached because every demo customer below has telegram_id: null,
// which is the exact same existing code path that already skips sending
// in production whenever a real customer hasn't connected Telegram.
//
// Nothing here is persisted anywhere — all "data" lives in the `db`
// object below, in this process's memory only, and resets completely
// every time this script is restarted.

process.env.BOT_TOKEN = "123456789:DEMO-FAKE-TOKEN-NOT-REAL-00000000000";
delete process.env.WORKSHOP_BOT_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
process.env.SESSION_SECRET = "demo-only-session-secret-not-for-production";

const express = require("express");
const bcrypt = require("bcrypt");

// ---------------- In-memory fake database ----------------

const db = {
    companies: [
        { id: 1, name: "Demo Auto Repair", phone: "+1 555 0100", address: "123 Demo Street", is_active: true, archived_at: null }
    ],
    admin_accounts: [
        {
            id: 1,
            username: "demo",
            password_hash: bcrypt.hashSync("demo1234", 10),
            company_id: 1,
            name: "Demo Admin",
            language: "en",
            telegram_id: null
        }
    ],
    // contact_method + Telegram/WhatsApp state is deliberately varied to
    // preview every real state renderMessageAction/renderTelegramSection
    // can produce (all fake/placeholder data, not real accounts):
    //   Alice  — contact_method "telegram", linked + public username  -> real, clickable "Chat on Telegram"
    //   Bob    — contact_method "telegram", linked, NO public username -> honest "not available" state, points at the connect flow
    //   Carla  — contact_method "whatsapp", NO phone on file          -> honest "no valid WhatsApp number" state
    //   David  — contact_method "whatsapp", valid phone               -> real, clickable wa.me link
    customers: [
        { id: 1, company_id: 1, name: "Alice Johnson", phone: "+1 555 0101", telegram_id: 100001, telegram_username: "alice_demo_fake", contact_method: "telegram", language: "en" },
        { id: 2, company_id: 1, name: "Bob Smith", phone: "+1 555 0102", telegram_id: 100002, telegram_username: null, contact_method: "telegram", language: "en" },
        { id: 3, company_id: 1, name: "Carla Diaz", phone: null, telegram_id: null, telegram_username: null, contact_method: "whatsapp", language: "en" },
        { id: 4, company_id: 1, name: "David Nguyen", phone: "+1 555 0104", telegram_id: null, telegram_username: null, contact_method: "whatsapp", language: "en" }
    ],
    cars: [
        { id: 1, company_id: 1, customer_id: 1, brand: "BMW", model: "320i", registration: "DEMO-001", vin: "WBA12345678901234", problem: "Brake noise on braking", status: "repair", created_at: new Date(Date.now() - 86400000 * 2).toISOString(), updated_at: new Date(Date.now() - 3600000 * 3).toISOString() },
        { id: 2, company_id: 1, customer_id: 2, brand: "Toyota", model: "Corolla", registration: "DEMO-002", vin: "", problem: "Oil change + inspection", status: "ready", created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date(Date.now() - 1800000).toISOString() },
        { id: 3, company_id: 1, customer_id: 3, brand: "Ford", model: "Focus", registration: "DEMO-003", vin: "", problem: "Check engine light", status: "received", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 4, company_id: 1, customer_id: null, brand: "Audi", model: "A4", registration: "DEMO-004", vin: "", problem: "Full service", status: "delivered", created_at: new Date(Date.now() - 86400000 * 5).toISOString(), updated_at: new Date(Date.now() - 86400000 * 4).toISOString() },
        { id: 5, company_id: 1, customer_id: 4, brand: "Honda", model: "Civic", registration: "DEMO-005", vin: "", problem: "Timing belt replacement", status: "waiting_parts", created_at: new Date(Date.now() - 86400000 * 3).toISOString(), updated_at: new Date(Date.now() - 86400000).toISOString() },
        { id: 6, company_id: 1, customer_id: 1, brand: "Mazda", model: "CX-5", registration: "DEMO-006", vin: "", problem: "Customer cancelled appointment", status: "cancelled", created_at: new Date(Date.now() - 86400000 * 6).toISOString(), updated_at: new Date(Date.now() - 86400000 * 5).toISOString() }
    ],
    telegram_connect_tokens: [],
    status_history: [],
    // Requires migrations/009_vehicle_service_notes.sql in real
    // production — mocked here so the new Service Notes section has
    // something to display and add to in this local preview.
    vehicle_service_notes: [
        { id: 1, car_id: 1, company_id: 1, mileage_km: 184250, note: "Engine oil and filter changed.", created_by_admin_id: 1, created_at: new Date(Date.now() - 86400000 * 30).toISOString() },
        { id: 2, car_id: 1, company_id: 1, mileage_km: 186100, note: "Front brake pads replaced.", created_by_admin_id: 1, created_at: new Date(Date.now() - 86400000 * 5).toISOString() }
    ],
    // Empty on purpose — previews the "not configured yet" group status
    // honestly, since no Workshop Bot token exists in this local demo
    // anyway (confirmed: the Check Groups Status button only ever makes
    // a real Telegram call through admin.js's own workshopApiBot, which
    // is null here, same as production without WORKSHOP_BOT_TOKEN set).
    workshop_telegram_groups: [],
    // Requires migrations/012_company_contacts.sql in real production.
    company_contacts: [
        { id: 1, company_id: 1, role_label: "Owner", phone: "+15005550100", telegram_username: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    ]
};

const nextId = {};
for (const table of Object.keys(db)) {
    nextId[table] = Math.max(0, ...db[table].map((r) => r.id || 0)) + 1;
}

function attachEmbeds(table, row, selectStr) {
    const clone = { ...row };
    if (table === "cars" && /customers\s*\(/.test(selectStr)) {
        clone.customers = db.customers.find((c) => c.id === row.customer_id) || null;
    }
    if (table === "cars" && /companies\s*\(/.test(selectStr)) {
        clone.companies = db.companies.find((c) => c.id === row.company_id) || null;
    }
    if (table === "vehicle_service_notes" && /admin_accounts\s*\(/.test(selectStr)) {
        clone.admin_accounts = db.admin_accounts.find((a) => a.id === row.created_by_admin_id) || null;
    }
    return clone;
}

function mockSupabase() {

    function from(table) {

        let op = "select";
        let selectStr = "*";
        const filters = [];
        let orderCol = null, orderAsc = true;
        let limitN = null;
        let insertPayload = null;
        let updatePayload = null;

        function matches(row) {
            return filters.every((f) => f(row));
        }

        async function exec(terminal) {

            if (op === "insert") {
                const rows = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
                const inserted = rows.map((r) => {
                    const row = { id: nextId[table]++, ...r };
                    db[table].push(row);
                    return row;
                });
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

            if (orderCol) {
                rows = [...rows].sort((a, b) => {
                    if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1;
                    if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1;
                    return 0;
                });
            }

            if (limitN != null) rows = rows.slice(0, limitN);

            rows = rows.map((r) => attachEmbeds(table, r, selectStr));

            if (terminal === "single") {
                if (rows.length === 0) return { data: null, error: { message: "No rows found" } };
                return { data: rows[0], error: null };
            }

            if (terminal === "maybeSingle") {
                return { data: rows[0] || null, error: null };
            }

            return { data: rows, error: null };
        }

        const api = {
            select(s) { selectStr = s || "*"; return api; },
            eq(col, val) { filters.push((r) => r[col] == val); return api; },
            neq(col, val) { filters.push((r) => r[col] != val); return api; },
            in(col, vals) { filters.push((r) => vals.includes(r[col])); return api; },
            is(col, val) { filters.push((r) => (r[col] ?? null) === val); return api; },
            gt(col, val) { filters.push((r) => r[col] > val); return api; },
            order(col, opts) { orderCol = col; orderAsc = !(opts && opts.ascending === false); return api; },
            limit(n) { limitN = n; return api; },
            insert(obj) { op = "insert"; insertPayload = obj; return api; },
            update(obj) { op = "update"; updatePayload = obj; return api; },
            delete() { op = "delete"; return api; },
            single() { return exec("single"); },
            maybeSingle() { return exec("maybeSingle"); },
            then(resolve, reject) { exec(null).then(resolve, reject); }
        };

        return api;
    }

    return { from };
}

// Intercept admin.js's own `require("./supabase")` BEFORE requiring
// admin.js, so the mock above is what admin.js actually gets — the real
// supabase.js (which would call createClient with real credentials) is
// never executed at all.
const supabasePath = require.resolve("./supabase");
require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: mockSupabase()
};

const adminRouter = require("./admin");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/admin", adminRouter);

app.get("/", (req, res) => res.redirect("/admin/login"));

const PORT = 3100;

app.listen(PORT, () => {
    console.log(`Demo Admin Panel running at http://localhost:${PORT}/admin/login`);
    console.log(`Login: username "demo", password "demo1234"`);
    console.log(`All data is in-memory and fake — no real database or Telegram connection exists.`);
});
