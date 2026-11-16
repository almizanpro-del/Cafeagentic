# Handoff — phone verification (WhatsApp OTP) + weekly perk cap

One branch: `phone-verification-weekly-cap`. One patch artifact:
`cafepass-phone-verification-and-weekly-cap.patch` — it includes the earlier
fraud-flags work (apply this one INSTEAD of `cafepass-fraud-flags.patch`).

## What it does

1. **Fraud flags (soft, never block the cashier)** — `GEO_IMPOSSIBLE`
   (same pass at two far-apart cafés too quickly for one person to travel)
   and `NEW_ACCOUNT_BURST` (account under 72 hours old with 3+ redemptions
   today). Both show on the scanner in English and Arabic and are written to
   the audit log (`agent_decisions`). Thresholds live in `agent_config`
   (`fraud.new_account_days` = 3, `fraud.new_account_max_day` = 3).
2. **WhatsApp phone verification** — member enters their number → gets a
   6-digit code on WhatsApp → enters it. **One verified phone = one account**
   (partial unique index in the database, not just app logic). Required before
   a membership is activated (invitation code today, payment later) — but ONLY
   when `PHONE_VERIFICATION_REQUIRED="true"` (default off).
3. **Weekly cap per perk** — the café sets an optional max uses per week
   (Sunday → Saturday, Jordan time, counts ALL members). Empty = no limit.
   Enforced at the scanner inside a per-perk advisory lock (two counters can
   never both take the week's last slot); the scanner perk list shows
   "weekly limit reached" (EN/AR) before staff attempt a doomed confirmation,
   and the perk dropdown shows "N of M left this week". The owner perk form
   has the new optional field; a cap change goes back for super-admin
   approval like other term changes. Campaign offers keep their own caps.

## Verified here (your agent ran it)

- `npx prisma validate` — schema parses.
- **Full test suite: 336 tests pass (20 files), 48 of them new** — phone
  formats (incl. Eastern-Arabic digits, 07/7/00962/+962 forms, junk
  rejection), code hashing/expiry/attempt limits, send-rate windows
  (5/15 min member, 3/hour phone, 20/15 min network, 60 s spacing),
  Sunday–Saturday week maths incl. month/year boundaries, cap rules, and
  both fraud flags (soft-only, 72 h boundary, override window).
- **`npm run build` — production build + type-check PASS** with the generated
  Prisma client. (The previous environment could not run this; four latent
  type errors were found and fixed: two missing `getConfig` imports in the
  agents code, a shadowed `verdict` in the campaign redemption path that
  mislabelled fraud audit rows, and `SessionUser` missing the phone fields.
  `/api/plans` + `/api/stats` are now `force-dynamic` — they are live-data
  routes and must never prerender at build time.)
- ESLint: the changed files are clean (the repo's remaining warnings/errors
  are pre-existing in files this patch does not touch).

## NOT verified here (needs a live deployment)

- A real WhatsApp message (needs your Meta template + credentials) — the
  notification log path and the "could not send" behaviour are covered by
  code review + unit tests only.
- The dialog on the plans page against a live DB, and a real scan against a
  real weekly cap. Test these on a preview deployment (steps below).

## Safe rollout order

1. Try everything on a COPY / branch database first.
2. Run `scripts/sql/2026-11-08-phone-verification-weekly-cap.sql` in the
   Supabase SQL editor (idempotent). It adds `User.phone`,
   `User.phoneVerifiedAt`, `Perk.weeklyCap` and the `PhoneVerification` table
   (RLS on, public REST roles revoked) plus the partial unique index that
   makes "one verified phone = one account" a database guarantee.
3. In Vercel set: `OTP_SECRET` (long random, `openssl rand -hex 32`).
   Meta: create a WhatsApp template with ONE variable for the code, e.g.
   "Your CafePass verification code is {{1}}. Valid for 10 minutes." (and an
   Arabic version). Set `WHATSAPP_OTP_TEMPLATE_NAME` to its name. If you use
   Meta's Authentication category, also set `WHATSAPP_OTP_AUTH_TEMPLATE="true"`.
   `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` must already be set.
4. Deploy with `PHONE_VERIFICATION_REQUIRED="false"`. Test end to end on a
   preview: send code, wrong code, expired code, resend, number already used
   by another account.
5. Only then set `PHONE_VERIFICATION_REQUIRED="true"`.
   Effect: anyone WITHOUT a verified number is asked to verify when they next
   try to activate/upgrade a membership. Members who already have an active
   membership are not cut off; they are asked at their next activation.

## Design notes / limits

- The code is never stored: only an HMAC keyed with `OTP_SECRET`
  (`src/lib/otp.ts`). The notification log stores "[verification code sent]"
  instead of the message.
- Limits: 5 sends / 15 min per member, 20 / 15 min per network address,
  3 / hour per phone number, 60 s between sends, 5 wrong tries per code, code
  valid 10 min. All windows are DB-backed (`PhoneVerification` rows double as
  the ledger) plus a coarse in-memory throttle per member.
- If WhatsApp is not really sent (no provider, template rejected), the member
  is told "could not send" instead of waiting for a code that never comes.
- Local development only (`NODE_ENV=development`, no WhatsApp configured): the
  code is returned in the response so the screen can be tested.
- Existing members: nothing happens to them until the flag is turned on.
- Weekly cap applies to normal perks; campaign offers keep their own caps.
- "Today" history for GEO_IMPOSSIBLE only covers the current Jordan day.
- Café coordinates must be correct; missing or (0,0) coordinates are skipped.
- Device fingerprinting and free-coffee-across-cafés rules are NOT part of
  this patch (free coffee stays once per member per café — Option A, agreed).

## Apply

    git checkout -b phone-verification-weekly-cap
    git apply cafepass-phone-verification-and-weekly-cap.patch
    npx prisma generate
    npm test
    npm run build
