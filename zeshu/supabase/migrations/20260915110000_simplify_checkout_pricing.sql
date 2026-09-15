-- Align the authoritative reservation total with the current Zeshu pricing model.
-- The legacy arguments remain for RPC compatibility, but are intentionally ignored
-- for pricing: delivery is based only on the merchandise subtotal.

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
  v_delivery_fee numeric;
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

  v_delivery_fee := case when v_subtotal >= 299 then 0 else 30 end;
  v_total := v_subtotal + v_delivery_fee;

  insert into public.inventory_reservations (
    user_id, vendor_id, delivery_address, merchandise_subtotal, expected_total_paid,
    pricing_snapshot, expires_at
  ) values (
    p_user_id, v_vendor_id, btrim(p_delivery_address), v_subtotal, v_total,
    jsonb_build_object(
      'small_cart_fee', 0,
      'delivery_fee', v_delivery_fee,
      'handling_fee', 0,
      'donation', 0,
      'tip', 0,
      'pass_fee', 0,
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

revoke execute
on function public.create_inventory_reservation(
  uuid,
  jsonb,
  text,
  boolean,
  boolean,
  numeric
)
from public, anon, authenticated;

grant execute
on function public.create_inventory_reservation(
  uuid,
  jsonb,
  text,
  boolean,
  boolean,
  numeric
)
to service_role;
