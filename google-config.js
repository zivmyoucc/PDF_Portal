/*
 * ══════════════════════════════════════════════════════════════
 *  SecureDocs — Google Identity Services Configuration
 *
 *  STEP-BY-STEP SETUP:
 *  ─────────────────────────────────────────────────────────────
 *  1. Go to console.cloud.google.com
 *  2. Create a new project (or select an existing one)
 *  3. Go to: APIs & Services → Credentials
 *  4. Click "Create Credentials" → "OAuth 2.0 Client ID"
 *  5. Application type: "Web application"
 *  6. Under "Authorized JavaScript origins" add:
 *       http://localhost:5500
 *       http://127.0.0.1:5500
 *  7. Under "Authorized redirect URIs" add:
 *       http://localhost:5500/
 *  8. Click "Create" — copy the "Client ID" (ends with .apps.googleusercontent.com)
 *  9. Paste it below as CLIENT_ID
 *  ─────────────────────────────────────────────────────────────
 *  NOTE: Google OAuth requires an HTTP server — file:// URLs will NOT work.
 * ══════════════════════════════════════════════════════════════
 */

const GOOGLE_CONFIG = {

    // ── REQUIRED: Paste your Google OAuth Client ID here ─────────
    CLIENT_ID: '371137880317-f8iec0v2ktv5u098km8eijq9uhd07nju.apps.googleusercontent.com',

};
