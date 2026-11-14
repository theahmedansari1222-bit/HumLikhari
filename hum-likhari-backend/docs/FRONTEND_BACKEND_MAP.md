# Frontend → Backend map (v1.0.0-rc.1)

All calls go through `window.HLBackend` (the adapter, `integration/supabase-adapter.js`, identical copy in `hum-likhari-frontend/js/vendor/`). The frontend never calls `supabase-js` directly.

| UI area (file) | Adapter call(s) | Database object |
|---|---|---|
| Phone login (`auth.js`) | `auth.sendPhoneCode`, `auth.verifyPhoneCode` | Supabase Auth (SMS provider required) |
| Google login | `auth.signInWithGoogle` (PKCE, redirect = origin + path) | Supabase Auth |
| Session / sign-out | `auth.getSession`, `auth.onChange`, `auth.signOut` | Auth |
| Onboarding interests / survey | `onboarding.saveInterests`, `myInterests`, `submitAcquisitionSource`, `surveyDone` | `user_interests`, `onboarding_surveys` |
| Home feed, topics (`feed.js`) | `posts.feed`, `posts.followingFeed`, `labels.*` | `post_feed_cards` view, `following_feed` RPC |
| Search | `posts.search` | `search_posts` RPC |
| Article | `posts.get` | `post_feed_cards` + `posts` |
| Composer (`write.js`) | `posts.saveDraft`, `publish`, `drafts`, `mine`, `remove`, `uploadCover`, `discardCover`, `coverUrl` | `posts`, `post-covers` bucket |
| Likes / saves | `social.like/unlike/bookmark/unbookmark`, `myLikes`, `myBookmarkIds`, `posts.saved` | `post_likes`, `post_bookmarks`, `saved_posts` RPC |
| Follow / people | `social.follow/unfollow/followers/following/removeFollower/myFollowingIds` | `follows` |
| Block / report | `social.block/unblock/blockedUsers`, `social.report` | `user_blocks`, `content_reports` |
| Comments (`social.js`) | `comments.list/add/remove` (replies via `parent_id`) | `comments` |
| Notifications | `notifications.list/unreadCount/markRead/markAllRead` | `notifications` (created by triggers) |
| Profile (`profile.js`) | `profiles.mine/byId/byUsername/update/stats/badges`, `uploadAvatar/removeAvatar/avatarUrl` | `profiles`, `profile_stats` RPC, `avatars` bucket |
| Payment options | `writerSupport.myOptions/publicOptions/saveOption/qrUrl` | `writer_payment_options` (one per method), private `writer-payment-qr` bucket |
| Writer support claims (`payments.js`) | `writerSupport.createTransferClaim/history/acknowledgeReceived/cancelClaim` | `writer_support_claims` |
| Platform donation | `platformDonations.accounts/submit/mine` | `platform_donation_accounts`, `platform_donation_intents` |
| Help, tickets | `feedback.submit/mine/uploadAttachment`, `ticketMessages.list/add` | `feedback_tickets`, `feedback_ticket_messages` |
| Team / Blue Tick | `team.apply/mine`, `badges.apply/mine` | `volunteer_applications`, `badge_applications` |
| Push registration | `push.register` | `register_push_device` RPC |
| Delete account | `auth.deleteMyAccount` | `delete-account` Edge Function |

## Stable slugs

Categories: شاعری `poetry` · افسانہ `fiction` · کالم `column` · مضمون `essay` · سفرنامہ `travelogue`.
Topics: ادب `literature` · محبت `love` · سماج `society` · زندگی `life` · سفر `travel` · ٹیکنالوجی `technology`.
The database stores slugs only; labels are translated at the UI boundary (`HLBackend.labels`).

## Behaviour contracts the UI relies on

- Counters (`like_count`, `comment_count`, followers) come from the database; the UI updates optimistically and **rolls back** on error.
- Feed rows carry a 400-character excerpt; the full body is fetched when an article opens.
- "I sent it" creates a `sender_reported_sent` claim; it is never presented as verified payment.
- Payment options are private until the writer sets both `is_public` and `is_active`.
- Staff-removed content disappears from readers and the author receives a `content_removed` notification.
- Errors surface through `HLBackend.userMessage(error)` (Urdu text; `rate_limited`, offline and RLS errors are mapped).

## Historical (v0.2.0) limitations — all addressed
Local-state likes/follows/notifications, in-memory drafts, ignored `allow_support`, missing payout consent, fake "I sent" success, hard-coded counts, label-instead-of-slug persistence, and demo-only report/block/delete/feedback/login actions.
