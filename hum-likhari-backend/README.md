# ہم لکھاری — Supabase Backend v1.0.0-rc.1

PostgreSQL schema، RLS، Storage policies، browser adapter (v2)، admin workflows، FCM push dispatcher، volunteer/badge/donation modules اور pgTAP ٹیسٹ۔ چاروں migrations حقیقی PostgreSQL 16 پر صاف لگتی ہیں اور 119 ٹیسٹ پاس ہیں (Supabase کی جگہ stub اسکیما اور سادہ pgTAP stand-in کے ساتھ)۔ اسے ابھی کسی حقیقی Supabase پروجیکٹ پر deploy/تصدیق نہیں کیا گیا — `../docs/DEPLOYMENT.md` دیکھیں۔

## Database migrations (اس ترتیب سے)

1. `supabase/migrations/20261110000000_initial_schema.sql`
   - profiles, categories/topics, posts/drafts, likes, bookmarks, comments, follows/blocks
   - notifications, reports, feedback tickets, acquisition survey, writer P2P payment options/claims, badges
2. `supabase/migrations/20261111000000_operations_and_growth.sql`
   - staff audit log, private push devices + push queue, feedback ticket messages
   - volunteer applications, badge applications, Pakistan-only platform donation intent ledger
   - admin/moderator status controls and team attachment storage
3. `supabase/migrations/20261112000000_admin_workflows.sql`
   - expanded notification events, staff-only acquisition analytics
   - atomic badge review RPC, tightly scoped admin user-role RPC
4. `supabase/migrations/20261113000000_security_hardening_and_app_support.sql`
   - fixes F1–F10 (`docs/SECURITY_MODEL.md`)، `post_feed_cards` view، `search_posts`، `following_feed`، `saved_posts`، `profile_stats`، `register_push_device`، `acquisition_source_counts`
   - `platform_donation_accounts` (admin-managed destination accounts)، rate limits، `content_removed` notifications، ticket links

ان migrations کو صرف fresh development database پر timestamp order میں validate کریں۔ Existing/prod database پر blind apply نہ کریں۔ چوتھی migration پچھلی تین کو نہیں بدلتی (forward-only)۔

## Main tables / workflows

| Feature | Storage |
|---|---|
| Profile | `profiles` |
| Posts and drafts | `posts` (`draft` / `published`) |
| Social graph | `follows`, `user_blocks` |
| Likes/bookmarks/comments | `post_likes`, `post_bookmarks`, `comments` |
| App notifications | `notifications` |
| Device push | `push_devices`, `push_deliveries` |
| Reports | `content_reports` |
| Help and feedback | `feedback_tickets`, `feedback_ticket_messages` |
| Team joining | `volunteer_applications` |
| Blue Tick / Featured Writer | `badge_applications`, `writer_badges` |
| Writer direct support | `writer_payment_options`, `writer_support_claims` |
| Platform donations | `platform_donation_intents` (manual Pakistan pilot only) + `platform_donation_accounts` (admin-managed) |
| Acquisition source | `onboarding_surveys` |
| Admin activity | `staff_audit_log`, private `user_roles` |

## Setup

### 1. Local Supabase

Install Docker and Supabase CLI. CLI command behavior can change, so inspect `supabase --help` and `supabase start --help` for the installed version.

```bash
cd hum-likhari-backend
supabase start
supabase test db
```

Run the migrations in timestamp order and then `supabase/seed.sql` as appropriate. Fresh local initialization via CLI applies migration history according to the installed CLI. Compare CLI's migration list with the repository before applying to a hosted project.

### 2. Providers

- Auth: configure Google OAuth client IDs, callback URL and allowed redirect URLs.
- Phone: configure a supported SMS provider, sender and rate limits; test international numbers and Pakistan delivery specifically.
- Storage: the migrations create buckets and RLS policies.
- API: ensure `public` is listed in the project's exposed Data API schemas. Table GRANTs and RLS are separate requirements.

### 3. First admin role

Use `scripts/bootstrap-first-admin.sql` only once in Supabase SQL Editor as project owner. Replace the UUID with a real `auth.users.id`. This script is never part of a browser/API endpoint. After bootstrapping, use admin console role management.

### 4. Browser adapter

`integration/supabase-adapter.js` (v2، classic script) پہلے supabase-js UMD **2.119.0** اور پھر adapter لوڈ ہوتا ہے:

```js
HLBackend.configure({ url: "https://YOUR_PROJECT.supabase.co", publishableKey: "sb_publishable_YOUR_KEY" });
```

گروپس: `auth, profiles, posts, social, comments, notifications, feedback, ticketMessages, writerSupport, onboarding, team, badges, platformDonations, push, admin`، نیز `labels`, `userMessage`, `UserError`, `LIMITS`۔ صارف ایپ میں اس فائل کی کاپی `hum-likhari-frontend/js/vendor/` میں ہے اور **دونوں یکساں رہنی چاہئیں** (`npm run validate` جانچتا ہے)۔ نقشہ: `docs/FRONTEND_BACKEND_MAP.md`۔

## Edge Functions

مشترکہ مددگار `_shared/http.ts` (CORS صرف `HUM_LIKHARI_ALLOWED_ORIGIN` کی فہرست کو؛ `*` نہیں) اور `_shared/freshness.ts`۔

### `delete-account`
تصدیق شدہ JWT، **15 منٹ کے اندر کا لاگ اِن** (newest `amr[].timestamp` / `last_sign_in_at` سے؛ Supabase ٹوکن میں `auth_time` نہیں ہوتا) اور صریح `confirm: "DELETE"` لازمی۔ avatars، post-covers، writer-payment-qr، feedback-attachments، team-applications کی فائلیں ہٹا کر auth صارف حذف کرتا ہے۔ صرف ڈسپوزیبل اکاؤنٹ پر آزمائیں۔

### `manage-user-role`
`public.manage_user_role` پر JWT-protected wrapper؛ اصل اجازت/تحریر private فنکشن میں۔ صرف admin کردار دے/لے سکتا ہے، اپنا admin کردار خود واپس نہیں لے سکتا، ہر تبدیلی audit میں۔

### `push-dispatch`
**دو طریقوں سے اجازت (کوڈ کے اندر)**: سائن اِن admin، یا شیڈیولر کا `x-dispatch-secret` (≥ 24 حروف، constant-time موازنہ)۔ اسی لیے `config.toml` میں `verify_jwt = false`۔ قطار کی ہر قطار پر 5 منٹ کی lease لگتی ہے (دہری ترسیل نہیں)؛ ناکامی پر exponential back-off، 8 کوششوں کے بعد منسوخ؛ `UNREGISTERED` ٹوکن بند۔ لاک اسکرین کا متن عمومی ہے۔ شیڈیولر کا SQL: `../docs/DEPLOYMENT.md`۔

Secrets: `FCM_SERVICE_ACCOUNT_JSON`، `HUM_LIKHARI_ALLOWED_ORIGIN`، `PUSH_DISPATCH_SECRET` (دیکھیں `supabase/.env.example`)۔ Supabase runtime کی قدریں (`SUPABASE_URL`، anon/publishable، service/secret key) خود مہیا ہوتی ہیں۔

`push_devices.device_token` صرف مالک کو نظر آتا ہے؛ `push_deliveries` صرف admin کو۔ Firebase/APNs کی کلائنٹ سائیڈ رجسٹریشن ایپ ٹیم کو مکمل کرنی ہے۔

## Admin panel

See `../admin/README.md`. It covers reports, feedback threads, volunteer applications, badge review, donation reconciliation, **platform donation accounts**, users/roles, acquisition stats, push dispatch and audit history. Admin panel uses only the publishable key in the browser; RLS/RPC enforces authorization.

## Money / donation boundaries

- `writer_support_claims` = sender says they transferred P2P money to a writer. It is not proof or automatic confirmation.
- `platform_donation_intents` = a Pakistan/PKR manual pilot record. It is not a checkout, wallet, payment gateway or automated reconciliation. Admin must inspect a real receipt/provider record before marking `confirmed`.
- Do not store bank passwords, PINs, OTPs, full card numbers or other credentials.
- App-store payment policy, Pakistan provider contracts, taxes, KYC and legal terms need a separate launch review before enabling actual payments.

## Tests

```bash
npm test                 # repository root: static checks + Node tests
cd hum-likhari-backend
supabase test db          # pgTAP: database_schema (36), hardening (55), operations (28)
```

119 ٹیسٹ حقیقی PostgreSQL 16 پر (Supabase stub اسکیما + سادہ pgTAP stand-in کے ساتھ) پاس ہو چکے ہیں؛ اصل `supabase test db` پر دوبارہ چلائیں۔ Static/ٹیسٹ، Supabase advisors، penetration ٹیسٹ اور پروڈکشن سکیورٹی جائزے کا متبادل نہیں۔
