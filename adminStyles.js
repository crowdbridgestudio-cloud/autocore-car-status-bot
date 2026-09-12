// ==================================================
// SHARED ADMIN PANEL DESIGN SYSTEM
// ==================================================
// One CSS string reused by every admin.js page instead of each route
// carrying its own ad-hoc <style> block. Mobile-first: base rules target
// small phones, @media (min-width: ...) rules layer on the desktop
// dashboard look. No build step, no framework — just one shared string
// interpolated into each page's <style> tag.
//
// Also exports the small head-tag snippet (viewport + PWA-ish meta tags)
// every page should carry, and the STATUS_COLORS map used to color-code
// the status badge shown on vehicle cards.

// Inline SVG data URI — no new static file/route needed just for a tab icon.
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23111827'/%3E%3Ctext x='50' y='68' font-size='55' text-anchor='middle'%3E%F0%9F%9A%97%3C/text%3E%3C/svg%3E";

const HEAD_META = `
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#111827">
    <link rel="icon" href="${FAVICON}">
`;

// Keyed by the same STATUS_KEYS used throughout admin.js/locales.js —
// purely a visual accent next to the existing emoji+text label, no
// business meaning attached here.
const STATUS_COLORS = {
    received: "#e0e7ff",
    diagnostics: "#fef3c7",
    repair: "#fef3c7",
    waiting_parts: "#fef3c7",
    testing: "#e0e7ff",
    payment: "#fef3c7",
    ready: "#dcfce7",
    delivered: "#dcfce7",
    cancelled: "#fee2e2"
};

const STATUS_TEXT_COLORS = {
    received: "#3730a3",
    diagnostics: "#92400e",
    repair: "#92400e",
    waiting_parts: "#92400e",
    testing: "#3730a3",
    payment: "#92400e",
    ready: "#166534",
    delivered: "#166534",
    cancelled: "#991b1b"
};

function statusBadgeStyle(statusKey) {
    const bg = STATUS_COLORS[statusKey] || "#f3f4f6";
    const color = STATUS_TEXT_COLORS[statusKey] || "#374151";
    return `background:${bg};color:${color};`;
}


const BASE_STYLES = `
    :root {
        --bg: #f4f6f8;
        --surface: #ffffff;
        --text: #111827;
        --text-muted: #6b7280;
        --border: #e5e7eb;
        --primary: #111827;
        --primary-text: #ffffff;
        --danger: #dc2626;
        --danger-bg: #fee2e2;
        --danger-text: #991b1b;
        --success-bg: #dcfce7;
        --success-text: #166534;
        --radius: 14px;
        --radius-sm: 10px;
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    html, body { margin: 0; padding: 0; }

    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        background: var(--bg);
        color: var(--text);
        -webkit-text-size-adjust: 100%;
    }

    a { color: inherit; }

    h1, h2, h3, p { margin: 0 0 8px; }

    /* ---------------- Header ---------------- */

    .app-header {
        background: #111827;
        color: white;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        position: sticky;
        top: 0;
        z-index: 10;
    }

    .app-header .brand {
        font-size: 18px;
        font-weight: 700;
        display: flex;
        flex-direction: column;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .app-header .brand .tagline {
        font-size: 11px;
        font-weight: 400;
        opacity: 0.7;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .lang-switcher select {
        -webkit-appearance: none;
        appearance: none;
        background: rgba(255,255,255,0.12);
        color: white;
        border: none;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 14px;
        min-height: 40px;
    }

    .lang-switcher select option { color: #111827; }

    .logout-link {
        color: white;
        text-decoration: none;
        background: rgba(255,255,255,0.15);
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 14px;
        white-space: nowrap;
        min-height: 40px;
        display: inline-flex;
        align-items: center;
    }

    /* ---------------- Layout ---------------- */

    .container {
        max-width: 1100px;
        margin: 0 auto;
        padding: 16px;
    }

    @media (min-width: 768px) {
        .container { padding: 24px 32px; }
    }

    @media (min-width: 1200px) {
        .container { padding: 32px 48px; }
    }

    .top-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 16px;
    }

    .notice-banner {
        margin: 0 0 16px;
        padding: 12px 16px;
        border-radius: var(--radius-sm);
        font-size: 14px;
    }

    .notice-banner.success { background: var(--success-bg); color: var(--success-text); }
    .notice-banner.error { background: var(--danger-bg); color: var(--danger-text); }

    /* ---------------- Buttons ---------------- */

    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 48px;
        padding: 12px 20px;
        border-radius: var(--radius-sm);
        border: none;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        font-family: inherit;
        line-height: 1.2;
        white-space: nowrap;
    }

    .btn-primary { background: var(--primary); color: var(--primary-text); }
    .btn-outline { background: var(--border); color: var(--text); }
    .btn-danger { background: var(--danger-bg); color: var(--danger-text); }
    .btn-block { width: 100%; }

    /* ---------------- Forms ---------------- */

    label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-muted);
        margin: 14px 0 6px;
    }

    input, select, textarea {
        width: 100%;
        min-height: 48px;
        padding: 12px 14px;
        font-size: 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        font-family: inherit;
        background: white;
        color: var(--text);
    }

    textarea { min-height: 90px; resize: vertical; padding-top: 12px; }

    /* ---------------- Cards ---------------- */

    .card {
        background: var(--surface);
        border-radius: var(--radius);
        padding: 20px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    /* ---------------- Vehicle list ---------------- */

    .car-card {
        background: var(--surface);
        border-radius: var(--radius);
        padding: 18px;
        margin-bottom: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    .car-card .car-title { font-size: 17px; font-weight: 700; }

    .car-card .car-reg {
        color: var(--text-muted);
        font-size: 14px;
        margin-bottom: 10px;
        letter-spacing: 0.5px;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 10px;
    }

    .car-meta { font-size: 14px; margin: 4px 0; }
    .car-meta a { color: #2563eb; text-decoration: none; }

    .car-card .status-form {
        display: flex;
        gap: 8px;
        margin-top: 14px;
    }

    .car-card .status-form select { flex: 1; }
    .car-card .status-form button { flex-shrink: 0; }

    /* A translated "Change status" label can be long — stack instead of
       cramming it next to the select on the narrowest phones (320-360px). */
    @media (max-width: 380px) {
        .status-form { flex-direction: column; }
        .status-form button { width: 100%; }
    }

    .car-card .actions-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
    }

    .car-card .actions-row .btn { flex: 1; min-width: 100px; }

    .search-box {
        margin-bottom: 16px;
    }

    /* Desktop: turn each vehicle card into a dense table-like row. */
    @media (min-width: 1024px) {

        .car-card {
            display: grid;
            grid-template-columns: 1.6fr 1fr 1.6fr auto;
            align-items: center;
            gap: 20px;
            padding: 14px 20px;
        }

        .car-card .car-reg { margin-bottom: 0; }
        .status-badge { margin-bottom: 0; }
        .car-card .status-form { margin-top: 0; }
        .car-card .actions-row { margin-top: 0; flex-wrap: nowrap; }
        .car-card .actions-row .btn { flex: 0 0 auto; min-width: 0; }
    }

    /* ---------------- Login page ---------------- */

    .login-header {
        background: #111827;
        color: white;
        padding: 16px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .login-header .brand { font-size: 19px; font-weight: 700; }

    .login-wrap {
        min-height: calc(100vh - 60px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px 48px;
    }

    .login-box {
        width: 100%;
        max-width: 400px;
        background: var(--surface);
        padding: 28px 24px;
        border-radius: 18px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
    }

    .login-box h1 {
        font-size: 20px;
        text-align: center;
        color: var(--text-muted);
        font-weight: 600;
        margin-bottom: 22px;
    }

    .login-box .btn { margin-top: 6px; }
`;


// ==================================================
// DOUBLE-SUBMIT GUARD
// ==================================================
// Generic client-side protection against duplicate form submissions —
// double-clicks, repeated Enter presses, or a slow request the user
// impatiently retries. Attaches once per page load (plain server-
// rendered pages, no client router, so there's no risk of this running
// twice) and covers every <form> on the page, not just one. Locks on
// the `submit` event itself (not the button's `click`), so it fires no
// matter how the submission was triggered. Restores the button if the
// page is ever shown again from the back/forward cache instead of a
// fresh navigation (e.g. the user hits Back after an error).
//
// This is a UX safety net, not the source of truth — real duplicate-
// creation protection for routes that insert data lives server-side
// (see admin.js's /add-car idempotency-key handling).
const DOUBLE_SUBMIT_GUARD_SCRIPT = `
    <script>
        (function () {
            document.querySelectorAll("form").forEach(function (form) {
                form.addEventListener("submit", function (e) {
                    if (form.dataset.submitting === "1") {
                        e.preventDefault();
                        return;
                    }
                    var btn = form.querySelector("button[type=submit], form > button");
                    if (btn) {
                        form.dataset.submitting = "1";
                        btn.disabled = true;
                        btn.dataset.originalText = btn.textContent;
                        btn.textContent = btn.dataset.loadingText || (btn.textContent + "…");
                    }
                });
            });
            window.addEventListener("pageshow", function (e) {
                if (e.persisted) {
                    document.querySelectorAll("form").forEach(function (form) {
                        form.dataset.submitting = "";
                        var btn = form.querySelector("button[type=submit], form > button");
                        if (btn && btn.dataset.originalText) {
                            btn.disabled = false;
                            btn.textContent = btn.dataset.originalText;
                        }
                    });
                }
            });
        })();
    </script>
`;

module.exports = {
    HEAD_META,
    BASE_STYLES,
    statusBadgeStyle,
    DOUBLE_SUBMIT_GUARD_SCRIPT
};
