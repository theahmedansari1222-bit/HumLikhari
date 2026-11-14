-- Run with `supabase test db` on a local development database.
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

begin;
select plan(36);

select has_table('public', 'profiles', 'public writer profiles exist');
select has_table('public', 'content_categories', 'content categories exist');
select has_table('public', 'content_topics', 'content topics exist');
select has_table('public', 'posts', 'posts and drafts share one table');
select has_table('public', 'post_likes', 'post likes exist');
select has_column('public', 'posts', 'like_count', 'feed like counts are stored on posts');
select has_column('public', 'posts', 'comment_count', 'feed comment counts are stored on posts');
select has_table('public', 'post_bookmarks', 'bookmarks exist');
select has_table('public', 'comments', 'comments exist');
select has_table('public', 'follows', 'follow graph exists');
select has_table('public', 'user_blocks', 'user blocks exist');
select has_table('public', 'notifications', 'notifications exist');
select has_table('public', 'content_reports', 'moderation reports exist');
select has_table('public', 'feedback_tickets', 'feedback tickets exist');
select has_table('public', 'writer_payment_options', 'writer payout methods exist');
select has_table('public', 'writer_support_claims', 'manual transfer claims exist');
select has_table('public', 'writer_badges', 'writer badges exist');
select has_view('public', 'post_feed_cards', 'feed card view exists');
select has_function('public', 'search_posts', array['text','text','text','integer','integer'], 'search RPC exists');
select has_function('public', 'replace_my_interests', array['text[]'], 'atomic interest replacement RPC exists');

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.posts'::regclass), 'posts has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.comments'::regclass), 'comments has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.writer_payment_options'::regclass), 'payment options have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.writer_support_claims'::regclass), 'support claims have RLS enabled');

select has_policy('public', 'posts', 'posts_public_read_anon', 'published posts are readable by guests');
select has_policy('public', 'post_likes', 'post_likes_read_own', 'users can only inspect their own like state');
select has_function('private', 'adjust_post_like_count', array[]::name[], 'like counter trigger is private');
select has_function('private', 'adjust_post_comment_count', array[]::name[], 'comment counter trigger is private');
select ok(not has_table_privilege('anon', 'public.post_likes', 'SELECT'), 'anonymous readers cannot enumerate who liked a post');
select has_policy('public', 'posts', 'posts_insert_own', 'users can only create posts as themselves');
select has_policy('public', 'posts', 'posts_update_own', 'users can only update their own posts');
select has_policy('public', 'notifications', 'notifications_read_own', 'notifications are private to recipients');
select has_policy('public', 'writer_payment_options', 'writer_payments_read_public_or_owner', 'payout options are owner-only unless explicitly public');
select ok(not has_function_privilege('anon', 'private.has_role(text[])', 'EXECUTE'), 'anonymous callers cannot invoke private role check');
select ok(has_function_privilege('authenticated', 'private.has_role(text[])', 'EXECUTE'), 'authenticated policy checks can invoke private role check');

select * from finish();
rollback;
