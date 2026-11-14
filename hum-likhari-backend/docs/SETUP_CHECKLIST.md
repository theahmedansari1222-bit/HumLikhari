# Setup and verification checklist (v1.0.0-rc.1)

Full step-by-step: `../../docs/DEPLOYMENT.md`.

## Local/development

- [ ] Install the current Supabase CLI; check `supabase --help` first (CLI v3 changed local/hosted defaults in November 2026).
- [ ] Initialize/link a **development** project only.
- [ ] Apply all four migrations (`20261110…` → `20261113…`) to a fresh local database, in order.
- [ ] Run `supabase/seed.sql` and check Urdu categories/topics.
- [ ] Run `supabase test db` (3 files: schema 36, hardening 55, operations 28 tests).
- [ ] Check all expected tables have RLS enabled.
- [ ] Check project Data API exposes `public`; table/function privileges are granted by the migration.
- [ ] Configure Google OAuth provider and allowed callback URLs.
- [ ] Configure a production-grade SMS provider; verify OTP delivery to Pakistan and international test numbers.
- [ ] Test avatar, cover, payment QR and feedback attachment buckets with owner and non-owner accounts.
- [ ] Test account deletion with a disposable account: it must be refused if the last sign-in was > 15 minutes ago; after a fresh sign-in and typing DELETE, profile, posts, comments and storage files (avatars, post-covers, writer-payment-qr, feedback-attachments, team-applications) are removed.
- [ ] Set Edge Function secrets: `HUM_LIKHARI_ALLOWED_ORIGIN`, `FCM_SERVICE_ACCOUNT_JSON`, `PUSH_DISPATCH_SECRET`; schedule `push-dispatch` (pg_cron snippet in DEPLOYMENT.md).
- [ ] Add the real platform donation accounts in the admin console (Accounts section) and confirm they appear in the app.
- [ ] Verify the adapter's PostgREST embeds/filters against the real API (see "unverified" list in `docs/REVIEW_REPORT.md`).

## RLS matrix (must pass)

| Action | Guest | User A | User B | Moderator | Admin |
|---|---:|---:|---:|---:|---:|
| Read published posts | yes | yes, except blocked | yes, except blocked | yes | yes |
| Read another user's draft | no | no | no | yes via staff policy | yes |
| Edit own post | no | yes | yes | not by default | not by default |
| Edit another user's post | no | no | no | no | no |
| Delete reported post | no | no | no | yes | yes |
| Read own notifications | no | yes | yes | own only | own only |
| Read another user's notification | no | no | no | no | no |
| Read private payment option | no | owner only | owner only | no by default | no by default |
| Read active public payment option | yes | yes | yes | yes | yes |
| Submit feedback ticket | no | own | own | own | own |
| Review feedback | no | no | no | support role only | yes |
| Issue writer badge | no | no | no | no | yes |

## Production release gates

- [ ] SQL migration and pgTAP tests pass on a clean local database.
- [ ] Supabase security/performance advisors reviewed; no unresolved critical findings.
- [ ] No service/secret keys in frontend or Git history.
- [ ] Payment option UI includes explicit public disclosure consent.
- [ ] Writer support history uses `sender_reported_sent` language, not “verified/received”.
- [ ] Account deletion asks for explicit confirmation and recent authentication.
- [ ] Frontend error, loading, empty and offline states exercised against the real network (airplane mode, slow 3G, expired session).
- [ ] Placeholder legal text replaced; supabase-js self-hosted or SRI-pinned; HTTP security headers set.
- [ ] Backups and rollback plan recorded before production migrations.
