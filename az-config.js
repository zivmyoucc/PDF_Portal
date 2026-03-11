/*
 * ══════════════════════════════════════════════════════════════
 *  SecureDocs — Azure AD / Entra ID Configuration
 *
 *  STEP-BY-STEP SETUP:
 *  ─────────────────────────────────────────────────────────────
 *  1. Go to portal.azure.com → Microsoft Entra ID → App registrations
 *  2. Click "New registration"
 *  3. Name: SecureDocs (or any name you prefer)
 *  4. Supported account types:
 *       • "Accounts in this organizational directory only" — for single-tenant
 *       • "Accounts in any organizational directory" — for multi-tenant
 *       • "Accounts in any organizational directory or personal MS accounts" — broadest
 *  5. Redirect URI: choose "Single-page application (SPA)" and enter:
 *       http://localhost:5500   ← if using VS Code Live Server (default port)
 *       http://127.0.0.1:5500  ← alternative for Live Server
 *       (Add BOTH to be safe — you can add multiple redirect URIs)
 *  6. Click Register.
 *  7. From the Overview page copy:
 *       "Application (client) ID"  → paste below as CLIENT_ID
 *       "Directory (tenant) ID"    → paste below as TENANT_ID
 *  8. Under Authentication → verify that "Access tokens" and "ID tokens" are checked.
 *  ─────────────────────────────────────────────────────────────
 *  NOTE: Opening index.html directly as a file:// URL does NOT work with
 *  Microsoft OAuth — you MUST serve the app via a local HTTP server
 *  (e.g. VS Code Live Server, npx http-server, etc.).
 * ══════════════════════════════════════════════════════════════
 */

const AZ_CONFIG = {

    // ── REQUIRED: Replace with your Azure App Registration values ──
    CLIENT_ID: '49f3793d-26d7-46af-8e67-e3a43cbc7ed8',
    TENANT_ID: '86a00e7f-7459-4c56-931d-5f99754abf45',

    // ── Redirect URI ──────────────────────────────────────────────
    // Must EXACTLY match one of the Redirect URIs you registered in Azure.
    // window.location.origin gives you e.g. "http://localhost:5500"
    // REDIRECT_URI: window.location.origin + '/',
        REDIRECT_URI: https://black-water-010e27603.2.azurestaticapps.net 
    // ── Scopes requested from Azure AD ───────────────────────────
    SCOPES: ['User.Read', 'openid', 'profile', 'email'],

    // ── Login method: 'popup' or 'redirect' ──────────────────────
    // 'popup'    → opens a popup window (recommended for SPAs)
    // 'redirect' → full-page redirect (works better in some enterprise environments)
    LOGIN_METHOD: 'popup',

    // ── Allow local password fallback (for development/demo) ─────
    ALLOW_LOCAL_FALLBACK: true,

};



