begin;

create or replace function public.create_ming_space_product(
  p_space_id uuid,p_title text,p_price numeric,p_condition text,p_category text,
  p_handover text,p_description text default '',p_qty integer default 1,
  p_media jsonb default '[]'::jsonb,p_auction jsonb default '{}'::jsonb
)
returns public.ming_space_products
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_row public.ming_space_products;
  v_auction_end timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select s.* into v_space from public.ming_spaces s where s.id=p_space_id and s.nature='marketplace';
  if not found then raise exception 'Listings can only be created in a Marketplace Space'; end if;
  if coalesce((v_space.features->>'listings')::boolean,true)=false then
    raise exception 'Listings are disabled in this Marketplace Space';
  end if;

  select m.role into v_role from public.ming_space_members m
  where m.space_id=p_space_id and m.user_id=v_user and m.approved=true;
  if v_role not in ('owner','seller') or v_role is null then
    raise exception 'You need the seller role in this Marketplace Space.';
  end if;

  if char_length(btrim(coalesce(p_title,''))) not between 2 and 120 then raise exception 'Listing title must be 2–120 characters'; end if;
  if p_price is null or p_price<=0 or p_price>1000000000 or p_price<>round(p_price,2) then raise exception 'Enter a valid price with up to two decimal places'; end if;
  if p_qty is null or p_qty not between 1 and 10000 then raise exception 'Quantity must be between 1 and 10,000'; end if;
  if char_length(coalesce(p_condition,'')) not between 1 and 40
     or char_length(coalesce(p_category,'')) not between 1 and 80
     or char_length(coalesce(p_handover,'')) not between 1 and 40 then
    raise exception 'Listing condition, category or handover option is invalid';
  end if;
  if char_length(coalesce(p_description,''))>3000 then raise exception 'Listing description is too long'; end if;
  if jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_media,'[]'::jsonb))>8
     or octet_length(coalesce(p_media,'[]'::jsonb)::text)>16384 then
    raise exception 'Listing media metadata is invalid or too large';
  end if;
  if jsonb_typeof(coalesce(p_auction,'{}'::jsonb))<>'object'
     or octet_length(coalesce(p_auction,'{}'::jsonb)::text)>4096 then
    raise exception 'Auction settings are invalid';
  end if;
  if coalesce((p_auction->>'enabled')::boolean,false) then
    begin
      v_auction_end := nullif(p_auction->>'endsAt','')::timestamptz;
    exception when others then
      raise exception 'Auction end time is invalid';
    end;
    if v_auction_end is null or v_auction_end<=now() then
      raise exception 'An auction must have a future end time';
    end if;
  end if;

  insert into public.ming_space_products(
    space_id,seller_id,title,price,condition,category,handover,description,qty,media,auction
  )
  values(
    p_space_id,v_user,btrim(p_title),p_price,btrim(p_condition),btrim(p_category),
    btrim(p_handover),coalesce(p_description,''),p_qty,
    coalesce(p_media,'[]'::jsonb),coalesce(p_auction,'{}'::jsonb)
  )
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.place_ming_space_product_bid(p_product_id uuid,p_amount numeric)
returns public.ming_space_product_bids
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_product public.ming_space_products;
  v_space public.ming_spaces;
  v_role text;
  v_high numeric;
  v_bid public.ming_space_product_bids;
  v_enabled boolean;
  v_ends timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select p.* into v_product from public.ming_space_products p where p.id=p_product_id for update;
  if not found then raise exception 'Listing not found.'; end if;
  select s.* into v_space from public.ming_spaces s where s.id=v_product.space_id and s.nature='marketplace';
  if not found then raise exception 'This listing is not in a Marketplace Space'; end if;
  if coalesce((v_space.features->>'listings')::boolean,true)=false then raise exception 'Marketplace listings are disabled'; end if;
  if v_product.status<>'listed' then raise exception 'This listing is no longer available.'; end if;
  if v_product.seller_id=v_user then raise exception 'You cannot bid on your own listing.'; end if;
  if private.tweaklr_is_blocked(v_product.seller_id) then raise exception 'You cannot bid on this seller’s listing'; end if;

  select m.role into v_role from public.ming_space_members m
  where m.space_id=v_product.space_id and m.user_id=v_user and m.approved=true;
  if v_role is null or v_role='guest' then raise exception 'Approved Marketplace membership is required to bid'; end if;

  v_enabled:=coalesce((v_product.auction->>'enabled')::boolean,false);
  begin
    v_ends:=nullif(v_product.auction->>'endsAt','')::timestamptz;
  exception when others then
    raise exception 'Auction end time is invalid';
  end;
  if not v_enabled then raise exception 'This listing is not an auction.'; end if;
  if v_ends is null or v_ends<=now() then raise exception 'This auction has ended.'; end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000000 or p_amount<>round(p_amount,2) then
    raise exception 'Enter a valid bid with up to two decimal places';
  end if;

  select coalesce(max(amount),v_product.price) into v_high
  from public.ming_space_product_bids where product_id=p_product_id;
  if p_amount<=v_high then raise exception 'Your bid must be higher than the current highest bid.'; end if;

  insert into public.ming_space_product_bids(product_id,bidder_id,amount)
  values(p_product_id,v_user,p_amount)
  returning * into v_bid;
  return v_bid;
end;
$function$;

create or replace function public.get_my_ming_space_products()
returns setof public.ming_space_products
language sql
stable
security definer
set search_path = ''
as $function$
  select p.*
  from public.ming_space_products p
  join public.ming_spaces s on s.id=p.space_id
  where s.nature='marketplace'
    and coalesce((s.features->>'listings')::boolean,true)
    and p.status<>'removed'
    and exists(
      select 1 from public.ming_space_members m
      where m.space_id=p.space_id and m.user_id=(select auth.uid()) and m.approved=true
    )
  order by p.created_at desc;
$function$;

create or replace function public.get_my_ming_space_product_bids()
returns setof public.ming_space_product_bids
language sql
stable
security definer
set search_path = ''
as $function$
  select b.*
  from public.ming_space_product_bids b
  join public.ming_space_products p on p.id=b.product_id
  join public.ming_spaces s on s.id=p.space_id
  where s.nature='marketplace'
    and coalesce((s.features->>'listings')::boolean,true)
    and exists(
      select 1 from public.ming_space_members m
      where m.space_id=p.space_id and m.user_id=(select auth.uid()) and m.approved=true
    )
  order by b.created_at desc;
$function$;

create or replace function private.record_ming_space_file(
  p_space_id uuid,p_storage_path text,p_filename text,p_content_type text,
  p_size_bytes bigint default 0,p_kind text default 'file',
  p_content_id uuid default null,p_product_id uuid default null
)
returns public.ming_space_files
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_space public.ming_spaces;
  v_role text;
  v_content public.ming_space_content;
  v_product public.ming_space_products;
  v_row public.ming_space_files;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_space_id is null or p_storage_path is null
     or p_storage_path not like p_space_id::text||'/'||v_user::text||'/%' then
    raise exception 'Uploaded file path must belong to your account and this Space';
  end if;
  if p_size_bytes is null or p_size_bytes not between 0 and 52428800 then
    raise exception 'Space media must be 50 MB or smaller';
  end if;
  if char_length(coalesce(p_filename,'')) not between 1 and 255
     or char_length(coalesce(p_content_type,'')) not between 1 and 128 then
    raise exception 'File name or content type is invalid';
  end if;
  if p_content_id is not null and p_product_id is not null then
    raise exception 'A file can be attached to a post or a product, not both';
  end if;

  select s.* into v_space from public.ming_spaces s where s.id=p_space_id;
  if not found then raise exception 'Space not found'; end if;
  select m.role into v_role from public.ming_space_members m
  where m.space_id=p_space_id and m.user_id=v_user and m.approved=true;
  if v_role is null or v_role='guest' then raise exception 'Approved, write-enabled Space membership is required'; end if;

  if not exists(
    select 1 from storage.objects o
    where o.bucket_id='ming-space-media'
      and o.name=p_storage_path
      and o.owner_id=v_user::text
  ) then
    raise exception 'The uploaded file was not found or does not belong to you';
  end if;

  if p_product_id is not null then
    if v_space.nature<>'marketplace'
       or coalesce((v_space.features->>'listings')::boolean,true)=false
       or v_role not in ('owner','seller')
       or p_kind not in ('photo','video','audio') then
      raise exception 'Product media requires an enabled Marketplace listing and seller permissions';
    end if;
    select p.* into v_product from public.ming_space_products p
    where p.id=p_product_id and p.space_id=p_space_id and p.seller_id=v_user;
    if not found then raise exception 'You can only attach media to your own listing in this Marketplace'; end if;
  elsif p_content_id is not null then
    select c.* into v_content from public.ming_space_content c
    where c.id=p_content_id and c.space_id=p_space_id;
    if not found then raise exception 'The attached Space content was not found'; end if;
    if p_kind is distinct from v_content.kind then raise exception 'File type does not match the attached content'; end if;
    if v_content.author_id<>v_user and v_role not in ('owner','admin','manager') then
      raise exception 'Only the content author or a Space manager can attach files';
    end if;
    if v_content.kind='doc' and (
      v_space.nature<>'business'
      or coalesce((v_space.features->>'documents')::boolean,true)=false
      or v_role not in ('owner','admin','manager')
    ) then raise exception 'Business document permissions are required'; end if;
  else
    if p_kind<>'document'
       or v_space.nature<>'business'
       or coalesce((v_space.features->>'documents')::boolean,true)=false
       or v_role not in ('owner','admin','manager') then
      raise exception 'Standalone files require the enabled Business documents feature and manager permissions';
    end if;
  end if;

  insert into public.ming_space_files(
    space_id,owner_id,content_id,product_id,storage_path,filename,content_type,size_bytes,kind
  )
  values(
    p_space_id,v_user,p_content_id,p_product_id,p_storage_path,btrim(p_filename),
    p_content_type,p_size_bytes,p_kind
  )
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.delete_ming_space_file(p_file_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_file public.ming_space_files;
  v_role text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select f.* into v_file from public.ming_space_files f where f.id=p_file_id for update;
  if not found then raise exception 'Document not found'; end if;
  select m.role into v_role from public.ming_space_members m
  where m.space_id=v_file.space_id and m.user_id=v_user and m.approved=true;
  if v_role is null then raise exception 'You are not an approved member of this Space'; end if;
  if v_file.owner_id<>v_user and v_role not in ('owner','admin','manager') then
    raise exception 'Only the uploader or a Space manager can delete this file';
  end if;
  delete from public.ming_space_files where id=p_file_id;
  return true;
end;
$function$;

-- Restrict uploads to the member's own folder. Space owners/admins/managers
-- may remove any Space file; ordinary members may only update/delete their own.
drop policy if exists "Space members delete own media" on storage.objects;
drop policy if exists "Space members read media" on storage.objects;
drop policy if exists "Space members update own media" on storage.objects;
drop policy if exists "Space members upload media" on storage.objects;

create policy "Space members read media"
on storage.objects for select to authenticated
using (
  bucket_id='ming-space-media'
  and exists(
    select 1 from public.ming_space_members m
    where m.space_id=split_part(name,'/',1)::uuid
      and m.user_id=(select auth.uid()) and m.approved=true
  )
);

create policy "Space members upload own media"
on storage.objects for insert to authenticated
with check (
  bucket_id='ming-space-media'
  and split_part(name,'/',2)=(select auth.uid())::text
  and exists(
    select 1 from public.ming_space_members m
    where m.space_id=split_part(name,'/',1)::uuid
      and m.user_id=(select auth.uid()) and m.approved=true and m.role<>'guest'
  )
);

create policy "Space members update own media"
on storage.objects for update to authenticated
using (
  bucket_id='ming-space-media'
  and split_part(name,'/',2)=(select auth.uid())::text
  and exists(
    select 1 from public.ming_space_members m
    where m.space_id=split_part(name,'/',1)::uuid
      and m.user_id=(select auth.uid()) and m.approved=true
  )
)
with check (
  bucket_id='ming-space-media'
  and split_part(name,'/',2)=(select auth.uid())::text
  and exists(
    select 1 from public.ming_space_members m
    where m.space_id=split_part(name,'/',1)::uuid
      and m.user_id=(select auth.uid()) and m.approved=true
  )
);

create policy "Space owners and members delete media"
on storage.objects for delete to authenticated
using (
  bucket_id='ming-space-media'
  and exists(
    select 1 from public.ming_space_members m
    where m.space_id=split_part(name,'/',1)::uuid
      and m.user_id=(select auth.uid()) and m.approved=true
      and (
        split_part(name,'/',2)=(select auth.uid())::text
        or m.role in ('owner','admin','manager')
      )
  )
);

update storage.buckets
set file_size_limit=52428800,
    allowed_mime_types=array[
      'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
      'video/mp4','video/webm','video/quicktime','video/x-m4v',
      'audio/mpeg','audio/mp4','audio/ogg','audio/webm','audio/wav','audio/x-wav','audio/aac',
      'application/pdf','text/plain','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
where id='ming-space-media';

commit;