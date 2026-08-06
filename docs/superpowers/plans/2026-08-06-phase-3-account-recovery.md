# Phase 3: Account Recovery + Invite Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the launch blocker of zero account recovery: forgot/reset/change password flows, a real invite email, a coach-triggered rescue reset, and profile↔auth email consistency.

**Architecture:** Password reset uses `supabaseAdmin.auth.admin.generateLink({ type: 'recovery' })` + the existing branded Resend service (no dependency on Supabase SMTP config), with the frontend posting the link's `token_hash` back to a new backend endpoint that verifies via GoTrue `verifyOtp` and sets the password with the admin client. Invite emails reuse the same `renderEmail`/`sendEmail` plumbing. All new endpoints follow the existing route patterns (rate limiters from `createRateLimiter`, masked errors, service-role-only DB access).

**Tech Stack:** Express, `@supabase/supabase-js` admin + anon clients, Resend via `backend/src/services/email.js`, React 19 + shadcn/ui.

## Global Constraints

- Locked invariants in `CLAUDE.md` (service-role-only backend, no client-trusted auth, soft-delete, no cross-deploy-boundary imports).
- No schema changes in this phase.
- Reset/forgot endpoints must not enumerate accounts beyond what the existing signup flow already reveals: unknown emails get the same 200 as known ones.
- Passwords: minimum 8 chars, matching the signup rule.
- Emails only via `services/email.js` (`configured()`, `sendEmail`, `renderEmail`, idempotency keys); when unconfigured, forgot-password returns 503 (server config state, not per-account state) and invite falls back to the existing "tell them manually" copy.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- Create: `backend/src/services/accountRecovery.js` — email builders + send helpers for reset and invite (single responsibility: recovery/invite email content and dispatch).
- Modify: `backend/src/middleware/rateLimits.js` — `forgotPasswordLimiter`, `resetPasswordLimiter`, `changePasswordLimiter`.
- Modify: `backend/src/routes/auth.js` — `POST /forgot-password`, `POST /reset-password`, `POST /change-password`.
- Modify: `backend/src/routes/clients.js` — invite email on `PATCH /:id/invite`, `POST /:id/send-password-reset`, auth-email sync in `PUT /:id`.
- Create: `backend/test/account-recovery.test.js` — mounted-route tests (require-cache stubs, auto-book-mounted style).
- Create: `frontend/src/pages/ForgotPassword.jsx`, `frontend/src/pages/ResetPassword.jsx`.
- Modify: `frontend/src/App.js` (routes), `frontend/src/pages/Login.jsx` (link), `frontend/src/pages/Signup.jsx` (email prefill), `frontend/src/components/layout/AppShell.jsx` (Change password dialog), `frontend/src/pages/coach/ClientDetail.jsx` (reset button + invite-email feedback).

### Task 1: Recovery/invite email service

**Interfaces (Produces):**
- `sendPasswordResetEmail({ email, name }, env?)` → generates a recovery link, emails it; throws on provider/link failure.
- `sendInviteEmail({ client, coachName }, env?)` → emails the signup link; throws on provider failure.

- [ ] Implement `backend/src/services/accountRecovery.js`:

```js
const { supabaseAdmin } = require('../supabase');
const { renderEmail, sendEmail } = require('./email');

// Recovery links come from GoTrue admin.generateLink — no email is sent by
// Supabase itself, so delivery always goes through the branded Resend path
// and works regardless of Supabase SMTP configuration.
async function sendPasswordResetEmail({ email, name }, env = process.env) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email });
  if (error) throw error;
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error('recovery link missing token');
  const resetUrl = `${env.FRONTEND_URL || ''}/reset-password?token=${encodeURIComponent(tokenHash)}`;
  const headline = 'Reset your CVF PT password';
  const rendered = renderEmail({
    headline,
    intro: `Hi ${String(name || '').split(' ')[0] || 'there'} — use the button below to choose a new password.`,
    actionLabel: 'Choose a new password',
    actionUrl: resetUrl,
    footer: 'This link expires after about an hour. If you did not request it, you can ignore this email.',
  });
  return sendEmail({ to: [email], subject: headline, ...rendered }, `password-reset/${tokenHash.slice(0, 24)}`, env);
}

async function sendInviteEmail({ client, coachName }, env = process.env) {
  const signupUrl = `${env.FRONTEND_URL || ''}/signup?email=${encodeURIComponent(client.email)}`;
  const headline = 'Your CVF PT account is ready to claim';
  const rendered = renderEmail({
    headline,
    intro: `${coachName} set up your Core Value Fitness training account. Sign up with this exact email address: ${client.email}.`,
    actionLabel: 'Claim your account',
    actionUrl: signupUrl,
    footer: 'If you were not expecting this, you can ignore this email.',
  });
  return sendEmail({ to: [client.email], subject: headline, ...rendered }, `invite/${client.id}/${client.updated_at}`, env);
}

module.exports = { sendInviteEmail, sendPasswordResetEmail };
```

### Task 2: Rate limiters

- [ ] Add to `backend/src/middleware/rateLimits.js` (patterns match existing limiters) and export:

```js
const forgotPasswordLimiter = createRateLimiter({
  identifier: 'auth-forgot-password', windowMs: 60 * 60 * 1000, limit: 5,
});
const resetPasswordLimiter = createRateLimiter({
  identifier: 'auth-reset-password', windowMs: 60 * 60 * 1000, limit: 10,
});
const changePasswordLimiter = createRateLimiter({
  identifier: 'auth-change-password', windowMs: 15 * 60 * 1000, limit: 10,
});
```

### Task 3: Auth endpoints

- [ ] `POST /api/auth/forgot-password { email }` — always `200 {ok:true}` for known and unknown emails; `503` when email service unconfigured; `502` when the provider rejects the send. Looks up an active coach by email, then an active *claimed* client (`auth_user_id not null`), both via escaped `ilike` (emails are stored lowercased but legacy case tolerated).
- [ ] `POST /api/auth/reset-password { token, password }` — password ≥8; `anonClient().auth.verifyOtp({ type: 'recovery', token_hash })`; invalid/expired → `400`; then `supabaseAdmin.auth.admin.updateUserById(user.id, { password })` → `200 {ok:true}`.
- [ ] `POST /api/auth/change-password { current_password, new_password }` — `requireAuth` + limiter; re-verifies the current password via `signInWithPassword(req.user.email, current_password)` (`401` on mismatch), then `updateUserById(req.user.authUserId, { password: new_password })`.

### Task 4: Client routes — invite email, rescue reset, email sync

- [ ] `PATCH /:id/invite`: after a successful `invited: true` update with an email present, `dispatchEmail(() => sendInviteEmail(...))` and include `invite_email: 'sent' | 'unconfigured'` in the response (never fail the toggle on email failure — `dispatchEmail` already swallows).
- [ ] `POST /:id/send-password-reset` (coach/admin, ownership via `loadClientOr404`): `400` if the client has not claimed their account or has no email; `503` if email unconfigured; otherwise `sendPasswordResetEmail` → `200 {ok:true}`.
- [ ] `PUT /:id`: when the email changes on a *claimed* client, first `updateUserById(auth_user_id, { email, email_confirm: true })`; "already registered" → `409`; keeps login email and profile email in lockstep.

### Task 5: Mounted-route tests (`backend/test/account-recovery.test.js`)

Stub `../src/supabase` (admin auth API + table chains), `../src/middleware/auth`, and `../src/services/email` via the require cache (auto-book-mounted pattern). Cases:
- [ ] forgot-password: known coach email → 200 + one reset email whose URL carries the generated token_hash
- [ ] forgot-password: unknown email → 200, zero emails (no enumeration)
- [ ] forgot-password: unconfigured email service → 503, generateLink never called
- [ ] reset-password: verifyOtp error → 400, updateUserById not called; short password → 400
- [ ] reset-password: valid token → updateUserById called with the new password → 200
- [ ] change-password: wrong current password → 401, no update; happy path → 200 with update
- [ ] invite toggle: response carries `invite_email: 'sent'`, invite email addressed to the client with the signup URL
- [ ] send-password-reset: unclaimed client → 400, no email; claimed → 200 + email
- [ ] PUT email change on claimed client calls auth email update; duplicate → 409

### Task 6: Frontend — pages, links, menu, coach UI

- [ ] `ForgotPassword.jsx`: auth-styled page (BrandBackdrop/Card like Login); email form → `api.post('/auth/forgot-password')`; success state replaces the form ("check your email"); 503 surfaces its server message.
- [ ] `ResetPassword.jsx`: reads `?token=`; no token → invalid-link state; password+confirm (≥8, match) → `api.post('/auth/reset-password')`; success state links to `/login`; 400 shows the expired-link message with a link to request a new one.
- [ ] `App.js`: public routes `/forgot-password`, `/reset-password`.
- [ ] `Login.jsx`: "Forgot password?" link (to `/forgot-password`) next to the password label.
- [ ] `Signup.jsx`: prefill email from `?email=` query param.
- [ ] `AppShell.jsx` UserMenu: "Change password" item + dialog (current/new/confirm, `saving` guard, toast on success) following the existing email-preferences dialog pattern.
- [ ] `ClientDetail.jsx`: invite toast reflects `invite_email` ("Invite email sent" vs. existing manual copy); claimed clients with email get a "Send password reset" action.
- [ ] `cd frontend && npm run build` passes.

### Task 7: Verify + ship

- [ ] `cd backend && npm test` all green (new tests included)
- [ ] Scoped commits (service+limiters+routes+tests; frontend), push, PR.

**⏸ OWNER CHECK-IN (ends Phase 3):** set/verify `RESEND_API_KEY`, `NOTIFY_REPLY_TO`, `FRONTEND_URL`, `CRON_SECRET` in Vercel backend env; approve email copy; run one real round-trip — invite a test client to a real inbox, claim the account, use "Forgot password", reset, log in. Also confirm the Supabase recovery-link expiry (default 1h) is acceptable.
