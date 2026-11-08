-- Canonicalize Space post expiry against the database clock.
-- This prevents device clock/time-zone differences and media-upload time
-- from shortening the visibility period selected by the publisher.

begin;

create or replace function public.set_ming_space_content_expiry()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_hours numeric;
  v_expiry timestamptz;
begin
  if new.kind not in ('business_post', 'friend_post') then
    return new;
  end if;

  if coalesce(new.payload->>'expiryMode', '') = 'never' then
    new.payload := jsonb_set(coalesce(new.payload, '{}'::jsonb), '{expiresAt}', 'null'::jsonb, true);
    return new;
  end if;

  if coalesce(new.payload->>'expiryMode', '') <> 'duration' then
    return new;
  end if;

  begin
    v_hours := nullif(new.payload->>'expiryDurationHours', '')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_hours := null;
  end;

  if v_hours is null or v_hours <= 0 then
    if new.kind = 'business_post' or new.payload->>'postFormat' = 'story' then
      v_hours := 24;
    else
      -- Invalid or missing duration must never cause immediate expiry.
      new.payload := jsonb_set(coalesce(new.payload, '{}'::jsonb), '{expiryMode}', '"never"'::jsonb, true);
      new.payload := jsonb_set(new.payload, '{expiryDurationHours}', 'null'::jsonb, true);
      new.payload := jsonb_set(new.payload, '{expiresAt}', 'null'::jsonb, true);
      return new;
    end if;
  end if;

  v_expiry := coalesce(new.created_at, now()) + make_interval(secs => (v_hours * 3600)::double precision);
  new.payload := jsonb_set(coalesce(new.payload, '{}'::jsonb), '{expiryMode}', '"duration"'::jsonb, true);
  new.payload := jsonb_set(new.payload, '{expiryDurationHours}', to_jsonb(v_hours), true);
  new.payload := jsonb_set(
    new.payload,
    '{expiresAt}',
    to_jsonb((extract(epoch from v_expiry) * 1000)::bigint),
    true
  );

  return new;
end;
$function$;

drop trigger if exists trg_ming_space_content_expiry on public.ming_space_content;

create trigger trg_ming_space_content_expiry
before insert on public.ming_space_content
for each row
execute function public.set_ming_space_content_expiry();

commit;
