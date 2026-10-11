// Small shared helpers used by both the company admin panel (admin.js)
// and the super admin panel (superadmin.js).

function escapeHtml(value) {

    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


// Escapes a value so it can be safely embedded inside a single-quoted
// JS string literal in server-rendered HTML (e.g. an inline onclick=).
function escapeJsString(value) {

    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/</g, "\\x3C");
}


// Produces the digit string wa.me needs (no "+", no spaces/punctuation),
// or null if the input can't be trusted to be a complete, real number.
// Deliberately conservative — a loose 8-15 digit sanity bound (realistic
// international phone number lengths), never padding/guessing a country
// code or any other digit that isn't already in the input. Stripping a
// leading "+" is removing a formatting character, not inventing data.
// Shared by admin.js (customer WhatsApp contact), superadmin.js and
// admin.js (company contact people), and index.js (customer-facing
// "Message on WhatsApp" button) — re-validated at render time in every
// one of them, never trusted purely from how it was stored.
function toWhatsappDigits(phone) {
    if (!phone || typeof phone !== "string") return null;
    const digits = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
    return /^\d{8,15}$/.test(digits) ? digits : null;
}

// Real Telegram username rules: 5-32 characters, starts with a letter,
// letters/digits/underscores only. Returns the cleaned username (a
// leading "@" is stripped — that's how people naturally type it, not
// part of the username itself), or the literal string "INVALID" if
// something was entered but doesn't look like a real username — the
// caller distinguishes "nothing entered" (null, fine, optional field)
// from "entered but wrong" (must be rejected, not silently dropped).
function sanitizeTelegramUsername(input) {
    if (!input || typeof input !== "string") return null;
    const trimmed = input.trim();
    if (trimmed === "") return null;
    const cleaned = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(cleaned) ? cleaned : "INVALID";
}


module.exports = {
    escapeHtml,
    escapeJsString,
    toWhatsappDigits,
    sanitizeTelegramUsername
};
