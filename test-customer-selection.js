// Isolated local tests for:
//   Feature — Reliable Customer Selection When Adding a Vehicle (admin.js)
//
// Covers exactly the 5 behaviors required:
//   (a) auto-population data is correct and sourced from the SAME customer
//   (b) two same-named customers remain distinguishable and both selectable
//   (c) a customer missing phone/telegram shows empty, never another
//       customer's data
//   (d) a company-B customer id can never be selected or assigned via a
//       forged POST to company A's /add-car
//   (e) the existing Add Vehicle creation flow (new customer, existing
//       customer, VIN validation) still works unchanged
//
// SAFETY: no production Supabase connection — same in-memory mock recipe
// as test-contact-features.js / test-overnight-qa.js. admin.js's own
// require("./supabase") is intercepted before admin.js is required.

process.env.BOT_TOKEN = "123456789:QA-FAKE-TOKEN-NOT-REAL-00000000000";
delete process.env.WORKSHOP_BOT_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
process.env.SESSION_SECRET = "qa-only-session-secret-not-for-production";

const express = require("express");
const bcrypt = require("bcrypt");

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: detail || "" }); }

const db = {
    companies: [], admin_accounts: [], customers: [], cars: [],
    workshop_telegram_groups: [], company_contacts: []
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

function extractCookie(h) { if (!h) return null; return (Array.isArray(h) ? h[0] : h).split(";")[0]; }

async function main() {

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
        const location = res.headers.get("location");
        return { status: res.status, html, location };
    }

    const passwordHash = await bcrypt.hash("qapass123", 10);
    db.companies.push({ id: 1, name: "Selection QA Co A", is_active: true, archived_at: null });
    db.companies.push({ id: 2, name: "Selection QA Co B", is_active: true, archived_at: null });
    nextId.companies = 3;
    db.admin_accounts.push({ id: 1, username: "selectionqa_a", password_hash: passwordHash, company_id: 1, name: "QA Admin A", language: "en", telegram_id: null });
    db.admin_accounts.push({ id: 2, username: "selectionqa_b", password_hash: passwordHash, company_id: 2, name: "QA Admin B", language: "en", telegram_id: null });
    nextId.admin_accounts = 3;

    // Two same-named customers in company A, one with full contact info,
    // one deliberately missing phone/telegram (must never inherit the
    // other's data). Plus a customer in company B with the SAME id-space
    // overlap risk, to prove cross-company scoping.
    db.customers.push({ id: 1, company_id: 1, name: "John Smith", phone: "+15005550001", telegram_username: "john_the_first", contact_method: "telegram", telegram_id: null });
    db.customers.push({ id: 2, company_id: 1, name: "John Smith", phone: null, telegram_username: null, contact_method: "whatsapp", telegram_id: null });
    db.customers.push({ id: 3, company_id: 2, name: "Company B Customer", phone: "+15005559999", telegram_username: "company_b_user", contact_method: "telegram", telegram_id: null });
    nextId.customers = 4;

    const loginA = await login("selectionqa_a", "qapass123");
    const loginB = await login("selectionqa_b", "qapass123");
    const cookieA = loginA.cookie, cookieB = loginB.cookie;
    record("Both QA admins log in successfully", loginA.status === 302 && loginB.status === 302 && !!cookieA && !!cookieB, `A=${loginA.status} B=${loginB.status}`);


    // ================= (a) + (b): auto-population data + same-name disambiguation =================

    const addCarPageA = await get("/admin/add-car", cookieA);
    record("Add Car page loads for company A", addCarPageA.status === 200, `status=${addCarPageA.status}`);

    const html = addCarPageA.html;

    // Both same-named customers must appear as separate, selectable options.
    const optionJohn1 = /<option\s+value="1"[^>]*data-phone="\+15005550001"[^>]*data-contact-method="telegram"[^>]*data-telegram="john_the_first"[^>]*>/s.test(html);
    const optionJohn2 = /<option\s+value="2"[^>]*data-phone=""[^>]*data-contact-method="whatsapp"[^>]*data-telegram=""[^>]*>/s.test(html);
    record("First 'John Smith' option carries correct phone/telegram/contact-method data attributes", optionJohn1, "");
    record("Second 'John Smith' option (missing contact info) has empty data attributes, not inherited", optionJohn2, "");

    // The visible label itself must disambiguate, not just the hidden attributes.
    record("Visible label for customer 1 includes phone to disambiguate", html.includes("John Smith — +15005550001 / @john_the_first"), "");
    record("Visible label for customer 2 (no contact info) is plain name only, not fabricated", /<option[^>]*value="2"[^>]*>\s*John Smith\s*<\/option>/s.test(html), "");
    record("Both same-named customers are present as distinct, selectable options", optionJohn1 && optionJohn2 && html.match(/John Smith/g).length >= 2, "");


    // ================= (c) empty fields stay empty (re-confirmed via dedicated single-customer check) =================

    db.customers.push({ id: 4, company_id: 1, name: "Nobody Contactable", phone: null, telegram_username: null, contact_method: null, telegram_id: null });
    nextId.customers = 5;
    const addCarPageA2 = await get("/admin/add-car", cookieA);
    const emptyCustomerOption = /<option\s+value="4"[^>]*data-phone=""[^>]*data-contact-method=""[^>]*data-telegram=""[^>]*>\s*Nobody Contactable\s*<\/option>/s.test(addCarPageA2.html);
    record("Customer with zero contact info on file has all-empty data attributes (JS shows 'Not on file', never another customer's data)", emptyCustomerOption, "");


    // ================= (d) cross-company rejection =================

    const addCarPageB = await get("/admin/add-car", cookieB);
    record("Company B's Add Car page does not list company A's customers", !addCarPageB.html.includes("John Smith") && !addCarPageB.html.includes("Nobody Contactable"), "");
    record("Company A's Add Car page does not list company B's customer", !html.includes("Company B Customer") && !html.includes("company_b_user"), "");

    {
        // Forged POST: company B's admin session, but customer_id = 1 (belongs to company A).
        const r = await post("/admin/add-car", cookieB, {
            idempotency_key: "qa-cross-company-1",
            customer_id: "1",
            brand: "Honda", model: "Civic", vin: "QAVIN00000CROSS1", problem: "test"
        });
        const carsForB = db.cars.filter((c) => c.company_id === 2);
        const attachedToForgedId = carsForB.find((c) => c.customer_id === 1);
        record("Forged cross-company customer_id is rejected (invalid_customer_selection), no car created with it", r.status === 200 && /selected customer is invalid/i.test(r.html || "") && !attachedToForgedId, `status=${r.status}`);
    }


    // ================= (e) existing Add Vehicle behavior intact =================

    {
        // New-customer path still works end-to-end.
        const r = await post("/admin/add-car", cookieA, {
            idempotency_key: "qa-new-customer-1",
            new_customer_name: "Fresh New Customer",
            new_customer_phone: "+15005550055",
            contact_method: "whatsapp",
            brand: "Toyota", model: "Yaris", vin: "QAVINNEWCUST0001", problem: "oil change"
        });
        const createdCustomer = db.customers.find((c) => c.name === "Fresh New Customer");
        record("New-customer Add Vehicle path still creates a customer + car", r.status === 302 && !!createdCustomer, `status=${r.status}`);
    }
    {
        // Existing-customer path (selecting customer id 1, company A) still works and does NOT create a duplicate customer.
        const beforeCount = db.customers.length;
        const r = await post("/admin/add-car", cookieA, {
            idempotency_key: "qa-existing-customer-1",
            customer_id: "1",
            brand: "BMW", model: "M3", vin: "QAVINEXIST00001", problem: "brake check"
        });
        const afterCount = db.customers.length;
        const car = db.cars.find((c) => c.vin === "QAVINEXIST00001");
        record("Existing-customer Add Vehicle path attaches the correct customer_id, creates no duplicate customer", r.status === 302 && !!car && car.customer_id === 1 && afterCount === beforeCount, `status=${r.status} before=${beforeCount} after=${afterCount} carCustomerId=${car?.customer_id}`);
    }
    {
        // Selecting the SECOND same-named customer (id 2) must attach id 2, not silently collapse to id 1.
        const r = await post("/admin/add-car", cookieA, {
            idempotency_key: "qa-existing-customer-2",
            customer_id: "2",
            brand: "Kia", model: "Rio", vin: "QAVINEXIST00002", problem: "tire rotation"
        });
        const car = db.cars.find((c) => c.vin === "QAVINEXIST00002");
        record("Selecting the second same-named customer attaches customer_id=2, not the first", r.status === 302 && !!car && car.customer_id === 2, `carCustomerId=${car?.customer_id}`);
    }
    {
        // VIN validation still enforced on this route.
        const r = await post("/admin/add-car", cookieA, {
            idempotency_key: "qa-bad-vin-1",
            new_customer_name: "Should Not Be Created",
            brand: "Seat", model: "Leon", vin: "x", problem: "test"
        });
        const createdCustomer = db.customers.find((c) => c.name === "Should Not Be Created");
        record("Invalid VIN is still rejected and no customer/car is created", r.status === 200 && !createdCustomer, `status=${r.status}`);
    }

    server.close();

    console.log("\n=== CUSTOMER SELECTION FEATURE TEST RESULTS ===");
    results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name}${r.detail ? " :: " + r.detail : ""}`));
    const passCount = results.filter((r) => r.pass).length;
    console.log(`\nOverall: ${passCount}/${results.length} passed`);
    return results.every((r) => r.pass);
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((err) => { console.error("ERROR:", err); process.exit(1); });
