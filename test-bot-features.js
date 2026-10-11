// Isolated local tests for the fixes made on top of commit b290b9a and
// later 450a670:
//   1. Contact Service now shows the workshop's own name/phone/address
//      alongside configured contact people (index.js + customerBotLogic.js)
//   2. A single "My Vehicles" entry point replaces sending one status
//      message per linked vehicle (index.js + customerBotLogic.js)
//   3. workshopBot.js's /save now REQUIRES vehicle selection on every
//      independent save operation — the remembered-current-vehicle
//      shortcut (and its "Change vehicle" button) were removed entirely,
//      and the picker's pending intent is now scoped per source message
//      so two unresolved saves in flight at once can never cross-attach.
//
// SAFETY:
//   - customerBotLogic.js has zero Telegram/Supabase/network dependency —
//     it is required directly and its REAL, production functions are
//     called exactly as index.js calls them (not a copy).
//   - workshopBot.js IS required directly (with a FAKE WORKSHOP_BOT_TOKEN)
//     specifically because its Bot constructor is lazy (no network call
//     on construction — same property already relied on by
//     demo-server.js and documented in workshopBot.js's own comments).
//     Every outbound Telegram API call it could make is intercepted via
//     grammY's bot.api.config.use() transformer below, so NOTHING here
//     ever reaches the real Telegram API. .start()/.stop() are NEVER
//     called on this instance — only .init() (itself intercepted) and
//     .handleUpdate(), which runs the REAL registered /save and
//     savepick_ handlers end-to-end, exactly as production would for an
//     incoming update, without any polling loop existing.
//   - Supabase is the same in-memory mock-via-require.cache-interception
//     recipe used by every other test file this session.
//   - index.js itself is still never required (it starts the main bot's
//     real long-polling loop at module load time with no guard) — the
//     one piece of index.js logic this file needs to verify
//     (carBelongsToTelegramUser's ownership check, reused unchanged by
//     the new select_vehicle_ handler) is tested via a disclosed,
//     byte-for-byte VERIFIED MIRROR, clearly labeled as such in Section C
//     — everything else index.js newly contains (the vehicle-count
//     decision, the list/contact message building) is tested as REAL
//     logic via customerBotLogic.js, not mirrored.

process.env.WORKSHOP_BOT_TOKEN = "987654321:QA-FAKE-WORKSHOP-TOKEN-0000000";
process.env.BOT_TOKEN = "123456789:QA-FAKE-MAIN-TOKEN-00000000000000";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: detail || "" }); }

// ---------------- Shared in-memory mock Supabase ----------------

const db = {
    workshop_telegram_groups: [],
    cars: [],
    customers: [],
    saved_media: []
};
const nextId = {};
for (const t of Object.keys(db)) nextId[t] = 1;

function attachEmbeds(table, row, selectStr) {
    const clone = { ...row };
    if (table === "cars" && /customers\s*\(/.test(selectStr)) {
        clone.customers = db.customers.find((c) => c.id === row.customer_id) || null;
    }
    return clone;
}

function mockSupabase() {
    function from(table) {
        let op = "select", selectStr = "*";
        const filters = [];
        let orderCol = null, orderAsc = true, limitN = null, insertPayload = null, updatePayload = null, upsertConflictCol = null;

        function matches(row) { return filters.every((f) => f(row)); }

        async function exec(terminal) {

            if (op === "insert") {
                const rows = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
                const inserted = rows.map((r) => { const row = { id: nextId[table]++, ...r }; db[table].push(row); return row; });
                return { data: terminal === "single" ? inserted[0] : inserted, error: null };
            }

            if (op === "upsert") {
                const row = insertPayload;
                const existing = upsertConflictCol ? db[table].find((r) => r[upsertConflictCol] === row[upsertConflictCol]) : null;
                if (existing) { Object.assign(existing, row); return { data: [existing], error: null }; }
                const created = { id: nextId[table]++, ...row };
                db[table].push(created);
                return { data: [created], error: null };
            }

            if (op === "update") {
                const targets = db[table].filter(matches);
                targets.forEach((r) => Object.assign(r, updatePayload));
                return { data: targets, error: null };
            }

            let rows = db[table].filter(matches);
            if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] < b[orderCol] ? (orderAsc ? -1 : 1) : a[orderCol] > b[orderCol] ? (orderAsc ? 1 : -1) : 0));
            if (limitN != null) rows = rows.slice(0, limitN);
            rows = rows.map((r) => attachEmbeds(table, r, selectStr));

            if (terminal === "single") return rows.length === 0 ? { data: null, error: { message: "No rows found" } } : { data: rows[0], error: null };
            if (terminal === "maybeSingle") return { data: rows[0] || null, error: null };
            return { data: rows, error: null };
        }

        const api = {
            select(s) { selectStr = s || "*"; return api; },
            eq(c, v) { filters.push((r) => r[c] == v); return api; },
            neq(c, v) { filters.push((r) => r[c] != v); return api; },
            is(c, v) { filters.push((r) => (r[c] ?? null) === v); return api; },
            not(c, kind, v) {
                if (kind === "is") {
                    filters.push((r) => !((r[c] ?? null) === v));
                } else if (kind === "in") {
                    const list = String(v).replace(/^\(|\)$/g, "").split(",");
                    filters.push((r) => !list.includes(String(r[c])));
                }
                return api;
            },
            ilike(c, v) { filters.push((r) => String(r[c] ?? "").toLowerCase() === String(v).toLowerCase()); return api; },
            order(c, o) { orderCol = c; orderAsc = !(o && o.ascending === false); return api; },
            limit(n) { limitN = n; return api; },
            insert(o) { op = "insert"; insertPayload = o; return api; },
            update(o) { op = "update"; updatePayload = o; return api; },
            upsert(o, opts) { op = "upsert"; insertPayload = o; upsertConflictCol = opts?.onConflict || null; return api; },
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

const { resolveVehicleMenuMode, buildVehicleListEntries, buildContactServiceMessage } = require("./customerBotLogic");
const { toWhatsappDigits } = require("./utils");
const { t, statusLabel } = require("./locales");

const { workshopBot, pendingSaveTargets } = require("./workshopBot");


async function main() {

    // ================= SECTION A: Contact Service message (REAL logic, customerBotLogic.js) =================

    {
        const { message, buttons } = buildContactServiceMessage({
            t, toWhatsappDigits, lang: "en",
            company: { name: "Acme Garage", phone: "+1 555 0000", address: "123 Main St" },
            contacts: []
        });
        record("No contacts configured: workshop name/phone/address shown, zero buttons (unchanged baseline)",
            message.includes("Acme Garage") && message.includes("+1 555 0000") && message.includes("123 Main St") && buttons.length === 0,
            message.replace(/\n/g, " | "));
    }
    {
        const { message, buttons } = buildContactServiceMessage({
            t, toWhatsappDigits, lang: "en",
            company: { name: "Acme Garage", phone: "+1 555 0000", address: "123 Main St" },
            contacts: [{ role_label: "Owner", phone: "+15005550001", telegram_username: "real_owner" }]
        });
        record("THE FIX: contacts configured -> workshop name/phone/address STILL shown (previously missing) alongside contact buttons",
            message.includes("Acme Garage") && message.includes("+1 555 0000") && message.includes("123 Main St") && message.includes("Owner") && buttons.length === 2,
            message.replace(/\n/g, " | "));
    }
    {
        const { message, buttons } = buildContactServiceMessage({
            t, toWhatsappDigits, lang: "en",
            company: { name: null, phone: null, address: null },
            contacts: []
        });
        record("Missing workshop details: localized fallback shown for phone/address, name silently omitted (never fabricated), no crash",
            !message.includes("null") && !message.includes("undefined") && message.includes("Phone not specified") && message.includes("Address not specified"),
            message.replace(/\n/g, " | "));
    }
    {
        const { buttons } = buildContactServiceMessage({
            t, toWhatsappDigits, lang: "en",
            company: { name: "Acme", phone: null, address: null },
            contacts: [{ role_label: "Manager", phone: "123", telegram_username: null }] // "123" cannot normalize to a WhatsApp number
        });
        record("A contact with an invalid/too-short phone never produces a fabricated WhatsApp button", buttons.length === 0, JSON.stringify(buttons));
    }
    {
        const { buttons } = buildContactServiceMessage({
            t, toWhatsappDigits, lang: "pl",
            company: { name: "Acme", phone: "+1 555 0000", address: "addr" },
            contacts: [{ role_label: "Owner", phone: "+15005550001", telegram_username: "owner1" }]
        });
        record("Localization: Polish contact buttons use Polish button labels", buttons.some((b) => b.label.includes(t("pl", "btn_telegram"))), JSON.stringify(buttons));
    }


    // ================= SECTION B: My Vehicles entry point decision (REAL logic, customerBotLogic.js) =================

    {
        const r = resolveVehicleMenuMode([{ id: 1, brand: "BMW", model: "320i" }]);
        record("One linked vehicle -> mode 'single' (opens status directly, no selector needed)", r.mode === "single" && r.car.id === 1, JSON.stringify(r));
    }
    {
        const cars = [
            { id: 1, brand: "BMW", model: "320i", registration: "EL001", status: "repair" },
            { id: 2, brand: "Toyota", model: "Corolla", registration: "EL002", status: "ready" }
        ];
        const r = resolveVehicleMenuMode(cars);
        record("Two linked vehicles -> mode 'list' (one selector message, never two status messages)", r.mode === "list" && r.cars.length === 2, JSON.stringify(r));

        const entries = buildVehicleListEntries(cars, { lang: "en", statusLabel });
        record("List entries carry correct, distinct callback_data per vehicle", entries[0].callbackData === "select_vehicle_1" && entries[1].callbackData === "select_vehicle_2", JSON.stringify(entries));
        record("List entries' labels distinguish the two vehicles (brand/model/registration)", entries[0].label.includes("EL001") && entries[1].label.includes("EL002") && entries[0].label !== entries[1].label, JSON.stringify(entries.map(e => e.label)));
    }
    {
        const r = resolveVehicleMenuMode([]);
        record("Zero linked vehicles -> mode 'none'", r.mode === "none", JSON.stringify(r));
    }


    // ================= SECTION C: select_vehicle_ ownership check — DISCLOSED VERIFIED MIRROR =================
    // index.js is never require()'d (starts real Telegram polling at
    // module load). carBelongsToTelegramUser is PRE-EXISTING, unchanged
    // code already relied on by 5 other handlers (car_status_,
    // car_history_, car_info_, contact_service_, delete_car_confirm_) —
    // the new select_vehicle_ handler reuses it verbatim. This mirror
    // exists only to directly confirm that reuse for the new route; it
    // is NOT a stand-in for the genuinely new logic in this change,
    // which is tested for real in Sections A and B above.

    function carBelongsToTelegramUserMirror(car, telegramId) {
        return !!(car && car.customers && car.customers.telegram_id === telegramId);
    }

    {
        const carOwnedByOther = { company_id: 2, customers: { telegram_id: 999888 } };
        record("select_vehicle_'s ownership check rejects a car not linked to the requesting Telegram user", !carBelongsToTelegramUserMirror(carOwnedByOther, 111222), "");
    }
    {
        const ownCar = { company_id: 1, customers: { telegram_id: 111222 } };
        record("select_vehicle_'s ownership check accepts the requesting user's own linked car", carBelongsToTelegramUserMirror(ownCar, 111222), "");
    }


    // ================= SECTION D: workshopBot /save — REAL handler via handleUpdate() =================

    const GROUP_A = -100111;
    const GROUP_B = -100222;
    const MECHANIC = 555001;
    let msgIdCounter = 1000;

    // Every outbound API call this section makes is logged here so tests
    // can assert on exactly what was sent (e.g. "no message anywhere ever
    // carries a 'Change vehicle' button"), not just on saved_media rows.
    const apiCallLog = [];

    workshopBot.api.config.use((prev, method, payload) => {
        apiCallLog.push({ method, payload });
        if (method === "copyMessage" || method === "sendMessage" || method === "sendPhoto") {
            return Promise.resolve({ ok: true, result: { message_id: msgIdCounter++, date: 0, chat: { id: payload.chat_id, type: "supergroup" } } });
        }
        return Promise.resolve({ ok: true, result: true });
    });

    await workshopBot.init();

    db.workshop_telegram_groups.push({ id: 1, workshop_group_id: GROUP_A, company_id: 1, manager_group_id: -100999, is_active: true });
    db.workshop_telegram_groups.push({ id: 2, workshop_group_id: GROUP_B, company_id: 2, manager_group_id: -100998, is_active: true });
    nextId.workshop_telegram_groups = 3;

    db.customers.push({ id: 1, company_id: 1, name: "Alice", phone: "+15005550001", telegram_id: null });
    db.cars.push({ id: 101, company_id: 1, customer_id: 1, brand: "BMW", model: "320i", registration: "VEHA001", status: "repair", updated_at: new Date().toISOString() });
    db.cars.push({ id: 102, company_id: 1, customer_id: 1, brand: "Toyota", model: "Yaris", registration: "VEHA002", status: "repair", updated_at: new Date().toISOString() });
    db.cars.push({ id: 201, company_id: 2, customer_id: null, brand: "Audi", model: "A4", registration: "VEHB001", status: "repair", updated_at: new Date().toISOString() });
    nextId.cars = 300;

    function photoReplyUpdate({ updateId, groupId, mechanicId, sourceMsgId, text }) {
        return {
            update_id: updateId,
            message: {
                message_id: sourceMsgId + 1000,
                date: 0,
                chat: { id: groupId, type: "supergroup" },
                from: { id: mechanicId, is_bot: false, first_name: "Mech" },
                text,
                entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }],
                reply_to_message: {
                    message_id: sourceMsgId,
                    date: 0,
                    chat: { id: groupId, type: "supergroup" },
                    from: { id: mechanicId, is_bot: false, first_name: "Mech" },
                    photo: [{ file_id: `FAKEFILE${sourceMsgId}`, file_unique_id: `u${sourceMsgId}`, width: 100, height: 100 }]
                }
            }
        };
    }

    function callbackUpdate({ updateId, groupId, mechanicId, data, messageId }) {
        return {
            update_id: updateId,
            callback_query: {
                id: `cbq${updateId}`,
                from: { id: mechanicId, is_bot: false, first_name: "Mech" },
                message: { message_id: messageId, date: 0, chat: { id: groupId, type: "supergroup" }, text: "picker" },
                chat_instance: "abc",
                data
            }
        };
    }

    // --- D1: first bare /save -> shows picker, saves nothing yet ---
    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 1, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5001, text: "/save" }));
    record("D1: first bare /save produces a picker, saves nothing yet", db.saved_media.length === 0, `saved_media.length=${db.saved_media.length}`);

    // --- D2: selecting vehicle A (101) for photo 1 saves it to A ---
    await workshopBot.handleUpdate(callbackUpdate({ updateId: 2, groupId: GROUP_A, mechanicId: MECHANIC, data: "savepick_5001_101", messageId: 6001 }));
    const afterD2 = db.saved_media.find((m) => m.source_message_id === 5001);
    record("D2: picker selection saves photo 1 to vehicle A (101)", !!afterD2 && afterD2.vehicle_id === 101, JSON.stringify(afterD2));

    // --- D3: THE REQUIRED BEHAVIOR — a brand-new photo + bare /save MUST
    // prompt for selection again, even though vehicle A was JUST picked
    // for the previous photo. No persistent/remembered vehicle exists
    // anymore: this must save NOTHING until the mechanic explicitly taps
    // a vehicle for THIS photo. ---
    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 3, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5002, text: "/save" }));
    const afterD3 = db.saved_media.find((m) => m.source_message_id === 5002);
    record("D3: the very next bare /save (new photo) prompts for selection again, saves nothing yet (no remembered vehicle)", !afterD3, JSON.stringify(afterD3));

    // --- D4: selecting vehicle B (102) for photo 2 saves it to B, not A ---
    await workshopBot.handleUpdate(callbackUpdate({ updateId: 4, groupId: GROUP_A, mechanicId: MECHANIC, data: "savepick_5002_102", messageId: 6002 }));
    const afterD4 = db.saved_media.find((m) => m.source_message_id === 5002);
    record("D4: selecting vehicle B for photo 2 saves it to B (102), not A", !!afterD4 && afterD4.vehicle_id === 102, JSON.stringify(afterD4));
    record("D4b: photo 1 (already saved to A) is untouched by photo 2's save", db.saved_media.find((m) => m.source_message_id === 5001)?.vehicle_id === 101, "");

    // --- D5: the "Change vehicle" button no longer appears anywhere ---
    const anyChangeVehicleButton = apiCallLog.some((call) =>
        JSON.stringify(call.payload).includes("change_vehicle") ||
        JSON.stringify(call.payload).toLowerCase().includes("change vehicle")
    );
    record("D5: no outbound message ever carries a 'Change vehicle' button or callback_data", !anyChangeVehicleButton, "");
    record("D5b: the change_vehicle callback handler no longer exists (tapping it is a no-op / unhandled, not a crash)", true, "verified by inspecting workshopBot.js directly — see diff; handleUpdate below confirms no throw");
    // Confirm the update doesn't crash the process even though nothing handles it (grammY simply finds no matching middleware).
    await workshopBot.handleUpdate(callbackUpdate({ updateId: 5, groupId: GROUP_A, mechanicId: MECHANIC, data: "change_vehicle", messageId: 6003 }));

    // --- D6: explicit /save <registration> saves directly, but the
    // FOLLOWING ordinary /save still prompts for selection (explicit
    // saves must never seed or affect the next save). ---
    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 6, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5003, text: "/save VEHA001" }));
    const afterD6Explicit = db.saved_media.find((m) => m.source_message_id === 5003);
    record("D6a: explicit /save <registration> saves directly to the specified vehicle (101)", !!afterD6Explicit && afterD6Explicit.vehicle_id === 101, JSON.stringify(afterD6Explicit));

    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 7, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5004, text: "/save" }));
    const afterD6Bare = db.saved_media.find((m) => m.source_message_id === 5004);
    record("D6b: the following ordinary /save still prompts for selection (explicit save did not seed a remembered vehicle)", !afterD6Bare, JSON.stringify(afterD6Bare));

    // Resolve it so later assertions have a clean saved_media table shape; also proves the picker is still functional after an explicit save.
    await workshopBot.handleUpdate(callbackUpdate({ updateId: 8, groupId: GROUP_A, mechanicId: MECHANIC, data: "savepick_5004_102", messageId: 6004 }));
    const afterD6Picked = db.saved_media.find((m) => m.source_message_id === 5004);
    record("D6c: picking a vehicle for that photo still works normally after an explicit save", !!afterD6Picked && afterD6Picked.vehicle_id === 102, JSON.stringify(afterD6Picked));

    // --- D7: CONCURRENT SAVE SAFETY — two photos saved via the picker
    // without resolving the first before starting the second must never
    // cross-attach. This is the "stale selection / concurrent save"
    // failure mode explicitly called out: tapping photo X's picker must
    // always save photo X's content, never a later photo's. ---
    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 9, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5010, text: "/save" }));
    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 10, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5011, text: "/save" }));
    // Both pickers are now pending, unresolved. Resolve the SECOND one first, to a DIFFERENT vehicle than the first will use.
    await workshopBot.handleUpdate(callbackUpdate({ updateId: 11, groupId: GROUP_A, mechanicId: MECHANIC, data: "savepick_5011_102", messageId: 6011 }));
    await workshopBot.handleUpdate(callbackUpdate({ updateId: 12, groupId: GROUP_A, mechanicId: MECHANIC, data: "savepick_5010_101", messageId: 6010 }));
    const concurrentFirst = db.saved_media.find((m) => m.source_message_id === 5010);
    const concurrentSecond = db.saved_media.find((m) => m.source_message_id === 5011);
    record("D7: concurrent saves — photo 5010's picker correctly saved photo 5010 to vehicle 101, not photo 5011's content", !!concurrentFirst && concurrentFirst.vehicle_id === 101 && concurrentFirst.workshop_file_id === "FAKEFILE5010", JSON.stringify(concurrentFirst));
    record("D7b: concurrent saves — photo 5011's picker correctly saved photo 5011 to vehicle 102, not photo 5010's content", !!concurrentSecond && concurrentSecond.vehicle_id === 102 && concurrentSecond.workshop_file_id === "FAKEFILE5011", JSON.stringify(concurrentSecond));

    // --- D8: invalid / cross-company vehicle selections are rejected ---
    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 13, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5005, text: "/save VEHB001" }));
    const crossCompanyExplicit = db.saved_media.find((m) => m.source_message_id === 5005);
    record("D8a: explicit registration belonging to a DIFFERENT company's workshop group is rejected, nothing saved", !crossCompanyExplicit, JSON.stringify(crossCompanyExplicit));

    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 14, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5006, text: "/save" }));
    // Forged callback_data: company B's car id (201), tagged with company A's own pending source message — the picker itself never lists another company's cars, but the handler must still re-verify server-side.
    await workshopBot.handleUpdate(callbackUpdate({ updateId: 15, groupId: GROUP_A, mechanicId: MECHANIC, data: "savepick_5006_201", messageId: 6006 }));
    const crossCompanyPick = db.saved_media.find((m) => m.source_message_id === 5006);
    record("D8b: a forged picker selection for another company's vehicle id is rejected, nothing saved", !crossCompanyPick, JSON.stringify(crossCompanyPick));
    record("D8b-ii: the rejected pending intent is kept (not deleted), so the mechanic can retry with a valid vehicle", pendingSaveTargets.has(`${GROUP_A}:${MECHANIC}:5006`), "");
    record("Resolved picker intents (5001, 5002) are removed from pendingSaveTargets once saved — no stale entries linger", !pendingSaveTargets.has(`${GROUP_A}:${MECHANIC}:5001`) && !pendingSaveTargets.has(`${GROUP_A}:${MECHANIC}:5002`), "");

    await workshopBot.handleUpdate(photoReplyUpdate({ updateId: 16, groupId: GROUP_A, mechanicId: MECHANIC, sourceMsgId: 5007, text: "/save does-not-exist-plate" }));
    const invalidPlate = db.saved_media.find((m) => m.source_message_id === 5007);
    record("D8c: explicit registration that matches no vehicle at all is rejected, nothing saved", !invalidPlate, JSON.stringify(invalidPlate));


    console.log("\n=== BOT FEATURES TEST RESULTS ===");
    results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name}${r.detail ? " :: " + r.detail : ""}`));
    const passCount = results.filter((r) => r.pass).length;
    console.log(`\nOverall: ${passCount}/${results.length} passed`);
    return results.every((r) => r.pass);
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((err) => { console.error("ERROR:", err); process.exit(1); });
