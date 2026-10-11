// Pure, Telegram-independent decision/formatting logic used by the
// CUSTOMER-facing bot in index.js. Extracted here (rather than left
// inline) specifically so it can be required directly in tests without
// constructing a grammY Bot, touching Supabase, or starting any Telegram
// polling — every function below takes plain data in and returns plain
// data out, with zero side effects and zero network/database access.
// index.js requires and calls these exact functions in production; tests
// that require this module are therefore exercising the REAL logic, not
// a copy of it.

// Decides what the "Status" entry point / My Vehicles screen should show
// for a given set of linked vehicles — this is what stops a customer with
// two or more linked vehicles from receiving one independent status
// message per vehicle (previously, every vehicle was sent as its own
// message unconditionally). A single vehicle is still shown directly
// (no extra tap needed); two or more always produce exactly one
// selector message instead of several status messages.
function resolveVehicleMenuMode(cars) {

    if (!cars || cars.length === 0) {
        return { mode: "none" };
    }

    if (cars.length === 1) {
        return { mode: "single", car: cars[0] };
    }

    return { mode: "list", cars };
}


// Builds the plain-data entries for the My Vehicles selector keyboard —
// one entry per vehicle, each carrying the exact callback_data the real
// select_vehicle_<id> handler expects. Telegram-specific keyboard
// construction (new InlineKeyboard()) stays in index.js; this only
// decides WHAT each button says and WHERE it points.
function buildVehicleListEntries(cars, { lang, statusLabel }) {

    return (cars || []).map((car) => ({
        carId: car.id,
        label: `${car.brand} ${car.model} — ${car.registration || "-"} (${statusLabel(lang, car.status)})`,
        callbackData: `select_vehicle_${car.id}`
    }));
}


// Builds the Contact Service message text and the plain-data list of
// link buttons (role_label + url) it should show. Always includes the
// workshop's own name/phone/address (previously these were only shown
// when NO company_contacts existed for this company, so a company with
// contact people configured never displayed its own basic info at all).
// Never fabricates a value: a missing company name is simply omitted; a
// missing phone/address falls back to the existing localized placeholder
// text this screen has always used. A contact only ever produces a
// Telegram button when it has a real stored username, and a WhatsApp
// button only when its phone normalizes to a complete number via the
// shared toWhatsappDigits() validator — re-validated here at render
// time, never trusted purely from how it was stored.
function buildContactServiceMessage({ t, toWhatsappDigits, lang, company, contacts }) {

    let message = t(lang, "contact_title");

    if (company && company.name) {
        message += `🏢 ${company.name}\n`;
    }

    message +=
        `📞 ${(company && company.phone) || t(lang, "contact_phone_missing")}\n` +
        `📍 ${(company && company.address) || t(lang, "contact_address_missing")}\n\n`;

    const buttons = [];

    if (contacts && contacts.length > 0) {

        for (const contact of contacts) {

            const waDigits = toWhatsappDigits(contact.phone);

            message += `👤 *${contact.role_label}*\n`;

            if (!contact.telegram_username && !waDigits) {
                message += `${t(lang, "contact_method_not_configured")}\n`;
            }

            message += `\n`;

            if (contact.telegram_username) {
                buttons.push({
                    label: `💬 ${contact.role_label} — ${t(lang, "btn_telegram")}`,
                    url: `https://t.me/${contact.telegram_username}`
                });
            }

            if (waDigits) {
                buttons.push({
                    label: `💬 ${contact.role_label} — ${t(lang, "btn_whatsapp")}`,
                    url: `https://wa.me/${waDigits}`
                });
            }
        }
    }

    return { message, buttons };
}


module.exports = {
    resolveVehicleMenuMode,
    buildVehicleListEntries,
    buildContactServiceMessage
};
