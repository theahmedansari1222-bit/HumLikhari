-- Staff-only workflows, notification event expansion and transactional badge review.
begin;


-- Role changes are performed by a private SECURITY DEFINER function after an
-- explicit auth.uid() + admin-role check. Only the narrow invoker RPC is public.
create or replace function private.change_user_role(
  p_user_id uuid, p_role text, p_operation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not private.has_role(array['admin']::text[]) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_role not in ('admin','moderator','support_agent') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if p_operation not in ('grant','revoke') then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  if p_user_id = v_actor and p_role = 'admin' and p_operation = 'revoke' then
    raise exception 'self_admin_revoke_not_allowed' using errcode = '55000';
  end if;
  if p_operation = 'grant' then
    insert into private.user_roles(user_id,role,created_by)
    values (p_user_id,p_role,v_actor) on conflict (user_id,role) do nothing;
  else
    delete from private.user_roles where user_id = p_user_id and role = p_role;
  end if;
  insert into public.staff_audit_log(actor_id,action,entity_type,entity_id,details)
  values (v_actor,case when p_operation='grant' then 'role_granted' else 'role_revoked' end,
    'user_roles',p_user_id::text,jsonb_build_object('role',p_role));
end;
$$;
revoke all on function private.change_user_role(uuid,text,text) from public,anon,authenticated;
grant execute on function private.change_user_role(uuid,text,text) to authenticated;

create or replace function public.manage_user_role(p_user_id uuid,p_role text,p_operation text)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.change_user_role(p_user_id,p_role,p_operation); $$;
revoke all on function public.manage_user_role(uuid,text,text) from public,anon;
grant execute on function public.manage_user_role(uuid,text,text) to authenticated;


-- Staff can inspect inactive profiles to review/restore an account; regular users
-- still see only active public profiles or their own profile.
create policy profiles_read_staff on public.profiles
  for select to authenticated using ((select private.has_role(array['admin','moderator']::text[])));

-- A deactivated account's comments no longer appear to other readers.
drop policy if exists comments_read_anon on public.comments;
create policy comments_read_anon on public.comments
  for select to anon using (
    status = 'visible'
    and exists (select 1 from public.profiles cp where cp.id = author_id and cp.is_active = true)
    and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published')
  );
drop policy if exists comments_read_auth on public.comments;
create policy comments_read_auth on public.comments
  for select to authenticated using (
    (status = 'visible'
      and exists (select 1 from public.profiles cp where cp.id = comments.author_id and cp.is_active = true)
      and not (select private.is_blocked_user(comments.author_id))
      and exists (select 1 from public.posts p where p.id = post_id and p.status = 'published'
        and exists (select 1 from public.profiles pp where pp.id = p.author_id and pp.is_active = true)
        and not (select private.is_blocked_user(p.author_id)))
    )
    or author_id = (select auth.uid())
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
    or (select private.has_role(array['admin','moderator']::text[]))
  );

-- Inactive users cannot create new follow relationships.
drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert to authenticated with check (
    follower_id = (select auth.uid())
    and (select private.is_active_user())
    and exists (select 1 from public.profiles p where p.id = following_id and p.is_active = true)
    and not (select private.is_blocked_user(following_id))
  );

-- A writer can acknowledge a reader-reported P2P transfer; the sender cannot
-- mark their own transfer as received/verified.
create policy writer_support_acknowledge on public.writer_support_claims
  for update to authenticated
  using (creator_id = (select auth.uid()) and status = 'sender_reported_sent')
  with check (creator_id = (select auth.uid()) and status = 'creator_acknowledged');
grant update(status) on public.writer_support_claims to authenticated;

create or replace function private.notify_writer_support_ack()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status = 'creator_acknowledged' then
    insert into public.notifications(recipient_id,actor_id,event_type,support_claim_id)
    values (new.sender_id,new.creator_id,'writer_support',new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.notify_writer_support_ack() from public,anon,authenticated;
create trigger writer_support_ack_notify after update of status on public.writer_support_claims
  for each row execute function private.notify_writer_support_ack();

-- Extend event vocabulary without exposing private operational records.
alter table public.notifications drop constraint notifications_event_type_check;
alter table public.notifications add constraint notifications_event_type_check
  check (event_type in ('post_like','comment','new_follower','writer_support',
    'ticket_reply','badge_update','team_update','platform_donation_update','system'));
alter table public.notifications drop constraint notifications_target_check;
alter table public.notifications add constraint notifications_target_check check (
  (event_type = 'post_like' and post_id is not null and comment_id is null and support_claim_id is null)
  or (event_type = 'comment' and (post_id is not null or comment_id is not null) and support_claim_id is null)
  or (event_type = 'new_follower' and post_id is null and comment_id is null and support_claim_id is null)
  or (event_type = 'writer_support' and support_claim_id is not null and post_id is null and comment_id is null)
  or (event_type in ('ticket_reply','badge_update','team_update','platform_donation_update','system')
      and post_id is null and comment_id is null and support_claim_id is null)
);

-- Acquisition survey analytics are visible only to staff.
create policy acquisition_survey_read_staff on public.onboarding_surveys
  for select to authenticated using ((select private.has_role(array['admin','support_agent']::text[])));

-- A badge decision and the actual badge grant happen atomically.
create or replace function public.review_badge_application(
  p_application_id uuid,
  p_decision text,
  p_staff_note text default ''
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_app public.badge_applications%rowtype;
begin
  if not private.has_role(array['admin']::text[]) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_decision not in ('approved','declined','in_review') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  select * into v_app from public.badge_applications
    where id = p_application_id for update;
  if not found then raise exception 'application_not_found' using errcode = 'P0002'; end if;
  if v_app.status in ('approved','declined','withdrawn') then
    raise exception 'application_already_closed' using errcode = '55000';
  end if;
  update public.badge_applications
    set status = p_decision, staff_note = left(coalesce(p_staff_note,''),2000),
        reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_application_id;
  if p_decision = 'approved' then
    insert into public.writer_badges(user_id,badge_type,reason,assigned_by)
    values (v_app.user_id,v_app.badge_type,left(coalesce(p_staff_note,'منظوری شد'),1000),(select auth.uid()))
    on conflict do nothing;
  end if;
end;
$$;
revoke all on function public.review_badge_application(uuid,text,text) from public, anon;
grant execute on function public.review_badge_application(uuid,text,text) to authenticated;

-- Staff replies create an in-app notification for the ticket owner.
create or replace function private.notify_ticket_reply()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid;
begin
  if new.is_internal then return new; end if;
  if not private.has_role(array['admin','support_agent']::text[]) then return new; end if;
  select user_id into v_owner from public.feedback_tickets where id = new.ticket_id;
  if v_owner is not null and v_owner <> new.author_id then
    insert into public.notifications(recipient_id,actor_id,event_type)
    values (v_owner,new.author_id,'ticket_reply');
  end if;
  return new;
end;
$$;
revoke all on function private.notify_ticket_reply() from public,anon,authenticated;
create trigger ticket_messages_notify after insert on public.feedback_ticket_messages
  for each row execute function private.notify_ticket_reply();

-- Notify applicants when staff reviews their application.
create or replace function private.notify_application_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_recipient uuid; v_event text;
begin
  if old.status is not distinct from new.status then return new; end if;
  if tg_table_name = 'badge_applications' then v_recipient := new.user_id; v_event := 'badge_update';
  elsif tg_table_name = 'volunteer_applications' then v_recipient := new.applicant_id; v_event := 'team_update';
  elsif tg_table_name = 'platform_donation_intents' then v_recipient := new.donor_id; v_event := 'platform_donation_update';
  else return new; end if;
  insert into public.notifications(recipient_id,event_type)
  values (v_recipient,v_event);
  return new;
end;
$$;
revoke all on function private.notify_application_status() from public,anon,authenticated;
create trigger badge_application_notify after update of status on public.badge_applications
  for each row execute function private.notify_application_status();
create trigger volunteer_application_notify after update of status on public.volunteer_applications
  for each row execute function private.notify_application_status();
create trigger platform_donation_notify after update of status on public.platform_donation_intents
  for each row execute function private.notify_application_status();

commit;
