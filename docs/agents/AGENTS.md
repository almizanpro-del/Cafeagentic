# The Intelligent Agents — founder's guide

The agents are a small automatic team living inside CafePass. They watch
events (scans, signups, passing time), make simple decisions, and either act
(suggest a café, send a win-back message) or report to you (fraud blocks).
Every decision is recorded, and **you can overturn any of them** from the
admin dashboard: **Admin → Agents**.

This page explains what each agent does, the knobs you can turn, and the one
environment variable (`CRON_SECRET`) that makes the scheduled parts run.

---

## 1. The pieces

| Piece | What it is | Where it lives |
| --- | --- | --- |
| Event bus | A delivery table (`Event`). Anything interesting happens → a row is written. A dispatcher hands each event to the agents, retries failures with growing pauses, and dead-letters events that never succeed (you get pinged). | `src/lib/agents/bus.ts` |
| Agent 1 — Fraud prevention | Watches every scan. Blocks or soft-challenges patterns that look like abuse of the free welcome coffee: duplicate person (phone/device), impossible travel between cafés, brand-new accounts on a spree, velocity limits. | `src/lib/agents/fraud.ts` |
| Agent 2 — Café matcher | Ranks open partner cafés for a member: distance, opening hours, amenities (power/wifi/study/outdoor), usable perk right now, rating, and — once the member has a few visits — their own history. Explains each pick in EN/AR ("Open now, 5 min away, has power outlets"). | `src/lib/agents/matcher.ts`, `GET /api/cafes/recommend` |
| Agent 3 — Win-back | Daily pass over members who are cooling off (never redeemed / one visit then silent / 10–21 days quiet / pass ending soon with low usage) and sends **one** bilingual nudge with a concrete nearby café + current perk. Opt-in channels only, quiet hours respected, at most once per segment period. | `src/lib/agents/retention.ts` |
| Agent config | Every threshold above is a row in the `agent_config` table (or a default in code). Change values in **Admin → Agents** — they apply instantly, no redeploy. | `src/lib/agents/config.ts` |
| Decisions log | Every agent decision (block, challenge, send, skip) is written to `AgentDecision` so you can always answer "why did it do that?". | `src/lib/agents/decisions.ts` |
| Device signals | At signup and pass views we store a coarse fingerprint (hash of browser + language + rough network prefix). We never store the raw IP. Used only for duplicate-person detection. | `src/lib/agents/device.ts` |

### Rules the agents never break

1. **The cashier is never blocked by a soft flag.** Geo-impossible and
   new-account-burst show a polite bilingual banner and go to the audit log —
   the redemption still completes. Only hard signals (duplicate person,
   velocity caps) stop the scan, and staff see exactly why.
2. **Members are messaged only where they opted in.** WhatsApp is off by
   default; members manage consents, quiet hours and a weekly message cap on
   their pass screen (`PATCH /api/me/notifications`).
3. **Everything is bilingual.** Staff banners and member messages all come
   from EN/AR templates — no AI writes copy in v1.
4. **The human always wins.** Any fraud decision can be overridden in
   **Admin → Agents → Override**; the member can then re-scan within the
   override window and staff see an "approved by admin" banner.

---

## 2. Admin → Agents (the control room)

- **Health cards** — fraud blocks (7d), soft challenges (7d), win-back
  messages (7d), and event problems (retrying + dead).
- **Recent decisions** — the latest fraud decisions with reasons; **Override**
  turns a decision into `OVERRIDDEN` (audited, with your optional note).
- **Live settings** — every config key below with its effective value;
  changed rows are highlighted until you save.
- **Event bus** — the latest 30 events with status (`PROCESSED`, `PENDING`,
  `FAILED` with automatic retries, `DEAD` = gave up, you were notified).

---

## 3. Configuration keys

Defaults live in `AGENT_CONFIG_DEFAULTS` (`src/lib/agents/config.ts`); a row
in `agent_config` overrides a default. Recognised keys only (typos are
rejected by the admin API).

| Key | Default | Meaning |
| --- | --- | --- |
| `agents.enabled` | `true` | Master switch for the whole agent subsystem |
| `dispatcher.batch` | `25` | Events handled per dispatcher run |
| `dispatcher.max_attempts` | `5` | Retries before an event is dead-lettered |
| `dispatcher.alert_on_dead` | `true` | Ping the founder when an event dies |
| `fraud.enabled` | `true` | Agent 1 on/off |
| `fraud.first_visit_scope` | `global` | Welcome coffee once per person (`global`) or once per café (`per_cafe`) |
| `fraud.duplicate_check` | `phone_or_device` | Duplicate-person signals: `phone_or_device`, `phone_only`, `device_only`, `off` |
| `fraud.duplicate_action` | `hard_block` | `hard_block` or `soft_challenge` on duplicate hit |
| `fraud.max_per_hour` | `3` | Redemptions/hour before a velocity challenge |
| `fraud.max_per_day` | `6` | Redemptions/day before a velocity challenge |
| `fraud.geo_max_kmh` | `90` | Implied travel speed (km/h) that looks impossible |
| `fraud.geo_min_distance_km` | `2` | Below this distance the geo rule never fires |
| `fraud.new_account_days` | `3` | Account age (days) still considered new |
| `fraud.new_account_max_day` | `3` | Redemptions today allowed for a new account |
| `fraud.override_window_min` | `30` | Minutes an override stays valid for re-scans |
| `fraud.alert_admin` | `true` | Notify the founder on every blocked scan |
| `matcher.enabled` | `true` | Agent 2 on/off |
| `matcher.limit` | `5` | Results per recommendation request |
| `matcher.radius_km` | `10` | Radius filter (0 = whole city) |
| `matcher.cold_start_min_visits` | `3` | Visits before history affects ranking |
| `matcher.w.*` | see code | Weights: distance 3, open 4, amenity 2, preference 1.5, history 1, perk 2, rating 1 |
| `retention.enabled` | `true` | Agent 3 on/off |
| `retention.batch` | `100` | Members scanned per daily run |
| `retention.send_window` | `09:00-20:00` | Jordan-local window; per-member quiet hours still apply |
| `retention.<segment>.enabled` | `true` | Per-segment switches: `never_redeemed`, `one_then_silent`, `cooling_10_21`, `near_expiry` |

---

## 4. Scheduled runs (crons)

**Vercel Hobby plan = max two cron jobs, daily only.** Only two are declared
in `vercel.json`; the agent work piggybacks on them:

| Route | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/expiry-reminders` | 06:00 (09:00 Amman) | Pass expiry reminders + token cleanup **+ the agents' daily win-back pass (Agent 3)** |
| `/api/cron/campaign-lifecycle` | 21:00 | Campaign start/end transitions **+ a nightly event-bus dispatch kick** |

Standalone agent routes exist but are NOT scheduled on Hobby — hot paths
(scans, redemptions) dispatch events inline via `after()`, so real-time
agent behavior is unaffected. Enable the full schedule after a Vercel Pro
upgrade (add back to `vercel.json`):

| Route | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/agent-dispatcher` | every minute | Safety net: hands pending events to the agents with retry + backoff |
| `/api/cron/agent-retention` | 06:30 (09:30 Amman) | The daily win-back pass (already covered by the piggyback) |

**Required setup:** set `CRON_SECRET` (any long random string, e.g.
`openssl rand -hex 32`) in the Vercel project environment variables.
Vercel Cron then calls the routes with `Authorization: Bearer <CRON_SECRET>`
automatically. **Without it every cron returns 403 and the scheduled work
silently never runs.**

Alternative without Vercel Pro: schedule `/api/cron/agent-dispatcher` from
Supabase `pg_cron` with `pg_net` (`net.http_get`) using the same Bearer
header, or trigger it from any external uptime monitor. Idempotency
guarantees make double-runs harmless: replays no-op.

---

## 5. Event types

Emitted today:

- `redemption.completed` / `redemption.blocked` — from every scan (the fraud
  agent reacts to blocks; the idempotency key is member+café+reason+day, so
  at most one block alert per café per day per member).
- `retention.message.sent` — the win-back "claim" that guarantees exactly one
  message per member per segment period.

Reserved for the next phase (declared in `EVENT_TYPES`, not yet emitted):
`redemption.attempted`, `user.inactive_14d`, `cafe.performance_low`,
`offer.expiring`, `cafe.discovered`, `outreach.draft_ready` — the growth /
outreach agent (drafts for low-performing cafés) builds on these.

---

## 6. Privacy notes

- We never store raw IPs. The device fingerprint is a SHA-256 of user-agent +
  preferred language + a coarse network prefix (/24 IPv4, /48 IPv6) — weak on
  its own, useful combined with phone + timing.
- `PhoneVerification` rows keep only a hash of each code, expire in 10
  minutes, and are rate-limited.
- Notification preferences store consents with timestamps; opt-outs take
  effect immediately.
