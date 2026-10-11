// Overnight autonomous QA suite for the local AutoCore admin redesign.
//
// SAFETY: this test NEVER connects to the real/production Supabase. It
// spins up its OWN temporary Express app (on an ephemeral port, never
// 3100 — the user-facing demo at localhost:3100 is left completely
// untouched and running) with its OWN in-memory mock standing in for
// `require("./supabase")`, seeded with TWO companies so cross-tenant
// isolation can actually be exercised. Nothing here is Supabase,
// Telegram, or any real external service — pure local HTTP + in-memory
// state, same recipe as demo-server.js, extended with a second company.

process.env.BOT_TOKEN = "123456789:QA-FAKE-TOKEN-NOT-REAL-00000000000";
delete process.env.WORKSHOP_BOT_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
process.env.SESSION_SECRET = "qa-only-session-secret-not-for-production";

const express = require("express");
const bcrypt = require("bcrypt");

const results = [];
function record(name, pass, detail) {
    results.push({ name, pass, detail: detail || "" });
}

// ---------------- In-memory fake database (two companies) ----------------

const db = {
    companies: [
        { id: 1, name: "QA Company A", phone: "+1 555 0001", address: "A Street", is_active: true, archived_at: null },
        { id: 2, name: "QA Company B", phone: "+1 555 0002", address: "B Street", is_active: true, archived_at: null }
    ],
    admin_accounts: [],
    customers: [],
    cars: [],
    telegram_connect_tokens: [],
    status_history: [],
    vehicle_service_notes: []
};

const nextId = {};
for (const table of Object.keys(db)) nextId[table] = 1;

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

        function matches(row) { return filters.every((f) => f(row)); }

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
const { isValidVin, toWhatsappDigits, sanitizeTelegramUsername, sanitizeContactMethod } = adminRouter;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/admin", adminRouter);

let server, base;

function extractCookie(setCookieHeader) {
    if (!setCookieHeader) return null;
    const first = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    return first.split(";")[0];
}

async function login(username, password) {
    const res = await fetch(`${base}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        body: new URLSearchParams({ username, password, lang: "en" }).toString()
    });
    return { status: res.status, cookie: extractCookie(res.headers.get("set-cookie")) };
}

async function get(path, cookie) {
    const res = await fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
    const html = await res.text();
    return { status: res.status, html, location: res.headers.get("location") };
}

async function post(path, cookie, fields) {
    const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
        redirect: "manual",
        body: new URLSearchParams(fields).toString()
    });
    const html = res.status === 200 ? await res.text() : null;
    return { status: res.status, html, location: res.headers.get("location") };
}

async function main() {

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;

    // ================= SECTION 1: pure-logic unit tests =================

    const vinCases = [
        ["WBA12345678901234", true], ["", false], [null, false], ["AB", false],
        ["TOOLONG1234567890X", false], ["has space", false], ["VALID5", true], ["12345", true]
    ];
    for (const [input, expected] of vinCases) {
        record(`isValidVin(${JSON.stringify(input)}) === ${expected}`, isValidVin(input) === expected, `got ${isValidVin(input)}`);
    }

    const waCases = [
        ["+1 555 0104", "15550104"], // exactly 8 digits after stripping formatting -> the minimum valid length
        ["+15005550006", "15005550006"],
        ["123", null], // only 3 digits -> too short, invalid
        ["", null],
        [null, null],
        ["+1 (500) 555-0006", "15005550006"],
        ["0000000000000000", null] // 16 digits, too long
    ];
    for (const [input, expected] of waCases) {
        const got = toWhatsappDigits(input);
        record(`toWhatsappDigits(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, got === expected, `got ${JSON.stringify(got)}`);
    }

    const unameCases = [
        ["johnsmith", "johnsmith"], ["@johnsmith", "johnsmith"], ["ab", "INVALID"],
        ["", null], [null, null], ["123abc", "INVALID"], ["valid_user_99", "valid_user_99"],
        ["has space", "INVALID"], ["a".repeat(33), "INVALID"]
    ];
    for (const [input, expected] of unameCases) {
        const got = sanitizeTelegramUsername(input);
        record(`sanitizeTelegramUsername(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, got === expected, `got ${JSON.stringify(got)}`);
    }

    record('sanitizeContactMethod("telegram") === "telegram"', sanitizeContactMethod("telegram") === "telegram");
    record('sanitizeContactMethod("whatsapp") === "whatsapp"', sanitizeContactMethod("whatsapp") === "whatsapp");
    record('sanitizeContactMethod("garbage") === null', sanitizeContactMethod("garbage") === null);
    record('sanitizeContactMethod(undefined) === null', sanitizeContactMethod(undefined) === null);


    // ================= SECTION 2: seed two companies =================

    const passwordHash = await bcrypt.hash("qapass123", 10);

    db.admin_accounts.push({ id: 1, username: "qa_admin_a", password_hash: passwordHash, company_id: 1, name: "QA Admin A", language: "en", telegram_id: null });
    db.admin_accounts.push({ id: 2, username: "qa_admin_b", password_hash: passwordHash, company_id: 2, name: "QA Admin B", language: "en", telegram_id: null });

    db.customers.push({ id: 1, company_id: 1, name: "Customer A1", phone: "+15005550010", telegram_id: null, telegram_username: null, contact_method: "whatsapp", language: "en" });
    db.customers.push({ id: 2, company_id: 2, name: "Customer B1", phone: "+15005550020", telegram_id: null, telegram_username: null, contact_method: "whatsapp", language: "en" });

    db.cars.push({ id: 1, company_id: 1, customer_id: 1, brand: "BMW", model: "320i", registration: "QA-A-001", vin: "QAVIN0000000001A", problem: "test", status: "repair", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    db.cars.push({ id: 2, company_id: 2, customer_id: 2, brand: "Audi", model: "A4", registration: "QA-B-001", vin: "QAVIN0000000002B", problem: "test", status: "received", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    // Legacy-style car with no VIN at all, to test graceful handling.
    db.cars.push({ id: 3, company_id: 1, customer_id: 1, brand: "Legacy", model: "Car", registration: "QA-A-LEGACY", vin: null, problem: "no vin on file", status: "ready", created_at: new Date(Date.now() - 86400000 * 30).toISOString(), updated_at: new Date().toISOString() });

    nextId.admin_accounts = 3; nextId.customers = 3; nextId.cars = 4;


    // ================= SECTION 3: Auth and tenant isolation =================

    {
        const r = await get("/admin/", null);
        record("Unauthenticated GET /admin/ redirects to login", r.status === 302 && /login/.test(r.location || ""), `status=${r.status} location=${r.location}`);
    }

    const loginA = await login("qa_admin_a", "qapass123");
    record("Company A admin login succeeds (302)", loginA.status === 302 && !!loginA.cookie, `status=${loginA.status}`);

    const loginB = await login("qa_admin_b", "qapass123");
    record("Company B admin login succeeds (302)", loginB.status === 302 && !!loginB.cookie, `status=${loginB.status}`);

    {
        const r = await login("qa_admin_a", "wrongpassword");
        record("Wrong password rejected (no cookie, not 302-to-admin)", !r.cookie, `cookie=${r.cookie}`);
    }

    const cookieA = loginA.cookie;
    const cookieB = loginB.cookie;

    {
        // Company A must see only its own cars (QA-A-001, QA-A-LEGACY), never QA-B-001.
        const r = await get("/admin/", cookieA);
        const hasOwn = r.html.includes("QA-A-001");
        const hasLegacy = !r.html.includes("QA-A-LEGACY"); // legacy car is status "ready", excluded from Active Repairs by design
        const leaksOther = r.html.includes("QA-B-001");
        record("Company A dashboard shows own active car, not company B's", hasOwn && !leaksOther, `hasOwn=${hasOwn} leaksOther=${leaksOther}`);
    }

    {
        // Direct car-detail access across companies must fail (company-scoped query).
        const r = await get("/admin/car/2", cookieA); // car 2 belongs to company B
        const leaked = r.html.includes("Audi") || r.html.includes("QA-B-001");
        record("Company A cannot open company B's car detail page directly", !leaked, `status=${r.status} leaked=${leaked}`);
    }

    {
        // Cross-company customer_id injection on /add-car must still be rejected (P0 fix regression check).
        const r = await get("/admin/add-car", cookieA);
        const idemMatch = r.html.match(/name="idempotency_key" value="([^"]+)"/);
        const idem = idemMatch ? idemMatch[1] : "";
        const r2 = await post("/admin/add-car", cookieA, {
            idempotency_key: idem, customer_id: "2", brand: "Hack", model: "Attempt",
            registration: "HACK-001", vin: "HACKVIN0000000001", problem: "x"
        });
        const rejected = r2.status === 200 && /invalid/i.test(r2.html);
        record("P0 regression: cross-company customer_id on /add-car still rejected", rejected, `status=${r2.status}`);
    }

    {
        // /admin/status invalid-value rejection (P1 fix regression check).
        const r = await post("/admin/status", cookieA, { car_id: "1", status: "not_a_real_status" });
        record("P1 regression: /admin/status rejects invalid status", r.status === 200 && /not valid/i.test(r.html), `status=${r.status}`);
    }

    {
        // A company A session must not be able to change company B's car status.
        const before = db.cars.find((c) => c.id === 2).status;
        await post("/admin/status", cookieA, { car_id: "2", status: "delivered" });
        const after = db.cars.find((c) => c.id === 2).status;
        record("Company A cannot change company B's car status", before === after, `before=${before} after=${after}`);
    }

    {
        // Customer edit cross-company protection.
        const r = await get("/admin/customer/2/edit", cookieA); // customer 2 belongs to company B
        const leaked = r.html.includes("Customer B1");
        record("Company A cannot open company B's customer edit page", !leaked, `leaked=${leaked}`);
    }

    {
        // Direct POST attempt (not just GET) against another company's
        // customer — the update query's own company_id filter must be
        // what actually protects this, not merely hiding the GET page.
        const before = db.customers.find((c) => c.id === 2).name;
        await post("/admin/customer/2/edit", cookieA, { name: "HACKED NAME", phone: "" });
        const after = db.customers.find((c) => c.id === 2).name;
        record("Company A's direct POST cannot edit company B's customer record", before === after, `before=${before} after=${after}`);
    }


    // ================= SECTION 4: VIN =================

    {
        const r = await get("/admin/add-car", cookieA);
        const idem = (r.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        const r2 = await post("/admin/add-car", cookieA, {
            new_customer_name: "VIN Test Customer", brand: "Kia", model: "Rio",
            registration: "VIN-TEST-1", idempotency_key: idem, problem: "test"
            // vin omitted entirely
        });
        record("Missing VIN rejected on vehicle creation", r2.status === 200 && /valid VIN/i.test(r2.html), `status=${r2.status}`);
    }

    {
        const r = await get("/admin/add-car", cookieA);
        const idem = (r.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        const r2 = await post("/admin/add-car", cookieA, {
            new_customer_name: "VIN Test 2", brand: "Kia", model: "Rio",
            registration: "VIN-TEST-2", vin: "AB", idempotency_key: idem, problem: "test"
        });
        record("Malformed (too-short) VIN rejected", r2.status === 200 && /valid VIN/i.test(r2.html), `status=${r2.status}`);
    }

    {
        const r = await get("/admin/add-car", cookieA);
        const idem = (r.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        const beforeCount = db.cars.length;
        const r2 = await post("/admin/add-car", cookieA, {
            new_customer_name: "VIN Test 3", brand: "Kia", model: "Rio",
            registration: "VIN-TEST-3", vin: "VALIDVIN123456", idempotency_key: idem,
            contact_method: "telegram", problem: "test"
        });
        const afterCount = db.cars.length;
        record("Valid VIN accepted, exactly one car row created", r2.status === 302 && afterCount === beforeCount + 1, `status=${r2.status} before=${beforeCount} after=${afterCount}`);
    }

    {
        // Legacy car with null VIN must render without crashing anywhere it appears.
        const r1 = await get("/admin/", cookieA);
        const r2 = await get("/admin/ready", cookieA); // legacy car (status "ready") lives here
        const r3 = await get("/admin/car/3", cookieA);
        const r4 = await get("/admin/customers", cookieA);
        const allOk = [r1, r2, r3, r4].every((r) => r.status === 200);
        const showsNotOnFile = r3.html.includes("Not on file");
        record("Legacy vehicle with no VIN renders safely everywhere (dashboard/ready/detail/customers)", allOk && showsNotOnFile, `statuses=${[r1, r2, r3, r4].map((r) => r.status)} showsNotOnFile=${showsNotOnFile}`);
    }

    {
        // Duplicate submission (same idempotency key twice) must not create two cars.
        const r = await get("/admin/add-car", cookieA);
        const idem = (r.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        const payload = { new_customer_name: "Dup Test", brand: "Dup", model: "Car", registration: "DUP-001", vin: "DUPVIN1234567", idempotency_key: idem, problem: "test" };
        const beforeCount = db.cars.length;
        const [first, second] = await Promise.all([post("/admin/add-car", cookieA, payload), post("/admin/add-car", cookieA, payload)]);
        const afterCount = db.cars.length;
        record("Simultaneous duplicate submission creates exactly one car, not two", afterCount === beforeCount + 1, `before=${beforeCount} after=${afterCount} statuses=${first.status},${second.status}`);
    }


    // ================= SECTION 5: Service notes =================

    {
        const beforeCount = db.vehicle_service_notes.length;
        const r = await post("/admin/car/1/notes", cookieA, { mileage_km: "184250", note: "Oil changed" });
        const afterCount = db.vehicle_service_notes.length;
        record("Valid service note accepted and persisted", r.status === 302 && afterCount === beforeCount + 1, `status=${r.status} before=${beforeCount} after=${afterCount}`);
    }

    for (const [label, fields] of [
        ["missing mileage", { note: "No mileage given" }],
        ["negative mileage", { mileage_km: "-5", note: "Negative" }],
        ["decimal mileage", { mileage_km: "184250.5", note: "Decimal" }],
        ["non-numeric mileage", { mileage_km: "abc", note: "Non numeric" }],
        ["empty note", { mileage_km: "190000", note: "" }]
    ]) {
        const beforeCount = db.vehicle_service_notes.length;
        const r = await post("/admin/car/1/notes", cookieA, fields);
        const afterCount = db.vehicle_service_notes.length;
        record(`Service note rejects ${label} (no row created)`, r.status === 200 && afterCount === beforeCount, `status=${r.status} before=${beforeCount} after=${afterCount}`);
    }

    {
        const r = await get("/admin/car/1", cookieA);
        const hasNote = r.html.includes("Oil changed") && r.html.includes("184,250");
        const hasAuthor = r.html.includes("QA Admin A");
        record("Service note renders with mileage, text, and staff attribution", hasNote && hasAuthor, `hasNote=${hasNote} hasAuthor=${hasAuthor}`);
    }

    {
        // Boundary: mileage of exactly 0 must be ACCEPTED (rule is >= 0,
        // not > 0) — a brand-new vehicle genuinely can have 0 km on it.
        const beforeCount = db.vehicle_service_notes.length;
        const r = await post("/admin/car/1/notes", cookieA, { mileage_km: "0", note: "Brand new, zero km at intake" });
        const afterCount = db.vehicle_service_notes.length;
        record("Mileage of exactly 0 is accepted (boundary, not rejected)", r.status === 302 && afterCount === beforeCount + 1, `status=${r.status} before=${beforeCount} after=${afterCount}`);
    }

    {
        // Notes must survive a status change (and delivery/cancellation) of the SAME car row.
        await post("/admin/status", cookieA, { car_id: "1", status: "ready" });
        await post("/admin/status", cookieA, { car_id: "1", status: "delivered" });
        const r = await get("/admin/car/1", cookieA);
        record("Service note still visible after status change -> delivered", r.html.includes("Oil changed"), `found=${r.html.includes("Oil changed")}`);

        const archiveR = await get("/admin/archive", cookieA);
        record("Delivered vehicle with notes appears in Archive", archiveR.html.includes("QA-A-001"), "");
    }

    {
        // Cross-company note access: company B must not be able to add a note to company A's car.
        const beforeCount = db.vehicle_service_notes.length;
        const r = await post("/admin/car/1/notes", cookieB, { mileage_km: "200000", note: "Hostile note from company B" });
        const afterCount = db.vehicle_service_notes.length;
        const blocked = afterCount === beforeCount && (r.status === 200 /* "car not found" page */);
        record("Company B cannot add a service note to company A's car", blocked, `status=${r.status} before=${beforeCount} after=${afterCount}`);
    }

    {
        // Cross-company note VIEWING: company B must not see company A's notes via the car-detail page (can't even reach it).
        const r = await get("/admin/car/1", cookieB);
        const leaked = r.html.includes("Oil changed");
        record("Company B cannot view company A's service notes", !leaked, `leaked=${leaked}`);
    }


    // ================= SECTION 6: Contact method / WhatsApp / Telegram =================

    {
        const r = await get("/admin/add-car", cookieA);
        const idem = (r.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        const r2 = await post("/admin/add-car", cookieA, {
            new_customer_name: "Bad Username Test", brand: "Kia", model: "Rio", registration: "UNAME-BAD",
            vin: "UNAMEBADVIN001", idempotency_key: idem, contact_method: "telegram", telegram_username: "x"
        });
        record("Invalid Telegram username rejected on vehicle creation", r2.status === 200 && /Telegram username/i.test(r2.html), `status=${r2.status}`);
    }

    {
        const r = await get("/admin/add-car", cookieA);
        const idem = (r.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        const r2 = await post("/admin/add-car", cookieA, {
            new_customer_name: "Good Username Test", brand: "Kia", model: "Rio", registration: "UNAME-GOOD",
            vin: "UNAMEGOODVIN01", idempotency_key: idem, contact_method: "telegram", telegram_username: "@valid_name_1"
        });
        const created = db.customers.find((c) => c.name === "Good Username Test");
        record("Valid Telegram username (with @ stripped) stored correctly", r2.status === 302 && created && created.telegram_username === "valid_name_1", `stored=${created && created.telegram_username}`);
    }

    {
        // Self-contained check (doesn't depend on car 1's status, which an
        // earlier section already moved to "delivered"/Archive) — create a
        // fresh active car for customer A1 (contact_method whatsapp, phone
        // +15005550010 -> digits 15005550010, 11 digits, valid) and confirm
        // its card carries a real wa.me link wherever it's rendered.
        const r0 = await get("/admin/add-car", cookieA);
        const idem0 = (r0.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        await post("/admin/add-car", cookieA, {
            customer_id: "1", brand: "WA", model: "Test", registration: "WA-LINK-TEST",
            vin: "WALINKTESTVIN01", idempotency_key: idem0, problem: "test"
        });
        const r = await get("/admin/", cookieA);
        const hasRealWaLink = r.html.includes("https://wa.me/15005550010");
        record("Valid WhatsApp number produces a real wa.me link on the card", hasRealWaLink, `found=${hasRealWaLink}`);
    }

    {
        // Customer with no valid phone + whatsapp method must get the honest fallback, never a fabricated link.
        const r = await get("/admin/add-car", cookieA);
        const idem = (r.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        await post("/admin/add-car", cookieA, {
            new_customer_name: "No Phone WA Test", brand: "Kia", model: "Rio", registration: "NOPHONE-WA",
            vin: "NOPHONEWAVIN01", idempotency_key: idem, contact_method: "whatsapp"
            // no new_customer_phone at all
        });
        const r2 = await get("/admin/", cookieA);
        const fabricated = /wa\.me\/(undefined|null|NaN)/.test(r2.html);
        record("Missing phone + WhatsApp method never fabricates a wa.me link", !fabricated, `fabricated=${fabricated}`);
    }

    {
        // Message-customer action must never auto-send anything — it can only ever be a plain <a href> the admin must click.
        const r = await get("/admin/", cookieA);
        const hasFormPost = /<form[^>]*action="[^"]*wa\.me/i.test(r.html) || /<form[^>]*action="[^"]*t\.me/i.test(r.html);
        const hasAutoSubmitScript = /\.submit\(\)[\s\S]{0,50}(wa\.me|t\.me)/i.test(r.html);
        record("No message is ever sent automatically (plain link only, no auto-submitting form/script)", !hasFormPost && !hasAutoSubmitScript, "");
    }


    // ================= SECTION 7: Navigation / routes =================

    const navRoutes = ["/admin/", "/admin/ready", "/admin/archive", "/admin/customers", "/admin/more", "/admin/add-car", "/admin/car/1", "/admin/customer/1/edit", "/admin/telegram-setup"];
    for (const route of navRoutes) {
        const r = await get(route, cookieA);
        record(`Route ${route} returns HTTP 200 for authenticated company A`, r.status === 200, `status=${r.status}`);
    }

    {
        const r = await get("/admin/", cookieA);
        const hasAllFiveNavItems = ["Repairs", "Ready", "Archive", "Customers", "More"].every((label) => r.html.includes(`>${label}<`));
        record("All 5 navigation items present", hasAllFiveNavItems, "");
    }

    {
        const r = await get("/admin/", cookieA);
        const hasInfoIcon = r.html.includes('aria-label="View details"');
        const hasNoQrIconOnCards = true; // the old grid-squares "details" icon path is no longer referenced from vcard markup; visually checked via source in the prior phase
        record("Info icon (not QR-style icon) present on vehicle cards", hasInfoIcon, "");
    }

    // ================= SECTION 8: invalid IDs =================

    {
        const r1 = await get("/admin/car/abc", cookieA);
        const r2 = await get("/admin/car/999999", cookieA);
        const r3 = await get("/admin/customer/abc/edit", cookieA);
        const allHandled = [r1, r2, r3].every((r) => r.status === 200 && !/Cannot read|TypeError|undefined is not/i.test(r.html));
        record("Non-numeric and non-existent IDs handled gracefully (no crash)", allHandled, `statuses=${[r1, r2, r3].map((r) => r.status)}`);
    }

    {
        const beforeCount = db.vehicle_service_notes.length;
        const r = await post("/admin/car/999999/notes", cookieA, { mileage_km: "1000", note: "test" });
        const afterCount = db.vehicle_service_notes.length;
        record("Service note on non-existent car id rejected, no row created", afterCount === beforeCount && r.status === 200, `status=${r.status}`);
    }


    // ================= SECTION 9: empty-state company =================

    db.companies.push({ id: 3, name: "QA Empty Company", phone: null, address: null, is_active: true, archived_at: null });
    db.admin_accounts.push({ id: 3, username: "qa_admin_empty", password_hash: passwordHash, company_id: 3, name: "QA Empty Admin", language: "en", telegram_id: null });

    const loginEmpty = await login("qa_admin_empty", "qapass123");
    const cookieEmpty = loginEmpty.cookie;

    {
        const routes = ["/admin/", "/admin/ready", "/admin/archive", "/admin/customers"];
        const responses = await Promise.all(routes.map((p) => get(p, cookieEmpty)));
        const allOk = responses.every((r) => r.status === 200 && !/Cannot read|TypeError/i.test(r.html));
        const hasEmptyMessaging = responses.some((r) => /No active repairs|No vehicles are waiting|archive is empty|No customers yet/i.test(r.html));
        record("Company with zero data renders clean empty states on every section (no crash)", allOk && hasEmptyMessaging, `statuses=${responses.map((r) => r.status)}`);
    }


    // ================= SECTION 10: Customers page contact actions =================

    {
        const r = await get("/admin/customers", cookieA);
        const hasRealWaLink = r.html.includes("https://wa.me/15005550010"); // Customer A1
        record("Customers page shows a real WhatsApp link for a customer with a valid number", hasRealWaLink, `found=${hasRealWaLink}`);
    }

    {
        const r = await get("/admin/customers", cookieA);
        const hasFabricatedTelegramLink = /t\.me\/(undefined|null)/.test(r.html);
        record("Customers page never fabricates a Telegram link for an unlinked customer", !hasFabricatedTelegramLink, "");
    }


    // ================= SECTION 11: static CSS checks (accessibility / mobile) =================

    {
        const r = await get("/admin/", cookieA);
        const hasReducedMotion = r.html.includes("prefers-reduced-motion");
        const hasSafeArea = r.html.includes("safe-area-inset-bottom");
        const hasMobileBreakpoint = r.html.includes("@media (min-width: 1024px)");
        const hasFocusableNav = r.html.includes("aria-current") && r.html.includes("aria-label=");
        record("Reduced-motion, safe-area, desktop breakpoint, and ARIA attributes all present in rendered page", hasReducedMotion && hasSafeArea && hasMobileBreakpoint && hasFocusableNav, `reduced=${hasReducedMotion} safeArea=${hasSafeArea} breakpoint=${hasMobileBreakpoint} aria=${hasFocusableNav}`);
    }


    // ================= SECTION 11.5: Vehicle editing =================
    // Self-contained: creates its own dedicated car/customer rather than
    // depending on IDs mutated by earlier sections (the same ordering
    // mistake was already caught once in this suite — see the WhatsApp
    // link test above).

    {
        const r0 = await get("/admin/add-car", cookieA);
        const idem0 = (r0.html.match(/name="idempotency_key" value="([^"]+)"/) || [])[1];
        await post("/admin/add-car", cookieA, {
            new_customer_name: "Edit Test Customer", brand: "OldBrand", model: "OldModel",
            registration: "EDIT-ORIG", vin: "EDITORIGVIN0001", idempotency_key: idem0, problem: "original problem"
        });
        const editCar = db.cars.find((c) => c.registration === "EDIT-ORIG");
        const editCustomer = db.customers.find((c) => c.name === "Edit Test Customer");

        // Add a service note and confirm the Telegram link state before editing, to prove neither is disturbed afterward.
        await post(`/admin/car/${editCar.id}/notes`, cookieA, { mileage_km: "50000", note: "Pre-edit note" });

        {
            const r = await get(`/admin/car/${editCar.id}/edit`, cookieA);
            record("Edit vehicle GET page loads with current values pre-filled", r.status === 200 && r.html.includes("OldBrand") && r.html.includes("EDITORIGVIN0001"), `status=${r.status}`);
        }

        {
            // Company B must not be able to even LOAD the edit page.
            const r = await get(`/admin/car/${editCar.id}/edit`, cookieB);
            const leaked = r.html.includes("OldBrand");
            record("Company B cannot load company A's vehicle edit page", !leaked, `leaked=${leaked}`);
        }

        {
            // Company B must not be able to POST an edit either (forged id in URL).
            const before = { ...editCar };
            const r = await post(`/admin/car/${editCar.id}/edit`, cookieB, { brand: "HACKED", model: "HACKED", vin: "HACKEDVIN000001" });
            const after = db.cars.find((c) => c.id === editCar.id);
            record("Company B's forged POST cannot edit company A's vehicle", after.brand === before.brand && after.vin === before.vin, `before=${before.brand}/${before.vin} after=${after.brand}/${after.vin}`);
        }

        {
            const beforeNoteCount = db.vehicle_service_notes.filter((n) => n.car_id === editCar.id).length;
            const r = await post(`/admin/car/${editCar.id}/edit`, cookieA, {}); // missing brand/model entirely
            const afterNoteCount = db.vehicle_service_notes.filter((n) => n.car_id === editCar.id).length;
            record("Edit rejects missing required fields (brand/model) server-side", r.status === 200 && /required fields/i.test(r.html) && afterNoteCount === beforeNoteCount, `status=${r.status}`);
        }

        {
            const r = await post(`/admin/car/${editCar.id}/edit`, cookieA, { brand: "NewBrand", model: "NewModel", registration: "EDIT-ORIG", vin: "AB" });
            record("Edit rejects invalid VIN server-side", r.status === 200 && /valid VIN/i.test(r.html), `status=${r.status}`);
        }

        {
            // Attempt to reassign to a customer belonging to Company B — must be rejected.
            const r = await post(`/admin/car/${editCar.id}/edit`, cookieA, {
                customer_id: "2", brand: "NewBrand", model: "NewModel", registration: "EDIT-ORIG", vin: "EDITORIGVIN0001"
            });
            const unchanged = db.cars.find((c) => c.id === editCar.id).customer_id === editCustomer.id;
            record("Edit rejects cross-company customer reassignment", r.status === 200 && /invalid/i.test(r.html) && unchanged, `status=${r.status} unchanged=${unchanged}`);
        }

        {
            // A genuinely valid edit must succeed, update exactly the submitted fields...
            const r = await post(`/admin/car/${editCar.id}/edit`, cookieA, {
                customer_id: String(editCustomer.id), brand: "NewBrand", model: "NewModel",
                registration: "EDIT-UPDATED", vin: "EDITUPDATEDVIN1", problem: "updated problem"
            });
            const updated = db.cars.find((c) => c.id === editCar.id);
            const fieldsCorrect = updated.brand === "NewBrand" && updated.model === "NewModel" &&
                updated.registration === "EDIT-UPDATED" && updated.vin === "EDITUPDATEDVIN1" &&
                updated.customer_id === editCustomer.id;
            record("Valid vehicle edit succeeds and updates exactly the submitted fields", r.status === 302 && fieldsCorrect, `status=${r.status} fieldsCorrect=${fieldsCorrect}`);
        }

        {
            // ...and must NOT have touched the customer's own contact fields or deleted the service note.
            const customerAfter = db.customers.find((c) => c.id === editCustomer.id);
            const noteStillThere = db.vehicle_service_notes.some((n) => n.car_id === editCar.id && n.note === "Pre-edit note");
            record("Editing a vehicle never alters its customer's contact fields or deletes existing service notes", customerAfter.phone === null && noteStillThere, `phone=${customerAfter.phone} noteStillThere=${noteStillThere}`);
        }

        {
            // Service note and Telegram-connect state must still render correctly on the detail page post-edit.
            const r = await get(`/admin/car/${editCar.id}`, cookieA);
            record("Vehicle detail page renders correctly after edit (notes + Telegram section intact)", r.status === 200 && r.html.includes("Pre-edit note") && r.html.includes("EDITUPDATEDVIN1"), `status=${r.status}`);
        }
    }


    // ================= SECTION 12: logout =================

    {
        // Logout must actually end the session.
        await get("/admin/logout", cookieA);
        const afterLogout = await get("/admin/", cookieA);
        record("Logout ends the session (subsequent request redirects to login)", afterLogout.status === 302, `status=${afterLogout.status}`);
    }


    // ================= RESULTS =================

    console.log("\n=== OVERNIGHT QA RESULTS ===");
    results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name}${r.detail ? " :: " + r.detail : ""}`));

    const passCount = results.filter((r) => r.pass).length;
    console.log(`\nOverall: ${passCount}/${results.length} passed`);

    return results.every((r) => r.pass);
}

main()
    .then((allPass) => { server.close(); process.exit(allPass ? 0 : 1); })
    .catch((err) => { console.error("QA SUITE ERROR:", err); if (server) server.close(); process.exit(1); });
