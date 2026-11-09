begin;

-- The app and discovery RPCs use profiles.discoverable. The legacy
-- is_discoverable column is retained for compatibility but is not authoritative.
alter policy "Users can view discoverable profiles"
on public.profiles
using (discoverable = true or id = (select auth.uid()));

-- Enforce the username/display-name policy at the database boundary, not only
-- in browser validation.
alter table public.profiles
  add constraint profiles_username_format_check
  check (username ~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$') not valid;
alter table public.profiles validate constraint profiles_username_format_check;

alter table public.profiles
  add constraint profiles_display_name_length_check
  check (
    display_name is null
    or (
      char_length(btrim(display_name)) between 1 and 60
      and display_name !~ '[[:cntrl:]]'
    )
  ) not valid;
alter table public.profiles validate constraint profiles_display_name_length_check;

-- Users can edit only profile fields used by the current UI. Username changes
-- must go through change_username(), which enforces the three-month cooldown.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, bio, headline, interests, tags, activity, discoverable)
  on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_username text := lower(btrim(coalesce(new.raw_user_meta_data->>'username','')));
  v_display_name text := btrim(coalesce(new.raw_user_meta_data->>'display_name',''));
begin
  if v_username !~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$' then
    raise exception 'Username must be 3–30 characters and use letters, numbers, underscores or hyphens';
  end if;
  if char_length(v_display_name) not between 1 and 60
     or v_display_name ~ '[[:cntrl:]]' then
    raise exception 'Display name must be 1–60 characters';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name);

  return new;
end;
$function$;

create or replace function public.change_username(new_username text)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  existing_username text;
  last_changed timestamptz;
  clean_username text;
  changed_at timestamptz;
begin
  if current_user_id is null then raise exception 'Not authenticated'; end if;

  clean_username := lower(trim(new_username));
  if clean_username !~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$' then
    raise exception 'Username must be 3–30 characters and use letters, numbers, underscores or hyphens';
  end if;

  select p.username,p.username_changed_at
  into existing_username,last_changed
  from public.profiles p
  where p.id = current_user_id
  for update;

  if existing_username is null then raise exception 'Profile not found'; end if;
  if existing_username = clean_username then
    return json_build_object('username',clean_username,'username_changed_at',last_changed);
  end if;
  if last_changed is not null and now() < last_changed + interval '3 months' then
    raise exception 'Username can only be changed once every 3 months';
  end if;

  changed_at := now();
  update public.profiles
  set username=clean_username,username_changed_at=changed_at,updated_at=changed_at
  where id=current_user_id;

  return json_build_object('username',clean_username,'username_changed_at',changed_at);
exception
  when unique_violation then raise exception 'Username already exists';
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.change_username(text) from public, anon, authenticated;
grant execute on function public.change_username(text) to authenticated;

commit;