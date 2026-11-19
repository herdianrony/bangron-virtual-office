# Security Architecture & Policies

## 1. Authentication & Session Management
- **Password Hashing:** `bcryptjs` with salt rounds = 12.
- **Session Storage:** SQLite-backed store with automatic expired session pruning.
- **Session Cookie:**
  - `name`: `bvo_session`
  - `httpOnly`: true (mitigating XSS extraction)
  - `sameSite`: 'lax' (or 'strict')
  - `secure`: true in production (disabled only for local HTTP development)
  - Session regeneration on login to prevent session fixation attacks.

## 2. Web Security Controls
- **Helmet:** Content Security Policy, X-Content-Type-Options, Frameguard (`DENY`), HSTS.
- **Rate Limiting:**
  - General API: 300 requests / 15 minutes.
  - Authentication `/api/auth/login`: 10 attempts / 15 minutes.
  - Webhooks `/api/integrations/hermes/events`: 1000 requests / minute with burst protection.
- **CSRF Defense:** Double-submit cookie or synchronizer token pattern for state-mutating requests (`POST`, `PATCH`, `DELETE`).
- **Input Validation:** Strict parsing with `Zod` or strong schema validation on all controllers.
- **Path Traversal Protection:** Deliverables downloads resolve safe paths strictly inside `storage/uploads` and reject `..` segments.

## 3. Webhook Security
- Raw body capture for HMAC-SHA256 signature calculation using `crypto.createHmac('sha256', secret)`.
- Constant-time comparison using `crypto.timingSafeEqual` prevents timing attacks.
- Replay protection enforces a 5-minute maximum drift on timestamps (`X-Hermes-Timestamp`).

## 4. Audit Logging
High-risk administrative events are written to the `audit_logs` table:
- User logins / failed login attempts
- Task cancellations and force-retries
- Director approvals and rejections
- System settings modifications
- Agent capability expansions
Sensitive secrets (passwords, webhook secrets, auth tokens) are masked and never persisted in audit tables or application log tails.
