/* ══════════════════════════════════════════════
   SecureDocs — app.js
   Core Logic: Azure AD Auth (MSAL) + Forms + Upload
   ══════════════════════════════════════════════ */

'use strict';

// ── Local fallback demo credentials ──────────
const LOCAL_USERS = [
    { username: 'admin', password: '1234', displayName: 'מנהל מערכת', initials: 'מ' },
    { username: 'user', password: 'abcd', displayName: 'משתמש כללי', initials: 'מ' },
];

// ── App State ─────────────────────────────────
let currentUser = null;
let msalInstance = null;
let googleTokenClient = null;
let historyItems = [];
let pendingDeleteId = null;
let pendingPreviewUrl = null;
let pendingPreviewName = null;
let formAttachments = [];

// ── Helpers ───────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }
function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
}
function fmtDate(d) {
    return new Date(d).toLocaleDateString('he-IL', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

// ── Toast ──────────────────────────────────────
function toast(msg, type = 'info') {
    const icons = {
        success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
        error: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
        info: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zm-1 4a1 1 0 012 0v4a1 1 0 11-2 0v-4z" clip-rule="evenodd"/></svg>',
    };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => { el.classList.add('fadeout'); setTimeout(() => el.remove(), 350); }, 3500);
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ══════════════════════════════════════════════
//  MSAL — Azure AD INITIALISATION (v2)
// ══════════════════════════════════════════════
async function initMsal() {
    // Guard: if no config or placeholder values, keep Azure section hidden
    if (typeof AZ_CONFIG === 'undefined' ||
        !AZ_CONFIG.CLIENT_ID ||
        AZ_CONFIG.CLIENT_ID === 'YOUR_CLIENT_ID_HERE' ||
        !AZ_CONFIG.TENANT_ID ||
        AZ_CONFIG.TENANT_ID === 'YOUR_TENANT_ID_HERE') {
        console.warn('[SecureDocs] Azure AD not configured — local fallback only.');
        const sub = document.querySelector('.login-header p');
        if (sub) sub.textContent = 'הזן את פרטי ההתחברות שלך להמשך';
        return;
    }

    try {
        const msalConfig = {
            auth: {
                clientId: AZ_CONFIG.CLIENT_ID,
                authority: `https://login.microsoftonline.com/${AZ_CONFIG.TENANT_ID}`,
                redirectUri: AZ_CONFIG.REDIRECT_URI,
                navigateToLoginRequestUrl: true,
            },
            cache: {
                cacheLocation: 'sessionStorage',
                storeAuthStateInCookie: false,
            },
            system: {
                loggerOptions: {
                    logLevel: msal.LogLevel.Warning,
                    loggerCallback: (_lvl, msg) => console.warn('[MSAL]', msg),
                }
            }
        };

        // MSAL v2: constructor is synchronous — no initialize() needed
        msalInstance = new msal.PublicClientApplication(msalConfig);

        // Show the Azure login button
        showAzureSection();

        // Handle redirect callback (for LOGIN_METHOD === 'redirect')
        const redirectResponse = await msalInstance.handleRedirectPromise();
        if (redirectResponse) {
            handleAuthResponse(redirectResponse);
            return;
        }

        // Silent SSO: restore a previously active session if one exists
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            try {
                const silentResult = await msalInstance.acquireTokenSilent({
                    scopes: AZ_CONFIG.SCOPES,
                    account: accounts[0],
                });
                handleAuthResponse(silentResult);
            } catch (silentErr) {
                // Silent SSO failed — user needs to click login button
                console.info('[SecureDocs] Silent SSO unavailable, user interaction required.');
            }
        }

    } catch (err) {
        console.error('[SecureDocs] MSAL init failed:', err);
        showAzureError('שגיאת אתחול Azure AD: ' + (err.message || err));
    }
}

function showAzureSection() {
    const az = document.getElementById('azureSection');
    const div = document.getElementById('loginDivider');
    if (az) az.style.display = 'block';
    // Show divider only when local fallback is also enabled
    if (div && AZ_CONFIG.ALLOW_LOCAL_FALLBACK) div.style.display = 'flex';
    // Hide local section if fallback is disabled
    if (!AZ_CONFIG.ALLOW_LOCAL_FALLBACK) {
        const local = document.getElementById('localSection');
        if (local) local.style.display = 'none';
    }
}

function hideAzureSection() {
    const az = document.getElementById('azureSection');
    const div = document.getElementById('loginDivider');
    if (az) az.style.display = 'none';
    if (div) div.style.display = 'none';
}

function showAzureError(msg) {
    const errEl = document.getElementById('azureError');
    const errMsg = document.getElementById('azureErrorMsg');
    if (errEl && errMsg) {
        errMsg.textContent = msg;
        errEl.classList.remove('hidden');
    }
}

// ── Handle successful auth response (popup or redirect) ──
function handleAuthResponse(response) {
    if (!response) return; // no auth happened (redirect returned nothing)
    const claims = response.idTokenClaims || {};

    // Extract user info from token claims
    const displayName = claims.name || claims.preferred_username || response.account?.username || 'משתמש Azure';
    const email = claims.email || claims.preferred_username || response.account?.username || '';
    const initials = displayName.charAt(0).toUpperCase();

    currentUser = { displayName, email, initials, source: 'azure', account: response.account };
    onLoginSuccess();
}

// ─────────────────────────────────────────────
//  Microsoft login button click
// ─────────────────────────────────────────────
document.getElementById('msLoginBtn').addEventListener('click', async () => {
    if (!msalInstance) {
        showAzureError('Azure AD לא מוגדר. עדכן את az-config.js עם CLIENT_ID ו-TENANT_ID.');
        return;
    }

    const btn = document.getElementById('msLoginBtn');
    const text = btn.querySelector('.btn-text');
    const spin = btn.querySelector('.btn-spinner');
    document.getElementById('azureError').classList.add('hidden');
    btn.disabled = true;
    text.classList.add('hidden');
    spin.classList.remove('hidden');

    const loginRequest = { scopes: AZ_CONFIG.SCOPES };

    try {
        if (AZ_CONFIG.LOGIN_METHOD === 'popup') {
            const response = await msalInstance.loginPopup(loginRequest);
            handleAuthResponse(response);
        } else {
            // redirect — page will reload, handleRedirectPromise catches it
            await msalInstance.loginRedirect(loginRequest);
            return; // page will reload
        }
    } catch (err) {
        // MSAL v3 cancellation / popup-closed codes — not alarming
        const cancelCodes = [
            'user_cancelled', 'userCancelledBrowserPopup',
            'popup_window_error', 'empty_window_error',
            'interaction_required',
        ];
        const isCancelled = cancelCodes.includes(err.errorCode) ||
            (err.message && err.message.toLowerCase().includes('user cancelled'));
        if (isCancelled) {
            toast('הכניסה בוטלה', 'info');
        } else {
            const msg = err.errorDescription || err.message || 'שגיאה לא ידועה';
            showAzureError(msg);
            toast('שגיאת כניסה: ' + msg, 'error');
            console.error('[SecureDocs] Login error:', err);
        }
    } finally {
        btn.disabled = false;
        text.classList.remove('hidden');
        spin.classList.add('hidden');
    }
});

// ══════════════════════════════════════════════
//  LOCAL FALLBACK LOGIN
// ══════════════════════════════════════════════

// Hide fallback section if not allowed
if (typeof AZ_CONFIG !== 'undefined' && !AZ_CONFIG.ALLOW_LOCAL_FALLBACK) {
    const localSection = document.getElementById('localSection');
    const loginDivider = document.getElementById('loginDivider');
    if (localSection) localSection.style.display = 'none';
    if (loginDivider) loginDivider.style.display = 'none';
}

// ══════════════════════════════════════════════
//  GOOGLE IDENTITY SERVICES
// ══════════════════════════════════════════════

// Decode a Google JWT ID token (no library needed — it's just base64)
function parseJwt(token) {
    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
    } catch { return {}; }
}

function showGoogleSection() {
    const el = document.getElementById('googleSection');
    if (el) el.style.display = 'block';
}

function showGoogleError(msg) {
    const errEl = document.getElementById('googleError');
    const errMsg = document.getElementById('googleErrorMsg');
    if (errEl && errMsg) {
        errMsg.textContent = msg;
        errEl.classList.remove('hidden');
    }
}

function initGoogle() {
    if (typeof GOOGLE_CONFIG === 'undefined' ||
        !GOOGLE_CONFIG.CLIENT_ID ||
        GOOGLE_CONFIG.CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
        console.warn('[SecureDocs] Google not configured — skipping.');
        return;
    }

    if (typeof google === 'undefined' || !google.accounts) {
        console.warn('[SecureDocs] Google Identity Services not loaded.');
        return;
    }

    try {
        // Initialize GIS with credential callback (One Tap + popup)
        google.accounts.id.initialize({
            client_id: GOOGLE_CONFIG.CLIENT_ID,
            callback: handleGoogleCredential,
            auto_select: false,
            cancel_on_tap_outside: true,
        });

        showGoogleSection();
        console.info('[SecureDocs] Google Identity Services ready.');
    } catch (err) {
        console.error('[SecureDocs] Google init failed:', err);
    }
}

// Called by GIS after the user picks a Google account
function handleGoogleCredential(response) {
    if (!response || !response.credential) {
        showGoogleError('לא התקבל אסימון מ-Google');
        return;
    }

    const claims = parseJwt(response.credential);
    const displayName = claims.name || claims.email || 'משתמש Google';
    const email = claims.email || '';
    const initials = displayName.charAt(0).toUpperCase();
    const picture = claims.picture || null;

    // Reset button state
    const btn = document.getElementById('googleLoginBtn');
    const text = btn.querySelector('.btn-text');
    const spin = btn.querySelector('.btn-spinner');
    btn.disabled = false;
    text.classList.remove('hidden');
    spin.classList.add('hidden');
    document.getElementById('googleError')?.classList.add('hidden');

    currentUser = { displayName, email, initials, picture, source: 'google', googleCredential: response.credential };
    onLoginSuccess();
}

// Google login button click
document.getElementById('googleLoginBtn').addEventListener('click', () => {
    if (typeof google === 'undefined' || !google.accounts) {
        showGoogleError('Google Identity Services לא נטען. בדוק חיבור לאינטרנט.');
        return;
    }
    if (typeof GOOGLE_CONFIG === 'undefined' || GOOGLE_CONFIG.CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
        showGoogleError('Google לא מוגדר. עדכן את google-config.js עם CLIENT_ID.');
        return;
    }

    const btn = document.getElementById('googleLoginBtn');
    const text = btn.querySelector('.btn-text');
    const spin = btn.querySelector('.btn-spinner');
    document.getElementById('googleError')?.classList.add('hidden');
    btn.disabled = true;
    text.classList.add('hidden');
    spin.classList.remove('hidden');

    // Trigger Google One Tap / popup flow
    google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            // One Tap was suppressed — fall back to explicit popup
            btn.disabled = false;
            text.classList.remove('hidden');
            spin.classList.add('hidden');
            if (notification.getNotDisplayedReason() === 'suppressed_by_user') {
                toast('כניסה עם Google בוטלה על ידי המשתמש', 'info');
            } else {
                // One Tap suppressed, try the FedCM / popup directly
                google.accounts.id.renderButton(
                    document.createElement('div'),
                    { theme: 'outline', size: 'large' }
                );
                toast('לחץ שוב לפתיחת חלון Google', 'info');
            }
        }
    });
});

document.getElementById('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const text = btn.querySelector('.btn-text');
    const spin = btn.querySelector('.btn-spinner');
    const errEl = document.getElementById('loginError');

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    errEl.classList.add('hidden');
    text.classList.add('hidden');
    spin.classList.remove('hidden');
    btn.disabled = true;

    setTimeout(() => {
        const user = LOCAL_USERS.find(u => u.username === username && u.password === password);
        if (user) {
            currentUser = { ...user, source: 'local' };
            onLoginSuccess();
        } else {
            errEl.classList.remove('hidden');
        }
        text.classList.remove('hidden');
        spin.classList.add('hidden');
        btn.disabled = false;
    }, 700);
});

// ── Shared post-login action ───────────────────
function onLoginSuccess() {
    const name = currentUser.displayName || 'משתמש';
    const initials = currentUser.initials || name.charAt(0).toUpperCase();
    document.getElementById('navUsername').textContent = name;
    document.getElementById('userAvatar').textContent = initials;
    const sourceTag =
        currentUser.source === 'azure' ? ' · Azure AD' :
            currentUser.source === 'google' ? ' · Google' : '';
    toast(`ברוך הבא, ${name}${sourceTag}!`, 'success');
    showScreen('dashboardScreen');
    refreshStats();
    renderHistory();
}

// Password toggle
document.getElementById('togglePassword').addEventListener('click', () => {
    const inp = document.getElementById('password');
    const icon = document.getElementById('eyeIcon');
    if (inp.type === 'password') {
        inp.type = 'text';
        icon.innerHTML = '<path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/>';
    } else {
        inp.type = 'password';
        icon.innerHTML = '<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>';
    }
});

// ── Logout ────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', () => {
    const wasAzure = currentUser?.source === 'azure';
    const wasGoogle = currentUser?.source === 'google';
    const account = currentUser?.account;
    currentUser = null;
    historyItems = [];
    formAttachments = [];
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('azureError')?.classList.add('hidden');
    document.getElementById('googleError')?.classList.add('hidden');
    showScreen('loginScreen');

    // Sign out from Azure AD
    if (wasAzure && msalInstance && account) {
        msalInstance.logoutPopup({ account }).catch(() => { });
    }

    // Revoke Google session
    if (wasGoogle && typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
    }
});

// ══════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel' + capitalise(btn.dataset.tab)).classList.add('active');
    });
});
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function switchTab(tabDataValue) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabDataValue));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel' + capitalise(tabDataValue)).classList.add('active');
}

// ══════════════════════════════════════════════
//  FORM TYPE SELECTOR
// ══════════════════════════════════════════════
document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.type-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
    });
});

// ══════════════════════════════════════════════
//  CHARACTER COUNTER
// ══════════════════════════════════════════════
const descTA = document.getElementById('description');
const charCountEl = document.getElementById('charCount');
descTA.addEventListener('input', () => {
    const len = descTA.value.length;
    charCountEl.textContent = len;
    charCountEl.style.color = len > 900 ? 'var(--orange)' : len >= 1000 ? 'var(--red)' : 'var(--text-3)';
    if (descTA.value.length > 1000) descTA.value = descTA.value.slice(0, 1000);
});

// ══════════════════════════════════════════════
//  FORM ATTACHMENTS (in the submission form)
// ══════════════════════════════════════════════
const formDropZone = document.getElementById('formDropZone');
const formFileInput = document.getElementById('formFileInput');

formDropZone.addEventListener('click', e => { if (e.target.tagName !== 'LABEL' && e.target.tagName !== 'INPUT') formFileInput.click(); });
formDropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') formFileInput.click(); });
formDropZone.addEventListener('dragover', e => { e.preventDefault(); formDropZone.classList.add('drag-over'); });
formDropZone.addEventListener('dragleave', () => formDropZone.classList.remove('drag-over'));
formDropZone.addEventListener('drop', e => { e.preventDefault(); formDropZone.classList.remove('drag-over'); handleFormFiles(e.dataTransfer.files); });
formFileInput.addEventListener('change', () => handleFormFiles(formFileInput.files));

function handleFormFiles(files) {
    Array.from(files).forEach(file => {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            toast(`הקובץ "${file.name}" אינו PDF ויתעלם`, 'error'); return;
        }
        if (file.size > 20 * 1024 * 1024) { toast(`הקובץ "${file.name}" גדול מ-20MB`, 'error'); return; }
        if (formAttachments.find(a => a.file.name === file.name && a.file.size === file.size)) { toast('קובץ זה כבר מצורף', 'info'); return; }
        const id = uid();
        formAttachments.push({ file, id });
        renderAttachments();
    });
    formFileInput.value = '';
}

function renderAttachments() {
    const list = document.getElementById('attachmentList');
    list.innerHTML = '';
    formAttachments.forEach(({ file, id }) => {
        const div = document.createElement('div');
        div.className = 'attachment-item';
        div.innerHTML = `
      <div class="attachment-file-icon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>
      </div>
      <div class="attachment-info">
        <div class="attachment-name">${file.name}</div>
        <div class="attachment-size">${fmtSize(file.size)}</div>
      </div>
      <button class="attachment-remove" data-id="${id}" title="הסר">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      </button>`;
        list.appendChild(div);
    });
    list.querySelectorAll('.attachment-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            formAttachments = formAttachments.filter(a => a.id !== btn.dataset.id);
            renderAttachments();
        });
    });
}

// ══════════════════════════════════════════════
//  SUBMISSION FORM — SUBMIT
// ══════════════════════════════════════════════
document.getElementById('submissionForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!validateForm()) return;

    const btn = document.getElementById('submitFormBtn');
    const text = btn.querySelector('.btn-text');
    const spin = btn.querySelector('.btn-spinner');
    btn.disabled = true;
    text.classList.add('hidden');
    spin.classList.remove('hidden');

    setTimeout(() => {
        const formType = document.querySelector('input[name="formType"]:checked').value;
        const typeLabels = { general: 'בקשה כללית', complaint: 'פנייה / תלונה', permit: 'בקשת אישור', report: 'הגשת דוח' };
        const ref = 'REF-' + uid();
        const entry = {
            id: uid(),
            type: 'form',
            ref,
            formType,
            formTypeLabel: typeLabels[formType] || formType,
            fullName: document.getElementById('fullName').value.trim(),
            idNumber: document.getElementById('idNumber').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            subject: document.getElementById('subject').value.trim(),
            priority: document.getElementById('priority').value,
            description: document.getElementById('description').value.trim(),
            attachments: formAttachments.map(a => ({ name: a.file.name, size: a.file.size, url: URL.createObjectURL(a.file) })),
            date: Date.now(),
        };
        historyItems.unshift(entry);
        refreshStats();
        renderHistory();

        // Reset
        document.getElementById('submissionForm').reset();
        formAttachments = [];
        renderAttachments();
        document.querySelectorAll('.type-card').forEach((c, i) => c.classList.toggle('active', i === 0));
        document.getElementById('charCount').textContent = '0';
        clearErrors();

        btn.disabled = false;
        text.classList.remove('hidden');
        spin.classList.add('hidden');

        // Success modal
        document.getElementById('successRef').textContent = `מספר אסמכתה: ${ref}`;
        document.getElementById('successModal').classList.remove('hidden');
    }, 1200);
});

document.getElementById('successClose').addEventListener('click', () => {
    document.getElementById('successModal').classList.add('hidden');
    switchTab('history');
});

// ── Form Validation ────────────────────────────
function validateForm() {
    clearErrors();
    let ok = true;

    const fullName = document.getElementById('fullName').value.trim();
    if (!fullName) { showErr('fullNameError', 'שדה חובה'); ok = false; }

    const idNum = document.getElementById('idNumber').value.trim();
    if (!idNum || !/^\d{7,9}$/.test(idNum)) { showErr('idNumberError', 'מספר ת.ז. חייב להכיל 7-9 ספרות'); ok = false; }

    const email = document.getElementById('email').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('emailError', 'כתובת דוא"ל לא תקינה'); ok = false; }

    const phone = document.getElementById('phone').value.trim();
    if (!phone || !/^[\d\-+\s]{9,15}$/.test(phone)) { showErr('phoneError', 'מספר טלפון לא תקין'); ok = false; }

    const subject = document.getElementById('subject').value.trim();
    if (!subject) { showErr('subjectError', 'שדה חובה'); ok = false; }

    const desc = document.getElementById('description').value.trim();
    if (desc.length < 10) { showErr('descriptionError', 'יש לספק תיאור של לפחות 10 תווים'); ok = false; }

    const decl = document.getElementById('declaration').checked;
    if (!decl) { showErr('declarationError', 'יש לאשר את ההצהרה להמשך'); ok = false; }

    return ok;
}

function showErr(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
function clearErrors() {
    ['fullNameError', 'idNumberError', 'emailError', 'phoneError', 'subjectError', 'descriptionError', 'declarationError'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '';
    });
}

// Clear form button
document.getElementById('clearFormBtn').addEventListener('click', () => {
    if (!confirm('האם ברצונך לנקות את הטופס?')) return;
    document.getElementById('submissionForm').reset();
    formAttachments = [];
    renderAttachments();
    document.querySelectorAll('.type-card').forEach((c, i) => c.classList.toggle('active', i === 0));
    document.getElementById('charCount').textContent = '0';
    clearErrors();
    toast('הטופס נוקה', 'info');
});

// ══════════════════════════════════════════════
//  DIRECT PDF UPLOAD (tab 2)
// ══════════════════════════════════════════════
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', e => { if (e.target.tagName !== 'LABEL' && e.target.tagName !== 'INPUT') fileInput.click(); });
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); uploadFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });

function uploadFiles(files) {
    const queue = document.getElementById('uploadQueue');
    queue.classList.remove('hidden');

    Array.from(files).forEach(file => {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            toast(`"${file.name}" — ניתן להעלות PDF בלבד`, 'error'); return;
        }
        if (file.size > 20 * 1024 * 1024) { toast(`הקובץ "${file.name}" חורג מ-20MB`, 'error'); return; }

        const itemId = uid();
        const item = document.createElement('div');
        item.className = 'queue-item';
        item.id = 'qi-' + itemId;
        item.innerHTML = `
      <div class="queue-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg></div>
      <div class="queue-info">
        <div class="queue-name">${file.name}</div>
        <div class="queue-meta">${fmtSize(file.size)}</div>
        <div class="queue-progress"><div class="queue-bar" id="bar-${itemId}" style="width:0%"></div></div>
      </div>
      <span class="queue-status status-uploading" id="qs-${itemId}">מעלה...</span>`;
        queue.appendChild(item);

        // Simulate upload progress
        let progress = 0;
        const bar = document.getElementById('bar-' + itemId);
        const status = document.getElementById('qs-' + itemId);
        const interval = setInterval(() => {
            progress += Math.random() * 30;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                bar.style.width = '100%';
                status.textContent = 'הועלה ✓';
                status.className = 'queue-status status-done';
                // Save to history
                const entry = { id: itemId, type: 'doc', name: file.name, size: file.size, url: URL.createObjectURL(file), date: Date.now() };
                historyItems.unshift(entry);
                refreshStats();
                renderHistory();
                toast(`"${file.name}" הועלה בהצלחה`, 'success');
                setTimeout(() => { const el = document.getElementById('qi-' + itemId); if (el) el.remove(); if (!queue.children.length) queue.classList.add('hidden'); }, 2000);
            } else {
                bar.style.width = progress + '%';
            }
        }, 250);
    });
}

// ══════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════
function refreshStats() {
    const forms = historyItems.filter(i => i.type === 'form').length;
    const docs = historyItems.filter(i => i.type === 'doc').length;
    const today = historyItems.filter(i => new Date(i.date).toDateString() === new Date().toDateString()).length;

    document.getElementById('statForms').textContent = forms;
    document.getElementById('statDocs').textContent = docs;
    document.getElementById('statToday').textContent = today;
    document.getElementById('tabHistoryBadge').textContent = historyItems.length;
}

// ══════════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════════
const priorityLabel = { low: 'נמוכה', normal: 'רגילה', high: 'גבוהה', urgent: 'דחופה' };
const priorityTagClass = { high: 'tag-priority-high', urgent: 'tag-priority-urgent' };

function renderHistory(filter = 'all', search = '') {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('emptyHistory');
    list.innerHTML = '';

    let items = [...historyItems];
    if (filter !== 'all') items = items.filter(i => i.type === (filter === 'form' ? 'form' : 'doc'));
    if (search) items = items.filter(i => {
        const hay = ((i.name || '') + (i.subject || '') + (i.fullName || '') + (i.ref || '')).toLowerCase();
        return hay.includes(search.toLowerCase());
    });

    empty.style.display = items.length ? 'none' : 'flex';

    items.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.style.animationDelay = (idx * 0.04) + 's';

        const isForm = item.type === 'form';
        const priorityTag = isForm && priorityTagClass[item.priority]
            ? `<span class="file-tag ${priorityTagClass[item.priority]}">${priorityLabel[item.priority] || ''}</span>`
            : '';
        const attachInfo = isForm && item.attachments?.length
            ? `<span>📎 ${item.attachments.length} נספחים</span>` : '';

        div.innerHTML = `
      <div class="file-thumb ${isForm ? 'form-thumb' : ''}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="${isForm
                ? 'M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75 1.84-1.83zM3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z'
                : 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z'}"/></svg>
      </div>
      <div class="file-meta">
        <div class="file-name">${isForm ? item.subject : item.name}</div>
        <div class="file-info">
          <span class="file-tag ${isForm ? 'tag-form' : 'tag-doc'}">${isForm ? '📝 ' + item.formTypeLabel : '📄 מסמך PDF'}</span>
          ${priorityTag}
          ${isForm ? `<span>${item.fullName}</span>` : `<span>${fmtSize(item.size)}</span>`}
          <span>${fmtDate(item.date)}</span>
          ${attachInfo}
        </div>
      </div>
      <div class="file-actions">
        <button class="btn-icon view-btn" data-id="${item.id}" title="${isForm ? 'פרטים' : 'צפה'}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
        </button>
        ${!isForm ? `<button class="btn-icon download-btn" data-id="${item.id}" title="הורד"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></button>` : ''}
        <button class="btn-icon del del-btn" data-id="${item.id}" title="מחק">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 000-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      </div>`;
        list.appendChild(div);
    });

    // Bind events
    list.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => {
        const item = historyItems.find(i => i.id === btn.dataset.id);
        if (!item) return;
        if (item.type === 'form') openFormDetail(item);
        else openPreview(item.url, item.name);
    }));
    list.querySelectorAll('.download-btn').forEach(btn => btn.addEventListener('click', () => {
        const item = historyItems.find(i => i.id === btn.dataset.id);
        if (!item) return;
        const a = document.createElement('a'); a.href = item.url; a.download = item.name; a.click();
    }));
    list.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', () => openDeleteModal(btn.dataset.id)));
}

// ── Search & Filter ────────────────────────────
document.getElementById('searchFiles').addEventListener('input', e => {
    renderHistory(document.getElementById('filterType').value, e.target.value);
});
document.getElementById('filterType').addEventListener('change', e => {
    renderHistory(e.target.value, document.getElementById('searchFiles').value);
});

// ══════════════════════════════════════════════
//  PREVIEW MODAL (PDF docs)
// ══════════════════════════════════════════════
function openPreview(url, name) {
    pendingPreviewUrl = url;
    pendingPreviewName = name;
    document.getElementById('modalTitle').textContent = name;
    document.getElementById('pdfPreview').src = url;
    document.getElementById('previewModal').classList.remove('hidden');
}
['modalClose', 'modalCloseBtn', 'modalBackdrop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => { document.getElementById('previewModal').classList.add('hidden'); document.getElementById('pdfPreview').src = ''; });
});
document.getElementById('modalDownloadBtn').addEventListener('click', () => {
    if (!pendingPreviewUrl) return;
    const a = document.createElement('a'); a.href = pendingPreviewUrl; a.download = pendingPreviewName; a.click();
});

// ══════════════════════════════════════════════
//  FORM DETAIL MODAL
// ══════════════════════════════════════════════
function openFormDetail(item) {
    const body = document.getElementById('formDetailBody');
    const pLabels = { low: 'נמוכה 🟢', normal: 'רגילה 🔵', high: 'גבוהה 🟠', urgent: 'דחופה 🔴' };
    const attachHTML = item.attachments?.length
        ? item.attachments.map(a => `<div class="detail-attach-item"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg><a href="${a.url}" target="_blank" style="color:var(--purple-light);text-decoration:none">${a.name}</a> <span style="color:var(--text-3)">(${fmtSize(a.size)})</span></div>`).join('')
        : '<span style="color:var(--text-3);font-size:.82rem">אין נספחים</span>';

    body.innerHTML = `
    <div class="detail-row"><span class="detail-label">אסמכתה:</span><span class="detail-value" style="color:var(--purple-light);font-weight:700">${item.ref}</span></div>
    <div class="detail-row"><span class="detail-label">סוג טופס:</span><span class="detail-value">${item.formTypeLabel}</span></div>
    <div class="detail-row"><span class="detail-label">שם מלא:</span><span class="detail-value">${item.fullName}</span></div>
    <div class="detail-row"><span class="detail-label">ת.ז.:</span><span class="detail-value">${item.idNumber}</span></div>
    <div class="detail-row"><span class="detail-label">דוא"ל:</span><span class="detail-value">${item.email}</span></div>
    <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-value">${item.phone}</span></div>
    <div class="detail-row"><span class="detail-label">נושא:</span><span class="detail-value">${item.subject}</span></div>
    <div class="detail-row"><span class="detail-label">עדיפות:</span><span class="detail-value">${pLabels[item.priority] || item.priority}</span></div>
    <div class="detail-row"><span class="detail-label">תיאור:</span></div>
    <div class="detail-desc">${item.description}</div>
    <div class="detail-row"><span class="detail-label">נספחים:</span></div>
    <div class="detail-attachments">${attachHTML}</div>
    <div class="detail-row"><span class="detail-label">תאריך הגשה:</span><span class="detail-value" style="color:var(--text-2)">${fmtDate(item.date)}</span></div>`;

    document.getElementById('formDetailModal').classList.remove('hidden');
}
['formDetailClose', 'formDetailCloseBtn', 'formDetailBackdrop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => document.getElementById('formDetailModal').classList.add('hidden'));
});

// ══════════════════════════════════════════════
//  DELETE MODAL
// ══════════════════════════════════════════════
function openDeleteModal(id) {
    const item = historyItems.find(i => i.id === id);
    if (!item) return;
    pendingDeleteId = id;
    document.getElementById('deleteFilename').textContent = item.subject || item.name;
    document.getElementById('deleteModal').classList.remove('hidden');
}
document.getElementById('deleteCancelBtn').addEventListener('click', () => {
    document.getElementById('deleteModal').classList.add('hidden');
    pendingDeleteId = null;
});
document.getElementById('deleteConfirmBtn').addEventListener('click', () => {
    if (!pendingDeleteId) return;
    historyItems = historyItems.filter(i => i.id !== pendingDeleteId);
    document.getElementById('deleteModal').classList.add('hidden');
    pendingDeleteId = null;
    refreshStats();
    renderHistory(document.getElementById('filterType').value, document.getElementById('searchFiles').value);
    toast('הפריט נמחק', 'info');
});

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
initMsal();

// Google GIS loads async — wait for it then init
if (document.querySelector('script[src*="accounts.google.com"]')) {
    const gisScript = document.querySelector('script[src*="accounts.google.com"]');
    if (typeof google !== 'undefined' && google.accounts) {
        initGoogle();
    } else {
        gisScript.addEventListener('load', initGoogle);
    }
}
