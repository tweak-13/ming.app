begin;

create or replace function public.enforce_ming_business_post_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_nature text;
  v_features jsonb;
  v_role text;
begin
  if new.kind <> 'business_post' then return new; end if;

  select s.nature, s.features into v_nature, v_features
  from public.ming_spaces s where s.id = new.space_id;
  if v_nature <> 'business' then
    raise exception 'Business Home posts are only available in Business Spaces';
  end if;

  select m.role into v_role
  from public.ming_space_members m
  where m.space_id = new.space_id and m.user_id = (select auth.uid()) and m.approved = true;
  if v_role is null then raise exception 'Approved Business Space membership required'; end if;

  if coalesce(v_features->>'businessMessaging', 'everyone') = 'owner'
     and v_role <> 'owner' then
    raise exception 'Only the creator can publish in this Business Space';
  end if;
  return new;
end;
$function$;

drop trigger if exists ming_business_post_policy_guard on public.ming_space_content;
create trigger ming_business_post_policy_guard
before insert on public.ming_space_content
for each row execute function public.enforce_ming_business_post_policy();

revoke all on function public.enforce_ming_business_post_policy() from public, anon, authenticated;

commit;