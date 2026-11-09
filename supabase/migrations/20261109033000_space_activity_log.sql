-- Tweaklr Business Space Activity Log
-- Run once in Supabase SQL Editor. This adds a durable, append-only history
-- without altering existing Space/content tables or policies.

create table if not exists public.ming_space_activity (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  actor_id uuid not null,
  event text not null check (char_length(event) between 2 and 80),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ming_space_activity_space_created_idx
  on public.ming_space_activity(space_id, created_at desc);
create index if not exists ming_space_activity_actor_idx
  on public.ming_space_activity(actor_id, created_at desc);

alter table public.ming_space_activity enable row level security;
revoke all on table public.ming_space_activity from anon, authenticated;

-- The log is append-only for application users. Even if a client obtains a
-- row identifier, direct UPDATE/DELETE is not granted; the trigger is a second guard.
create or replace function public.reject_ming_space_activity_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Space activity records are append-only';
end;
$$;

drop trigger if exists ming_space_activity_no_mutation on public.ming_space_activity;
create trigger ming_space_activity_no_mutation
before update on public.ming_space_activity
for each row execute function public.reject_ming_space_activity_mutation();

-- The app may record an event only for a Space the authenticated caller belongs to.
-- Metadata is deliberately allow-listed so sensitive payloads/reasons are not logged.
create or replace function public.record_ming_space_activity(
  p_space_id uuid,
  p_event text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_meta jsonb := '{}'::jsonb;
  v_id uuid;
  v_created_at timestamptz;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if p_space_id is null or p_event is null or p_event !~ '^[a-z][a-z0-9_.-]{1,79}$' then
    raise exception 'Invalid activity event';
  end if;
  if jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_meta, '{}'::jsonb)::text) > 3000 then
    raise exception 'Invalid activity metadata';
  end if;
  if not exists (
    select 1 from public.ming_space_members m
    where m.space_id = p_space_id
      and m.user_id = v_user
      and m.approved = true
  ) then
    raise exception 'You must be an approved Space member to record activity';
  end if;

  case p_event
    when 'content.created' then
      v_meta := jsonb_build_object('kind', left(coalesce(p_meta->>'kind', 'content'), 40));
    when 'task.toggled' then
      v_meta := jsonb_build_object('done', coalesce((p_meta->>'done')::boolean, false));
    when 'member.role_changed' then
      v_meta := jsonb_build_object('role', left(coalesce(p_meta->>'role', ''), 30));
    when 'invite.issued' then
      v_meta := jsonb_build_object('version', greatest(1, coalesce((p_meta->>'version')::integer, 1)));
    when 'invite.rotated' then
      v_meta := jsonb_build_object('version', greatest(1, coalesce((p_meta->>'version')::integer, 1)));
    when 'product.listed' then
      v_meta := '{}'::jsonb;
    when 'order.created' then
      v_meta := '{}'::jsonb;
    when 'dispute.opened' then
      v_meta := '{}'::jsonb;
    when 'dispute.evidence_added' then
      v_meta := jsonb_build_object('kind', left(coalesce(p_meta->>'kind', ''), 30));
    when 'document.uploaded' then
      v_meta := '{}'::jsonb;
    when 'document.renamed' then
      v_meta := '{}'::jsonb;
    when 'document.categorized' then
      v_meta := '{}'::jsonb;
    when 'document.deleted' then
      v_meta := '{}'::jsonb;
    else
      v_meta := '{}'::jsonb;
  end case;

  insert into public.ming_space_activity(space_id, actor_id, event, meta)
  values (p_space_id, v_user, p_event, v_meta)
  returning id, created_at into v_id, v_created_at;

  return jsonb_build_object('id', v_id, 'created_at', v_created_at);
end;
$$;

create or replace function public.get_my_ming_space_activity()
returns table (
  id uuid,
  space_id uuid,
  actor_id uuid,
  event text,
  meta jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select recent.id, recent.space_id, recent.actor_id, recent.event, recent.meta, recent.created_at
  from (
    select a.id, a.space_id, a.actor_id, a.event, a.meta, a.created_at
    from public.ming_space_activity a
    where exists (
      select 1 from public.ming_space_members m
      where m.space_id = a.space_id
        and m.user_id = (select auth.uid())
        and m.approved = true
    )
    order by a.created_at desc
    limit 500
  ) recent
  order by recent.created_at asc;
$$;

revoke all on function public.reject_ming_space_activity_mutation() from public, anon, authenticated;
revoke all on function public.record_ming_space_activity(uuid, text, jsonb) from public, anon;
revoke all on function public.get_my_ming_space_activity() from public, anon;
grant execute on function public.record_ming_space_activity(uuid, text, jsonb) to authenticated;
grant execute on function public.get_my_ming_space_activity() to authenticated;
