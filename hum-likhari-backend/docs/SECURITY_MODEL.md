# Security model (v1.0.0-rc.1)

## Trust boundaries

- Browser: untrusted. It receives only the Supabase project URL and publishable key.
- Supabase Auth: owns identity, phone/email and sessions.
- `public` schema: Data API accessible only through explicit grants + RLS.
- `private` schema: role data and authorization helpers; do not expose it in Data API settings.
- Edge Functions: server-side only. Service/secret key is never sent to the browser.

## RLS rules in this scaffold

- Public profiles expose only intended profile fields; phone/email are never copied into `profiles`.
- Guests can read published posts and their visible comments. Drafts are author-only.
- A signed-in user's posts/comments are limited to their ownership for edits; moderators/admins can remove content.
- Likes/bookmarks/follows/blocks are created or removed by the acting user only.
- Notifications are visible only to their recipient.
- Reports and feedback are private to submitters and authorized staff.
- Writer payment methods are private and inactive by default. They become readable by others only after the writer explicitly sets both `is_public=true` and `is_active=true`.
- QR assets live in a private bucket. Read access is granted only for a writer's active public option or to the owner.
- Writer support records are manual sender claims; no client can mark a payment as provider-verified.
- Badges can only be assigned/revoked by an admin role.
- Admin, moderator and support-agent roles are stored in `private.user_roles`; never accept roles from user-editable auth metadata.

## Hardening done in v1.0.0-rc.1 (migration `20261113…`)

Each item was reproduced against the earlier migrations in a real PostgreSQL before it was fixed, and has a regression test in `supabase/tests/hardening.test.sql`.

| # | Exploit | Fix |
|---|---|---|
| F1 | Author republished a post a moderator had removed | author policies exclude `removed`; author cannot set `removed`/delete evidence |
| F2 | INSERT with forged `like_count`/`comment_count`/`published_at` | explicit column `GRANT`s on INSERT |
| F3 | Suspended user set `profiles.is_active = true` | `profiles_guard_update` trigger |
| F4 | Moderator rewrote another writer's title/body or another user's profile | guard triggers: non-authors may change `status` only |
| F5 | Comment author un-hid a moderator-hidden comment | comment guard trigger |
| F6 | A device token registered by user A could never be used by user B | `register_push_device` RPC reassigns and cancels stale deliveries |
| F7 | Any staff member could forge `reviewed_by/at` | `stamp_review` trigger writes them |
| F8 | Notification spam from like/unlike and follow/unfollow loops | de-duplicating notification triggers (rate limits via `private.enforce_rate_limit`, e.g. 40 posts/hour/author, are a separate addition) |
| F9 | Username race could abort signup | signup trigger never aborts on a username collision |
| F10 | Feed/search returned full bodies (up to 100 KB per row) | `post_feed_cards` view with `left(body, 400)` excerpt |

Edge Functions: `delete-account` previously required an `auth_time` claim that Supabase tokens do not carry, so deletion could never succeed (or, if a deployer "fixed" it by removing the check, any stolen session could delete an account). Freshness is now taken from the newest `amr[].timestamp` / `last_sign_in_at` (token refresh changes neither). `push-dispatch` accepts only an admin session or a `x-dispatch-secret` of ≥ 24 characters compared in constant time. CORS allows only the explicit origin list.

## Role bootstrap

No admin user is pre-created. After a trusted owner account is registered and verified, assign the initial admin through the Supabase SQL Editor using the real Auth user UUID:

```sql
insert into private.user_roles (user_id, role)
values ('REAL_AUTH_USER_UUID', 'admin');
```

Do not make this insert available to normal clients. The `private` schema must not be included in exposed Data API schemas.

## Payment safety

`writer_payment_options` is for writer-provided, deliberately public payment instructions. Publishing a bank identifier or QR means every eligible reader may access it. Explain this before the user turns on public visibility. The `writer_support_claims` table is not a ledger of verified transactions and must not drive accounting, revenue reporting or tax records as if money were confirmed.

Platform donations are deliberately not mixed with writer tips. `platform_donation_intents` is a Pakistan/PKR **manual** ledger: donors are shown admin-managed destination accounts (`platform_donation_accounts`, editable by admin only) and report what they sent; an admin marks `confirmed` only after checking a real receipt. There is no gateway, no automatic reconciliation and no card data. A real processor needs a separate provider/accounting/compliance design.

Wording rule enforced in the UI: wallets/banks are never described as "send from the wallet"; the app says "see how to send" and records only a sender-reported claim.

## Before production

- Run Supabase security and performance advisors on the actual project.
- Verify each RLS policy using anonymous, user A, user B, moderator and admin sessions.
- Confirm phone OTP anti-abuse/rate limits, SMS delivery and Google OAuth redirect configuration.
- Add CAPTCHA/rate-limits for public or high-volume endpoints where appropriate.
- Account deletion already requires a login within 15 minutes; consider MFA step-up as well.
- Enforce MFA for all staff accounts; do not rely on phone OTP alone for staff.
- Serve the app and the console with the HTTP headers in `docs/DEPLOYMENT.md` (`frame-ancestors`, HSTS, nosniff); self-host or SRI-pin supabase-js.
- Replace the placeholder privacy policy / terms in `js/content/static.js`.
- Confirm data retention, moderation appeals, privacy policy, financial information handling and applicable local/global legal requirements.
- Rotate any key accidentally committed to a repository.
