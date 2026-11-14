# Architecture and module boundaries (v1.0.0-rc.1)

## Workspaces

| Path | Role |
|---|---|
| `hum-likhari-frontend/` | User app. Static HTML/CSS and **classic scripts** (no bundler); RTL Urdu; 9 themes. |
| `hum-likhari-backend/` | Supabase: 4 forward-only migrations, RLS, storage rules, Edge Functions, pgTAP tests, browser adapter (`integration/supabase-adapter.js`). |
| `admin/` | Static staff console on its own origin. Publishable key + signed-in staff session; **RLS/RPC is the authorization layer**, the UI only hides what a role cannot use. |
| `integration/` | Manual smoke-test page that drives the adapter directly. |
| `design/` | Design preview of the app and of the console (what the code now contains). |
| `tests/`, `scripts/`, `.github/` | Node tests, static validator, Playwright e2e, CI. |

## Frontend structure

Load order is fixed in `index.html`: `config.js` → supabase-js → `vendor/supabase-adapter.js` → `core/*` → `content/static.js` → `ui/*` → `screens/*` → `core/events.js` → `core/boot.js`.

- **State**: a single object `S` (`core/state.js`). Screens are plain functions registered in tables: `R` (screen renderers), `L` (loaders), `ACT` (click actions, `data-a`), `INPUT` (`data-i`), `FILE` (`data-file`), `PARTIAL` (re-render while typing), `AFTER` (post-render hooks), `SHEET` (bottom-sheet renderers). Markup carries only `data-*`; behaviour lives in those tables (one delegated listener per event type).
- **Rendering**: tagged template `h\`\`` escapes every interpolation unless wrapped in `raw()`. User text is never concatenated into HTML.
- **Data**: `core/store.js` maps rows → view models (`mapPost`, `mapProfile`, …), caches by key with TTL (`fetchKey`), pages lists (`listLoad`), hydrates viewer flags (liked/saved/following) and performs optimistic like/save/follow with rollback.
- **Resilience**: every network action is wrapped in `guarded(key, el, fn)` (busy-lock + error toast); loaders have loading / empty / error+retry states; offline banner; composer keeps a localStorage buffer plus a debounced server draft that is serialised per composer so two saves never race.
- **Routing**: screen stack plus hash deep links (`#/post/<id>`, `#/u/<username>`), restored on reload.
- The two copies of the adapter (`backend/integration` and `frontend/js/vendor`) must be identical; `npm run validate` enforces it.

## Database migrations (apply in order, fresh database)

1. `20261110000000_initial_schema.sql` — profiles, taxonomy, posts/drafts, follows, blocks, likes, bookmarks, comments, notifications, reports, feedback, survey, writer P2P support, badges.
2. `20261111000000_operations_and_growth.sql` — staff audit, push devices/queue, ticket conversations, volunteer + badge applications, Pakistan platform-donation ledger, moderation grants.
3. `20261112000000_admin_workflows.sql` — notification event expansion, staff survey access, badge-review RPC, role-management RPC.
4. `20261113000000_security_hardening_and_app_support.sql` — fixes F1–F10 (see `CHANGELOG.md`), app-support views/RPCs, platform donation accounts, push-device RPCs, one payment option per method.

## Design rules

- RLS on every exposed `public` table; column-level `GRANT`s for writes; `BEFORE UPDATE` guard triggers for rules RLS cannot express (who may change which column).
- Security-definer functions always `set search_path = ''` and live in `private` unless deliberately public; roles live in `private.user_roles` (never in `user_metadata`).
- Counters, review stamps and timestamps are written by the database, not accepted from clients.
- Browser: only URL + publishable key. Service/secret keys and the Firebase service account exist only as Edge Function secrets.
- `writer_support_claims` = sender-reported P2P transfer, not proof. `platform_donation_intents` = Pakistan/PKR manual ledger, not a processor.
- Push: DB trigger queues deliveries → `push-dispatch` (admin session or scheduler secret) sends via FCM HTTP v1 with a row lease; FCM tokens are private to their owner; lock-screen text is generic.
- Edge Functions share `_shared/http.ts` (explicit CORS origin list, constant-time secret compare) and `_shared/freshness.ts` (login freshness from `amr`/`last_sign_in_at`; Supabase JWTs have no `auth_time`).
