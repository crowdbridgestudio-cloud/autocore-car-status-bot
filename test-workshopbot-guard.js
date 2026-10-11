// Isolated regression check for workshopBot.js's managerGroupBelongsToAnotherCompany()
// guard — the P1 fix that prevents a Telegram group already serving as
// one company's Manager Group from being silently reassigned to another.
//
// SAFETY: no WORKSHOP_BOT_TOKEN is set, so requiring workshopBot.js
// constructs no Bot instance and starts no polling (confirmed in an
// earlier reviewed phase — the guard function was deliberately hoisted
// out of the `if (WORKSHOP_BOT_TOKEN)` block for exactly this reason).
// Supabase is fully mocked in-memory — no production connection at all.

delete process.env.WORKSHOP_BOT_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
process.env.BOT_TOKEN = "123456789:QA-FAKE-TOKEN-NOT-REAL-00000000000";

const db = { workshop_telegram_groups: [] };
let nextId = 1;

function mockSupabase() {
    function from(table) {
        const filters = [];
        let limitN = null;
        const api = {
            select() { return api; },
            eq(col, val) { filters.push((r) => r[col] == val); return api; },
            neq(col, val) { filters.push((r) => r[col] != val); return api; },
            limit(n) { limitN = n; return api; },
            then(resolve) {
                let rows = db[table].filter((r) => filters.every((f) => f(r)));
                if (limitN != null) rows = rows.slice(0, limitN);
                resolve({ data: rows, error: null });
            }
        };
        return api;
    }
    return { from };
}

const supabasePath = require.resolve("./supabase");
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: mockSupabase() };

const { managerGroupBelongsToAnotherCompany } = require("./workshopBot");

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: detail || "" }); }

async function main() {

    db.workshop_telegram_groups.push({ id: nextId++, company_id: 1, workshop_group_id: -1001, manager_group_id: -2001, is_active: true });

    const blockedForOther = await managerGroupBelongsToAnotherCompany(-2001, 2);
    record("Manager group already used by Company 1 is blocked for Company 2", blockedForOther === true, `result=${blockedForOther}`);

    const allowedForOwner = await managerGroupBelongsToAnotherCompany(-2001, 1);
    record("Company 1 reconnecting its own manager group is NOT blocked", allowedForOwner === false, `result=${allowedForOwner}`);

    const freshGroup = await managerGroupBelongsToAnotherCompany(-9999, 2);
    record("A fresh, never-used manager group id is never blocked", freshGroup === false, `result=${freshGroup}`);

    // Multi-workshop-group case: Company 1 has a SECOND workshop group
    // sharing the same manager_group_id (legitimate — multiple workshop
    // groups reporting to one manager group). Must still not be blocked
    // for Company 1 itself.
    db.workshop_telegram_groups.push({ id: nextId++, company_id: 1, workshop_group_id: -1002, manager_group_id: -2001, is_active: true });
    const stillAllowedForOwner = await managerGroupBelongsToAnotherCompany(-2001, 1);
    record("Shared manager_group_id across Company 1's own multiple workshop groups still not blocked for Company 1", stillAllowedForOwner === false, `result=${stillAllowedForOwner}`);

    console.log("\n=== WORKSHOPBOT GUARD RESULTS ===");
    results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"} - ${r.name} :: ${r.detail}`));
    const passCount = results.filter((r) => r.pass).length;
    console.log(`\nOverall: ${passCount}/${results.length} passed`);
    return results.every((r) => r.pass);
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((err) => { console.error("ERROR:", err); process.exit(1); });
