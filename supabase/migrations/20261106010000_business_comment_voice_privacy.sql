-- Business Space post comments v2: text, voice, anonymous, private and view-once voice notes.
-- Run once in Supabase SQL Editor. This migration is additive to the Spaces schema.

create table if not exists public.ming_business_space_post_comments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.ming_space_content(id) on delete cascade,
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  anonymous boolean not null default false,
  private_to_author boolean not null default false,
  voice_path text,
  voice_duration integer,
  voice_view_once boolean not null default false,
  voice_viewed_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint ming_business_comment_body_length check (char_length(body) <= 1000),
  constraint ming_business_comment_has_content check (char_length(btrim(body)) > 0 or voice_path is not null),
  constraint ming_business_comment_voice_duration check (voice_duration is null or voice_duration between 1 and 120),
  constraint ming_business_comment_voice_path check (voice_path is null or (voice_path !~ '/' and voice_path ~ '^[a-zA-Z0-9._-]+$')),
  constraint ming_business_comment_view_once_requires_voice check (voice_view_once = false or voice_path is not null)
);

alter table public.ming_business_space_post_comments
  add column if not exists voice_view_once boolean not null default false,
  add column if not exists voice_viewed_by uuid[] not null default '{}';

create index if not exists ming_business_comments_content_created_idx
  on public.ming_business_space_post_comments(content_id, created_at);

alter table public.ming_business_space_post_comments enable row level security;
revoke all on table public.ming_business_space_post_comments from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ming-business-comment-voice','ming-business-comment-voice',false,10485760,array['audio/webm','audio/ogg','audio/mp4','audio/mpeg'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Business comment voice upload own" on storage.objects;
create policy "Business comment voice upload own"
on storage.objects for insert to authenticated
with check (bucket_id='ming-business-comment-voice' and owner_id=(select auth.uid())::text);

drop policy if exists "Business comment voice read permitted" on storage.objects;
create policy "Business comment voice read permitted"
on storage.objects for select to authenticated
using (
  bucket_id='ming-business-comment-voice'
  and exists (
    select 1
    from public.ming_business_space_post_comments c
    join public.ming_space_content p on p.id=c.content_id
    join public.ming_space_members m on m.space_id=c.space_id and m.user_id=(select auth.uid()) and m.approved=true
    where c.voice_path=storage.objects.name
      and p.kind='business_post'
      and ((not c.private_to_author) or c.author_id=(select auth.uid()) or p.author_id=(select auth.uid()))
  )
);

drop policy if exists "Business comment voice delete own" on storage.objects;
create policy "Business comment voice delete own"
on storage.objects for delete to authenticated
using (bucket_id='ming-business-comment-voice' and owner_id=(select auth.uid())::text);

create or replace function public.get_ming_business_space_post_comments(p_content_id uuid)
returns setof jsonb
language sql
security definer
set search_path = ''
stable
as $function$
  select jsonb_build_object(
    'id',c.id,
    'body',c.body,
    'anonymous',c.anonymous,
    'private_to_author',c.private_to_author,
    'voice_path',c.voice_path,
    'voice_duration',c.voice_duration,
    'voice_view_once',c.voice_view_once,
    'voice_viewed',(select auth.uid()) = any(c.voice_viewed_by),
    'created_at_ms',floor(extract(epoch from c.created_at)*1000)::bigint,
    'author_display_name',case when c.anonymous then null else coalesce(pr.display_name,pr.username,'Space member') end,
    'author_username',case when c.anonymous then null else pr.username end,
    'author_avatar_url',case when c.anonymous then null else pr.avatar_url end
  )
  from public.ming_business_space_post_comments c
  join public.ming_space_content p on p.id=c.content_id
  join public.ming_space_members m on m.space_id=c.space_id and m.user_id=(select auth.uid()) and m.approved=true
  left join public.profiles pr on pr.id=c.author_id
  where c.content_id=p_content_id
    and p.kind='business_post'
    and exists (select 1 from public.ming_spaces s where s.id=c.space_id and s.nature='business')
    and ((not c.private_to_author) or c.author_id=(select auth.uid()) or p.author_id=(select auth.uid()))
  order by c.created_at asc;
$function$;

drop function if exists public.add_ming_business_space_post_comment_v2(uuid,text,boolean,boolean,text,integer);
create or replace function public.add_ming_business_space_post_comment_v2(
  p_content_id uuid,
  p_text text default '',
  p_anonymous boolean default false,
  p_private_to_author boolean default false,
  p_voice_path text default null,
  p_voice_duration integer default null,
  p_voice_view_once boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space_id uuid;
  v_comment public.ming_business_space_post_comments;
  v_profile public.profiles;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_text,''))) > 1000 then raise exception 'Comment must be 1000 characters or fewer'; end if;
  if char_length(btrim(coalesce(p_text,'')))=0 and p_voice_path is null then raise exception 'Write a comment or attach a voice note'; end if;
  if p_voice_duration is not null and p_voice_duration not between 1 and 120 then raise exception 'Voice notes must be 1–120 seconds'; end if;
  if p_voice_path is not null and (p_voice_path ~ '/' or p_voice_path !~ '^[a-zA-Z0-9._-]+$') then
    raise exception 'Invalid voice note file path';
  end if;
  if p_voice_view_once and p_voice_path is null then raise exception 'View once is available for voice notes only'; end if;

  select p.space_id into v_space_id
  from public.ming_space_content p
  join public.ming_spaces s on s.id=p.space_id and s.nature='business'
  where p.id=p_content_id and p.kind='business_post'
  for update of p;
  if not found then raise exception 'Business post not found'; end if;

  if not exists (
    select 1 from public.ming_space_members m
    where m.space_id=v_space_id and m.user_id=v_user and m.approved=true
  ) then raise exception 'Approved Business Space membership required'; end if;

  if p_voice_path is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id='ming-business-comment-voice' and o.name=p_voice_path and o.owner_id=v_user::text
  ) then raise exception 'Voice note upload was not found'; end if;

  insert into public.ming_business_space_post_comments(
    content_id,space_id,author_id,body,anonymous,private_to_author,voice_path,voice_duration,voice_view_once
  ) values (
    p_content_id,v_space_id,v_user,btrim(coalesce(p_text,'')),coalesce(p_anonymous,false),
    coalesce(p_private_to_author,false),p_voice_path,p_voice_duration,coalesce(p_voice_view_once,false)
  ) returning * into v_comment;

  select * into v_profile from public.profiles where id=v_user;
  return jsonb_build_object(
    'id',v_comment.id,'body',v_comment.body,'anonymous',v_comment.anonymous,
    'private_to_author',v_comment.private_to_author,'voice_path',v_comment.voice_path,
    'voice_duration',v_comment.voice_duration,'voice_view_once',v_comment.voice_view_once,
    'voice_viewed',false,
    'created_at_ms',floor(extract(epoch from v_comment.created_at)*1000)::bigint,
    'author_display_name',case when v_comment.anonymous then null else coalesce(v_profile.display_name,v_profile.username,'Space member') end,
    'author_username',case when v_comment.anonymous then null else v_profile.username end,
    'author_avatar_url',case when v_comment.anonymous then null else v_profile.avatar_url end
  );
end;
$function$;

create or replace function public.claim_ming_business_space_comment_voice_once(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_author uuid;
  v_post_author uuid;
  v_view_once boolean;
  v_viewed_by uuid[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select c.author_id,p.author_id,c.voice_view_once,c.voice_viewed_by
    into v_author,v_post_author,v_view_once,v_viewed_by
  from public.ming_business_space_post_comments c
  join public.ming_space_content p on p.id=c.content_id and p.kind='business_post'
  join public.ming_spaces s on s.id=c.space_id and s.nature='business'
  join public.ming_space_members m on m.space_id=c.space_id and m.user_id=v_user and m.approved=true
  where c.id=p_comment_id
    and ((not c.private_to_author) or c.author_id=v_user or p.author_id=v_user)
  for update of c;

  if not found then raise exception 'Voice note is not available to you'; end if;
  if not v_view_once then return true; end if;
  if v_author=v_user then return true; end if;
  if v_user=any(coalesce(v_viewed_by,'{}'::uuid[])) then return false; end if;

  update public.ming_business_space_post_comments
    set voice_viewed_by=array_append(coalesce(voice_viewed_by,'{}'::uuid[]),v_user)
    where id=p_comment_id;
  return true;
end;
$function$;

revoke all on function public.get_ming_business_space_post_comments(uuid) from public,anon;
revoke all on function public.add_ming_business_space_post_comment_v2(uuid,text,boolean,boolean,text,integer,boolean) from public,anon;
revoke all on function public.claim_ming_business_space_comment_voice_once(uuid) from public,anon;
grant execute on function public.get_ming_business_space_post_comments(uuid) to authenticated;
grant execute on function public.add_ming_business_space_post_comment_v2(uuid,text,boolean,boolean,text,integer,boolean) to authenticated;
grant execute on function public.claim_ming_business_space_comment_voice_once(uuid) to authenticated;

notify pgrst,'reload schema';
