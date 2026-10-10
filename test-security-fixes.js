// Regression test for the two Phase-1 security fixes:
//   1. admin.js  POST /admin/status   — status allow-list validation
//   2. workshopBot.js                — manager-group cross-company guard
//
// Uses disposable Supabase data (created and cleaned up here), plus a
// real local Express server mounting admin.js's router for fix 1 (same
// pattern as the earlier P0-fix verification). Fix 2 now calls the ACTUAL
// guard function, not a copy of its logic — managerGroupBelongsToAnotherCompany
// was hoisted out of workshopBot.js's `if (WORKSHOP_BOT_TOKEN)` block (it
// only ever depended on `supabase`, never on the bot/token) and exported,
// so requiring workshopBot.js here — with no WORKSHOP_BOT_TOKEN set, no
// Bot instance constructed, no polling started — gives direct access to
// the exact function both call sites invoke.

require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { managerGroupBelongsToAnotherCompany } = require("./workshopBot");

const STATUS_KEYS = [
    "received", "diagnostics", "repair", "waiting_parts",
    "testing", "payment", "ready", "delivered", "cancelled"
];

const TAG = `ZZZ_SECFIXTEST_${Date.now()}`;
const created = { companies: [], admins: [], customers: [], cars: [], groups: [] };

function extractCookie(setCookieHeader) {
    if (!setCookieHeader) return null;
    const first = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    return first.split(";")[0];
}

async function main() {
    const results = [];

    // ---------------- Setup ----------------
    const { data: companyA } = await supabase.from("companies").insert({ name: `${TAG}_A` }).select().single();
    created.companies.push(companyA.id);

    const { data: companyB } = await supabase.from("companies").insert({ name: `${TAG}_B` }).select().single();
    created.companies.push(companyB.id);

    const password = "SecFixTest123!";
    const passwordHash = await bcrypt.hash(password, 10);
    const username = `${TAG}_admin`.toLowerCase();

    const { data: adminA } = await supabase
        .from("admin_accounts")
        .insert({ username, password_hash: passwordHash, company_id: companyA.id, name: "Sec Fix Test Admin", language: "en" })
        .select().single();
    created.admins.push(adminA.id);

    const { data: customerA } = await supabase
        .from("customers")
        .insert({ company_id: companyA.id, name: "Test Customer A" })
        .select().single();
    created.customers.push(customerA.id);

    // customerA must NEVER have a telegram_id. admin.js's /status handler
    // (exercised 9 times by the valid-status loop below) constructs its
    // notificationBot from the real production BOT_TOKEN at module-load
    // time and will call notificationBot.api.sendMessage(telegramId, ...)
    // for real if car.customers.telegram_id is ever truthy — the only
    // thing currently preventing that is this row having none. This
    // assertion turns a future accidental addition of a telegram_id here
    // into an immediate, loud failure instead of a silent real Telegram
    // send through the production bot.
    if (customerA.telegram_id !== null && customerA.telegram_id !== undefined) {
        throw new Error(
            "SAFETY ABORT: customerA has a telegram_id set — refusing to proceed, " +
            "since the status-change loop below would attempt a REAL Telegram " +
            "send through the production BOT_TOKEN. This test must only ever " +
            "use a customer with no telegram_id."
        );
    }

    const { data: carA } = await supabase
        .from("cars")
        .insert({ company_id: companyA.id, customer_id: customerA.id, brand: "TestBrand", model: "TestModel", registration: `${TAG}-CAR`, status: "received" })
        .select().single();
    created.cars.push(carA.id);

    console.log("=== FIX 1: POST /admin/status allow-list validation ===");

    // Real local server mounting admin.js, same pattern as the P0 fix test.
    const adminRouter = require("./admin");
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use("/admin", adminRouter);

    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const loginRes = await fetch(`${base}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        body: new URLSearchParams({ username, password, lang: "en" }).toString()
    });
    const cookie = extractCookie(loginRes.headers.get("set-cookie"));

    if (!cookie || loginRes.status !== 302) {
        throw new Error(`Local login did not redirect as expected (status ${loginRes.status})`);
    }

    async function postStatus(status) {
        const res = await fetch(`${base}/admin/status`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
            redirect: "manual",
            body: new URLSearchParams({ car_id: String(carA.id), status }).toString()
        });
        const html = res.status === 200 ? await res.text() : null;
        return { status: res.status, html };
    }

    // 1a. All 9 existing valid statuses must still work exactly as before.
    for (const validStatus of STATUS_KEYS) {
        const r = await postStatus(validStatus);
        const { data: row } = await supabase.from("cars").select("status").eq("id", carA.id).maybeSingle();
        const pass = r.status === 302 && row.status === validStatus;
        results.push({ name: `Valid status "${validStatus}" still works`, pass, detail: `http=${r.status} dbStatus=${row.status}` });
    }

    const { count: historyCountBefore } = await supabase
        .from("status_history").select("id", { count: "exact", head: true }).eq("car_id", carA.id);

    // 1b. An invalid status must be rejected, must not touch cars.status,
    // and must not append a status_history row.
    const { data: beforeRow } = await supabase.from("cars").select("status").eq("id", carA.id).maybeSingle();

    const invalidRes = await postStatus("not_a_real_status_xyz");
    const { data: afterRow } = await supabase.from("cars").select("status").eq("id", carA.id).maybeSingle();
    const { count: historyCountAfter } = await supabase
        .from("status_history").select("id", { count: "exact", head: true }).eq("car_id", carA.id);

    const mentionsInvalid = invalidRes.html && invalidRes.html.toLowerCase().includes("not valid");
    results.push({
        name: "Invalid status rejected (HTTP 200 + error message)",
        pass: invalidRes.status === 200 && mentionsInvalid,
        detail: `http=${invalidRes.status}`
    });
    results.push({
        name: "Invalid status does not change cars.status",
        pass: afterRow.status === beforeRow.status,
        detail: `before=${beforeRow.status} after=${afterRow.status}`
    });
    results.push({
        name: "Invalid status does not append status_history row",
        pass: historyCountAfter === historyCountBefore,
        detail: `before=${historyCountBefore} after=${historyCountAfter}`
    });

    // 1c. Empty string must also be rejected (not just a garbage word).
    const emptyRes = await postStatus("");
    results.push({
        name: "Empty status rejected",
        pass: emptyRes.status === 200 && emptyRes.html.toLowerCase().includes("not valid"),
        detail: `http=${emptyRes.status}`
    });

    server.close();


    console.log("=== FIX 2: manager-group cross-company guard (actual exported function) ===");

    // Static wiring check: confirm both call sites still invoke the guard
    // by name, so a passing test below actually says something about what
    // ships — not just that the exported function works in isolation.
    const workshopBotSource = fs.readFileSync(require.resolve("./workshopBot.js"), "utf8");
    const myChatMemberCallSite = /purpose === "manager"\)[\s\S]{0,200}managerGroupBelongsToAnotherCompany\(/.test(workshopBotSource);
    const connectManagerCallSite = /command\("connect_manager"[\s\S]{0,1500}managerGroupBelongsToAnotherCompany\(/.test(workshopBotSource);

    results.push({
        name: "my_chat_member manager branch calls the guard",
        pass: myChatMemberCallSite,
        detail: `found=${myChatMemberCallSite}`
    });
    results.push({
        name: "/connect_manager fallback command calls the guard",
        pass: connectManagerCallSite,
        detail: `found=${connectManagerCallSite}`
    });

    // Company A already has a connected workshop + manager group.
    const workshopGroupIdA = -1000000001 - Math.floor(Math.random() * 1000);
    const managerGroupIdA = -2000000001 - Math.floor(Math.random() * 1000);

    const { data: groupRowA } = await supabase
        .from("workshop_telegram_groups")
        .insert({ company_id: companyA.id, workshop_group_id: workshopGroupIdA, manager_group_id: managerGroupIdA, is_active: true })
        .select().single();
    created.groups.push(groupRowA.id);

    // 2a. Company B trying to connect Company A's already-used manager group → must be flagged as belonging to another company.
    const blockedForB = await managerGroupBelongsToAnotherCompany(managerGroupIdA, companyB.id);
    results.push({
        name: "Manager group already used by Company A is blocked for Company B",
        pass: blockedForB === true,
        detail: `result=${blockedForB}`
    });

    // 2b. Company A reconnecting/re-confirming its OWN manager group → must NOT be blocked.
    const allowedForA = await managerGroupBelongsToAnotherCompany(managerGroupIdA, companyA.id);
    results.push({
        name: "Company A's own manager group is not blocked for Company A itself",
        pass: allowedForA === false,
        detail: `result=${allowedForA}`
    });

    // 2c. A brand-new, never-used group id → must not be blocked for anyone.
    const freshGroupId = -3000000001 - Math.floor(Math.random() * 1000);
    const allowedFresh = await managerGroupBelongsToAnotherCompany(freshGroupId, companyB.id);
    results.push({
        name: "Unused manager group id is never blocked",
        pass: allowedFresh === false,
        detail: `result=${allowedFresh}`
    });


    console.log("\n=== RESULTS ===");
    results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name} :: ${r.detail}`));

    const allPass = results.every((r) => r.pass);
    console.log(`\nOverall: ${allPass ? "ALL PASS" : "FAILURE DETECTED"} (${results.filter(r=>r.pass).length}/${results.length})`);

    return allPass;
}

main()
    .then((allPass) => cleanup().then((cleanupOk) => process.exit(allPass && cleanupOk ? 0 : 1)))
    .catch((err) => {
        console.error("TEST ERROR:", err);
        cleanup().finally(() => process.exit(1));
    });

// Deletes every row in `table` matching one of `ids`, one at a time. A
// thrown error (e.g. a transient network failure — the Supabase client
// can throw at that layer even though a DB-level error does not) on one
// row must never stop the remaining rows, in this table or any later
// table, from at least being attempted — previously a single thrown
// error partway through cleanup() could silently abort every delete
// after it, leaving disposable rows behind with no indication beyond the
// final leftover-count check. Failures are collected and reported
// clearly instead.
async function deleteAllById(table, ids, failures) {

    for (const id of ids) {

        try {

            const { error } = await supabase.from(table).delete().eq("id", id);

            if (error) {
                failures.push(`${table} id=${id}: ${error.message}`);
            }

        } catch (err) {
            failures.push(`${table} id=${id}: threw ${err.message}`);
        }
    }
}

// Returns true only if every delete succeeded AND both leftover-
// verification queries themselves succeeded AND found zero tagged rows.
// A query that fails is never treated as "nothing left" — that would
// turn an inability to check into a false success — so it counts as a
// cleanup failure in its own right, same as a failed delete.
async function cleanup() {
    console.log("\n=== CLEANUP ===");

    const failures = [];

    await deleteAllById("workshop_telegram_groups", created.groups, failures);
    await deleteAllById("cars", created.cars, failures);
    await deleteAllById("customers", created.customers, failures);
    await deleteAllById("admin_accounts", created.admins, failures);
    await deleteAllById("companies", created.companies, failures);

    if (failures.length > 0) {
        console.error(`⚠️  ${failures.length} cleanup operation(s) failed — manual removal may be needed:`);
        failures.forEach((f) => console.error(`   - ${f}`));
    } else {
        console.log("All cleanup operations completed without error.");
    }

    // Preserved exactly as before — the authoritative check for whether
    // anything tagged by this run is still left in the database,
    // regardless of what the per-row attempts above reported. Errors are
    // now captured explicitly instead of discarded.
    const { data: leftoverCompanies, error: companiesCheckError } =
        await supabase.from("companies").select("id").like("name", `${TAG}%`);
    const { data: leftoverCars, error: carsCheckError } =
        await supabase.from("cars").select("id").like("registration", `${TAG}%`);

    let verificationOk = true;

    if (companiesCheckError) {
        verificationOk = false;
        console.error(`⚠️  Leftover-companies check itself failed (cannot confirm cleanup): ${companiesCheckError.message}`);
    } else {
        console.log(`Leftover companies matching tag: ${leftoverCompanies.length}`);
        if (leftoverCompanies.length > 0) verificationOk = false;
    }

    if (carsCheckError) {
        verificationOk = false;
        console.error(`⚠️  Leftover-cars check itself failed (cannot confirm cleanup): ${carsCheckError.message}`);
    } else {
        console.log(`Leftover cars matching tag: ${leftoverCars.length}`);
        if (leftoverCars.length > 0) verificationOk = false;
    }

    const cleanupOk = failures.length === 0 && verificationOk;

    console.log(`Cleanup result: ${cleanupOk ? "OK" : "FAILED"}`);

    return cleanupOk;
}
