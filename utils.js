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


module.exports = {
    escapeHtml,
    escapeJsString
};
