-- Hum Likhari operations, team, platform donation and push notification layer.
-- Apply only AFTER 20261110000000_initial_schema.sql on a fresh development DB.
begin;

-- Minimal staff role checks exposed as safe invoker RPCs. Authorization data remains private.
create or replace function public.is_staff()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.has_role(array['admin','moderator','support_agent']::text[]); $$;
create or replace function public.is_admin()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.has_role(array['admin']::text[]); $$;
create or replace function public.is_moderator()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.has_role(array['moderator']::text[]); $$;
create or replace function public.is_support_agent()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.has_role(array['support_agent']::text[]); $$;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_moderator() from public, anon;
revoke all on function public.is_support_agent() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_moderator() to authenticated;
grant execute on function public.is_support_agent() to authenticated;

-- ---------------------------------------------------------------------------
-- Internal operations audit. No client insert/update/delete access.
-- ---------------------------------------------------------------------------
create table public.staff_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index staff_audit_log_created_idx on public.staff_audit_log(created_at desc);
create index staff_audit_log_entity_idx on public.staff_audit_log(entity_type, entity_id, created_at desc);
alter table public.staff_audit_log enable row level security;
create policy staff_audit_read_staff on public.staff_audit_log
  for select to authenticated using ((select private.has_role(array['admin','moderator','support_agent']::text[])));
grant select on public.staff_audit_log to authenticated;

create or replace function private.log_staff_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_entity_id text; v_old text; v_new text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not private.has_role(array['admin','moderator','support_agent']::text[]) then
    return new;
  end if;
  v_entity_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'ticket_number', '');
  v_old := to_jsonb(old)->>'status';
  v_new := to_jsonb(new)->>'status';
  if v_old is distinct from v_new then
    insert into public.staff_audit_log(actor_id, action, entity_type, entity_id, details)
    values (v_actor, 'status_changed', tg_table_name, v_entity_id,
      jsonb_build_object('from', v_old, 'to', v_new));
  end if;
  return new;
end;
$$;
revoke all on function private.log_staff_status_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private push tokens and queued deliveries. Tokens are visible only to owner;
-- server-side dispatcher uses service role and Firebase HTTP v1.
-- ---------------------------------------------------------------------------
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_token text not null,
  token_fingerprint text not null,
  platform text not null check (platform in ('android','ios','web')),
  device_label text not null default '',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint push_device_label_length check (char_length(device_label) <= 100),
  constraint push_device_token_length check (char_length(device_token) between 20 and 4096),
  constraint push_device_fingerprint_format check (token_fingerprint ~ '^[a-f0-9]{64}$'),
  unique(user_id, token_fingerprint),
  unique(token_fingerprint)
);
create index push_devices_user_enabled_idx on public.push_devices(user_id) where enabled = true;
alter table public.push_devices enable row level security;
create policy push_devices_read_own on public.push_devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_devices_insert_own on public.push_devices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_devices_update_own on public.push_devices
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy push_devices_delete_own on public.push_devices
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_devices to authenticated;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id, device_id)
);
create index push_deliveries_pending_idx on public.push_deliveries(next_attempt_at, created_at)
  where status in ('pending','failed');
alter table public.push_deliveries enable row level security;
create policy push_deliveries_read_staff on public.push_deliveries
  for select to authenticated using ((select private.has_role(array['admin']::text[])));
revoke all on public.push_deliveries from anon, authenticated;
grant select on public.push_deliveries to authenticated;

create or replace function private.enqueue_push_deliveries()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.push_deliveries(notification_id, device_id)
  select new.id, d.id from public.push_devices d
  where d.user_id = new.recipient_id and d.enabled = true
  on conflict (notification_id, device_id) do nothing;
  return new;
end;
$$;
revoke all on function private.enqueue_push_deliveries() from public, anon, authenticated;
create trigger notifications_enqueue_push after insert on public.notifications
  for each row execute function private.enqueue_push_deliveries();

create trigger posts_audit_status after update of status on public.posts
  for each row execute function private.log_staff_status_change();
create trigger comments_audit_status after update of status on public.comments
  for each row execute function private.log_staff_status_change();
create trigger reports_audit_status after update of status on public.content_reports
  for each row execute function private.log_staff_status_change();
create trigger feedback_audit_status after update of status on public.feedback_tickets
  for each row execute function private.log_staff_status_change();

-- Staff may hide content by status transition; they never receive permission to
-- rewrite a writer's title/body. The original owner policies remain in force.
create policy posts_moderator_update_status on public.posts
  for update to authenticated
  using ((select private.has_role(array['admin','moderator']::text[])))
  with check ((select private.has_role(array['admin','moderator']::text[])));
grant update(status) on public.posts to authenticated;
create policy comments_moderator_update_status on public.comments
  for update to authenticated
  using ((select private.has_role(array['admin','moderator']::text[])))
  with check ((select private.has_role(array['admin','moderator']::text[])));
grant update(status) on public.comments to authenticated;

-- ---------------------------------------------------------------------------
-- Private ticket conversation: owner and staff only.
-- ---------------------------------------------------------------------------
create table public.feedback_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.feedback_tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ticket_message_length check (char_length(btrim(message)) between 1 and 4000)
);
create index feedback_ticket_messages_ticket_idx on public.feedback_ticket_messages(ticket_id, created_at);
alter table public.feedback_ticket_messages enable row level security;
create policy ticket_messages_read_owner_or_staff on public.feedback_ticket_messages
  for select to authenticated using (
    (not is_internal and exists (select 1 from public.feedback_tickets t
      where t.id = ticket_id and t.user_id = (select auth.uid())))
    or (select private.has_role(array['admin','support_agent']::text[]))
  );
create policy ticket_messages_insert_owner_or_staff on public.feedback_ticket_messages
  for insert to authenticated with check (
    author_id = (select auth.uid()) and (
      ((not is_internal) and exists (select 1 from public.feedback_tickets t
        where t.id = ticket_id and t.user_id = (select auth.uid())))
      or ((select private.has_role(array['admin','support_agent']::text[])))
    )
  );
grant select on public.feedback_ticket_messages to authenticated;
grant insert(ticket_id, author_id, message, is_internal) on public.feedback_ticket_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Join-the-team applications. Personal details are private to applicant/staff.
-- ---------------------------------------------------------------------------
create table public.volunteer_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  team_area text not null check (team_area in ('proofreading','editing','translation','design','development','community','promotion','research','other')),
  skills text not null default '',
  availability text not null default '',
  motivation text not null,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  status text not null default 'received' check (status in ('received','in_review','accepted','declined','withdrawn')),
  staff_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint volunteer_text_lengths check (
    char_length(skills) <= 1500 and char_length(availability) <= 300
    and char_length(btrim(motivation)) between 20 and 3000
  )
);
alter table public.volunteer_applications add column attachment_path text;
alter table public.volunteer_applications add constraint volunteer_attachment_owner_path
  check (attachment_path is null or attachment_path like applicant_id::text || '/%');
create unique index volunteer_one_open_idx on public.volunteer_applications(applicant_id)
  where status in ('received','in_review');
create index volunteer_applications_status_idx on public.volunteer_applications(status, created_at desc);
create trigger volunteer_applications_updated before update on public.volunteer_applications
  for each row execute function private.set_updated_at();
create trigger volunteer_applications_audit after update of status on public.volunteer_applications
  for each row execute function private.log_staff_status_change();
alter table public.volunteer_applications enable row level security;
create policy volunteers_read_owner_or_staff on public.volunteer_applications
  for select to authenticated using (applicant_id = (select auth.uid())
    or (select private.has_role(array['admin','support_agent']::text[])));
create policy volunteers_insert_own on public.volunteer_applications
  for insert to authenticated with check (applicant_id = (select auth.uid()));
create policy volunteers_update_staff on public.volunteer_applications
  for update to authenticated using ((select private.has_role(array['admin','support_agent']::text[])))
  with check ((select private.has_role(array['admin','support_agent']::text[])));
grant select on public.volunteer_applications to authenticated;
grant insert(applicant_id,team_area,skills,availability,motivation,country_code,attachment_path) on public.volunteer_applications to authenticated;
grant update(status,staff_note,reviewed_by,reviewed_at) on public.volunteer_applications to authenticated;

-- ---------------------------------------------------------------------------
-- Writer badge applications; only staff can issue/revoke the actual badge.
-- ---------------------------------------------------------------------------
create table public.badge_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_type text not null check (badge_type in ('consistent_writer','featured_writer')),
  portfolio_note text not null default '',
  status text not null default 'received' check (status in ('received','in_review','approved','declined','withdrawn')),
  staff_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint badge_application_note_length check (char_length(portfolio_note) <= 2000)
);
create unique index badge_applications_one_pending_idx on public.badge_applications(user_id,badge_type)
  where status in ('received','in_review');
create index badge_applications_status_idx on public.badge_applications(status,created_at desc);
create trigger badge_applications_updated before update on public.badge_applications
  for each row execute function private.set_updated_at();
create trigger badge_applications_audit after update of status on public.badge_applications
  for each row execute function private.log_staff_status_change();
alter table public.badge_applications enable row level security;
create policy badge_applications_read_owner_or_staff on public.badge_applications
  for select to authenticated using (user_id = (select auth.uid())
    or (select private.has_role(array['admin','moderator']::text[])));
create policy badge_applications_insert_own on public.badge_applications
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy badge_applications_update_staff on public.badge_applications
  for update to authenticated using ((select private.has_role(array['admin']::text[])))
  with check ((select private.has_role(array['admin']::text[])));
grant select on public.badge_applications to authenticated;
grant insert(user_id,badge_type,portfolio_note) on public.badge_applications to authenticated;
grant update(status,staff_note,reviewed_by,reviewed_at) on public.badge_applications to authenticated;

-- ---------------------------------------------------------------------------
-- Platform donation requests. This is a manual, Pakistan-only pilot ledger,
-- NOT a payment gateway. Staff must verify an external receipt before marking
-- a donation confirmed. Claimed country is not identity/location proof.
-- ---------------------------------------------------------------------------
create table public.platform_donation_intents (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.profiles(id) on delete cascade,
  claimed_country_code text not null default 'PK' check (claimed_country_code = 'PK'),
  amount numeric(12,2) not null check (amount between 100 and 5000000),
  currency text not null default 'PKR' check (currency = 'PKR'),
  method text not null check (method in ('jazzcash','easypaisa','bank_transfer')),
  transaction_reference text not null default '',
  donor_note text not null default '',
  status text not null default 'submitted' check (status in ('submitted','under_review','confirmed','rejected')),
  staff_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_donation_reference_length check (char_length(transaction_reference) <= 120),
  constraint platform_donation_note_length check (char_length(donor_note) <= 1000)
);
create index platform_donations_status_idx on public.platform_donation_intents(status, created_at desc);
create index platform_donations_donor_idx on public.platform_donation_intents(donor_id, created_at desc);
create trigger platform_donations_audit after update of status on public.platform_donation_intents
  for each row execute function private.log_staff_status_change();
alter table public.platform_donation_intents enable row level security;
create policy platform_donations_read_owner_or_staff on public.platform_donation_intents
  for select to authenticated using (donor_id = (select auth.uid())
    or (select private.has_role(array['admin','support_agent']::text[])));
create policy platform_donations_insert_owner_pk on public.platform_donation_intents
  for insert to authenticated with check (donor_id = (select auth.uid()) and claimed_country_code = 'PK'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.country_code = 'PK'));
create policy platform_donations_update_admin on public.platform_donation_intents
  for update to authenticated using ((select private.has_role(array['admin']::text[])))
  with check ((select private.has_role(array['admin']::text[])));
grant select on public.platform_donation_intents to authenticated;
grant insert(donor_id,claimed_country_code,amount,currency,method,transaction_reference,donor_note)
  on public.platform_donation_intents to authenticated;
grant update(status,staff_note,reviewed_by,reviewed_at) on public.platform_donation_intents to authenticated;

-- Moderators may update only account active status; users cannot self-deactivate
-- or change staff flags because column-level grants are restricted.
create policy profiles_staff_update_active on public.profiles
  for update to authenticated using ((select private.has_role(array['admin','moderator']::text[])))
  with check ((select private.has_role(array['admin','moderator']::text[])));
grant update(is_active) on public.profiles to authenticated;

-- Team applications may include personal content; keep attachments in a private bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('team-applications','team-applications',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
create policy team_files_read_owner_or_staff on storage.objects
  for select to authenticated using (bucket_id = 'team-applications' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.has_role(array['admin','support_agent']::text[]))
  ));
create policy team_files_insert_owner on storage.objects
  for insert to authenticated with check (bucket_id = 'team-applications'
    and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy team_files_delete_owner_or_admin on storage.objects
  for delete to authenticated using (bucket_id = 'team-applications' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.has_role(array['admin']::text[]))
  ));

-- Expose table privileges explicitly: RLS still controls every row.
grant usage on schema public to authenticated;
grant select on public.staff_audit_log, public.feedback_ticket_messages,
  public.volunteer_applications, public.badge_applications,
  public.platform_donation_intents, public.push_deliveries to authenticated;

commit;
