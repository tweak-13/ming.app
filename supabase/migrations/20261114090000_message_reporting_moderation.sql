-- Message reporting and threshold-based account review.
-- Three distinct connected users reporting the same account opens a 7-day review suspension.
create table if not exists public.message_user_reports (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  reason text not null check (reason in ('harassment','hate_or_abuse','scam_or_fraud','sexual_content','threats_or_violence','illegal_activity','spam','other')),
  details text,
  message_snapshot text,
  attachment_mime text,
  attachment_path text,
  created_at timestamptz not null default now(),
  unique (target_user_id, reporter_user_id)
);
create index if not exists message_user_reports_target_created_idx
  on public.message_user_reports(target_user_id, created_at desc);

create table if not exists public.account_moderation_cases (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'pending_review'
    check (status in ('pending_review','suspended_review','cleared','confirmed_violation','closed')),
  distinct_report_count integer not null default 0,
  suspension_until timestamptz,
  suspension_applied boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete set null,
  review_notes text
);
alter table public.message_user_reports enable row level security;
alter table public.account_moderation_cases enable row level security;
revoke all on public.message_user_reports, public.account_moderation_cases from anon, authenticated;
grant select on public.message_user_reports, public.account_moderation_cases to authenticated;

drop policy if exists "Moderators can read message reports" on public.message_user_reports;
create policy "Moderators can read message reports" on public.message_user_reports
for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','moderator'));
drop policy if exists "Moderators can read moderation cases" on public.account_moderation_cases;
create policy "Moderators can read moderation cases" on public.account_moderation_cases
for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','moderator'));

create or replace function public.submit_message_user_report(
  p_message_id uuid, p_reason text, p_details text default null
)
returns table(report_count integer, review_case_created boolean, target_user_id uuid)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_reporter uuid := auth.uid();
  v_target uuid;
  v_body text;
  v_mime text;
  v_attachment_path text;
  v_count integer;
  v_rows integer := 0;
  v_case_created boolean := false;
begin
  if v_reporter is null then raise exception 'You must be signed in to report a message.'; end if;
  if p_reason not in ('harassment','hate_or_abuse','scam_or_fraud','sexual_content','threats_or_violence','illegal_activity','spam','other') then
    raise exception 'Choose a valid report reason.';
  end if;
  select m.sender_id,m.body,m.attachment_mime,m.attachment_path
    into v_target,v_body,v_mime,v_attachment_path
  from public.messages m where m.id=p_message_id and m.sender_id<>v_reporter and m.recipient_id=v_reporter;
  if v_target is null then raise exception 'You can only report a message sent to you in this conversation.'; end if;
  if not exists (
    select 1 from public.connections c where c.status='accepted'
    and ((c.requester_id=v_reporter and c.recipient_id=v_target) or (c.recipient_id=v_reporter and c.requester_id=v_target))
  ) then raise exception 'You can only report someone you are connected to.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_target::text,0));
  insert into public.message_user_reports(target_user_id,reporter_user_id,message_id,reason,details,message_snapshot,attachment_mime,attachment_path)
  values(v_target,v_reporter,p_message_id,p_reason,nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_details,'')),1000),''),
    pg_catalog.left(coalesce(v_body,''),4000),v_mime,v_attachment_path)
  on conflict(target_user_id,reporter_user_id) do nothing;
  select pg_catalog.count(distinct r.reporter_user_id)::integer into v_count
  from public.message_user_reports r where r.target_user_id=v_target;
  if v_count>=3 then
    insert into public.account_moderation_cases(target_user_id,status,distinct_report_count,suspension_until)
    values(v_target,'suspended_review',v_count,pg_catalog.now()+interval '7 days')
    on conflict(target_user_id) do nothing;
    get diagnostics v_rows = row_count;
    v_case_created := v_rows>0;
  end if;
  return query select v_count,v_case_created,v_target;
end;
$function$;
revoke all on function public.submit_message_user_report(uuid,text,text) from public, anon;
grant execute on function public.submit_message_user_report(uuid,text,text) to authenticated;
