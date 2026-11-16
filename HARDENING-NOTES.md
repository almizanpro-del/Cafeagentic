# Hardening Pass — November 2026

Plain-English summary of this change set, written for the project owner.
Technical reviewers: each item names the file(s) it touched.

## What changed, and why it matters to you

### 1. Stability under real traffic (highest impact)
**File:** `.env.example`, `DEPLOYMENT.md`
The database connection setting `connection_limit=1` allowed only ONE query
path per server. The scanner and membership flows hold that slot for up to 10
seconds inside a transaction — so two cashiers scanning at the same time could
freeze every request on that server (`P2024` timeouts). Raised to 5.
**Action for you:** after merging, update `DATABASE_URL` in Vercel → change
`connection_limit=1` to `connection_limit=5`.

### 2. Session tokens are no longer stored "as-is" in the database
**Files:** `src/lib/auth.ts`, `src/lib/security.ts`, `tests/hardening.test.ts`
Previously a stolen database backup contained live login tokens that could be
replayed to sign in as anyone. Now only an unrecoverable SHA-256 fingerprint of
each token is stored; the usable token lives only in the user's secure cookie.
**Known consequence: every currently signed-in user is logged out ONCE after
this deploys.** They just sign in again. No data is lost.

### 3. Login lock-out abuse fixed
**File:** `src/app/api/auth/login/route.ts`
Before: 9 sign-in attempts (even successful ones) locked an email out for 5
minutes — a troll could keep any known customer from logging in. Now only
FAILED attempts count toward the per-email limit, while the brute-force
ceiling stays the same. Also: the fake-password hash used for timing
equalisation is now built on first use instead of slowing every server start.

### 4. Jordan day/month boundaries no longer depend on the server's clock setting
**Files:** `src/lib/perks.ts`, `src/lib/campaigns/redemption.ts`,
`src/lib/campaigns/analytics-core.ts`, `src/app/api/scan/redeem/route.ts`,
`src/lib/campaigns/instances.ts`, `tests/hardening.test.ts`
The "once per day" / "per month" rules and analytics day-keys were computed
with math that is only correct when the server runs in UTC. They now read the
Jordan (Asia/Amman) calendar directly via `Intl`, verified by tests that
simulate servers in UTC, Amman, India and Hawaii — all produce identical
results. Existing behaviour on Vercel (UTC) is unchanged.
**Note:** the perk/campaign *schedule-hour* checks still assume a UTC server
(Vercel's default) — documented in DEPLOYMENT.md.

### 5. Scanner fixes
**Files:** `src/app/api/scan/validate/route.ts`, `src/app/api/scan/redeem/route.ts`
- "Visits at this café" now counts only this café's redemptions (it silently
  counted all cafés that day).
- The redemption receipt email is sent *after* the response via Next's
  `after()`, so the cashier sees the result faster and the email is still
  delivered reliably.

### 6. Nightly cleanup of expired tokens (new)
**File:** `src/app/api/cron/expiry-reminders/route.ts`
Expired session / pass-code / email-token rows were never deleted and grew
forever. The existing nightly cron now purges them (and used-up email tokens
older than 30 days). Vercel's Hobby plan allows only two cron jobs, so this
rides on the existing 06:00 UTC run — no vercel.json change needed.

### 7. Service worker (offline mode) safety
**File:** `public/sw.js`
- Error/redirect pages are no longer cached (only `200 OK`).
- Signed-in app shells (`/pass`, `/staff`, `/business`, `/admin`) are never
  cached, so a shared device can't show the previous user's screen offline.
- URLs containing tokens (e.g. password-reset links `?resetToken=…`) are never
  written to the cache.

### 8. Small security hardening
- `me/pass` QR rotation now has a rate limit (was the only unthrottled
  mutating endpoint) — `src/app/api/me/pass/route.ts`.
- Admin campaign-rules: malformed JSON now returns a proper 400 instead of a
  crash — `src/app/api/admin/campaigns/rules/route.ts`.
- Google sign-in: the OAuth state cookie is cleared on failure paths too, the
  token-exchange error body is no longer logged, success logs moved off the
  error level and no longer contain the user's email — `src/app/api/auth/google/callback/route.ts`.
- Email button links are attribute-escaped (defence in depth) — `src/lib/notify.ts`.
- A Content-Security-Policy header ships in **report-only** mode: nothing is
  blocked yet, but violations become visible in the browser console so the
  policy can be tightened safely later — `next.config.ts`.

### 9. Database: safer schema + faster queries
**File:** `prisma/schema.prisma`
- New indexes: `Redemption(createdAt)` (admin review/export scans),
  `Notification(userId, event, createdAt)` (reminder cron), `Cafe(ownerId)`.
- The `CampaignEvent → CampaignInstance` foreign key is now declared in the
  schema. Before, it existed only in the database (created by hand-written
  SQL), so a future `prisma db push` would have silently DROPPED it.
**Action for you:** after merging, run `npx prisma db push` once (adds the
indexes; purely additive, no data loss). Also update the DATABASE_URL in
Vercel as in item 1.

### 10. Deployment guide made safe
**File:** `DEPLOYMENT.md`, `scripts/supabase-setup.sh`
- Step 3 no longer tells you to seed the production database, explains the
  demo-account risk, and gives SQL to CHECK for and delete any `@cafepass.jo`
  demo accounts. Step 5 now smoke-tests with real accounts.
- `supabase-setup.sh` no longer hardcodes a project ref and no longer seeds;
  it pushes the schema only.

### 11. Dead code and repo clutter removed
13 unused dependencies removed (verified zero imports):
`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@mdxeditor/editor`,
`@reactuses/core`, `@tanstack/react-query`, `@tanstack/react-table`,
`date-fns`, `framer-motion`, `next-intl`, `react-markdown`,
`react-syntax-highlighter`, `uuid` (+ `bun-types`). Smaller installs, smaller
bundles, smaller supply chain. `bun.lock` removed (project standardised on
npm/`package-lock.json`). `examples/`, `mini-services/`, `worklog.md`,
`.git-commit-msg.txt` deleted.

## Deliberately NOT changed (documented decisions)
- **Pass (QR) codes stay in plaintext** in the database: they expire in 10
  minutes, only grant perks, and hashing them would break multi-device QR
  display. Session tokens — the real risk — are hashed.
- **Register still answers `EMAIL_TAKEN`**: standard UX tradeoff; probing is
  capped at 20/hour/IP.
- **`x-real-ip` fallback kept** in `clientIp()`: on Vercel both it and the
  rightmost XFF entry are platform-set; no safety gain from switching.
- **Photos remain in Postgres** for now; moving to Supabase Storage is the
  biggest future performance win but needs a migration plan.
- **`admin/members` and `admin/invitations` still have no pagination** — fine
  at current size; add `take/skip` before the member base grows.
- **CSP stays report-only** until console reports are reviewed.

### 12. Review round 2 add-ons (independent audit follow-up)
- **Scanner validation is faster**: the four independent database reads in
  `POST /api/scan/validate` (perks, today's redemptions, campaign offers,
  loyalty progress) now run in one parallel batch — `src/app/api/scan/validate/route.ts`.
- **Café directory caching**: the public `GET /api/cafes` listing now carries a
  short CDN cache (`s-maxage=30, stale-while-revalidate=120`); its optional
  perk-type lookup runs in parallel with the main query. The per-café detail
  endpoint is intentionally NOT cached (it shows per-member first-visit state)
  — `src/app/api/cafes/route.ts`.
- **Photo uploads rate-limited**: `POST /api/owner/photos` now allows 20
  uploads/hour/owner (photo bytes are stored in Postgres) — `src/app/api/owner/photos/route.ts`.
- **Membership history protected**: `Membership.user` is now `onDelete:
  Restrict`, so removing a user can never silently erase their pass history
  (no code path deletes users today; this is a guard rail) — `prisma/schema.prisma`.

## After-merge checklist
1. Merge the branch → Vercel deploys automatically.
2. In Vercel → Settings → Environment Variables, edit `DATABASE_URL`:
   `connection_limit=1` → `connection_limit=5`. Redeploy.
3. Run once locally with production `.env`: `npx prisma db push`
   (adds indexes and tightens the Membership→User foreign key; purely additive,
   no data loss).
4. Expect: all users signed out once (item 2). Ask staff to sign in again.
5. In Supabase SQL editor, confirm no demo accounts:
   `SELECT email FROM "User" WHERE email LIKE '%@cafepass.jo';`
6. Watch the first nightly cron run — its JSON now includes a `cleanup` count.
