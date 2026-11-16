# CafePass — Code Review (October 2026)

Scope: the full `cafepass-main` codebase (about 23.7k lines of TypeScript, Prisma schema, SQL migrations, config).

## 1. Verification

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors (before and after changes) |
| Unit tests (`vitest`) | 162 / 162 pass (150 existing + 12 new in `tests/security.test.ts`) |
| ESLint (`npm run lint`) | 5 errors, 20 warnings (was 6 errors). Details in §5 |
| Prisma schema | Validates; types regenerated |
| `next build` | Not run in the review sandbox (Prisma engine downloads are blocked there). Check the Vercel build log after deploying. |

Prisma types were generated without the engine binary for the type check only. Run `npm install` and `npx prisma generate` locally to confirm.

## 2. Fixed in this pass

**Security**

- **Spoofable rate-limit IP** (`src/lib/security.ts`, used by `auth.ts`). `clientIp` took the *leftmost* `x-forwarded-for` entry, which the client controls. Any attacker could rotate fake IPs to bypass every IP-based limit (login, register, waitlist, invites). It now uses the rightmost entry, which the platform appends. Confirm on the live site with a test request that sends a made-up `X-Forwarded-For` value.
- **HTML injection in emails** (`src/lib/notify.ts`). Member names, café names, perk titles, plan names and the admin alert bodies were inserted into email HTML unescaped. Signup accepts any name, so a crafted name could inject links or markup into emails to the owner and other users. All of them are now escaped with `escHtml`, including the email heading.
- **CSV formula injection** (`src/app/api/admin/export/route.ts`). Cells starting with `= + - @` (or tab/CR) are now prefixed with `'`, so opening an export in Excel can no longer run a formula.
- **Google sign-in** (`src/app/api/auth/google/callback/route.ts`). A missing `email_verified` claim was treated as verified. It now requires `=== true`. The id_token is also checked for issuer, audience (this app's client ID) and expiry before it is trusted.
- **Waitlist abuse** (`src/app/api/waitlist/route.ts`). Each address can now be targeted at most twice a day, so the endpoint can't be used to spam an inbox with confirmation emails.
- **Register rate-limit key** now uses the lower-cased email, so case changes can't bypass the per-address limit.
- **Served photos** (`src/app/api/media/[id]/route.ts`) now send `X-Content-Type-Options: nosniff`.

**Correctness and performance**

- **Hourly visits chart** (`src/app/api/owner/analytics/route.ts`). It used server-local hours, which are UTC on Vercel, so the chart was three hours off Jordan time. It now uses UTC+3 explicitly.
- **Homepage stats** (`src/app/api/stats/route.ts`) are cached for 5 minutes instead of running four count queries on every page view.
- **Mobile hook** (`src/hooks/use-mobile.ts`) rewritten with `useSyncExternalStore`, the React-recommended way to read the viewport. It removes one lint error and keeps the same behavior.

## 3. Payments (on hold until a gateway is chosen)

Done in this pass:
1. **Student discount** no longer trusted from the browser. Student plans are refused server-side until a real verification step exists (`src/app/api/membership/route.ts`).
2. **Invitation code and membership are written in one transaction** under a per-member lock. A failed write no longer uses up the code, and two requests can't activate two plans at once.

These must be re-checked when the gateway is chosen (Stripe or other): webhook signature verification, idempotent activation, and server-side price lookup.

1. **Student discount is self-declared** (`src/app/api/membership/route.ts`). The client sends `studentVerified: true` and the server accepts it. Student verification must be checked on the server (for example, a verified student email domain or an uploaded card reviewed by an admin) before a student plan can be bought.
2. **Invitation code is consumed before the membership is written.** If the membership insert fails, the code is used up and the member gets nothing. Move the code claim and the membership write into one `db.$transaction`.
3. **Double-activation race.** Two simultaneous requests can both pass the "already active" check and create two active memberships. Use the same per-user advisory lock the redemption route already uses, or a transaction.

## 4. Data integrity

- **Deleting a café, perk or member wipes their redemption history.** Fixed in this pass: `Redemption` relations are now `Restrict` in `prisma/schema.prisma`, with the migration in `scripts/sql/2026-11-03-ledger-and-waitlist.sql`. Nothing in the code deletes these records today. `Redemption` → `Cafe`, `Perk` and `User` are `onDelete: Cascade` in `prisma/schema.prisma`. Redemptions are the audit trail for café payouts and member rewards. Recommended: change these three to `Restrict` (or `SetNull` for the member) with this migration, after confirming the constraint names in your database:

  ```sql
  ALTER TABLE "Redemption" DROP CONSTRAINT "Redemption_cafeId_fkey",
    ADD CONSTRAINT "Redemption_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "Redemption" DROP CONSTRAINT "Redemption_perkId_fkey",
    ADD CONSTRAINT "Redemption_perkId_fkey" FOREIGN KEY ("perkId") REFERENCES "Perk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ```

- **Waitlist emails were not unique.** Fixed in this pass (`@unique` plus the same migration file). `WaitlistEntry.email` has no unique constraint, so the "already on the list" check can race and create duplicates. Remove duplicates, then add the constraint:

  ```sql
  DELETE FROM "WaitlistEntry" a USING "WaitlistEntry" b WHERE a.email = b.email AND a.id > b.id;
  CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");
  ```

- **CSV exports are silently capped at 20,000 rows** (`take: 20000`). Not changed; fine for now, add pagination before the member base grows.

## 5. Remaining items

**Lint errors (5).** Each is `react-hooks/set-state-in-effect`. They are real patterns (syncing from the URL, a QR code, a map of API data) and changing them without a browser test risks hydration bugs, so they are left for a supervised change:
- `src/components/cafepass/views/AuthView.tsx:63` reads the reset token from the URL.
- `src/components/cafepass/views/CafeDetailView.tsx:76` resets state when the café slug changes.
- `src/components/cafepass/views/PassView.tsx:48` and `:58` (QR code and expiry timer).
- `src/components/ui/carousel.tsx:98` (Embla carousel sync).

**Other findings**

- **Caddyfile was an open port proxy** (`reverse_proxy localhost:{query.XTransformPort}`). Removed in this pass. Vercel does not use it.
- **Rate limiter fails open** (`lib/auth.ts`). If the database errors, limits stop applying. This is deliberate so sign-in is not blocked by an outage, but it means the limits are off during an outage. Accept consciously.
- **Login rate limit can lock out a victim.** Limits are per email, so someone can block a specific user from signing in for 5 minutes. Consider a softer per-email limit with a higher ceiling.
- **Blocking bcrypt calls** fixed in this pass: every request-time password hash and check now uses the async `bcrypt.hash` / `bcrypt.compare`.
- **Timezone helpers** (`lib/perks.ts`, `lib/campaigns/redemption.ts`, `lib/campaigns/analytics-core.ts`) mix local-time and UTC getters with `getTimezoneOffset()`. They are correct on a UTC server (Vercel), but wrong on any other server time zone. Replace with one `Intl.DateTimeFormat` helper for `Asia/Amman`.
- **Register ignored `invitationCode`.** Removed in this pass (invitations are redeemed through the membership screen).
- **No Content-Security-Policy header** (`next.config.ts`). Add one after testing it against your scripts, fonts and the Vercel analytics script.
- **Test coverage.** The 150 existing tests cover campaigns only. Auth, scanning, redemption and membership have no tests. Add integration tests for those first, since they handle money and access.
- **Clutter.** `examples/websocket/` and the empty `mini-services/` folder are leftover scaffolding. Two lockfiles exist (`bun.lock` and `package-lock.json`); keep one. `@types/bcryptjs` stub removed in this pass. The `dev` script pipes to `tee dev.log` (harmless, not changed).
- **Large view files.** `PartnerView.tsx` (893 lines), `OwnerCampaignsStudio.tsx` (802) and `CafeDetailView.tsx` (790) are hard to change safely. Split them when you next work in them.

## 6. Checked and found sound

- No secrets are committed to the repository.
- Every owner, admin, staff and scan route checks role, and owner routes check café ownership (no cross-tenant access found).
- Redemption is protected by a per-member advisory lock, and the daily and first-visit rules run inside it.
- Uploaded photos are validated by magic bytes, not the browser-supplied type.
- Tokens (verification, reset) are stored hashed, single-use, and redeemed atomically.
- Cron endpoints require `CRON_SECRET`.
- No raw SQL is built from user input (all queries use parameterized `$queryRaw` tagged templates).
