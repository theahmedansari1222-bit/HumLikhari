# Changelog

## v1.0.0-rc.1 — release candidate

### Frontend (rewritten wiring, same look)
- Demo arrays removed. Every screen reads/writes through `HLBackend` (Supabase adapter v2): feed (tabs/categories, paging), search, article, comments (true replies), likes/bookmarks/follows with optimistic update + rollback, notifications, profile editor (avatar crop/upload, payment options), composer (cover image, drafts, server autosave, offline buffer), donate flow, writer-support claims (acknowledge/cancel), help/tickets with threads, team application, Blue Tick application, platform donation, block/unblock, report, account deletion.
- Robust async handling: loading/empty/error/offline states, busy-locks on every mutating button, keyed loaders with TTL, coalesced re-render, hash deep links, auto-escaping template tag (all user text is inert), CSP meta, `config.js` placeholders show a setup screen.
- supabase-js pinned to 2.119.0 (same as Edge Functions).

### Backend
- Migration `20261113000000_security_hardening_and_app_support.sql` (forward-only):
  F1 authors could republish a moderator-removed post · F2 forged counters/`published_at` on INSERT · F3 suspended user could reactivate themselves · F4 moderators could rewrite others' content/profiles · F5 comment author could un-hide a moderated comment · F6 device re-registration by a second user · F7 forged `reviewed_by/at` · F8 notification spam from like/unlike loops · F9 username race in signup trigger · F10 feed/search returned full bodies.
  New: `post_feed_cards` view, `search_posts`, `following_feed`, `saved_posts`, `profile_stats`, `register_push_device`/`unregister_push_device`, `acquisition_source_counts`, `platform_donation_accounts`, `notifications.ticket_id` + `content_removed`, one payment option per method per writer.
- pgTAP-style tests: 36 + 55 + 28 = 119.
- Edge Functions: shared strict CORS helper (explicit origin list); `delete-account` computes login freshness from `amr`/`last_sign_in_at` (Supabase tokens carry no `auth_time`, so the old check could never pass); `push-dispatch` authorises in code (admin session **or** `x-dispatch-secret`), leases rows to prevent double-sends, retries with back-off, disables dead tokens, generic lock-screen copy.

### Admin console
- Platform donation accounts editor, user search, role change by handle, ticket threads with internal notes, 50-row paging and status filters, aggregate acquisition RPC, no client-written review stamps, readable error messages, CSP, idle sign-out, no reload on token refresh.

### Tooling
- `scripts/validate.mjs`: adapter copies identical, no demo data, every `data-a` has a handler, CSP present, one pinned supabase-js version, CORS/verify_jwt contracts, no real keys in config files.
- Tests: Node (11), frontend e2e (21 scenarios), admin e2e (17 scenarios), DB (119).

## v0.2.0
Original preview + backend scaffold.
