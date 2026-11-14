-- Hum Likhari backend schema v0.1.0
-- Target: Supabase Postgres 15+ (local and hosted)
-- Apply only to a fresh/development database after reviewing this migration.

begin;

create extension if not exists pg_trgm with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Private authorization data. Never expose this schema through the Data API.
-- -----------------------------------------------------------------------------
create table private.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'moderator', 'support_agent')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id, role)
);
alter table private.user_roles enable row level security;
revoke all on private.user_roles from public, anon, authenticated;

create or replace function private.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = any (p_roles)
  );
$$;
revoke all on function private.has_role(text[]) from public, anon, authenticated;
grant execute on function private.has_role(text[]) to authenticated;

-- Internal timestamp helper.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- User profiles and auth bootstrap.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  bio text not null default '',
  avatar_path text,
  country_code text,
  locale text not null default 'ur',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username = lower(username) and username ~ '^[a-z0-9_]{3,24}$'),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 80),
  constraint profiles_bio_length check (char_length(bio) <= 300),
  constraint profiles_avatar_owner_path check (avatar_path is null or avatar_path like id::text || '/%'),
  constraint profiles_country_code_format check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint profiles_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
create unique index profiles_username_lower_uidx on public.profiles (lower(username));
create index profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);
create index profiles_username_trgm_idx on public.profiles using gin (username gin_trgm_ops);
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

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
begin
  -- Auth metadata is used only as an initial display hint, never for authorization.
  v_display_name := left(coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    'نئے لکھاری'
  ), 80);

  v_seed := lower(regexp_replace(coalesce(
    nullif(new.raw_user_meta_data ->> 'user_name', ''),
    nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    'likhari'
  ), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(v_seed) < 3 then
    v_seed := 'likhari';
  end if;
  v_username := left(v_seed, 24);

  if exists (select 1 from public.profiles p where lower(p.username) = lower(v_username)) then
    v_username := left(v_seed, 14) || '_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Taxonomy. Labels match the Urdu labels currently hard-coded in v0.2.0.
-- -----------------------------------------------------------------------------
create table public.content_categories (
  slug text primary key check (slug ~ '^[a-z0-9_]+$'),
  label_ur text not null unique,
  sort_order smallint not null default 0,
  is_active boolean not null default true
);

create table public.content_topics (
  slug text primary key check (slug ~ '^[a-z0-9_]+$'),
  label_ur text not null unique,
  sort_order smallint not null default 0,
  is_active boolean not null default true
);

-- -----------------------------------------------------------------------------
-- Posts, drafts, likes, bookmarks and comments.
-- Drafts are posts with status='draft' (one source of truth).
-- -----------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  category_slug text not null references public.content_categories(slug),
  topic_slug text not null references public.content_topics(slug),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived', 'removed')),
  allow_support boolean not null default true,
  cover_image_path text,
  like_count bigint not null default 0 check (like_count >= 0),
  comment_count bigint not null default 0 check (comment_count >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint posts_body_length check (char_length(body) <= 100000),
  constraint posts_cover_owner_path check (cover_image_path is null or cover_image_path like author_id::text || '/%')
);
create index posts_author_status_updated_idx on public.posts (author_id, status, updated_at desc);
create index posts_published_feed_idx on public.posts (published_at desc, id) where status = 'published';
create index posts_category_published_idx on public.posts (category_slug, published_at desc) where status = 'published';
create index posts_topic_published_idx on public.posts (topic_slug, published_at desc) where status = 'published';
create index posts_title_trgm_idx on public.posts using gin (title gin_trgm_ops);
create index posts_body_trgm_idx on public.posts using gin (body gin_trgm_ops);
create trigger posts_set_updated_at before update on public.posts
for each row execute function private.set_updated_at();

create or replace function private.set_post_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  elsif new.status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.set_post_published_at() from public, anon, authenticated;
create trigger posts_set_published_at before insert or update of status, published_at on public.posts
for each row execute function private.set_post_published_at();

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_created_idx on public.post_likes (user_id, created_at desc);

create or replace function private.adjust_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_post_id uuid; v_delta integer;
begin
  if tg_op = 'DELETE' then
    v_post_id := old.post_id; v_delta := -1;
  else
    v_post_id := new.post_id; v_delta := 1;
  end if;
  update public.posts
    set like_count = greatest(0, like_count + v_delta)
    where id = v_post_id;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.adjust_post_like_count() from public, anon, authenticated;
create trigger post_likes_count after insert or delete on public.post_likes
for each row execute function private.adjust_post_like_count();

create table public.post_bookmarks (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_bookmarks_user_created_idx on public.post_bookmarks (user_id, created_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null,
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(btrim(body)) between 1 and 5000)
);
create index comments_post_created_idx on public.comments (post_id, created_at asc) where status = 'visible';
create index comments_author_created_idx on public.comments (author_id, created_at desc);
create trigger comments_set_updated_at before update on public.comments
for each row execute function private.set_updated_at();

create or replace function private.adjust_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_post_id uuid; v_delta integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'visible' then return new; end if;
    v_post_id := new.post_id; v_delta := 1;
  elsif tg_op = 'DELETE' then
    if old.status <> 'visible' then return old; end if;
    v_post_id := old.post_id; v_delta := -1;
  else
    if old.status = new.status then return new; end if;
    v_post_id := new.post_id;
    v_delta := case when new.status = 'visible' then 1 else -1 end;
  end if;
  update public.posts
    set comment_count = greatest(0, comment_count + v_delta)
    where id = v_post_id;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.adjust_post_comment_count() from public, anon, authenticated;
create trigger comments_count after insert or delete or update of status on public.comments
for each row execute function private.adjust_post_comment_count();

-- -----------------------------------------------------------------------------
-- Social graph, blocks and notifications.
-- -----------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);
create index follows_following_created_idx on public.follows (following_id, created_at desc);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id, blocker_id);

-- Helpers are defined after their referenced tables exist.
create or replace function private.is_blocked_user(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null or p_other_user_id is null then false
    else exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_other_user_id)
         or (b.blocker_id = p_other_user_id and b.blocked_id = (select auth.uid()))
    )
  end;
$$;
revoke all on function private.is_blocked_user(uuid) from public, anon, authenticated;
grant execute on function private.is_blocked_user(uuid) to authenticated;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active = true
  );
$$;
revoke all on function private.is_active_user() from public, anon, authenticated;
grant execute on function private.is_active_user() to authenticated;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('post_like', 'comment', 'new_follower', 'writer_support')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  support_claim_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_target_check check (
    (event_type = 'post_like' and post_id is not null and comment_id is null and support_claim_id is null)
    or (event_type = 'comment' and (post_id is not null or comment_id is not null) and support_claim_id is null)
    or (event_type = 'new_follower' and post_id is null and comment_id is null and support_claim_id is null)
    or (event_type = 'writer_support' and support_claim_id is not null and post_id is null and comment_id is null)
  )
);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id, created_at desc) where read_at is null;

-- -----------------------------------------------------------------------------
-- Moderation and user feedback.
-- -----------------------------------------------------------------------------
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'plagiarism', 'inappropriate', 'other')),
  details text not null default '',
  status text not null default 'received' check (status in ('received', 'in_review', 'action_taken', 'dismissed')),
  staff_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_reports_target_check check (
    (target_type = 'post' and post_id is not null and comment_id is null and reported_user_id is null)
    or (target_type = 'comment' and post_id is null and comment_id is not null and reported_user_id is null)
    or (target_type = 'user' and post_id is null and comment_id is null and reported_user_id is not null)
  ),
  constraint content_reports_not_self check (reported_user_id is null or reported_user_id <> reporter_id),
  constraint content_reports_details_length check (char_length(details) <= 2000)
);
create index content_reports_status_created_idx on public.content_reports (status, created_at desc);
create index content_reports_reporter_idx on public.content_reports (reporter_id, created_at desc);

create table public.feedback_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default (
    'HL-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  ),
  user_id uuid not null references public.profiles(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('suggestion', 'complaint', 'bug', 'question')),
  message text not null,
  attachment_path text,
  status text not null default 'received' check (status in ('received', 'in_review', 'resolved', 'closed')),
  staff_reply text,
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_message_length check (char_length(btrim(message)) between 5 and 5000),
  constraint feedback_attachment_owner_path check (attachment_path is null or attachment_path like user_id::text || '/%')
);
create index feedback_tickets_user_created_idx on public.feedback_tickets (user_id, created_at desc);
create index feedback_tickets_status_created_idx on public.feedback_tickets (status, created_at desc);
create trigger feedback_tickets_set_updated_at before update on public.feedback_tickets
for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Reader interests and acquisition-source survey.
-- -----------------------------------------------------------------------------
create table public.user_interests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_slug text not null references public.content_topics(slug) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_slug)
);

create table public.onboarding_surveys (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  source text not null check (source in (
    'facebook', 'instagram', 'youtube', 'whatsapp', 'tiktok',
    'google_search', 'friend_family', 'literary_community',
    'website_blog', 'advertisement', 'other'
  )),
  other_text text not null default '',
  submitted_at timestamptz not null default now(),
  constraint onboarding_survey_other_check check (source = 'other' or other_text = ''),
  constraint onboarding_survey_other_length check (char_length(other_text) <= 200)
);

-- -----------------------------------------------------------------------------
-- Writer payment options and voluntary, manually reported P2P support.
-- Private by default: the writer must explicitly publish each method.
-- These records do NOT prove that money was transferred.
-- -----------------------------------------------------------------------------
create table public.writer_payment_options (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  method text not null check (method in ('jazzcash', 'easypaisa', 'bank_transfer')),
  display_label text not null default '',
  bank_name text,
  account_title text,
  account_identifier text,
  qr_object_path text,
  is_public boolean not null default false,
  is_active boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint writer_payment_option_payload_check check (
    (method in ('jazzcash', 'easypaisa') and qr_object_path is not null)
    or (method = 'bank_transfer' and bank_name is not null and account_title is not null and account_identifier is not null)
  ),
  constraint writer_payment_qr_owner_path check (
    qr_object_path is null or qr_object_path like creator_id::text || '/%'
  ),
  constraint writer_payment_label_length check (char_length(display_label) <= 80)
);
create index writer_payment_options_public_idx on public.writer_payment_options (creator_id, sort_order)
  where is_public = true and is_active = true;
create trigger writer_payment_options_set_updated_at before update on public.writer_payment_options
for each row execute function private.set_updated_at();

create table public.writer_support_claims (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  payment_option_id uuid references public.writer_payment_options(id) on delete set null,
  amount numeric(12,2) not null check (amount between 10 and 1000000),
  currency text not null default 'PKR' check (currency = 'PKR'),
  sender_note text not null default '',
  status text not null default 'sender_reported_sent' check (status in ('sender_reported_sent', 'creator_acknowledged', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint writer_support_no_self check (sender_id <> creator_id),
  constraint writer_support_note_length check (char_length(sender_note) <= 500)
);
create index writer_support_sender_idx on public.writer_support_claims (sender_id, created_at desc);
create index writer_support_creator_idx on public.writer_support_claims (creator_id, created_at desc);
alter table public.notifications add constraint notifications_support_claim_id_fkey
  foreign key (support_claim_id) references public.writer_support_claims(id) on delete cascade;

-- A Blue Tick / Featured Writer label is an editorial decision, never self-awarded.
create table public.writer_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_type text not null check (badge_type in ('consistent_writer', 'featured_writer')),
  reason text not null default '',
  assigned_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint writer_badges_reason_length check (char_length(reason) <= 1000)
);
create unique index writer_badges_active_unique_idx on public.writer_badges (user_id, badge_type)
  where revoked_at is null;
create index writer_badges_public_idx on public.writer_badges (user_id, issued_at desc) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Server-side notification triggers. They cannot be called as RPC endpoints.
-- -----------------------------------------------------------------------------
create or replace function private.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_recipient uuid;
begin
  select p.author_id into v_recipient from public.posts p where p.id = new.post_id;
  if v_recipient is not null and v_recipient <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, event_type, post_id)
    values (v_recipient, new.user_id, 'post_like', new.post_id);
  end if;
  return new;
end;
$$;
revoke all on function private.notify_post_like() from public, anon, authenticated;
create trigger post_likes_notify after insert on public.post_likes
for each row execute function private.notify_post_like();

create or replace function private.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_post_author uuid; v_parent_author uuid;
begin
  select p.author_id into v_post_author from public.posts p where p.id = new.post_id;
  if v_post_author is not null and v_post_author <> new.author_id then
    insert into public.notifications (recipient_id, actor_id, event_type, post_id, comment_id)
    values (v_post_author, new.author_id, 'comment', new.post_id, new.id);
  end if;
  if new.parent_id is not null then
    select c.author_id into v_parent_author from public.comments c where c.id = new.parent_id;
    if v_parent_author is not null and v_parent_author <> new.author_id and v_parent_author <> v_post_author then
      insert into public.notifications (recipient_id, actor_id, event_type, post_id, comment_id)
      values (v_parent_author, new.author_id, 'comment', new.post_id, new.id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_comment() from public, anon, authenticated;
create trigger comments_notify after insert on public.comments
for each row execute function private.notify_comment();

create or replace function private.notify_new_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, actor_id, event_type)
  values (new.following_id, new.follower_id, 'new_follower');
  return new;
end;
$$;
revoke all on function private.notify_new_follow() from public, anon, authenticated;
create trigger follows_notify after insert on public.follows
for each row execute function private.notify_new_follow();

create or replace function private.notify_writer_support()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, actor_id, event_type, support_claim_id)
  values (new.creator_id, new.sender_id, 'writer_support', new.id);
  return new;
end;
$$;
revoke all on function private.notify_writer_support() from public, anon, authenticated;
create trigger writer_support_notify after insert on public.writer_support_claims
for each row execute function private.notify_writer_support();

-- -----------------------------------------------------------------------------
-- Views and RPCs. security_invoker is important: base-table RLS still applies.
-- -----------------------------------------------------------------------------
create or replace view public.post_feed_cards
with (security_invoker = true)
as
select
  p.id,
  p.author_id,
  p.title,
  p.body,
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

create or replace function public.search_posts(
  p_query text default '',
  p_topic_slug text default null,
  p_category_slug text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  body text,
  category_slug text,
  topic_slug text,
  allow_support boolean,
  cover_image_path text,
  published_at timestamptz,
  display_name text,
  username text,
  avatar_path text,
  like_count bigint,
  comment_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id, p.author_id, p.title, p.body, p.category_slug, p.topic_slug,
    p.allow_support, p.cover_image_path, p.published_at,
    pr.display_name, pr.username, pr.avatar_path,
    p.like_count,
    p.comment_count
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where p.status = 'published'
    and (p_topic_slug is null or p.topic_slug = p_topic_slug)
    and (p_category_slug is null or p.category_slug = p_category_slug)
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or p.title ilike ('%' || btrim(p_query) || '%')
      or p.body ilike ('%' || btrim(p_query) || '%')
      or pr.display_name ilike ('%' || btrim(p_query) || '%')
      or pr.username ilike ('%' || btrim(p_query) || '%')
    )
  order by p.published_at desc nulls last, p.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.replace_my_interests(p_topic_slugs text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  delete from public.user_interests where user_id = (select auth.uid());
  insert into public.user_interests (user_id, topic_slug)
  select (select auth.uid()), topics.topic_slug
  from unnest(coalesce(p_topic_slugs, array[]::text[])) as topics(topic_slug)
  on conflict (user_id, topic_slug) do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security: every public-schema table is protected.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.content_categories enable row level security;
alter table public.content_topics enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_bookmarks enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.user_blocks enable row level security;
alter table public.notifications enable row level security;
alter table public.content_reports enable row level security;
alter table public.feedback_tickets enable row level security;
alter table public.user_interests enable row level security;
alter table public.onboarding_surveys enable row level security;
alter table public.writer_payment_options enable row level security;
alter table public.writer_support_claims enable row level security;
alter table public.writer_badges enable row level security;

-- Profiles: only public profile fields live here. Email/phone remain in Auth.
create policy profiles_public_read_anon on public.profiles
for select to anon using (is_active = true);
create policy profiles_public_or_self_read on public.profiles
for select to authenticated using (is_active = true or id = (select auth.uid()));
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy categories_public_read on public.content_categories
for select to anon, authenticated using (is_active = true);
create policy topics_public_read on public.content_topics
for select to anon, authenticated using (is_active = true);

-- Posts: anonymous readers see published work; signed-in readers also respect blocks.
create policy posts_public_read_anon on public.posts
for select to anon using (
  status = 'published'
  and exists (select 1 from public.profiles pr where pr.id = author_id and pr.is_active = true)
);
create policy posts_read_authenticated on public.posts
for select to authenticated
using (
  (status = 'published'
    and exists (select 1 from public.profiles pr where pr.id = author_id and pr.is_active = true)
    and not (select private.is_blocked_user(author_id)))
  or author_id = (select auth.uid())
  or (select private.has_role(array['admin', 'moderator']::text[]))
);
create policy posts_insert_own on public.posts
for insert to authenticated
with check (author_id = (select auth.uid()) and (select private.is_active_user()));
create policy posts_update_own on public.posts
for update to authenticated
using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()) and (select private.is_active_user()));
create policy posts_delete_own on public.posts
for delete to authenticated using (author_id = (select auth.uid()));
create policy posts_delete_moderator on public.posts
for delete to authenticated using ((select private.has_role(array['admin', 'moderator']::text[])));

-- Likes are public counters; users can only add/remove their own like.
create policy post_likes_read_own on public.post_likes
for select to authenticated using (user_id = (select auth.uid()));
create policy post_likes_insert_own on public.post_likes
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_active_user())
  and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
    and not (select private.is_blocked_user(p.author_id)))
);
create policy post_likes_delete_own on public.post_likes
for delete to authenticated using (user_id = (select auth.uid()));

create policy post_bookmarks_read_own on public.post_bookmarks
for select to authenticated using (user_id = (select auth.uid()));
create policy post_bookmarks_insert_own on public.post_bookmarks
for insert to authenticated with check (
  user_id = (select auth.uid())
  and (select private.is_active_user())
  and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
    and not (select private.is_blocked_user(p.author_id)))
);
create policy post_bookmarks_delete_own on public.post_bookmarks
for delete to authenticated using (user_id = (select auth.uid()));

create policy comments_read_anon on public.comments
for select to anon using (
  status = 'visible'
  and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published')
);
create policy comments_read_auth on public.comments
for select to authenticated using (
  (status = 'visible'
    and not (select private.is_blocked_user(comments.author_id))
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.status = 'published'
        and not (select private.is_blocked_user(p.author_id))
    ))
  or author_id = (select auth.uid())
  or exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
  or (select private.has_role(array['admin', 'moderator']::text[]))
);
create policy comments_insert_own on public.comments
for insert to authenticated with check (
  author_id = (select auth.uid())
  and (select private.is_active_user())
  and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
    and not (select private.is_blocked_user(p.author_id)))
  and (parent_id is null or exists (
    select 1 from public.comments parent_comment
    where parent_comment.id = parent_id
      and parent_comment.post_id = comments.post_id
      and parent_comment.status = 'visible'
  ))
);
create policy comments_update_own on public.comments
for update to authenticated using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()));
create policy comments_delete_own on public.comments
for delete to authenticated using (author_id = (select auth.uid()));
create policy comments_delete_post_author on public.comments
for delete to authenticated using (
  exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
);
create policy comments_moderator_delete on public.comments
for delete to authenticated using ((select private.has_role(array['admin', 'moderator']::text[])));

-- Follow graph is public for counts/lists; relationship changes are owner-only.
create policy follows_read_public on public.follows
for select to anon, authenticated using (true);
create policy follows_insert_own on public.follows
for insert to authenticated with check (
  follower_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = following_id and p.is_active = true)
  and not (select private.is_blocked_user(following_id))
);
create policy follows_delete_own on public.follows
for delete to authenticated using (follower_id = (select auth.uid()));

-- A user can inspect and remove only blocks they created. The private helper checks both directions.
create policy user_blocks_read_own on public.user_blocks
for select to authenticated using (blocker_id = (select auth.uid()));
create policy user_blocks_insert_own on public.user_blocks
for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy user_blocks_delete_own on public.user_blocks
for delete to authenticated using (blocker_id = (select auth.uid()));

create policy notifications_read_own on public.notifications
for select to authenticated using (recipient_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
for update to authenticated using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications
for delete to authenticated using (recipient_id = (select auth.uid()));

create policy reports_insert_own on public.content_reports
for insert to authenticated with check (
  reporter_id = (select auth.uid())
  and (select private.is_active_user())
);
create policy reports_read_own on public.content_reports
for select to authenticated using (reporter_id = (select auth.uid()));
create policy reports_read_staff on public.content_reports
for select to authenticated using ((select private.has_role(array['admin', 'moderator']::text[])));
create policy reports_update_staff on public.content_reports
for update to authenticated
using ((select private.has_role(array['admin', 'moderator']::text[])))
with check ((select private.has_role(array['admin', 'moderator']::text[])));

create policy feedback_insert_own on public.feedback_tickets
for insert to authenticated with check (user_id = (select auth.uid()));
create policy feedback_read_own on public.feedback_tickets
for select to authenticated using (user_id = (select auth.uid()));
create policy feedback_read_staff on public.feedback_tickets
for select to authenticated using ((select private.has_role(array['admin', 'support_agent']::text[])));
create policy feedback_update_staff on public.feedback_tickets
for update to authenticated
using ((select private.has_role(array['admin', 'support_agent']::text[])))
with check ((select private.has_role(array['admin', 'support_agent']::text[])));

create policy interests_read_own on public.user_interests
for select to authenticated using (user_id = (select auth.uid()));
create policy interests_insert_own on public.user_interests
for insert to authenticated with check (user_id = (select auth.uid()));
create policy interests_delete_own on public.user_interests
for delete to authenticated using (user_id = (select auth.uid()));

create policy survey_read_own on public.onboarding_surveys
for select to authenticated using (user_id = (select auth.uid()));
create policy survey_insert_own on public.onboarding_surveys
for insert to authenticated with check (user_id = (select auth.uid()));

create policy writer_payments_read_public_anon on public.writer_payment_options
for select to anon using (is_public = true and is_active = true);
create policy writer_payments_read_public_or_owner on public.writer_payment_options
for select to authenticated using (
  (is_public = true and is_active = true) or creator_id = (select auth.uid())
);
create policy writer_payments_insert_own on public.writer_payment_options
for insert to authenticated with check (creator_id = (select auth.uid()));
create policy writer_payments_update_own on public.writer_payment_options
for update to authenticated using (creator_id = (select auth.uid()))
with check (creator_id = (select auth.uid()));
create policy writer_payments_delete_own on public.writer_payment_options
for delete to authenticated using (creator_id = (select auth.uid()));

create policy writer_support_insert_own on public.writer_support_claims
for insert to authenticated with check (
  sender_id = (select auth.uid())
  and sender_id <> creator_id
  and exists (
    select 1 from public.writer_payment_options opt
    where opt.id = payment_option_id
      and opt.creator_id = public.writer_support_claims.creator_id
      and opt.is_public = true and opt.is_active = true
  )
  and not (select private.is_blocked_user(creator_id))
);
create policy writer_support_read_sender_or_creator on public.writer_support_claims
for select to authenticated using (
  sender_id = (select auth.uid()) or creator_id = (select auth.uid())
);
create policy writer_support_read_admin on public.writer_support_claims
for select to authenticated using ((select private.has_role(array['admin']::text[])));
-- No public client UPDATE/DELETE policy: sender-reported transfers cannot be self-verified.

create policy writer_badges_read_anon on public.writer_badges
for select to anon using (revoked_at is null);
create policy writer_badges_read_auth on public.writer_badges
for select to authenticated using (revoked_at is null);
create policy writer_badges_insert_admin on public.writer_badges
for insert to authenticated with check ((select private.has_role(array['admin']::text[])));
create policy writer_badges_update_admin on public.writer_badges
for update to authenticated using ((select private.has_role(array['admin']::text[])))
with check ((select private.has_role(array['admin']::text[])));
create policy writer_badges_delete_admin on public.writer_badges
for delete to authenticated using ((select private.has_role(array['admin']::text[])));

-- -----------------------------------------------------------------------------
-- Explicit Data API grants. New public tables are no longer auto-exposed by
-- default on current Supabase projects; the public schema must also be enabled
-- in the project's Data API exposed-schema settings.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.content_categories, public.content_topics,
  public.posts, public.comments, public.follows,
  public.writer_payment_options, public.writer_badges, public.post_feed_cards
  to anon;
grant select on public.profiles, public.content_categories, public.content_topics,
  public.posts, public.post_likes, public.post_bookmarks, public.comments,
  public.follows, public.user_blocks, public.notifications, public.content_reports,
  public.feedback_tickets, public.user_interests, public.onboarding_surveys,
  public.writer_payment_options, public.writer_support_claims, public.writer_badges,
  public.post_feed_cards
  to authenticated;

grant insert, update, delete on public.posts to authenticated;
revoke update on public.posts from authenticated;
grant update (title, body, category_slug, topic_slug, status, allow_support, cover_image_path)
  on public.posts to authenticated;
grant update (username, display_name, bio, avatar_path, country_code, locale)
  on public.profiles to authenticated;
grant insert, delete on public.post_likes, public.post_bookmarks, public.follows, public.user_blocks to authenticated;
grant insert (post_id, author_id, parent_id, body) on public.comments to authenticated;
grant delete on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant insert (reporter_id, target_type, post_id, comment_id, reported_user_id, reason, details)
  on public.content_reports to authenticated;
grant insert (user_id, feedback_type, message, attachment_path)
  on public.feedback_tickets to authenticated;
grant insert on public.user_interests to authenticated;
grant insert (user_id, source, other_text) on public.onboarding_surveys to authenticated;
grant delete on public.user_interests to authenticated;
grant insert, delete on public.writer_payment_options to authenticated;
grant update (method, display_label, bank_name, account_title, account_identifier, qr_object_path, is_public, is_active, sort_order)
  on public.writer_payment_options to authenticated;
grant insert (sender_id, creator_id, payment_option_id, amount, currency, sender_note)
  on public.writer_support_claims to authenticated;
grant insert, update, delete on public.writer_badges to authenticated;
grant update (status, staff_note, reviewed_by, reviewed_at) on public.content_reports to authenticated;
grant update (status, staff_reply, assigned_to) on public.feedback_tickets to authenticated;

revoke all on function public.search_posts(text, text, text, integer, integer) from public;
grant execute on function public.search_posts(text, text, text, integer, integer) to anon, authenticated;
revoke all on function public.replace_my_interests(text[]) from public;
grant execute on function public.replace_my_interests(text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage buckets and object policies.
-- Public buckets contain only public avatars/covers. Payment QR and feedback
-- attachments remain private and use explicit object policies.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('post-covers', 'post-covers', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('writer-payment-qr', 'writer-payment-qr', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('feedback-attachments', 'feedback-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy avatars_insert_own_folder on storage.objects
for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy avatars_delete_own_folder on storage.objects
for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy post_covers_insert_own_folder on storage.objects
for insert to authenticated with check (
  bucket_id = 'post-covers' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy post_covers_delete_own_folder on storage.objects
for delete to authenticated using (
  bucket_id = 'post-covers' and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy writer_qr_read_active_public_or_owner on storage.objects
for select to anon, authenticated using (
  bucket_id = 'writer-payment-qr'
  and (
    exists (
      select 1 from public.writer_payment_options opt
      where opt.qr_object_path = storage.objects.name and opt.is_public = true and opt.is_active = true
    )
    or ((select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text)
  )
);
create policy writer_qr_insert_own_folder on storage.objects
for insert to authenticated with check (
  bucket_id = 'writer-payment-qr' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy writer_qr_update_own_folder on storage.objects
for update to authenticated using (
  bucket_id = 'writer-payment-qr' and (storage.foldername(name))[1] = (select auth.uid())::text
) with check (
  bucket_id = 'writer-payment-qr' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy writer_qr_delete_own_folder on storage.objects
for delete to authenticated using (
  bucket_id = 'writer-payment-qr' and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy feedback_files_read_owner_or_staff on storage.objects
for select to authenticated using (
  bucket_id = 'feedback-attachments'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.has_role(array['admin', 'support_agent']::text[]))
  )
);
create policy feedback_files_insert_owner on storage.objects
for insert to authenticated with check (
  bucket_id = 'feedback-attachments' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy feedback_files_delete_owner_or_admin on storage.objects
for delete to authenticated using (
  bucket_id = 'feedback-attachments'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.has_role(array['admin']::text[]))
  )
);

commit;
