-- Ming Spaces Workspace v2
-- Run AFTER supabase_spaces_migration.sql.
-- Adds persistent workspace content, marketplace listings, themes, media metadata,
-- real invitation rotation, and secure private Space media storage.

alter table public.ming_spaces
  add column if not exists theme jsonb not null default '{}'::jsonb;

create table if not exists public.ming_space_content (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (char_length(btrim(kind)) between 1 and 40),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ming_space_content_space_created_idx
  on public.ming_space_content(space_id, created_at desc);
create index if not exists ming_space_content_author_idx
  on public.ming_space_content(author_id);

create table if not exists public.ming_space_products (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  price numeric(18,2) not null check (price > 0),
  asset text not null default 'USDT',
  condition text not null default 'Used',
  category text not null default 'Other',
  qty integer not null default 1 check (qty > 0),
  handover text not null default 'Either',
  description text not null default '',
  media jsonb not null default '[]'::jsonb,
  status text not null default 'listed' check (status in ('listed','reserved','sold','removed')),
  auction jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ming_space_products_space_idx
  on public.ming_space_products(space_id, created_at desc);
create index if not exists ming_space_products_seller_idx
  on public.ming_space_products(seller_id);

create table if not exists public.ming_space_files (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ming_spaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid references public.ming_space_content(id) on delete cascade,
  product_id uuid references public.ming_space_products(id) on delete cascade,
  storage_path text not null unique,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  kind text not null default 'file',
  created_at timestamptz not null default now()
);

create index if not exists ming_space_files_space_idx
  on public.ming_space_files(space_id, created_at desc);

alter table public.ming_space_content enable row level security;
alter table public.ming_space_products enable row level security;
alter table public.ming_space_files enable row level security;

revoke all on table public.ming_space_content, public.ming_space_products, public.ming_space_files from anon;
grant select on public.ming_space_content, public.ming_space_products, public.ming_space_files to authenticated;

drop policy if exists "space members can read content" on public.ming_space_content;
create policy "space members can read content"
on public.ming_space_content for select to authenticated
using (
  exists (
    select 1 from public.ming_space_members m
    where m.space_id = ming_space_content.space_id
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
);

drop policy if exists "space members can read products" on public.ming_space_products;
create policy "space members can read products"
on public.ming_space_products for select to authenticated
using (
  exists (
    select 1 from public.ming_space_members m
    where m.space_id = ming_space_products.space_id
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
);

drop policy if exists "space members can read files" on public.ming_space_files;
create policy "space members can read files"
on public.ming_space_files for select to authenticated
using (
  exists (
    select 1 from public.ming_space_members m
    where m.space_id = ming_space_files.space_id
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
);

-- Storage bucket. Files themselves belong in Storage; their metadata/path belongs
-- in Postgres. This is the normal Supabase architecture for images/video/audio.
insert into storage.buckets (id, name, public)
values ('ming-space-media', 'ming-space-media', false)
on conflict (id) do update set public = false;

drop policy if exists "Space members upload media" on storage.objects;
create policy "Space members upload media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ming-space-media'
  and exists (
    select 1
    from public.ming_space_members m
    where m.space_id = split_part(name, '/', 1)::uuid
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
);

drop policy if exists "Space members read media" on storage.objects;
create policy "Space members read media"
on storage.objects for select to authenticated
using (
  bucket_id = 'ming-space-media'
  and exists (
    select 1
    from public.ming_space_members m
    where m.space_id = split_part(name, '/', 1)::uuid
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
);

drop policy if exists "Space members update own media" on storage.objects;
create policy "Space members update own media"
on storage.objects for update to authenticated
using (
  bucket_id = 'ming-space-media'
owner_id = (select auth.uid()::text)
with check (
  bucket_id = 'ming-space-media'
 owner_id = (select auth.uid()::text)

drop policy if exists "Space members delete own media" on storage.objects;
create policy "Space members delete own media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'ming-space-media'
owner_id = (select auth.uid()::text)

create or replace function public.get_my_ming_space_content()
returns table (
  id uuid,
  space_id uuid,
  author_id uuid,
  kind text,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select c.id, c.space_id, c.author_id, c.kind, c.payload, c.created_at, c.updated_at
  from public.ming_space_content c
  where exists (
    select 1 from public.ming_space_members m
    where m.space_id = c.space_id
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
  order by c.created_at desc;
$$;

create or replace function public.create_ming_space_content(
  p_space_id uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns public.ming_space_content
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.ming_space_content;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.ming_space_members
    where space_id = p_space_id and user_id = auth.uid() and approved = true
  ) then
    raise exception 'You are not a member of this Space.';
  end if;
  insert into public.ming_space_content(space_id, author_id, kind, payload)
  values(p_space_id, auth.uid(), btrim(p_kind), coalesce(p_payload, '{}'::jsonb))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_ming_space_content(
  p_id uuid,
  p_payload jsonb
)
returns public.ming_space_content
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.ming_space_content;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.ming_space_content c
  set payload = coalesce(p_payload, '{}'::jsonb), updated_at = now()
  where c.id = p_id
    and (
      c.author_id = auth.uid()
      or exists (
        select 1 from public.ming_spaces s
        where s.id = c.space_id and s.owner_id = auth.uid()
      )
    )
  returning * into v_row;
  if not found then raise exception 'Content not found or not permitted.'; end if;
  return v_row;
end;
$$;

create or replace function public.create_ming_space_product(
  p_space_id uuid,
  p_title text,
  p_price numeric,
  p_condition text,
  p_category text,
  p_handover text,
  p_description text default '',
  p_qty integer default 1,
  p_media jsonb default '[]'::jsonb,
  p_auction jsonb default '{}'::jsonb
)
returns public.ming_space_products
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.ming_space_products;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.ming_space_members
    where space_id = p_space_id and user_id = auth.uid()
      and approved = true and role in ('owner','seller')
  ) then
    raise exception 'You need the seller role in this Space.';
  end if;
  insert into public.ming_space_products(
    space_id,seller_id,title,price,condition,category,handover,description,qty,media,auction
  )
  values(
    p_space_id,auth.uid(),btrim(p_title),p_price,coalesce(p_condition,'Used'),
    coalesce(p_category,'Other'),coalesce(p_handover,'Either'),coalesce(p_description,''),
    greatest(coalesce(p_qty,1),1),coalesce(p_media,'[]'::jsonb),coalesce(p_auction,'{}'::jsonb)
  )
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.get_my_ming_space_products()
returns setof public.ming_space_products
language sql
security definer
set search_path = ''
stable
as $$
  select p.*
  from public.ming_space_products p
  where exists (
    select 1 from public.ming_space_members m
    where m.space_id = p.space_id
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
  order by p.created_at desc;
$$;

create or replace function public.record_ming_space_file(
  p_space_id uuid,
  p_storage_path text,
  p_filename text,
  p_content_type text,
  p_size_bytes bigint default 0,
  p_kind text default 'file',
  p_content_id uuid default null,
  p_product_id uuid default null
)
returns public.ming_space_files
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.ming_space_files;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.ming_space_members
    where space_id = p_space_id and user_id = auth.uid() and approved = true
  ) then
    raise exception 'You are not a member of this Space.';
  end if;
  insert into public.ming_space_files(
    space_id,owner_id,content_id,product_id,storage_path,filename,content_type,size_bytes,kind
  )
  values(
    p_space_id,auth.uid(),p_content_id,p_product_id,p_storage_path,p_filename,
    coalesce(p_content_type,'application/octet-stream'),coalesce(p_size_bytes,0),coalesce(p_kind,'file')
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- Real invitation rotation. The old client-side random-code path is no longer
-- authoritative once this function is installed.
create or replace function public.rotate_ming_space_invite(
  p_space_id uuid,
  p_ttl_hours integer default 24,
  p_max_uses integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_hash text;
  v_version integer;
  v_invite public.ming_space_invites;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.ming_spaces
    where id = p_space_id and owner_id = v_user
  ) then
    raise exception 'Only the creator can regenerate the invitation.';
  end if;

  update public.ming_space_invites
  set revoked = true
  where space_id = p_space_id and revoked = false;

  select coalesce(max(version),0)+1 into v_version
  from public.ming_space_invites where space_id = p_space_id;

  v_code := upper(
    substr(md5(random()::text || clock_timestamp()::text || v_user::text),1,4)
    || '-' ||
    substr(md5(random()::text || clock_timestamp()::text || p_space_id::text),1,4)
  );
  v_hash := encode(extensions.digest(v_code,'sha256'),'hex');

  insert into public.ming_space_invites(space_id,code_hash,hint,expires_at,max_uses,version)
  values(
    p_space_id,v_hash,right(v_code,2),
    case when coalesce(p_ttl_hours,24)>0 then now()+make_interval(hours=>coalesce(p_ttl_hours,24)) else null end,
    p_max_uses,v_version
  )
  returning * into v_invite;

  return jsonb_build_object(
    'code',v_code,
    'invite',jsonb_build_object(
      'id',v_invite.id,'codeHash',v_invite.code_hash,'hint',v_invite.hint,
      'createdAt',v_invite.created_at,'expiresAt',v_invite.expires_at,
      'maxUses',v_invite.max_uses,'uses',v_invite.uses,'revoked',v_invite.revoked,
      'version',v_invite.version
    )
  );
end;
$$;

create or replace function public.leave_ming_space(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists (
    select 1 from public.ming_space_members
    where space_id=p_space_id and user_id=auth.uid() and role='owner'
  ) then
    raise exception 'The creator must delete or transfer this Space before leaving.';
  end if;
  delete from public.ming_space_members
  where space_id=p_space_id and user_id=auth.uid();
end;
$$;

revoke execute on function public.get_my_ming_space_content() from public, anon;
revoke execute on function public.create_ming_space_content(uuid,text,jsonb) from public, anon;
revoke execute on function public.update_ming_space_content(uuid,jsonb) from public, anon;
revoke execute on function public.create_ming_space_product(uuid,text,numeric,text,text,text,text,integer,jsonb,jsonb) from public, anon;
revoke execute on function public.get_my_ming_space_products() from public, anon;
revoke execute on function public.record_ming_space_file(uuid,text,text,text,bigint,text,uuid,uuid) from public, anon;
revoke execute on function public.rotate_ming_space_invite(uuid,integer,integer) from public, anon;
revoke execute on function public.leave_ming_space(uuid) from public, anon;

grant execute on function public.get_my_ming_space_content() to authenticated;
grant execute on function public.create_ming_space_content(uuid,text,jsonb) to authenticated;
grant execute on function public.update_ming_space_content(uuid,jsonb) to authenticated;
grant execute on function public.create_ming_space_product(uuid,text,numeric,text,text,text,text,integer,jsonb,jsonb) to authenticated;
grant execute on function public.get_my_ming_space_products() to authenticated;
grant execute on function public.record_ming_space_file(uuid,text,text,text,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.rotate_ming_space_invite(uuid,integer,integer) to authenticated;
grant execute on function public.leave_ming_space(uuid) to authenticated;


create or replace function public.get_my_ming_space_files()
returns setof public.ming_space_files
language sql
security definer
set search_path = ''
stable
as $$
  select f.*
  from public.ming_space_files f
  where exists (
    select 1 from public.ming_space_members m
    where m.space_id = f.space_id
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
  order by f.created_at desc;
$$;

revoke execute on function public.get_my_ming_space_files() from public, anon;
grant execute on function public.get_my_ming_space_files() to authenticated;


-- Keep the dedicated theme column synchronized with the theme selected during creation.
create or replace function public.create_ming_space(
  p_name text,
  p_description text default '',
  p_nature text default 'friendly',
  p_privacy text default 'private',
  p_require_approval boolean default false,
  p_max_members integer default null,
  p_hue integer default null,
  p_location_linked boolean default false,
  p_expires_at timestamptz default null,
  p_features jsonb default '{}'::jsonb,
  p_invite_ttl_hours integer default 24,
  p_invite_max_uses integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_space public.ming_spaces;
  v_member public.ming_space_members;
  v_code text;
  v_hash text;
  v_invite public.ming_space_invites;
  v_features jsonb := coalesce(p_features, '{}'::jsonb);
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_name,''))) < 2 then raise exception 'A Space needs a name.'; end if;
  if p_nature not in ('business','friendly','casual','silly','romantic','marketplace') then raise exception 'Unknown Space nature.'; end if;
  if p_privacy not in ('private','approval','discoverable') then raise exception 'Unknown Space privacy.'; end if;
  if p_max_members is not null and p_max_members <= 0 then raise exception 'Member limit must be positive.'; end if;

  insert into public.ming_spaces(
    owner_id,name,description,nature,privacy,discoverable,require_approval,max_members,
    hue,location_linked,expires_at,features,theme
  )
  values(
    v_user,btrim(p_name),coalesce(p_description,''),p_nature,
    case when p_nature='romantic' then 'private' else p_privacy end,
    case when p_nature='romantic' then false else p_privacy='discoverable' end,
    (p_privacy='approval' or p_require_approval),p_max_members,p_hue,p_location_linked,
    p_expires_at,v_features,coalesce(v_features->'theme','{}'::jsonb)
  )
  returning * into v_space;

  insert into public.ming_space_members(space_id,user_id,role,approved)
  values(v_space.id,v_user,'owner',true)
  returning * into v_member;

  v_code := upper(substr(md5(random()::text||clock_timestamp()::text||v_user::text),1,4)||'-'||
                  substr(md5(random()::text||clock_timestamp()::text||v_space.id::text),1,4));
  v_hash := encode(extensions.digest(v_code,'sha256'),'hex');

  insert into public.ming_space_invites(space_id,code_hash,hint,expires_at,max_uses,version)
  values(
    v_space.id,v_hash,right(v_code,2),
    case when coalesce(p_invite_ttl_hours,24)>0 then now()+make_interval(hours=>coalesce(p_invite_ttl_hours,24)) else null end,
    p_invite_max_uses,1
  )
  returning * into v_invite;

  return jsonb_build_object(
    'space',jsonb_build_object(
      'id',v_space.id,'name',v_space.name,'description',v_space.description,'nature',v_space.nature,
      'privacy',v_space.privacy,'discoverable',v_space.discoverable,'requireApproval',v_space.require_approval,
      'maxMembers',v_space.max_members,'hue',v_space.hue,'locationLinked',v_space.location_linked,
      'expiresAt',v_space.expires_at,'features',v_space.features,'theme',v_space.theme,
      'ownerId',v_space.owner_id,'createdAt',v_space.created_at
    ),
    'member',jsonb_build_object(
      'spaceId',v_member.space_id,'userId',v_member.user_id,'role',v_member.role,
      'joinedAt',v_member.joined_at,'approved',v_member.approved
    ),
    'invite',jsonb_build_object(
      'id',v_invite.id,'codeHash',v_invite.code_hash,'hint',v_invite.hint,'createdAt',v_invite.created_at,
      'expiresAt',v_invite.expires_at,'maxUses',v_invite.max_uses,'uses',v_invite.uses,
      'revoked',v_invite.revoked,'version',v_invite.version
    ),
    'code',v_code
  );
end;
$$;

revoke execute on function public.create_ming_space(text,text,text,text,boolean,integer,integer,boolean,timestamptz,jsonb,integer,integer) from public, anon;
grant execute on function public.create_ming_space(text,text,text,text,boolean,integer,integer,boolean,timestamptz,jsonb,integer,integer) to authenticated;


create table if not exists public.ming_space_product_bids (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.ming_space_products(id) on delete cascade,
  bidder_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists ming_space_product_bids_product_idx
  on public.ming_space_product_bids(product_id, amount desc, created_at desc);

alter table public.ming_space_product_bids enable row level security;
revoke all on table public.ming_space_product_bids from anon;
grant select on public.ming_space_product_bids to authenticated;

drop policy if exists "space members can read bids" on public.ming_space_product_bids;
create policy "space members can read bids"
on public.ming_space_product_bids for select to authenticated
using (
  exists (
    select 1
    from public.ming_space_products p
    join public.ming_space_members m on m.space_id = p.space_id
    where p.id = ming_space_product_bids.product_id
      and m.user_id = (select auth.uid())
      and m.approved = true
  )
);

create or replace function public.get_my_ming_space_product_bids()
returns setof public.ming_space_product_bids
language sql
security definer
set search_path = ''
stable
as $$
  select b.*
  from public.ming_space_product_bids b
  join public.ming_space_products p on p.id = b.product_id
  where exists (
    select 1 from public.ming_space_members m
    where m.space_id = p.space_id and m.user_id = auth.uid() and m.approved = true
  )
  order by b.created_at desc;
$$;

create or replace function public.place_ming_space_product_bid(
  p_product_id uuid,
  p_amount numeric
)
returns public.ming_space_product_bids
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.ming_space_products;
  v_high numeric;
  v_bid public.ming_space_product_bids;
  v_enabled boolean;
  v_ends timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_product from public.ming_space_products where id=p_product_id for update;
  if not found then raise exception 'Listing not found.'; end if;
  if v_product.status <> 'listed' then raise exception 'This listing is no longer available.'; end if;
  if v_product.seller_id = v_user then raise exception 'You cannot bid on your own listing.'; end if;
  if not exists (
    select 1 from public.ming_space_members
    where space_id=v_product.space_id and user_id=v_user and approved=true
  ) then raise exception 'Join this Space to bid.'; end if;

  v_enabled := coalesce((v_product.auction->>'enabled')::boolean,false);
  v_ends := nullif(v_product.auction->>'endsAt','')::timestamptz;
  if not v_enabled then raise exception 'This listing is not an auction.'; end if;
  if v_ends is not null and v_ends <= now() then raise exception 'This auction has ended.'; end if;

  select coalesce(max(amount), v_product.price) into v_high
  from public.ming_space_product_bids where product_id=p_product_id;

  if p_amount <= v_high then
    raise exception 'Your bid must be higher than the current highest bid.';
  end if;

  insert into public.ming_space_product_bids(product_id,bidder_id,amount)
  values(p_product_id,v_user,p_amount)
  returning * into v_bid;
  return v_bid;
end;
$$;

revoke execute on function public.get_my_ming_space_product_bids() from public, anon;
revoke execute on function public.place_ming_space_product_bid(uuid,numeric) from public, anon;
grant execute on function public.get_my_ming_space_product_bids() to authenticated;
grant execute on function public.place_ming_space_product_bid(uuid,numeric) to authenticated;


create or replace function public.set_ming_space_member_role(
  p_space_id uuid,
  p_user_id uuid,
  p_role text
)
returns public.ming_space_members
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.ming_space_members;
declare v_nature text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select nature into v_nature from public.ming_spaces where id=p_space_id and owner_id=auth.uid();
  if not found then raise exception 'Only the creator can change Space roles.'; end if;
  if p_role not in ('admin','manager','moderator','seller','buyer','member','guest') then
    raise exception 'That role does not exist.';
  end if;
  if exists(select 1 from public.ming_space_members where space_id=p_space_id and user_id=p_user_id and role='owner') then
    raise exception 'The owner role cannot be reassigned.';
  end if;
  if p_role not in (
    case v_nature
      when 'business' then 'admin,manager,member'
      when 'friendly' then 'moderator,member'
      when 'casual' then 'moderator,member,guest'
      when 'silly' then 'moderator,member'
      when 'romantic' then 'member'
      when 'marketplace' then 'moderator,seller,buyer'
      else ''
    end
  ) then
    raise exception 'That role is not available in this Space.';
  end if;
  update public.ming_space_members
  set role=p_role
  where space_id=p_space_id and user_id=p_user_id
  returning * into v_row;
  if not found then raise exception 'Member not found.'; end if;
  return v_row;
end;
$$;

revoke execute on function public.set_ming_space_member_role(uuid,uuid,text) from public, anon;
grant execute on function public.set_ming_space_member_role(uuid,uuid,text) to authenticated;
