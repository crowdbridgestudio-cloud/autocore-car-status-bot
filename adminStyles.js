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

    /* Contact-method radio pair — plain native radios (not pill buttons)
       so the actually-selected one is unambiguous without any JS beyond
       the one-line visibility toggle for the Telegram username field. */
    .contact-method-row { display: flex; gap: 18px; margin: 2px 0 14px; }

    .contact-method-option {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 500;
        color: var(--text);
        margin: 0;
        cursor: pointer;
    }

    .contact-method-option input[type="radio"] {
        width: 20px;
        height: 20px;
        min-height: 0;
        flex-shrink: 0;
    }

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


    /* ==================================================
       APP SHELL (v2 — bottom nav / sidebar navigation)
       ================================================== */
    /* Custom ease-out, per Emil Kowalski's design-engineering guidance:
       built-in CSS easings are too weak for UI motion to feel intentional.
       Only transform/opacity/color are ever transitioned below — both
       skip layout and paint, so they stay smooth even under load. */

    :root {
        --accent: #4f46e5;
        --accent-soft: #eef2ff;
        --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
        --nav-height: 64px;
    }

    .app-shell { display: flex; flex-direction: column; min-height: 100vh; }
    .shell-body { display: flex; flex: 1; }

    .shell-main {
        flex: 1;
        min-width: 0;
        padding: 16px 16px calc(var(--nav-height) + 24px + env(safe-area-inset-bottom));
    }

    @media (min-width: 1024px) {
        .shell-main { padding: 28px 32px; max-width: 1100px; margin: 0 auto; width: 100%; }
    }

    .top-bar {
        background: #111827;
        color: white;
        padding: max(14px, env(safe-area-inset-top)) 16px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        position: sticky;
        top: 0;
        z-index: 20;
    }

    .top-bar-title {
        font-size: 17px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .top-bar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

    /* Bottom tab bar — mobile default. Reserves its own space via
       .shell-main's padding-bottom above, so it never covers content. */
    .bottom-nav {
        position: fixed;
        left: 0; right: 0; bottom: 0;
        z-index: 30;
        display: flex;
        background: var(--surface);
        border-top: 1px solid var(--border);
        padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
        box-shadow: 0 -2px 10px rgba(0,0,0,0.05);
    }

    .nav-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 6px 2px;
        border-radius: 10px;
        color: var(--text-muted);
        text-decoration: none;
        font-size: 11px;
        font-weight: 600;
        transition: color 160ms var(--ease-out), background-color 160ms var(--ease-out), transform 140ms var(--ease-out);
    }

    .nav-item svg { width: 22px; height: 22px; }
    .nav-item[aria-current="page"] { color: var(--accent); background: var(--accent-soft); }
    .nav-item:active { transform: scale(0.94); }

    @media (hover: hover) and (pointer: fine) {
        .nav-item:hover { color: var(--accent); }
    }

    /* Sidebar — desktop only, same nav items, different layout */
    .side-nav {
        display: none;
        flex-direction: column;
        width: 216px;
        flex-shrink: 0;
        background: var(--surface);
        border-right: 1px solid var(--border);
        padding: 16px 10px;
        gap: 2px;
    }

    .side-nav .nav-item {
        flex-direction: row;
        justify-content: flex-start;
        gap: 10px;
        font-size: 14px;
        padding: 11px 12px;
        width: 100%;
    }

    @media (min-width: 1024px) {
        .bottom-nav { display: none; }
        .side-nav { display: flex; }
        .shell-main { padding-bottom: 28px; }
    }

    /* ---------------- Overview stat tiles ---------------- */

    .stat-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-bottom: 18px;
    }

    .stat-tile {
        background: var(--surface);
        border-radius: var(--radius-sm);
        padding: 14px 10px;
        text-align: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }

    .stat-tile .stat-value { font-size: 22px; font-weight: 800; line-height: 1.1; }
    .stat-tile .stat-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; font-weight: 600; }

    /* ---------------- Filter pills ---------------- */

    .filter-row {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
        margin-bottom: 14px;
        scrollbar-width: none;
    }
    .filter-row::-webkit-scrollbar { display: none; }

    .filter-pill {
        flex-shrink: 0;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 7px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        transition: transform 120ms var(--ease-out), background-color 160ms var(--ease-out), color 160ms var(--ease-out), border-color 160ms var(--ease-out);
    }

    .filter-pill:active { transform: scale(0.96); }

    .filter-pill[aria-pressed="true"] {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
    }

    /* ---------------- Redesigned vehicle card (v2) ---------------- */

    .vcard {
        background: var(--surface);
        border-radius: var(--radius);
        padding: 16px;
        margin-bottom: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        transition: box-shadow 160ms var(--ease-out);
    }

    @media (hover: hover) and (pointer: fine) {
        .vcard:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
    }

    .vcard-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 4px; }
    .vcard-title { font-size: 16px; font-weight: 700; }
    .vcard-reg { font-size: 13px; color: var(--text-muted); letter-spacing: 0.4px; margin-top: 2px; }

    /* VIN is a plain requirement ("must not be hidden behind another
       click") — shown inline, never collapsed/truncated/toggled. */
    .vcard-vin, .car-vin { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    /* Italic alone distinguishes "missing" from a real VIN — no opacity
       reduction, since stacking it on top of an already-muted color
       pushed contrast below WCAG AA for this text's size (~12-13px). */
    .vin-missing { font-style: italic; }

    .vcard-meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        font-size: 13px;
        color: var(--text-muted);
        margin: 8px 0 12px;
    }

    .vcard-meta-row .meta-item { display: inline-flex; align-items: center; gap: 5px; }
    .vcard-meta-row svg { width: 14px; height: 14px; flex-shrink: 0; }

    .vcard-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

    .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: var(--border);
        color: var(--text);
        flex-shrink: 0;
        transition: transform 120ms var(--ease-out), background-color 160ms var(--ease-out), opacity 160ms var(--ease-out);
        text-decoration: none;
    }

    .icon-btn svg { width: 18px; height: 18px; }
    .icon-btn:active { transform: scale(0.93); }
    .icon-btn.disabled { opacity: 0.35; pointer-events: none; }

    /* The one Telegram state that's a REAL, working link (see
       renderTelegramAction) — visually distinct from the grey disabled
       state so staff can tell at a glance which customers can actually
       be chatted with directly. */
    .icon-btn-accent { background: var(--accent-soft); color: var(--accent); }

    /* ---------------- Service notes ---------------- */

    .service-notes-list { display: flex; flex-direction: column; gap: 10px; }

    .service-note {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 12px 14px;
    }

    .service-note-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 6px; }
    .service-note-date { font-size: 12px; color: var(--text-muted); }
    .service-note-text { font-size: 14px; margin: 0 0 4px; }
    .service-note-author { font-size: 12px; color: var(--text-muted); margin: 0; }

    .vcard .status-form { flex: 1; min-width: 160px; display: flex; gap: 8px; margin: 0; }
    .vcard .status-form select { flex: 1; }

    /* ---------------- Empty states ---------------- */

    .empty-state { text-align: center; padding: 48px 20px; color: var(--text-muted); }
    .empty-state svg { width: 40px; height: 40px; margin-bottom: 10px; opacity: 0.45; }
    .empty-state p { font-size: 14px; }

    /* ---------------- Customer directory ---------------- */

    .customer-card {
        background: var(--surface);
        border-radius: var(--radius);
        padding: 16px;
        margin-bottom: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    .customer-card .customer-name { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .customer-card .customer-vehicles { font-size: 13px; color: var(--text-muted); margin: 8px 0 12px; }

    .pill-muted {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: var(--bg);
        border: 1px solid var(--border);
        color: var(--text-muted);
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
    }

    /* ---------------- More / settings list ---------------- */

    .more-list { display: flex; flex-direction: column; gap: 8px; }

    .more-item {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--surface);
        border-radius: var(--radius-sm);
        padding: 14px 16px;
        text-decoration: none;
        color: var(--text);
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        transition: transform 120ms var(--ease-out);
    }

    .more-item:active { transform: scale(0.98); }
    .more-item svg { width: 20px; height: 20px; color: var(--text-muted); flex-shrink: 0; }
    .more-item .chevron { margin-left: auto; width: 16px; height: 16px; color: var(--text-muted); opacity: 0.6; }

    /* ---------------- List entrance + universal press feedback ---------------- */

    @media (prefers-reduced-motion: no-preference) {
        .vcard, .customer-card { animation: shellFadeIn 260ms var(--ease-out) both; }
        .vcard:nth-child(2), .customer-card:nth-child(2) { animation-delay: 30ms; }
        .vcard:nth-child(3), .customer-card:nth-child(3) { animation-delay: 60ms; }
        .vcard:nth-child(4), .customer-card:nth-child(4) { animation-delay: 90ms; }
        .vcard:nth-child(n+5), .customer-card:nth-child(n+5) { animation-delay: 110ms; }
    }

    @keyframes shellFadeIn {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
        .vcard, .customer-card { animation: none !important; }
        .btn:active, .icon-btn:active, .nav-item:active, .filter-pill:active, .more-item:active { transform: none !important; }
    }

    /* Existing .btn class (login, forms, QR page, etc.) gains real press
       feedback retroactively — no markup changes needed anywhere it's
       already used. */
    .btn {
        transition: transform 140ms var(--ease-out), background-color 160ms var(--ease-out), opacity 160ms var(--ease-out);
        -webkit-tap-highlight-color: transparent;
    }
    .btn:active { transform: scale(0.97); }
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

// ==================================================
// ICON SET
// ==================================================
// A small, cohesive, hand-authored stroke icon set (one consistent
// 24x24 grid, currentColor, round caps/joins) — used throughout the
// redesigned shell instead of emoji as primary interface icons. "more"
// is deliberately filled dots (classic grid/menu glyph) rather than
// stroked, matching how that icon reads everywhere it's used elsewhere.

const ICON_PATHS = {
    repairs: '<polyline points="3 12 8 12 10 7 14 17 16 12 21 12"/>',
    ready: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><line x1="10" y1="13" x2="14" y2="13"/>',
    customers: '<circle cx="9" cy="8" r="3"/><path d="M4 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.3"/><path d="M15 14.3c2.6.4 4.6 2.6 5 5.7"/>',
    phone: '<path d="M5 4h4l2 5-2.5 2.5a11 11 0 0 0 5 5L16 14l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    telegram: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
    details: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"/>',
    edit: '<path d="M4 20h4L18 10l-4-4L4 16v4z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/>',
    message: '<path d="M4 4h16v12H8l-4 4V4z"/>',
    whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M8.5 8.8c.2-.5.4-.5.6-.5h.5c.2 0 .4 0 .6.4s.6 1.5.7 1.6c.1.1.1.3 0 .5s-.2.3-.3.5-.3.3-.1.6c.2.3.8 1.2 1.6 1.9 1.1 1 1.9 1.2 2.2 1.4.3.1.4.1.6-.1.2-.2.7-.8.9-1.1s.4-.2.6-.1 1.6.7 1.9.9.4.2.5.3c.1.2.1.9-.2 1.6s-1.6 1.3-2.2 1.3c-.6 0-1.3.1-4.2-1.1-3.1-1.3-5.1-4.4-5.3-4.6-.1-.2-1.2-1.6-1.2-3s.8-2.1 1-2.3z" fill="currentColor" stroke="none"/>',
    chevron: '<polyline points="9 6 15 12 9 18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>'
};

const ICON_FILLED = { more: '<circle cx="5" cy="5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="5" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><circle cx="19" cy="19" r="1.6"/>' };

function icon(name, className = "") {

    if (ICON_FILLED[name]) {
        return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${ICON_FILLED[name]}</svg>`;
    }

    const path = ICON_PATHS[name];

    if (!path) return "";

    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}


// ==================================================
// APP SHELL (bottom nav on mobile, sidebar on desktop)
// ==================================================
// One shared shell every authenticated admin.js page renders into —
// keeps the 5-section navigation (Repairs/Ready/Archive/Customers/More)
// and its "active" state in exactly one place. Purely presentational:
// takes already-translated label strings (adminStyles.js has no locale
// lookups of its own, same as statusBadgeStyle above) and a pre-rendered
// body string, and returns the full shell markup around it.

const NAV_KEYS = ["repairs", "ready", "archive", "customers", "more"];

const NAV_PATHS = {
    repairs: "/admin",
    ready: "/admin/ready",
    archive: "/admin/archive",
    customers: "/admin/customers",
    more: "/admin/more"
};

const NAV_ICON_NAMES = {
    repairs: "repairs",
    ready: "ready",
    archive: "archive",
    customers: "customers",
    more: "more"
};

function renderNavItems(activeKey, navLabels) {

    return NAV_KEYS.map((key) => `
        <a class="nav-item" href="${NAV_PATHS[key]}" ${key === activeKey ? 'aria-current="page"' : ""}>
            ${icon(NAV_ICON_NAMES[key])}
            <span>${navLabels[key]}</span>
        </a>
    `).join("");
}

function renderAppShell({ activeKey, pageTitle, navLabels, bodyHtml, headerRight = "" }) {

    return `
        <div class="app-shell">

            <header class="top-bar">
                <div class="top-bar-title">${pageTitle}</div>
                <div class="top-bar-actions">${headerRight}</div>
            </header>

            <div class="shell-body">

                <nav class="side-nav" aria-label="Primary">
                    ${renderNavItems(activeKey, navLabels)}
                </nav>

                <main class="shell-main">
                    ${bodyHtml}
                </main>

            </div>

            <nav class="bottom-nav" aria-label="Primary">
                ${renderNavItems(activeKey, navLabels)}
            </nav>

        </div>
    `;
}


module.exports = {
    HEAD_META,
    BASE_STYLES,
    statusBadgeStyle,
    DOUBLE_SUBMIT_GUARD_SCRIPT,
    icon,
    renderAppShell
};
