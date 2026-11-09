-- Allow the existing Romantic Space "Thinking of You" action to publish love_note content.
-- Keep it behind the same loveletter feature switch as sealed letters.
create or replace function public.enforce_ming_business_post_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_allowed text[];
  v_feature_key text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if new.author_id is distinct from v_user then
    raise exception 'Space content must be authored by the signed-in member';
  end if;
  if jsonb_typeof(coalesce(new.payload,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(new.payload,'{}'::jsonb)::text) > 65536 then
    raise exception 'Space content payload is invalid or too large';
  end if;

  select s.* into v_space from public.ming_spaces s where s.id = new.space_id;
  if not found then raise exception 'Space not found'; end if;

  select m.role into v_role
  from public.ming_space_members m
  where m.space_id = new.space_id and m.user_id = v_user and m.approved = true;
  if v_role is null or v_role = 'guest' then
    raise exception 'Approved, write-enabled Space membership is required';
  end if;

  v_allowed := case v_space.nature
    when 'business' then array['business_post','doc','announcement','task']
    when 'friendly' then array['friend_post','moment','poll','event','memory']
    when 'casual' then array['now','answer','event','meeting','poll']
    when 'romantic' then array['memory','love_note','love_letter','plan','milestone','nickname','health','list']
    else array[]::text[]
  end;
  if not (new.kind = any(v_allowed)) then
    raise exception 'That content type is not available in this Space';
  end if;

  v_feature_key := case
    when v_space.nature = 'business' and new.kind = 'doc' then 'documents'
    when v_space.nature = 'business' and new.kind = 'announcement' then 'announcements'
    when v_space.nature = 'business' and new.kind = 'task' then 'tasks'
    when v_space.nature = 'friendly' and new.kind in ('friend_post','moment') then 'moments'
    when v_space.nature = 'friendly' and new.kind = 'poll' then 'polls'
    when v_space.nature = 'friendly' and new.kind = 'event' then 'events'
    when v_space.nature = 'friendly' and new.kind = 'memory' then 'memories'
    when v_space.nature = 'casual' and new.kind in ('now','answer') then 'now'
    when v_space.nature = 'casual' and new.kind = 'poll' then 'polls'
    when v_space.nature = 'casual' and new.kind in ('event','meeting') then 'meet'
    when v_space.nature = 'romantic' and new.kind = 'memory' then 'memories'
    when v_space.nature = 'romantic' and new.kind in ('love_note','love_letter') then 'loveletter'
    when v_space.nature = 'romantic' and new.kind = 'plan' then 'plans'
    when v_space.nature = 'romantic' and new.kind = 'milestone' then 'milestones'
    when v_space.nature = 'romantic' and new.kind in ('nickname','list') then 'lists'
    else null
  end;

  if v_feature_key is not null
     and coalesce((v_space.features->>v_feature_key)::boolean,true) = false then
    raise exception 'This feature has been disabled by the Space owner';
  end if;

  if v_space.nature = 'business' then
    if new.kind = 'business_post'
       and coalesce(v_space.features->>'businessMessaging','everyone') = 'owner'
       and v_role <> 'owner' then
      raise exception 'Only the Space creator can publish Business posts';
    end if;
    if new.kind in ('doc','announcement','task')
       and v_role not in ('owner','admin','manager') then
      raise exception 'Only the creator, admins or managers can publish this Business content';
    end if;
  end if;

  return new;
end;
$function$;
