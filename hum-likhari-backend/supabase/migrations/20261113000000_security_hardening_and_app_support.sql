-- Hum Likhari — security hardening, logic fixes and app-support RPCs (v1.0.0-rc.1)
-- Apply AFTER 20261112000000_admin_workflows.sql. Forward-only: earlier migrations are untouched.
--
-- Fixes (each one was reproduced against the earlier migrations before being fixed):
--   F1  authors could republish a post a moderator had removed
--   F2  clients could INSERT posts with forged like_count / comment_count / published_at
--   F3  a suspended user could reactivate their own account (profiles.is_active)
--   F4  moderators could rewrite another writer's title/body and another user's profile fields
--   F5  a comment author could un-hide a comment that a moderator hid
--   F6  one physical device could not be re-registered by a second user (global unique token)
--   F7  review metadata (reviewed_by / reviewed_at) could be forged by any staff member
--   F8  duplicate notification spam from like/unlike and follow/unfollow loops
--   F9  username race in the signup trigger could abort account creation
--   F10 feed/search returned full post bodies (up to 100 KB per row)
begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- F2 + F1. Posts: explicit INSERT columns, author cannot touch removed posts,
-- author cannot set status 'removed', author cannot delete evidence of a removal.
-- ---------------------------------------------------------------------------
revoke insert on public.posts from authenticated;
grant insert (author_id, title, body, category_slug, topic_slug, status, allow_support, cover_image_path)
  on public.posts to authenticated;

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.is_active_user())
  and status in ('draft', 'published')
);

drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts
for update to authenticated
using (author_id = (select auth.uid()) and status <> 'removed')
with check (
  author_id = (select auth.uid())
  and (select private.is_active_user())
  and status in ('draft', 'published', 'archived')
);

drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts
for delete to authenticated
using (author_id = (select auth.uid()) and status <> 'removed');

-- ---------------------------------------------------------------------------
-- F4 (posts). Staff who are not the author may change `status` only.
-- ---------------------------------------------------------------------------
create or replace function private.guard_post_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return new; end if;               -- service role / SQL editor / internal
  if new.author_id is distinct from old.author_id then
    raise exception 'author_is_immutable' using errcode = '42501';
  end if;
  if v_uid <> old.author_id and private.has_role(array['admin', 'moderator']::text[]) then
    if (new.title, new.body, new.category_slug, new.topic_slug, new.allow_support, new.cover_image_path)
       is distinct from
       (old.title, old.body, old.category_slug, old.topic_slug, old.allow_support, old.cover_image_path) then
      raise exception 'staff_may_only_change_post_status' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_post_update() from public, anon, authenticated;
create trigger posts_guard_update before update on public.posts
for each row execute function private.guard_post_update();

-- ---------------------------------------------------------------------------
-- F5 + F4 (comments). Authors edit only visible comments and cannot change status.
-- ---------------------------------------------------------------------------
drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
for update to authenticated
using (author_id = (select auth.uid()) and status = 'visible')
with check (author_id = (select auth.uid()) and status = 'visible' and (select private.is_active_user()));

create or replace function private.guard_comment_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return new; end if;
  if (new.post_id, new.author_id, new.parent_id) is distinct from (old.post_id, old.author_id, old.parent_id) then
    raise exception 'comment_links_are_immutable' using errcode = '42501';
  end if;
  if v_uid <> old.author_id and private.has_role(array['admin', 'moderator']::text[]) then
    if new.body is distinct from old.body then
      raise exception 'staff_may_only_change_comment_status' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_comment_update() from public, anon, authenticated;
create trigger comments_guard_update before update on public.comments
for each row execute function private.guard_comment_update();

-- ---------------------------------------------------------------------------
-- F3 + F4 (profiles). Only staff (never the user themself) change is_active;
-- staff touching another user's profile may change nothing else.
-- ---------------------------------------------------------------------------
create or replace function private.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return new; end if;
  if new.is_active is distinct from old.is_active then
    if v_uid = old.id or not private.has_role(array['admin', 'moderator']::text[]) then
      raise exception 'only_staff_may_change_account_status' using errcode = '42501';
    end if;
  end if;
  if v_uid <> old.id then
    if (new.username, new.display_name, new.bio, new.avatar_path, new.country_code, new.locale)
       is distinct from
       (old.username, old.display_name, old.bio, old.avatar_path, old.country_code, old.locale) then
      raise exception 'staff_may_only_change_account_status' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_update() from public, anon, authenticated;
create trigger profiles_guard_update before update on public.profiles
for each row execute function private.guard_profile_update();

-- ---------------------------------------------------------------------------
-- F7. Review stamps are written by the database, never accepted from the client.
-- ---------------------------------------------------------------------------
create or replace function private.stamp_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return new; end if;
  if new.status is distinct from old.status or new.staff_note is distinct from old.staff_note then
    new.reviewed_by := v_uid;
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_review() from public, anon, authenticated;
create trigger content_reports_stamp_review before update on public.content_reports
for each row execute function private.stamp_review();
create trigger volunteer_applications_stamp_review before update on public.volunteer_applications
for each row execute function private.stamp_review();
create trigger badge_applications_stamp_review before update on public.badge_applications
for each row execute function private.stamp_review();
create trigger platform_donations_stamp_review before update on public.platform_donation_intents
for each row execute function private.stamp_review();

-- Support tickets: the assignee is always the staff member who handled the ticket.
create or replace function private.stamp_ticket_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return new; end if;
  if private.has_role(array['admin', 'support_agent']::text[]) then
    new.assigned_to := v_uid;
  else
    new.assigned_to := old.assigned_to;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_ticket_assignee() from public, anon, authenticated;
create trigger feedback_tickets_stamp_assignee before update on public.feedback_tickets
for each row execute function private.stamp_ticket_assignee();

-- ---------------------------------------------------------------------------
-- Rate limits (database-level, cannot be bypassed from the client).
-- trigger arguments: max rows, window, owner column
-- ---------------------------------------------------------------------------
create or replace function private.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := tg_argv[0]::integer;
  v_window interval := tg_argv[1]::interval;
  v_column text := tg_argv[2];
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null or private.has_role(array['admin', 'moderator', 'support_agent']::text[]) then
    return new;
  end if;
  execute format('select count(*) from %I.%I where %I = $1 and created_at > now() - $2',
                 tg_table_schema, tg_table_name, v_column)
    into v_count using v_uid, v_window;
  if v_count >= v_limit then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'too_many_requests';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_rate_limit() from public, anon, authenticated;
create trigger posts_rate_limit before insert on public.posts
  for each row execute function private.enforce_rate_limit(40, '1 hour', 'author_id');
create trigger comments_rate_limit before insert on public.comments
  for each row execute function private.enforce_rate_limit(30, '10 minutes', 'author_id');
create trigger reports_rate_limit before insert on public.content_reports
  for each row execute function private.enforce_rate_limit(20, '1 day', 'reporter_id');
create trigger feedback_rate_limit before insert on public.feedback_tickets
  for each row execute function private.enforce_rate_limit(10, '1 day', 'user_id');
create trigger donations_rate_limit before insert on public.platform_donation_intents
  for each row execute function private.enforce_rate_limit(10, '1 day', 'donor_id');
create trigger support_claims_rate_limit before insert on public.writer_support_claims
  for each row execute function private.enforce_rate_limit(30, '1 day', 'sender_id');

-- Reports: one open report per reporter per target; a user cannot report their own content.
create unique index content_reports_open_post_uidx on public.content_reports (reporter_id, post_id)
  where post_id is not null and status in ('received', 'in_review');
create unique index content_reports_open_comment_uidx on public.content_reports (reporter_id, comment_id)
  where comment_id is not null and status in ('received', 'in_review');
create unique index content_reports_open_user_uidx on public.content_reports (reporter_id, reported_user_id)
  where reported_user_id is not null and status in ('received', 'in_review');

create or replace function private.guard_report_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.post_id is not null and exists (
    select 1 from public.posts p where p.id = new.post_id and p.author_id = new.reporter_id) then
    raise exception 'cannot_report_own_content' using errcode = '22023';
  end if;
  if new.comment_id is not null and exists (
    select 1 from public.comments c where c.id = new.comment_id and c.author_id = new.reporter_id) then
    raise exception 'cannot_report_own_content' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_report_insert() from public, anon, authenticated;
create trigger content_reports_guard_insert before insert on public.content_reports
  for each row execute function private.guard_report_insert();

-- ---------------------------------------------------------------------------
-- Social graph logic.
-- ---------------------------------------------------------------------------
-- A writer may remove a follower (the follower row is theirs only as `following_id`).
create policy follows_remove_follower on public.follows
  for delete to authenticated using (following_id = (select auth.uid()));

-- Blocking removes follow relationships in both directions.
create or replace function private.cleanup_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and following_id = new.blocked_id)
     or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return new;
end;
$$;
revoke all on function private.cleanup_follows_on_block() from public, anon, authenticated;
create trigger user_blocks_cleanup_follows after insert on public.user_blocks
  for each row execute function private.cleanup_follows_on_block();

-- A sender may cancel their own unacknowledged claim (the 'cancelled' state was unreachable).
create policy writer_support_cancel_own on public.writer_support_claims
  for update to authenticated
  using (sender_id = (select auth.uid()) and status = 'sender_reported_sent')
  with check (sender_id = (select auth.uid()) and status = 'cancelled');

-- ---------------------------------------------------------------------------
-- Notifications: dedupe (F8), ticket link, moderation notice.
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists ticket_id uuid references public.feedback_tickets(id) on delete cascade;

alter table public.notifications drop constraint notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check
  check (event_type in ('post_like', 'comment', 'new_follower', 'writer_support',
    'ticket_reply', 'badge_update', 'team_update', 'platform_donation_update', 'system', 'content_removed'));
alter table public.notifications drop constraint notifications_target_check;
alter table public.notifications add constraint notifications_target_check check (
  (event_type = 'post_like' and post_id is not null and comment_id is null and support_claim_id is null and ticket_id is null)
  or (event_type = 'comment' and (post_id is not null or comment_id is not null) and support_claim_id is null and ticket_id is null)
  or (event_type = 'new_follower' and post_id is null and comment_id is null and support_claim_id is null and ticket_id is null)
  or (event_type = 'writer_support' and support_claim_id is not null and post_id is null and comment_id is null and ticket_id is null)
  or (event_type = 'ticket_reply' and post_id is null and comment_id is null and support_claim_id is null)
  or (event_type = 'content_removed' and (post_id is not null or comment_id is not null) and support_claim_id is null and ticket_id is null)
  or (event_type in ('badge_update', 'team_update', 'platform_donation_update', 'system')
      and post_id is null and comment_id is null and support_claim_id is null and ticket_id is null)
);
create index if not exists notifications_ticket_idx on public.notifications (ticket_id) where ticket_id is not null;

create or replace function private.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_recipient uuid;
begin
  select p.author_id into v_recipient from public.posts p where p.id = new.post_id;
  if v_recipient is not null and v_recipient <> new.user_id
     and not exists (select 1 from public.notifications n
       where n.recipient_id = v_recipient and n.actor_id = new.user_id
         and n.event_type = 'post_like' and n.post_id = new.post_id) then
    insert into public.notifications (recipient_id, actor_id, event_type, post_id)
    values (v_recipient, new.user_id, 'post_like', new.post_id);
  end if;
  return new;
end;
$$;

create or replace function private.notify_new_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.notifications n
    where n.recipient_id = new.following_id and n.actor_id = new.follower_id and n.event_type = 'new_follower') then
    insert into public.notifications (recipient_id, actor_id, event_type)
    values (new.following_id, new.follower_id, 'new_follower');
  end if;
  return new;
end;
$$;

create or replace function private.notify_ticket_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner uuid;
begin
  if new.is_internal then return new; end if;
  if not private.has_role(array['admin', 'support_agent']::text[]) then return new; end if;
  select user_id into v_owner from public.feedback_tickets where id = new.ticket_id;
  if v_owner is not null and v_owner <> new.author_id then
    insert into public.notifications (recipient_id, actor_id, event_type, ticket_id)
    values (v_owner, null, 'ticket_reply', new.ticket_id);   -- staff identity is not exposed to the user
  end if;
  return new;
end;
$$;

-- Writers are told when staff remove / hide their content (actor intentionally empty).
create or replace function private.notify_content_moderated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.has_role(array['admin', 'moderator']::text[]) then return new; end if;
  if tg_table_name = 'posts' then
    if old.status is distinct from new.status and new.status = 'removed' and new.author_id <> v_uid then
      insert into public.notifications (recipient_id, actor_id, event_type, post_id)
      values (new.author_id, null, 'content_removed', new.id);
    end if;
  elsif tg_table_name = 'comments' then
    if old.status is distinct from new.status and new.status in ('hidden', 'removed') and new.author_id <> v_uid then
      insert into public.notifications (recipient_id, actor_id, event_type, post_id, comment_id)
      values (new.author_id, null, 'content_removed', new.post_id, new.id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_content_moderated() from public, anon, authenticated;
create trigger posts_notify_moderated after update of status on public.posts
  for each row execute function private.notify_content_moderated();
create trigger comments_notify_moderated after update of status on public.comments
  for each row execute function private.notify_content_moderated();

-- ---------------------------------------------------------------------------
-- F9. Signup trigger: never abort account creation because of a username race.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_username text;
  v_seed text;
  v_attempt integer := 0;
begin
  v_display_name := left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    'نئے لکھاری'
  ), 80);

  v_seed := lower(regexp_replace(coalesce(
    nullif(new.raw_user_meta_data ->> 'user_name', ''),
    nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    'likhari'
  ), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(v_seed) < 3 then v_seed := 'likhari'; end if;
  v_username := left(v_seed, 24);

  loop
    begin
      insert into public.profiles (id, username, display_name)
      values (new.id, v_username, v_display_name)
      on conflict (id) do nothing;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 6 then raise; end if;
      v_username := left(v_seed, 14) || '_' || substr(md5(random()::text || clock_timestamp()::text || new.id::text), 1, 8);
    end;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- F6. Push device registration: reassigns a token that moves between accounts on one device.
-- ---------------------------------------------------------------------------
revoke insert, update on public.push_devices from authenticated;
grant update (enabled, device_label) on public.push_devices to authenticated;

create or replace function public.register_push_device(
  p_token text,
  p_platform text,
  p_label text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_fp text;
  v_prev uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_platform not in ('android', 'ios', 'web') then raise exception 'invalid_platform' using errcode = '22023'; end if;
  if p_token is null or char_length(p_token) not between 20 and 4096 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  v_fp := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  select user_id into v_prev from public.push_devices where token_fingerprint = v_fp;
  insert into public.push_devices (user_id, device_token, token_fingerprint, platform, device_label, enabled, last_seen_at)
  values (v_uid, p_token, v_fp, p_platform, left(coalesce(p_label, ''), 100), true, now())
  on conflict (token_fingerprint) do update
    set user_id = excluded.user_id, device_token = excluded.device_token, platform = excluded.platform,
        device_label = excluded.device_label, enabled = true, last_seen_at = now()
  returning id into v_id;
  if v_prev is not null and v_prev <> v_uid then
    -- Never deliver the previous owner's queued notifications to the new owner.
    update public.push_deliveries set status = 'cancelled', last_error = 'device_reassigned'
    where device_id = v_id and status in ('pending', 'failed');
  end if;
  return v_id;
end;
$$;
revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;

create or replace function public.unregister_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  delete from public.push_devices
  where user_id = v_uid
    and token_fingerprint = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
end;
$$;
revoke all on function public.unregister_push_device(text) from public, anon;
grant execute on function public.unregister_push_device(text) to authenticated;

-- ---------------------------------------------------------------------------
-- F10. Feed cards carry an excerpt, never the whole body. Feed-shaped RPCs share one row type.
-- ---------------------------------------------------------------------------
drop function if exists public.search_posts(text, text, text, integer, integer);
drop view if exists public.post_feed_cards;
create view public.post_feed_cards
with (security_invoker = true)
as
select
  p.id,
  p.author_id,
  p.title,
  left(p.body, 400) as excerpt,
  p.category_slug,
  p.topic_slug,
  p.allow_support,
  p.cover_image_path,
  p.published_at,
  p.created_at,
  p.updated_at,
  pr.display_name,
  pr.username,
  pr.avatar_path,
  p.like_count,
  p.comment_count
from public.posts p
join public.profiles pr on pr.id = p.author_id
where p.status = 'published';
revoke all on public.post_feed_cards from anon, authenticated;
grant select on public.post_feed_cards to anon, authenticated;

create or replace function public.search_posts(
  p_query text default '',
  p_topic_slug text default null,
  p_category_slug text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns setof public.post_feed_cards
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select c.*
  from public.post_feed_cards c
  where (p_topic_slug is null or c.topic_slug = p_topic_slug)
    and (p_category_slug is null or c.category_slug = p_category_slug)
    and (
      v_q is null
      or c.title ilike v_q
      or c.display_name ilike v_q
      or c.username ilike v_q
      or exists (select 1 from public.posts b where b.id = c.id and b.body ilike v_q)
    )
  order by c.published_at desc nulls last, c.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.search_posts(text, text, text, integer, integer) from public;
grant execute on function public.search_posts(text, text, text, integer, integer) to anon, authenticated;

create or replace function public.following_feed(
  p_category_slug text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns setof public.post_feed_cards
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.post_feed_cards c
  where exists (select 1 from public.follows f
                where f.follower_id = (select auth.uid()) and f.following_id = c.author_id)
    and (p_category_slug is null or c.category_slug = p_category_slug)
  order by c.published_at desc nulls last, c.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.following_feed(text, integer, integer) from public, anon;
grant execute on function public.following_feed(text, integer, integer) to authenticated;

create or replace function public.saved_posts(p_limit integer default 30, p_offset integer default 0)
returns setof public.post_feed_cards
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.post_bookmarks b
  join public.post_feed_cards c on c.id = b.post_id
  where b.user_id = (select auth.uid())
  order by b.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.saved_posts(integer, integer) from public, anon;
grant execute on function public.saved_posts(integer, integer) to authenticated;

create or replace function public.profile_stats(p_user_id uuid)
returns table (posts_count bigint, followers_count bigint, following_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.posts p where p.author_id = p_user_id and p.status = 'published'),
    (select count(*) from public.follows f where f.following_id = p_user_id),
    (select count(*) from public.follows f where f.follower_id = p_user_id);
$$;
revoke all on function public.profile_stats(uuid) from public;
grant execute on function public.profile_stats(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Platform donation: the donor must be told where to send money. Admin-managed accounts.
-- ---------------------------------------------------------------------------
create table public.platform_donation_accounts (
  id uuid primary key default gen_random_uuid(),
  method text not null check (method in ('jazzcash', 'easypaisa', 'bank_transfer')),
  label text not null default '',
  bank_name text,
  account_title text not null,
  account_identifier text not null,
  instructions text not null default '',
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_account_label_length check (char_length(label) <= 80),
  constraint platform_account_instructions_length check (char_length(instructions) <= 500),
  constraint platform_account_bank_check check (method <> 'bank_transfer' or bank_name is not null)
);
create trigger platform_donation_accounts_updated before update on public.platform_donation_accounts
  for each row execute function private.set_updated_at();
alter table public.platform_donation_accounts enable row level security;
create policy platform_accounts_read_active on public.platform_donation_accounts
  for select to authenticated using (is_active = true);
create policy platform_accounts_read_admin on public.platform_donation_accounts
  for select to authenticated using ((select private.has_role(array['admin']::text[])));
create policy platform_accounts_insert_admin on public.platform_donation_accounts
  for insert to authenticated with check ((select private.has_role(array['admin']::text[])));
create policy platform_accounts_update_admin on public.platform_donation_accounts
  for update to authenticated using ((select private.has_role(array['admin']::text[])))
  with check ((select private.has_role(array['admin']::text[])));
create policy platform_accounts_delete_admin on public.platform_donation_accounts
  for delete to authenticated using ((select private.has_role(array['admin']::text[])));
revoke all on public.platform_donation_accounts from anon, authenticated;
grant select, insert, delete on public.platform_donation_accounts to authenticated;
grant update (method, label, bank_name, account_title, account_identifier, instructions, is_active, sort_order)
  on public.platform_donation_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Admin analytics without a row cap: per-source counts (staff only through RLS).
-- ---------------------------------------------------------------------------
create or replace function public.acquisition_source_counts()
returns table (source text, responses bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.source, count(*) from public.onboarding_surveys s group by s.source order by count(*) desc;
$$;
revoke all on function public.acquisition_source_counts() from public, anon;
grant execute on function public.acquisition_source_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- Writer payment options: one row per method per writer (the app edits "the JazzCash option",
-- not "a JazzCash option"). Older duplicates are removed, keeping the most recently edited row.
-- ---------------------------------------------------------------------------
delete from public.writer_payment_options a
using public.writer_payment_options b
where a.creator_id = b.creator_id and a.method = b.method
  and (a.updated_at, a.id) < (b.updated_at, b.id);
create unique index writer_payment_options_one_per_method_uidx
  on public.writer_payment_options (creator_id, method);

commit;
