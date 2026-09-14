-- Inventory reservation bridge migration.
-- REVIEW ONLY: do not apply until the matching server-side checkout deployment.
-- This file is intentionally additive; existing product policies remain unchanged.

alter table public.products alter column quantity set default 0;
alter table public.products alter column quantity set not null;
alter table public.products alter column in_stock set default true;
alter table public.products alter column in_stock set not null;
alter table public.products drop constraint if exists products_quantity_nonnegative_check;
alter table public.products add constraint products_quantity_nonnegative_check check (quantity >= 0);

create unique index if not exists orders_payment_id_unique_idx on public.orders (payment_id);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id), razorpay_order_id text unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAYMENT_PENDING','CONSUMED','EXPIRED')),
  delivery_address text not null, merchandise_subtotal numeric not null check (merchandise_subtotal >= 0),
  expected_total_paid numeric not null check (expected_total_paid > 0), pricing_snapshot jsonb not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null, consumed_at timestamptz
);
create table if not exists public.inventory_reservation_items (
  reservation_id uuid not null references public.inventory_reservations(id) on delete cascade,
  product_id uuid not null references public.products(id), quantity integer not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0), item_snapshot jsonb not null,
  primary key (reservation_id, product_id)
);
create index if not exists inventory_reservations_user_status_expiry_idx on public.inventory_reservations(user_id,status,expires_at);
create index if not exists inventory_reservations_vendor_status_expiry_idx on public.inventory_reservations(vendor_id,status,expires_at);
create index if not exists inventory_reservation_items_product_idx on public.inventory_reservation_items(product_id);
alter table public.inventory_reservations enable row level security;
alter table public.inventory_reservation_items enable row level security;
drop policy if exists "customers read own inventory reservations" on public.inventory_reservations;
create policy "customers read own inventory reservations" on public.inventory_reservations for select using (user_id = auth.uid());
drop policy if exists "customers read own inventory reservation items" on public.inventory_reservation_items;
create policy "customers read own inventory reservation items" on public.inventory_reservation_items for select using (reservation_id in (select id from public.inventory_reservations where user_id=auth.uid()));

create or replace function public.create_inventory_reservation(
  p_user_id uuid,
  p_items jsonb,
  p_delivery_address text,
  p_has_zeshu_pass boolean,
  p_is_donating boolean,
  p_tip numeric
)
returns table (reservation_id uuid, expected_total_paid numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
  v_product_id_text text;
  v_quantity_text text;
  v_product_id uuid;
  v_quantity integer;
  v_existing_quantity bigint;
  v_item_map jsonb := '{}'::jsonb;
  v_product public.products%rowtype;
  v_vendor_id uuid;
  v_held_quantity bigint;
  v_subtotal numeric := 0;
  v_small_cart_fee numeric;
  v_delivery_fee numeric;
  v_donation numeric;
  v_pass_fee numeric;
  v_total numeric;
  v_reservation_id uuid;
  v_snapshots jsonb := '{}'::jsonb;
  v_snapshot jsonb;
  v_item record;
begin
  if p_user_id is null
     or p_delivery_address is null
     or length(btrim(p_delivery_address)) < 8
     or p_has_zeshu_pass is null
     or p_is_donating is null
     or p_tip is null
     or p_tip not in (0, 20, 30, 50)
     or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'invalid reservation request';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid reservation items';
  end if;

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'invalid reservation items';
    end if;

    v_product_id_text := v_entry ->> 'product_id';
    v_quantity_text := v_entry ->> 'quantity';
    if v_product_id_text is null
       or v_quantity_text is null
       or v_product_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or v_quantity_text !~ '^[0-9]+$'
       or length(v_quantity_text) > 10
       or (length(v_quantity_text) = 10 and v_quantity_text > '2147483647') then
      raise exception 'invalid reservation items';
    end if;

    v_product_id := v_product_id_text::uuid;
    v_quantity := v_quantity_text::integer;
    if v_quantity <= 0 then
      raise exception 'invalid reservation items';
    end if;

    v_existing_quantity := coalesce((v_item_map ->> v_product_id::text)::bigint, 0);
    if v_existing_quantity + v_quantity > 2147483647 then
      raise exception 'invalid reservation items';
    end if;

    v_item_map := jsonb_set(
      v_item_map,
      array[v_product_id::text],
      to_jsonb(v_existing_quantity + v_quantity),
      true
    );
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 9173));

  update public.inventory_reservations
  set status = 'EXPIRED'
  where user_id = p_user_id
    and status in ('ACTIVE', 'PAYMENT_PENDING')
    and expires_at <= now();

  if exists (
    select 1 from public.inventory_reservations
    where user_id = p_user_id
      and status = 'PAYMENT_PENDING'
      and expires_at > now()
  ) then
    raise exception 'an active payment checkout already exists';
  end if;

  update public.inventory_reservations
  set status = 'EXPIRED'
  where user_id = p_user_id
    and status = 'ACTIVE'
    and razorpay_order_id is null
    and expires_at > now();

  for v_item in
    select key::uuid as product_id, value::integer as quantity
    from jsonb_each_text(v_item_map)
    order by key::uuid
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    if not found
       or v_product.vendor_id is null
       or v_product.in_stock is not true
       or v_product.price is null then
      raise exception 'invalid reservation items';
    end if;

    if v_vendor_id is null then
      v_vendor_id := v_product.vendor_id;
    elsif v_vendor_id <> v_product.vendor_id then
      raise exception 'invalid reservation items';
    end if;

    select coalesce(sum(iri.quantity), 0) into v_held_quantity
    from public.inventory_reservation_items iri
    join public.inventory_reservations ir on ir.id = iri.reservation_id
    where iri.product_id = v_product.id
      and ir.status in ('ACTIVE', 'PAYMENT_PENDING')
      and ir.expires_at > now();

    if v_product.quantity - v_held_quantity < v_item.quantity then
      raise exception 'invalid reservation items';
    end if;

    v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
    v_snapshot := jsonb_build_object(
      'quantity', v_item.quantity,
      'unit_price', v_product.price,
      'item_snapshot', jsonb_build_object(
        'id', v_product.id,
        'name', v_product.name,
        'price', v_product.price,
        'weight', v_product.weight,
        'unit', v_product.unit,
        'image_url', v_product.image_url,
        'category', v_product.category
      )
    );
    v_snapshots := jsonb_set(v_snapshots, array[v_product.id::text], v_snapshot, true);
  end loop;

  v_small_cart_fee := case when v_subtotal > 0 and v_subtotal < 199 then 29 else 0 end;
  v_delivery_fee := case when p_has_zeshu_pass then 0 when v_subtotal > 0 and v_subtotal < 299 then 30 else 0 end;
  v_donation := case when p_is_donating then 1 else 0 end;
  v_pass_fee := case when p_has_zeshu_pass then 99 else 0 end;
  v_total := v_subtotal + v_small_cart_fee + v_delivery_fee + 5 + v_donation + p_tip + v_pass_fee;

  insert into public.inventory_reservations (
    user_id, vendor_id, delivery_address, merchandise_subtotal, expected_total_paid,
    pricing_snapshot, expires_at
  ) values (
    p_user_id, v_vendor_id, btrim(p_delivery_address), v_subtotal, v_total,
    jsonb_build_object(
      'small_cart_fee', v_small_cart_fee,
      'delivery_fee', v_delivery_fee,
      'handling_fee', 5,
      'donation', v_donation,
      'tip', p_tip,
      'pass_fee', v_pass_fee,
      'discount_total', 0
    ),
    now() + interval '10 minutes'
  ) returning id into v_reservation_id;

  for v_item in
    select key::uuid as product_id, value::integer as quantity
    from jsonb_each_text(v_item_map)
    order by key::uuid
  loop
    v_snapshot := v_snapshots -> v_item.product_id::text;
    insert into public.inventory_reservation_items (
      reservation_id, product_id, quantity, unit_price, item_snapshot
    ) values (
      v_reservation_id,
      v_item.product_id,
      v_item.quantity,
      (v_snapshot ->> 'unit_price')::numeric,
      v_snapshot -> 'item_snapshot'
    );
  end loop;

  reservation_id := v_reservation_id;
  expected_total_paid := v_total;
  return next;
end;
$$;

create or replace function public.bind_reservation_razorpay_order(
  p_user_id uuid,
  p_reservation_id uuid,
  p_razorpay_order_id text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
begin
  if p_user_id is null
     or p_reservation_id is null
     or p_razorpay_order_id is null
     or length(btrim(p_razorpay_order_id)) = 0 then
    raise exception 'invalid reservation request';
  end if;

  select * into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if not found or v_reservation.user_id <> p_user_id then
    raise exception 'invalid reservation request';
  end if;

  if v_reservation.status = 'PAYMENT_PENDING'
     and v_reservation.razorpay_order_id = btrim(p_razorpay_order_id) then
    return;
  end if;

  if v_reservation.status <> 'ACTIVE'
     or v_reservation.expires_at <= now()
     or v_reservation.razorpay_order_id is not null then
    raise exception 'invalid reservation request';
  end if;

  update public.inventory_reservations
  set razorpay_order_id = btrim(p_razorpay_order_id), status = 'PAYMENT_PENDING'
  where id = v_reservation.id;
end;
$$;

create or replace function public.finalize_grocery_order(
  p_user_id uuid,
  p_reservation_id uuid,
  p_razorpay_order_id text,
  p_payment_id text,
  p_captured_amount_paise bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
  v_existing_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_item record;
  v_other_held_quantity bigint;
  v_order_items jsonb;
  v_order_id uuid;
begin
  if p_user_id is null
     or p_reservation_id is null
     or p_razorpay_order_id is null
     or length(btrim(p_razorpay_order_id)) = 0
     or p_payment_id is null
     or length(btrim(p_payment_id)) = 0
     or p_captured_amount_paise is null
     or p_captured_amount_paise < 0 then
    raise exception 'invalid reservation request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_payment_id, 0));

  select * into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id;

  if not found then
    raise exception 'invalid reservation request';
  end if;

  select * into v_existing_order
  from public.orders
  where payment_id = p_payment_id;

  if found then
    -- orders has no reservation_id column. The unique Razorpay order binding makes
    -- this supplied reservation the strongest available persistent linkage.
    if v_reservation.user_id is distinct from p_user_id
       or v_existing_order.user_id is distinct from p_user_id
       or v_existing_order.vendor_id is distinct from v_reservation.vendor_id
       or v_reservation.razorpay_order_id is distinct from btrim(p_razorpay_order_id)
       or v_existing_order.total_paid is distinct from v_reservation.expected_total_paid
       or p_captured_amount_paise <> round(v_reservation.expected_total_paid * 100)::bigint then
      raise exception 'invalid reservation request';
    end if;
    return v_existing_order.id;
  end if;

  select * into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if v_reservation.user_id <> p_user_id
     or v_reservation.vendor_id is null
     or v_reservation.razorpay_order_id <> btrim(p_razorpay_order_id)
     or v_reservation.status <> 'PAYMENT_PENDING' then
    raise exception 'invalid reservation request';
  end if;

  if v_reservation.expires_at <= now() then
    raise exception 'reservation expired; payment reconciliation required';
  end if;

  if p_captured_amount_paise <> round(v_reservation.expected_total_paid * 100)::bigint
     or not exists (
       select 1 from public.inventory_reservation_items
       where reservation_id = v_reservation.id
     ) then
    raise exception 'invalid reservation request';
  end if;

  for v_item in
    select iri.product_id, iri.quantity
    from public.inventory_reservation_items iri
    where iri.reservation_id = v_reservation.id
    order by iri.product_id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
    for update;

    if not found or v_product.quantity < v_item.quantity then
      raise exception 'invalid reservation request';
    end if;

    select coalesce(sum(iri.quantity), 0) into v_other_held_quantity
    from public.inventory_reservation_items iri
    join public.inventory_reservations ir on ir.id = iri.reservation_id
    where iri.product_id = v_product.id
      and ir.id <> v_reservation.id
      and ir.status in ('ACTIVE', 'PAYMENT_PENDING')
      and ir.expires_at > now();

    if v_product.quantity - v_item.quantity < v_other_held_quantity then
      raise exception 'invalid reservation request';
    end if;
  end loop;

  for v_item in
    select iri.product_id, iri.quantity
    from public.inventory_reservation_items iri
    where iri.reservation_id = v_reservation.id
    order by iri.product_id
  loop
    update public.products
    set quantity = quantity - v_item.quantity,
        in_stock = case when quantity - v_item.quantity = 0 then false else in_stock end
    where id = v_item.product_id
      and quantity >= v_item.quantity;

    if not found then
      raise exception 'invalid reservation request';
    end if;
  end loop;

  select jsonb_agg(jsonb_build_object('item', item_snapshot, 'qty', quantity) order by product_id)
  into v_order_items
  from public.inventory_reservation_items
  where reservation_id = v_reservation.id;

  insert into public.orders (
    user_id, items, total_paid, payment_id, delivery_address, delivery_fee, vendor_id, status
  ) values (
    p_user_id,
    v_order_items,
    v_reservation.expected_total_paid,
    btrim(p_payment_id),
    v_reservation.delivery_address,
    (v_reservation.pricing_snapshot ->> 'delivery_fee')::numeric,
    v_reservation.vendor_id,
    'PENDING'
  ) returning id into v_order_id;

  update public.inventory_reservations
  set status = 'CONSUMED', consumed_at = now()
  where id = v_reservation.id;

  return v_order_id;
end;
$$;

create or replace function public.vendor_update_product(
  p_product_id uuid,
  p_name text default null,
  p_price numeric default null,
  p_category text default null,
  p_quantity integer default null,
  p_weight text default null,
  p_unit text default null,
  p_image_url text default null,
  p_in_stock boolean default null,
  p_set_name boolean default false,
  p_set_price boolean default false,
  p_set_category boolean default false,
  p_set_quantity boolean default false,
  p_set_weight boolean default false,
  p_set_unit boolean default false,
  p_set_image_url boolean default false,
  p_set_in_stock boolean default false
)
returns public.products
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
  v_held_quantity bigint;
  v_final_quantity integer;
  v_final_in_stock boolean;
begin
  if auth.uid() is null or p_product_id is null then
    raise exception 'invalid product update';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found or not exists (
    select 1 from public.vendors
    where id = v_product.vendor_id and owner_id = auth.uid()
  ) then
    raise exception 'invalid product update';
  end if;

  if (p_set_name and (p_name is null or length(btrim(p_name)) = 0))
     or (p_set_price and (p_price is null or p_price < 0))
     or (p_set_quantity and (p_quantity is null or p_quantity < 0))
     or (p_set_in_stock and p_in_stock is null) then
    raise exception 'invalid product update';
  end if;

  v_final_quantity := case when p_set_quantity then p_quantity else v_product.quantity end;
  if p_set_quantity then
    select coalesce(sum(iri.quantity), 0) into v_held_quantity
    from public.inventory_reservation_items iri
    join public.inventory_reservations ir on ir.id = iri.reservation_id
    where iri.product_id = v_product.id
      and ir.status in ('ACTIVE', 'PAYMENT_PENDING')
      and ir.expires_at > now();
    if v_final_quantity < v_held_quantity then
      raise exception 'invalid product update';
    end if;
  end if;

  v_final_in_stock := case when p_set_in_stock then p_in_stock else v_product.in_stock end;
  if v_final_quantity = 0 then
    v_final_in_stock := false;
  end if;

  update public.products
  set name = case when p_set_name then btrim(p_name) else name end,
      price = case when p_set_price then p_price else price end,
      category = case when p_set_category then p_category else category end,
      quantity = v_final_quantity,
      weight = case when p_set_weight then p_weight else weight end,
      unit = case when p_set_unit then p_unit else unit end,
      image_url = case when p_set_image_url then p_image_url else image_url end,
      in_stock = v_final_in_stock
  where id = v_product.id
  returning * into v_product;

  return v_product;
end;
$$;

create or replace function public.admin_update_product(
  p_product_id uuid,
  p_in_stock boolean
)
returns public.products
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
begin
  if auth.uid() is null or not public.is_admin() or p_product_id is null or p_in_stock is null then
    raise exception 'invalid product update';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'invalid product update';
  end if;

  update public.products
  set in_stock = case when v_product.quantity = 0 then false else p_in_stock end
  where id = v_product.id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.create_inventory_reservation(uuid, jsonb, text, boolean, boolean, numeric) from public;
revoke all on function public.bind_reservation_razorpay_order(uuid, uuid, text) from public;
revoke all on function public.finalize_grocery_order(uuid, uuid, text, text, bigint) from public;
revoke all on function public.vendor_update_product(uuid, text, numeric, text, integer, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public;
revoke all on function public.admin_update_product(uuid, boolean) from public;

grant execute on function public.create_inventory_reservation(uuid, jsonb, text, boolean, boolean, numeric) to service_role;
grant execute on function public.bind_reservation_razorpay_order(uuid, uuid, text) to service_role;
grant execute on function public.finalize_grocery_order(uuid, uuid, text, text, bigint) to service_role;
grant execute on function public.vendor_update_product(uuid, text, numeric, text, integer, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.admin_update_product(uuid, boolean) to authenticated;
