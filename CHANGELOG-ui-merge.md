# UI merge changelog (branch: ui-merge)

## Stage 1 — design system
Kept from cafepass: all backend, Prisma, auth, API routes, routing, views, PWA, deploy docs (untouched).
Taken from cafepassmanus: oat-paper / roast-ink / date-palm green / terra / gold palette, 18px radius, atlas shadow, warm focus ring, Manrope + Tajawal fonts.
Changes: globals.css tokens remapped (shadcn tokens now point at the palette; --cafe-* names kept so existing views inherit), warm dark theme, reduced-motion support, Arabic-first body font; layout.tsx fonts; pill Button + new `accent` variant; Card surface/shadow; manifest colors; two hardcoded teal shades in HomeView.
Compromise: Al Qabas kept for h1-h3 brand headings.

## Stage 2 — public shell + landing
Header/footer restyled on paper surfaces (taller header, terra accent sign-up button, deep-paper footer). Landing hero rebuilt as the Atlas editorial split (arch-top photo, live café count card) and a trust strip showing live cafés / members / redemptions / perks from /api/stats. Rest of the landing (cafés, plans, how-it-works, owner pitch, FAQ) already reads real data and inherits the new tokens. RTL handled with logical properties.
Not changed: navigation model (view-based, no new routes), copy/translations, logo files.

## Stage 3 — dashboards + scanner (styling only, no logic changes)
Shared role bar for pass/scanner/owner/admin (translated section name + user name). Pass card gets stamp-ring motif and gold hairline. Scanner: larger code field and button, stacked on mobile, bigger success icon, clearly tinted invalid state. New EmptyState component (icon + calm text) used on pass and scanner. All bg-card surfaces use the soft atlas shadow. API calls, QR validation/redemption, role guards untouched.
Known gap: the scanner "Demo tip" line is still hard-coded English (pre-existing); to be moved to i18n in Stage 4.

## Stage 4 — accessibility + Arabic polish
Audit: no physical left/right classes in the components (all logical, so RTL mirrors); no images missing alt text; no unlabeled icon-only buttons.
Fixed: muted text color darkened to pass 4.5:1 contrast on paper/card/deep-paper surfaces (was 3.9–4.3:1); trust-strip and hero-card labels now use that token; scanner demo tip moved into translations (EN + AR) and uses dir="auto"; focus ring and prefers-reduced-motion were added in Stage 1.
Compromises / not done: view-based navigation kept (no new /cafes, /plans URLs); the official CafePass wordmark PNG (teal/orange) is unchanged so the logo no longer matches the new green/terra palette exactly — a recolored logo file is needed from the brand owner.
Not verified in a real build here (sandbox blocks Prisma/Google Fonts downloads): `next build`, login flows, Arabic rendering on device.

## Stage 5 — dashboards rebuilt to match cafepassmanus
Member, Staff scanner, Café owner and Platform admin now use the Manus dashboard shell (left sidebar, top bar, editorial headings, metric cards, panels, tables) with real data. Dashboard CSS extracted from cafepassmanus into src/app/atlas-dashboard.css; shared DashboardFrame/PageHeading/MetricCard/Panel in components/cafepass/dashboard/parts.tsx. Public header/footer are hidden inside dashboards. All API calls, QR validation/redemption, role guards unchanged.
Known gap: on a phone the member page can scroll sideways slightly (activity table).

## Stage 6 — polish (branch ui-polish)
- Phone scrolling: member page no longer scrolls sideways (hidden table-header label escaped the scroll box; .table-scroll is now position: relative).
- Owner dashboard: "Recent member visits" table (masked member name, perk used, time, estimated saving). New `recent` field on /api/owner/analytics (additive); member names masked like the staff scanner.
- "Selected" badge on café cards (directory + landing) and the café page; short "By invitation" line under the owner pitch. Rule in src/lib/selected.ts (rating 4.7+ with a perk) — no database change. An admin-controlled flag would need a schema change.

## Stage 7 — perk rule + super-admin perk approval (branch perk-approval)
- Every listed café must offer at least one live perk (active + approved). Cafés without one are hidden from the directory, café page, homepage counts, and cannot be approved by the admin ("NO_LIVE_PERK").
- Cafés can have any number of perks (free cup, buy 4 get the 5th free, discounts...). Owner-created or owner-edited perks go to PENDING; the super admin approves/rejects them (new "Perks to review" panel, PATCH /api/admin/perks, audit-logged). Pausing/resuming needs no approval.
- Staff scanner and redemption only offer approved perks.
- DATABASE: adds one column, Perk.approvalStatus (default APPROVED, so existing perks are unaffected). Run `npx prisma db push` (without --accept-data-loss) BEFORE deploying this branch to production.

## Stage 8 — admin dashboard resilience (branch admin-fix)
The admin screen loaded five requests with Promise.all, so any single failure left the page blank. Each request is now independent; failures show an error panel naming the endpoint and the server's error text (Try again button). Admin GET routes return a readable SERVER_ERROR + detail instead of an empty 500.
