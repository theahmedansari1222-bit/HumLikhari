-- Behavioural tests for 20261113000000_security_hardening_and_app_support.sql
-- Run with `supabase test db`. Every scenario below was first reproduced as an exploit against the
-- original migrations; these tests keep the fixes from regressing.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

begin;
select plan(55);

-- ---------------------------------------------------------------- fixtures (run as owner)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.local', '{"name":"alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.local',   '{"name":"bob"}'),
  ('33333333-3333-3333-3333-333333333333', 'mod@test.local',   '{"name":"mod"}'),
  ('44444444-4444-4444-4444-444444444444', 'admin@test.local', '{"name":"admin"}'),
  ('55555555-5555-5555-5555-555555555555', 'dup1@test.local',  '{"name":"samename"}'),
  ('66666666-6666-6666-6666-666666666666', 'dup2@test.local',  '{"name":"samename"}');
insert into private.user_roles (user_id, role) values
  ('33333333-3333-3333-3333-333333333333', 'moderator'),
  ('44444444-4444-4444-4444-444444444444', 'admin');
update public.profiles set country_code = 'PK' where id = '22222222-2222-2222-2222-222222222222';
insert into public.posts (id, author_id, title, body, category_slug, topic_slug, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'alice post', 'plain body text', 'essay', 'life', 'published'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'alice second', 'second body', 'essay', 'life', 'published');
insert into public.comments (id, post_id, author_id, body) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bob comment');

-- signup trigger
select isnt((select username from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
            (select username from public.profiles where id = '66666666-6666-6666-6666-666666666666'),
            'two accounts with the same name both get a profile and distinct usernames');

-- ---------------------------------------------------------------- posts (F1, F2)
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select throws_ok($$insert into public.posts (author_id, title, body, category_slug, topic_slug, status, like_count)
  values ('22222222-2222-2222-2222-222222222222','forged','x','essay','life','published',999999)$$,
  '42501', null, 'a client cannot forge like_count on insert');
select throws_ok($$insert into public.posts (author_id, title, body, category_slug, topic_slug, status, published_at)
  values ('22222222-2222-2222-2222-222222222222','forged','x','essay','life','published','2099-01-01')$$,
  '42501', null, 'a client cannot forge published_at on insert');
select throws_ok($$insert into public.posts (author_id, title, body, category_slug, topic_slug, status)
  values ('22222222-2222-2222-2222-222222222222','born removed','x','essay','life','removed')$$,
  '42501', null, 'a client cannot create a post that is already removed');
select lives_ok($$insert into public.posts (author_id, title, body, category_slug, topic_slug, status)
  values ('22222222-2222-2222-2222-222222222222','bob draft','body','essay','life','draft')$$,
  'a user can create a draft');
select lives_ok($$update public.posts set status = 'published' where title = 'bob draft'$$,
  'a user can publish their draft');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select ok((select published_at is not null from public.posts where title = 'bob draft'),
  'published_at is stamped by the database');
select is((select like_count from public.posts where title = 'bob draft'), 0::bigint,
  'new post starts with zero likes');

-- moderator removes alice's post
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
set local role authenticated;
select lives_ok($$update public.posts set status = 'removed' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'a moderator can remove a post');
select throws_ok($$update public.posts set title = 'EDITED BY MOD' where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  '42501', 'staff_may_only_change_post_status', 'a moderator cannot rewrite a writer''s title');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::int from public.notifications where recipient_id = '11111111-1111-1111-1111-111111111111' and event_type = 'content_removed'),
  1, 'the writer is notified that their post was removed');
select is((select actor_id from public.notifications where event_type = 'content_removed' limit 1), null::uuid,
  'the removal notice does not expose which staff member acted');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;
update public.posts set status = 'published' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select status from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'removed',
  'the author can neither republish nor delete a removed post');

-- ---------------------------------------------------------------- comments (F5)
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
set local role authenticated;
select lives_ok($$update public.comments set status = 'hidden' where id = 'cccccccc-0000-0000-0000-000000000001'$$,
  'a moderator can hide a comment');
select throws_ok($$update public.comments set body = 'edited by mod' where id = 'cccccccc-0000-0000-0000-000000000001'$$,
  '42501', 'staff_may_only_change_comment_status', 'a moderator cannot edit comment text');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::int from public.notifications where recipient_id = '22222222-2222-2222-2222-222222222222' and event_type = 'content_removed'),
  1, 'the commenter is notified that their comment was hidden');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
update public.comments set status = 'visible' where id = 'cccccccc-0000-0000-0000-000000000001';
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select status from public.comments where id = 'cccccccc-0000-0000-0000-000000000001'), 'hidden',
  'a comment author cannot un-hide a moderated comment');

-- ---------------------------------------------------------------- profiles (F3, F4)
update public.profiles set is_active = false where id = '22222222-2222-2222-2222-222222222222';
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select throws_ok($$update public.profiles set is_active = true where id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', 'only_staff_may_change_account_status', 'a suspended user cannot reactivate themselves');
select throws_ok($$insert into public.posts (author_id, title, body, category_slug, topic_slug, status)
  values ('22222222-2222-2222-2222-222222222222','suspended post','x','essay','life','published')$$,
  '42501', null, 'a suspended user cannot publish');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
set local role authenticated;
select throws_ok($$update public.profiles set bio = 'defaced' where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', 'staff_may_only_change_account_status', 'a moderator cannot edit another user''s profile text');
select lives_ok($$update public.profiles set is_active = true where id = '22222222-2222-2222-2222-222222222222'$$,
  'a moderator can reactivate an account');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select is_active from public.profiles where id = '22222222-2222-2222-2222-222222222222'), true,
  'account is active again after staff action');

-- ---------------------------------------------------------------- reports (F7)
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select lives_ok($$insert into public.content_reports (reporter_id, target_type, post_id, reason)
  values ('22222222-2222-2222-2222-222222222222','post','aaaaaaaa-0000-0000-0000-000000000002','spam')$$,
  'a user can report a post');
select throws_ok($$insert into public.content_reports (reporter_id, target_type, post_id, reason)
  values ('22222222-2222-2222-2222-222222222222','post','aaaaaaaa-0000-0000-0000-000000000002','hate')$$,
  '23505', null, 'the same user cannot keep an open duplicate report on one post');
select throws_ok($$insert into public.content_reports (reporter_id, target_type, post_id, reason)
  values ('22222222-2222-2222-2222-222222222222','post',(select id from public.posts where title = 'bob draft'),'spam')$$,
  '22023', 'cannot_report_own_content', 'a user cannot report their own post');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
set local role authenticated;
update public.content_reports set status = 'dismissed', reviewed_by = '44444444-4444-4444-4444-444444444444'
  where reporter_id = '22222222-2222-2222-2222-222222222222' and reason = 'spam';
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select reviewed_by from public.content_reports where reporter_id = '22222222-2222-2222-2222-222222222222' and reason = 'spam'),
  '33333333-3333-3333-3333-333333333333'::uuid, 'reviewed_by is stamped from the session, not the request');

-- ---------------------------------------------------------------- social graph (F8)
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
insert into public.post_likes (post_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');
delete from public.post_likes where post_id = 'aaaaaaaa-0000-0000-0000-000000000002' and user_id = '22222222-2222-2222-2222-222222222222';
insert into public.post_likes (post_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');
insert into public.follows (follower_id, following_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
delete from public.follows where follower_id = '22222222-2222-2222-2222-222222222222';
insert into public.follows (follower_id, following_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::int from public.notifications where recipient_id = '11111111-1111-1111-1111-111111111111' and event_type = 'post_like'),
  1, 'like / unlike / like produces exactly one notification');
select is((select count(*)::int from public.notifications where recipient_id = '11111111-1111-1111-1111-111111111111' and event_type = 'new_follower'),
  1, 'follow / unfollow / follow produces exactly one notification');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select is((select count(*)::int from public.profile_stats('11111111-1111-1111-1111-111111111111')), 1, 'profile_stats returns one row');
select is((select followers_count from public.profile_stats('11111111-1111-1111-1111-111111111111')), 1::bigint, 'profile_stats counts followers');
delete from public.follows where following_id = '11111111-1111-1111-1111-111111111111';
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::int from public.follows where following_id = '11111111-1111-1111-1111-111111111111'), 0,
  'a writer can remove a follower');

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
insert into public.follows (follower_id, following_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.following_feed()), 1, 'following_feed shows the followed writer''s published posts');
insert into public.post_bookmarks (post_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.saved_posts()), 1, 'saved_posts returns bookmarked posts');
insert into public.user_blocks (blocker_id, blocked_id) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::int from public.follows), 0, 'blocking removes follow relationships');

-- ---------------------------------------------------------------- search / feed shape (F10)
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'post_feed_cards' and column_name = 'excerpt'),
  'feed cards expose an excerpt');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'post_feed_cards' and column_name = 'body'),
  'feed cards do not carry the full body');
set local role anon;
select is((select count(*)::int from public.search_posts('%')), 0, 'a literal % in a search is not a wildcard');
select is((select count(*)::int from public.search_posts('second body')), 1, 'body search still works');
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- ---------------------------------------------------------------- push devices (F6)
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select lives_ok($$select public.register_push_device(repeat('t', 40), 'android', 'shared phone')$$, 'first user registers a device');
select throws_ok($$insert into public.push_devices (user_id, device_token, token_fingerprint, platform)
  values ('11111111-1111-1111-1111-111111111111', repeat('z', 40), repeat('b', 64), 'android')$$,
  '42501', null, 'direct inserts into push_devices are closed; the RPC is the only way in');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select lives_ok($$insert into public.post_likes (post_id, user_id) values ((select id from public.posts where title = 'bob draft'),'22222222-2222-2222-2222-222222222222')$$,
  'author-side noise: self like is allowed');
reset role;
select set_config('request.jwt.claim.sub', '', true);
-- a notification for alice arrives while her device is registered, then bob logs in on the same phone
insert into public.notifications (recipient_id, event_type) values ('11111111-1111-1111-1111-111111111111', 'system');
select ok(exists (select 1 from public.push_deliveries where status = 'pending'), 'a notification queued a push delivery for the first user''s device');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select lives_ok($$select public.register_push_device(repeat('t', 40), 'android', 'shared phone')$$, 'a second user can take over the same device token');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select user_id from public.push_devices where token_fingerprint = encode(extensions.digest(convert_to(repeat('t', 40), 'UTF8'), 'sha256'), 'hex')),
  '22222222-2222-2222-2222-222222222222'::uuid, 'the device now belongs to the new user');
select is((select count(*)::int from public.push_deliveries where status = 'pending'), 0,
  'the previous owner''s queued pushes are cancelled, never delivered to the new owner');

-- ---------------------------------------------------------------- writer support claims
delete from public.user_blocks;   -- the earlier block scenario would (correctly) stop bob from supporting alice
insert into public.writer_payment_options (id, creator_id, method, bank_name, account_title, account_identifier, is_public, is_active)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'bank_transfer', 'Test Bank', 'Alice', 'PK00TEST0000000000000001', true, true);
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select lives_ok($$insert into public.writer_support_claims (sender_id, creator_id, payment_option_id, amount)
  values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','eeeeeeee-0000-0000-0000-000000000001',500)$$,
  'a reader can report that they sent support');
select throws_ok($$update public.writer_support_claims set status = 'creator_acknowledged' where sender_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', null, 'the sender cannot mark their own transfer as received');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select status from public.writer_support_claims where sender_id = '22222222-2222-2222-2222-222222222222'), 'sender_reported_sent',
  'the claim is still unverified after the sender''s attempt');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
update public.writer_support_claims set status = 'cancelled' where sender_id = '22222222-2222-2222-2222-222222222222';
reset role;
select set_config('request.jwt.claim.sub', '', true);
select is((select status from public.writer_support_claims where sender_id = '22222222-2222-2222-2222-222222222222'), 'cancelled',
  'the sender can cancel their own unacknowledged claim');

-- ---------------------------------------------------------------- platform accounts + analytics
insert into public.platform_donation_accounts (method, account_title, account_identifier) values ('easypaisa', 'Hum Likhari', '03000000000');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select is((select count(*)::int from public.platform_donation_accounts), 1, 'a signed-in user can read active platform donation accounts');
select throws_ok($$insert into public.platform_donation_accounts (method, account_title, account_identifier) values ('easypaisa','Fake','0300')$$,
  '42501', null, 'a normal user cannot add platform donation accounts');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
set local role authenticated;
select lives_ok($$insert into public.platform_donation_accounts (method, account_title, account_identifier) values ('jazzcash','Hum Likhari','03111111111')$$,
  'an admin can add a platform donation account');
select lives_ok($$select * from public.acquisition_source_counts()$$, 'staff can read acquisition counts');
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- ---------------------------------------------------------------- rate limit
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select lives_ok($test$do $b$ begin for i in 1..38 loop
  insert into public.posts (author_id, title, body, category_slug, topic_slug, status)
  values ('11111111-1111-1111-1111-111111111111', 'rl ' || i, 'x', 'essay', 'life', 'draft'); end loop; end $b$$test$,
  'a user can create posts at a normal pace');
select throws_ok($$insert into public.posts (author_id, title, body, category_slug, topic_slug, status)
  values ('11111111-1111-1111-1111-111111111111', 'one too many', 'x', 'essay', 'life', 'draft')$$,
  'P0001', 'rate_limited', 'the database rejects post flooding');
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
