// Safe, local-only check for migration-dependent query failures.
//
// Builds a STRICT mock of the CURRENT PRODUCTION schema — i.e. exactly
// as it exists today, WITHOUT migrations 009/010/011 applied — and runs
// every admin.js route that depends on those migrations against it. A
// real, unmigrated Supabase/PostgREST would reject any query naming a
// column or table that doesn't exist with an error response (confirmed
// by this project's own history: the migration-008 diagnosis surfaced
// exactly this shape of error). This mock reproduces that exact
// behavior — {data: null, error: {...}} for an unknown column, or for
// `vehicle_service_notes` specifically (which doesn't exist pre-009) —
// and checks whether each route then degrades to a clean, non-crashing
// response, or throws unhandled.
//
// SAFETY: no production connection, no WORKSHOP_BOT_TOKEN, no real
// Telegram/WhatsApp contact. Entirely local and in-memory.

process.env.BOT_TOKEN = "123456789:QA-FAKE-TOKEN-NOT-REAL-00000000000";
delete process.env.WORKSHOP_BOT_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
process.env.SESSION_SECRET = "qa-only-session-secret-not-for-production";

const express = require("express");
const bcrypt = require("bcrypt");

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: detail || "" }); }

// Exactly the columns that exist in production TODAY — no telegram_username,
// no contact_method on customers; no vehicle_service_notes table at all.
const PRE_MIGRATION_SCHEMA = {
    companies: ["id", "name", "phone", "address", "is_active", "archived_at"],
    admin_accounts: ["id", "username", "password_hash", "company_id", "name", "language", "telegram_id"],
    customers: ["id", "company_id", "telegram_id", "name", "phone", "language"],
    cars: ["id", "company_id", "customer_id", "brand", "model", "registration", "vin", "problem", "status", "created_at", "updated_at"]
    // vehicle_service_notes intentionally absent entirely — migration 009 not applied.
};

const db = {
    companies: [{ id: 1, name: "Pre-Migration Co", phone: null, address: null, is_active: true, archived_at: null }],
    admin_accounts: [],
    customers: [],
    cars: []
};

let nextId = { admin_accounts: 1, customers: 1, cars: 1 };

function parseSelectedColumns(selectStr) {
    // Pull out top-level column names from a select string like
    // "id, name, phone, telegram_id, telegram_username, contact_method"
    // or "*, customers ( id, name, phone, telegram_id, telegram_username )".
    // Good enough for this check's purpose: find every bare identifier
    // token and test each against the known-existing column list.
    return (selectStr.match(/[a-z_][a-z0-9_]*/gi) || []).filter((t) => t !== "*");
}

function mockSupabase() {
    function from(table) {

        const knownColumns = PRE_MIGRATION_SCHEMA[table];

        if (!knownColumns) {
            // Table doesn't exist in the pre-migration schema at all
            // (vehicle_service_notes) — real PostgREST returns a clean
            // error here (PGRST205-style), never a thrown exception.
            const api = {
                select() { return api; }, eq() { return api; }, neq() { return api; },
                is() { return api; }, gt() { return api; }, in() { return api; },
                order() { return api; }, limit() { return api; },
                insert() { return api; }, update() { return api; }, delete() { return api; },
                single() { return Promise.resolve({ data: null, error: { message: `relation "public.${table}" does not exist`, code: "PGRST205" } }); },
                maybeSingle() { return Promise.resolve({ data: null, error: { message: `relation "public.${table}" does not exist`, code: "PGRST205" } }); },
                then(resolve) { resolve({ data: null, error: { message: `relation "public.${table}" does not exist`, code: "PGRST205" } }); }
            };
            return api;
        }

        let selectStr = "*";
        const filters = [];
        let orderCol = null, orderAsc = true;
        let limitN = null;
        let insertPayload = null;
        let updatePayload = null;
        let op = "select";

        function matches(row) { return filters.every((f) => f(row)); }

        function unknownColumnError() {
            if (selectStr === "*") return null;
            const requested = parseSelectedColumns(selectStr);
            const unknown = requested.filter((c) => !knownColumns.includes(c) && !PRE_MIGRATION_SCHEMA[c] /* nested relation name */);
            if (unknown.length > 0) {
                return { message: `column ${table}.${unknown[0]} does not exist`, code: "42703" };
            }
            return null;
        }

        async function exec(terminal) {

            const colError = unknownColumnError();
            if (colError) return { data: terminal === "single" || terminal === "maybeSingle" ? null : null, error: colError };

            if (op === "insert") {
                const rows = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
                // Realistic: inserting a column that doesn't exist on this
                // table also fails, same as a bad select.
                for (const r of rows) {
                    for (const key of Object.keys(r)) {
                        if (!knownColumns.includes(key)) {
                            return { data: null, error: { message: `column "${key}" of relation "${table}" does not exist`, code: "42703" } };
                        }
                    }
                }
                const inserted = rows.map((r) => { const row = { id: nextId[table]++, ...r }; db[table].push(row); return row; });
                return { data: terminal === "single" ? inserted[0] : inserted, error: null };
            }
            if (op === "update") {
                for (const key of Object.keys(updatePayload || {})) {
                    if (!knownColumns.includes(key)) {
                        return { data: null, error: { message: `column "${key}" of relation "${table}" does not exist`, code: "42703" } };
                    }
                }
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
            // Nested relation embeds (e.g. "customers (...)") are simply
            // dropped in this pre-migration mock when the relation itself
            // references unknown columns — already caught above via
            // unknownColumnError(); plain rows pass through as-is.
            if (terminal === "single") {
                if (rows.length === 0) return { data: null, error: { message: "No rows found" } };
                return { data: rows[0], error: null };
            }
            if (terminal === "maybeSingle") return { data: rows[0] || null, error: null };
            return { data: rows, error: null };
        }

        const api = {
            select(s) { selectStr = s || "*"; return api; },
            eq(col, val) { filters.push((r) => r[col] == val); return api; },
            neq(col, val) { filters.push((r) => r[col] != val); return api; },
            is(col, val) { filters.push((r) => (r[col] ?? null) === val); return api; },
            gt(col, val) { filters.push((r) => r[col] > val); return api; },
            in(col, vals) { filters.push((r) => vals.includes(r[col])); return api; },
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

const supabasePath = require.resolve("./supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: mockSupabase() };

const adminRouter = require("./admin");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/admin", adminRouter);

// Last-resort error handler so an unhandled exception shows up as a
// clearly-labeled 500 in the test, rather than the test script itself
// crashing — this is what reveals an *unsafe* (crashing) route.
app.use((err, req, res, next) => {
    res.status(500).send(`UNHANDLED: ${err.message}`);
});

function extractCookie(h) { if (!h) return null; return (Array.isArray(h) ? h[0] : h).split(";")[0]; }

async function main() {

    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;

    const passwordHash = await bcrypt.hash("qapass123", 10);
    db.admin_accounts.push({ id: 1, username: "premig_admin", password_hash: passwordHash, company_id: 1, name: "Pre-Mig Admin", language: "en", telegram_id: null });
    db.customers.push({ id: 1, company_id: 1, telegram_id: null, name: "Pre-Mig Customer", phone: "+15005550001", language: "en" });
    db.cars.push({ id: 1, company_id: 1, customer_id: 1, brand: "PreMig", model: "Car", registration: "PREMIG-001", vin: "PREMIGVIN0001", problem: "x", status: "repair", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    const loginRes = await fetch(`${base}/admin/login`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "manual",
        body: new URLSearchParams({ username: "premig_admin", password: "qapass123", lang: "en" }).toString()
    });
    const cookie = extractCookie(loginRes.headers.get("set-cookie"));

    async function get(path) {
        const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
        const html = await res.text();
        return { status: res.status, html };
    }
    async function post(path, fields) {
        const res = await fetch(`${base}${path}`, {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, redirect: "manual",
            body: new URLSearchParams(fields).toString()
        });
        const html = res.status !== 302 ? await res.text() : null;
        return { status: res.status, html };
    }

    // The 5 routes known to select telegram_username/contact_method as
    // part of their PRIMARY query, against a schema that doesn't have
    // those columns yet (today's real production state).
    const readRoutes = ["/admin/", "/admin/ready", "/admin/archive", "/admin/customers", "/admin/car/1"];

    for (const route of readRoutes) {
        const r = await get(route);
        const crashed = r.status === 500 && r.html.startsWith("UNHANDLED");
        const gracefulError = r.status === 200 && /database error|something went wrong|not available/i.test(r.html);
        record(
            `${route}: pre-migration schema produces a controlled response, not an unhandled crash`,
            !crashed,
            `status=${r.status} crashed=${crashed} gracefulErrorShown=${gracefulError}`
        );
    }

    // Writes: new-customer creation on /add-car (writes contact_method/telegram_username).
    {
        const getR = await get("/admin/add-car");
        const idem = (getR.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        const r = await post("/admin/add-car", {
            new_customer_name: "Should Fail Pre-Migration", brand: "X", model: "Y", registration: "Z",
            vin: "PREMIGFAILVIN01", idempotency_key: idem, contact_method: "telegram", problem: "x"
        });
        const crashed = r.status === 500;
        record("POST /add-car (new customer) fails cleanly, not a crash, when contact_method/telegram_username columns don't exist yet", !crashed, `status=${r.status}`);
    }

    // Service note write against a table that doesn't exist at all (009 not applied).
    {
        const r = await post("/admin/car/1/notes", { mileage_km: "1000", note: "test" });
        const crashed = r.status === 500;
        record("POST /car/:id/notes fails cleanly, not a crash, when vehicle_service_notes table doesn't exist yet", !crashed, `status=${r.status}`);
    }

    console.log("\n=== MIGRATION-DEPENDENCY RESULTS (simulated pre-migration schema) ===");
    results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name} :: ${r.detail}`));
    const passCount = results.filter((r) => r.pass).length;
    console.log(`\nOverall: ${passCount}/${results.length} passed`);

    server.close();
    return results.every((r) => r.pass);
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((err) => { console.error("ERROR:", err); process.exit(1); });
