---
name: pplcrm-feature-catalog
description: "The verified catalogue of every user-facing pplCRM feature — all experiences/modules, the geo/field-ops capabilities in depth, plan gating, and the list of genuinely-unusual-vs-generic-CRM claims. USE WHEN writing marketing/website/help copy about what the product does, planning a comparison or pitch, answering 'does pplCRM do X', or orienting in an unfamiliar feature area before grepping. EXAMPLES: 'what should the website highlight', 'does the product do event ticketing', 'list everything on the Movement plan'."
---

# pplCRM feature catalogue

Compiled 2026-08-12 by reading every experience directory, all nine help-article files, the
canvassing/deliveries/maps-geo/campaigns skills, `plans.ts`, and the boundary catalog. Every
claim below was verified in source on that date. **If you ship or remove a user-facing
feature, update this file in the same change** — a stale catalogue is worse than none.
Verify load-bearing specifics (numbers, gating) against the named source before quoting
them in new copy; the `pplcrm-website-claims` skill governs what the marketing site may say.

## Feature areas (one per `apps/frontend/src/app/experiences/*`)

| Area                      | What a user does there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| persons                   | People grid + profile: contact details, tags, issues, campaign standing (support level, voting status, yard sign, consent, DNC), tabs for household, connections, emails, donations, volunteer, events, activity.                                                                                                                                                                                                                                                                                                                                                                 |
| households                | People grouped at one address; address autocomplete, map pin, geocode status chip, every electoral area the address falls in, yard-sign card.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| companies                 | Employers/sponsors/partners with linked people; optional Google Places enrichment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| emails                    | Shared inbox over synced Gmail/Microsoft mail: folders, triage, assignment, comments, SLA pill, compose, attachments, Gmail-style keys.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| tasks                     | Task list + Kanban with assignee, due date, priority, SLA breach counting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| newsletters               | Drag-and-drop editor, built-in + 50 saved templates, audience = list + tag include/exclude, scheduling, deliverability score (<50 blocks, AI review every check), engagement report, resend-to-non-openers once.                                                                                                                                                                                                                                                                                                                                                                  |
| lists                     | Smart (self-refreshing rule) and static lists of people or households; rule builder with live count; rules include electoral areas AND activity history (days since last donation/knock/newsletter open/event/shift, dollars this year, active pledge — 2026-08-20); built-in undeletable All Subscribers / All Volunteers.                                                                                                                                                                                                                                                       |
| forms                     | Public web forms (Signup/Pledge/RSVP/Request/Survey), draft→published→archived, live edit + preview, embed/iframe/API, submissions link-not-overwrite existing people; optional yard-sign checkbox feeds the Deliveries request pool (2026-08-20).                                                                                                                                                                                                                                                                                                                                |
| fundraising               | Donation-page builder (separate from forms because it takes card payments).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| donations                 | Ledger, pledges (recurring), receipts + giving statements, record-a-gift. Stripe Connect: campaign's own Stripe account, merchant of record, 1% platform fee. Donor self-service portal (2026-08-22): tokenized public /g/:token page where a donor sees their own giving, downloads receipt PDFs, updates the card / amount / cancels their pledge, fixes their mailing address, manages newsletter consent, and can volunteer or request a yard sign; links ride receipt emails, staff send/revoke from the person record, public request-by-email page never confirms a match. |
| workflows                 | Automations: triggers (form, person created, tag, list join, donation, shift, event registration, yard sign delivered, campaign-date countdown, SLA breach, new un/subscriber, quiet supporter, manual) + steps (wait, email, tag, add-to-static-list, task, notify); goals; previous-email gating; relationship vs marketing mail declaration.                                                                                                                                                                                                                                   |
| events                    | Event pages with public registration and ticket tiers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| shifts                    | Volunteer shifts with public signup links; hours accrue on the profile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| canvassing                | Turf cutting, turf detail with live map, canvasser roster, printable walk sheet, field report + coverage map, survey settings. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| deliveries                | Yard-sign requests, preview-then-commit route planning, route detail with map, volunteer assignment + link sending. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| volunteer-access          | Approve/decline/revoke companion volunteers, per-volunteer turf roaming, QR join codes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| teams                     | Teams of volunteers/staff with their own members, lists, tasks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| tags                      | Tag + issue vocabularies: rename, merge, delete, issue ranking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| imports                   | CSV wizard (Upload→Map→Review→Import) for people/companies/households/tasks; history; crash-resume. Do NOT market numeric row caps (operator directive).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| exports                   | CSV export of any grid or selection, on every plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| duplicates                | Duplicate finder + merge for people/households/companies with confidence + reasons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| activity                  | Per-record activity tab; workspace-wide admin log (90 days, exportable); Log-an-interaction (call/knock/email/meeting).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| campaigns                 | Office context (permanent) + election campaigns (archived, never deleted); nine jurisdiction/seat columns; carry-over of support levels; per-jurisdiction vocabulary registry.                                                                                                                                                                                                                                                                                                                                                                                                    |
| users                     | Invites, roles viewer/editor/admin/owner, campaign assignment (server-enforced scoping incl. fetch-by-id), MFA requirement.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| settings                  | Workspace: modules, campaigns, boundaries, teams, duplicates, communications, email sync, domains, service levels, donations, deliveries, app, storage, billing, API keys. Personal: passkeys, sessions.                                                                                                                                                                                                                                                                                                                                                                          |
| profile / files / summary | Own profile; files + storage quota; dashboard with SLA health, getting-started, field-ops tiles (doors 7d, turf coverage, signs ready/delivered) and donated-this-month (2026-08-20).                                                                                                                                                                                                                                                                                                                                                                                             |
| go-live                   | Wizard out of demo mode: demo-data removal, plan, org details, phone verification, sending setup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| help                      | In-app searchable Help Center (source: `libs/common/src/lib/help/articles/*.ts`, shared with the website /docs mirror).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Separate app `apps/companion` (prod `go.pplcrm.com`): `/t/:token` canvass turf, `/r/:token`
delivery route, `/j/:code` QR join, `/a/:token` approve-by-text, `/o/:token` organizer page.

## Geo and field operations (the differentiators, verified in source)

- **Boundary catalog** (`libs/common/src/lib/boundaries/catalog/catalog.entries.ts`, generated):
  exactly six published maps — Canada federal ridings (Elections Canada, 2023, 343), Ontario
  provincial (Elections Ontario 2022, 124), Alberta provincial (Elections Alberta 2019, 87),
  US congressional (441), US state senate (1,960), US state house (4,874). **No municipal
  wards/precincts, no other provinces.** Four ways to a map: select published / import CSV
  district columns / upload GeoJSON (20 MB, 5,000 areas, 50,000 pts/area, 50 sets) / hand-draw
  with vertex snapping over your own geocoded pins. Meaning lives in a declared role
  (seat_area/subdivision/locality), never the name. Drawn maps are organizing-grade, never
  compliance-grade.
- **Turf cutting** (`apps/backend/.../canvassing/lib/cutting-engine.ts`, `turf-boundary.ts`):
  cuts along the finest voting-subdivision map for the campaign's office, else the seat map,
  else proximity-only turfs labelled "unbounded". A turf never crosses a line. Snake walk
  order (`libs/common/src/lib/geo/walk-order.ts`, shared by phone/CRM/paper). Presets
  30/40/50/60 doors (40 recommended). Unplaced doors reported, never dropped. Turf status
  derived from knocks (Needs canvassers / Links sent / Knocking now = knock in last 6h /
  Every door knocked / Retired). Refresh-from-list keeps knocks.
- **Walk sheet** (`experiences/canvassing/ui/turf-print-page.ts`): grayscale map + numbered
  dots + dashed route + list in walk order with blank result/notes columns + QR into the app;
  already-knocked doors print with results; schematic fallback without a Maps key.
- **Canvass companion**: no install/account — personal link + one-time code to the contact on
  file + one admin approval per volunteer. Street-at-a-time; prior support at the door;
  "somebody was already here" = 30 days across turfs (`RECENT_KNOCK_WINDOW_DAYS`); apartment
  building rows; offline queue with visible blocked list (never silently discards); survey
  side-effects (yard sign → delivery request, volunteer interest, DNC, deceased, error-in-data
  task); mark-sign-delivered closes the delivery stop; advisory street claims; end-shift
  revokes the device.
- **Deliveries** (`modules/deliveries`, `lib/routing/route-constants.ts`): preview-then-commit
  pure routing, no third-party API, ~60-min routes (52-min fill), 8 km outlier threshold,
  named leftover buckets; "routed" derived from live stops (partial unique index), never
  stored; volunteer page carries first name + address only; undo survives reload; undeliverable
  auto-returns to pool; links minted+sent (email+SMS) in the assignment transaction, 30-day
  expiry by default (workspace-switchable); yard-sign standing card on household + person.
- **Riding display**: `household_districts` one row per household per map — no level
  overwrites another; District column + per-map columns headed with the campaign's own word
  (riding/constituency/circonscription/ward/polling division — registry in
  `libs/common/src/lib/jurisdictions/`); smart-list rules filter on electoral areas; CSV
  export includes them.
- **Geocoding**: Google, background job in the write's transaction, per-tenant cache incl.
  negative results, daily budget (over-budget rows wait, never fail); boundary matching is
  free point-in-polygon on our servers; statuses Located / Locating… / Address problem /
  Not geocoded (= plan-gated, not broken).

## Plan gating (`plans.ts`: GATED_FEATURES, FEATURE_MATRIX, plan-gate.ts)

| Minimum plan | Features                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free         | Core CRM: people/households/companies unlimited, newsletters (1,000 subscribers, warm-up), imports/exports, dupes, tasks, activity, demo workspace. |
| Grassroots   | Forms, shared inbox, API/Zapier, donations, automations, lists, volunteer mgmt (teams/events).                                                      |
| Movement     | Canvassing, deliveries, companion volunteers (unlimited, no seats), real geocoding, data-region choice.                                             |

Gates block mutations only (reads stay open on downgrade) — except the inbox, which blocks
reads and purges synced mail 30 days after downgrade. Demo workspaces gate as Movement.
Metering is **emailable subscribers, not contacts**. Pricing: Free $0; Grassroots $29→$359
(≤1k→100k); Movement $55→$665 (≤1k→200k); annual = 10× monthly.

## Genuinely unusual vs a generic CRM (the marketing-grade list)

1. Turf cutting bounded by electoral lines by construction; "unbounded" honesty when no map.
2. Built-in checksummed catalog of six official boundary maps (Elections Canada / Ontario /
   Alberta / US Census) — selectable free; scope honestly stated.
3. Hand-drawn boundaries over your own pins with snapping + no-area/multi-area quality counts.
4. A household holds every electoral area at once (old + new redistricting side by side).
5. Vocabulary from a per-jurisdiction registry (Ontario ward = seat; Massachusetts ward =
   subdivision; both stored correctly).
6. Two account-less volunteer apps with a real trust model (code + one-time approval, hashed
   sessions, revoke-all-devices, QR join, approve-by-text).
7. Payload minimization at the door (delivery page: first name + address only; canvass payload
   never carries emails/phones/donations).
8. Derived-not-stored discipline: turf status, "routed", yard-sign standing all computed —
   a canvasser planting a sign closes the driver's stop and can complete the route.
9. Gap-free per-year receipt numbering in-transaction; cancel-and-replace corrections; CRA +
   federal/BC/AB/ON political regimes with Elections Ontario / Élections Québec carve-outs.
10. Geo cost honesty: geocoding metered/cached/gated; boundary matching free and re-runs freely.
11. Offline canvassing that never silently loses a knock (visible blocked list with reasons).
12. Walk sheet with a QR back into the app; mid-campaign prints skip finished doors.
13. One workspace, several levels of government (office context + campaigns, own vocab each).

## Where this is marketed (as of 2026-08-12)

Deep pages `/canvassing`, `/deliveries`, `/districts`; `/use-cases` hub + six walkthroughs;
`/compare` with three sourced named-competitor charts (see `compare-content.ts` rules);
plan grid on `/pricing` renders live from `FEATURE_MATRIX`. Copy constraints live in the
`pplcrm-website-claims` skill — read it before writing new claims.
