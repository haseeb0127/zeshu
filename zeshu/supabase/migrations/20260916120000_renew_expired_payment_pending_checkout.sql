-- Renew an expired PAYMENT_PENDING checkout only after the trusted server has
-- reconciled Razorpay and established that the existing provider order is
-- still safe to retry. This function never declares a payment failed and
-- never creates or changes a Razorpay order.

create function public.renew_expired_payment_pending_checkout(
  p_reservation_id uuid,
  p_razorpay_order_id text
)
returns table (
  renewed boolean,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
  v_user_id uuid;
  v_product public.products%rowtype;
  v_item record;
  v_held_quantity bigint;
  v_vendor_id uuid;
  v_new_expires_at timestamptz := now() + interval '10 minutes';
  v_persisted_expires_at timestamptz;
begin
  if p_reservation_id is null
     or nullif(btrim(p_razorpay_order_id), '') is null then
    raise exception 'invalid payment-pending checkout request';
  end if;

  select ir.user_id
  into v_user_id
  from public.inventory_reservations ir
  where ir.id = p_reservation_id;

  if v_user_id is null then
    raise exception 'reservation not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 61129));

  select ir.*
  into v_reservation
  from public.inventory_reservations ir
  where ir.id = p_reservation_id
  for update;

  if v_reservation.razorpay_order_id is distinct from btrim(p_razorpay_order_id) then
    raise exception 'reservation payment binding mismatch';
  end if;

  if v_reservation.status = 'PAYMENT_PENDING'
     and v_reservation.expires_at > now() then
    renewed := false;
    expires_at := v_reservation.expires_at;
    return next;
  end if;

  if v_reservation.status <> 'PAYMENT_PENDING'
     or v_reservation.expires_at > now() then
    raise exception 'reservation is not an expired payment-pending checkout';
  end if;

  if exists (
    select 1
    from public.payment_provider_events e
    where e.razorpay_order_id = v_reservation.razorpay_order_id
      and not (e.event_type = 'payment.failed' and e.status = 'PROCESSED')
  ) then
    raise exception 'payment reconciliation required';
  end if;

  if exists (
    select 1
    from public.payment_reconciliation_refunds r
    where r.reservation_id = v_reservation.id
  ) then
    raise exception 'payment reconciliation required';
  end if;

  if exists (
    select 1
    from public.reward_redemptions rr
    where rr.reservation_id = v_reservation.id
      and (
        rr.status <> 'RESERVED'
        or rr.order_id is not null
        or (rr.razorpay_order_id is not null
            and rr.razorpay_order_id is distinct from v_reservation.razorpay_order_id)
      )
  ) then
    raise exception 'payment reconciliation required';
  end if;

  if exists (
    select 1
    from public.reward_redemptions rr
    where rr.reservation_id = v_reservation.id
      and rr.status = 'RESERVED'
      and (rr.expires_at is null or rr.expires_at <= now())
  ) then
    raise exception 'reward hold is no longer renewable';
  end if;

  if not exists (
    select 1
    from public.inventory_reservation_items iri
    where iri.reservation_id = v_reservation.id
  ) then
    raise exception 'cannot renew an empty reservation';
  end if;

  for v_item in
    select iri.product_id, iri.quantity, iri.unit_price
    from public.inventory_reservation_items iri
    where iri.reservation_id = v_reservation.id
    order by iri.product_id
  loop
    select p.*
    into v_product
    from public.products p
    where p.id = v_item.product_id
    for update;

    if not found
       or v_product.vendor_id is null
       or v_product.in_stock is not true
       or v_product.price is null
       or v_product.price is distinct from v_item.unit_price then
      raise exception 'checkout no longer matches current product state';
    end if;

    if v_vendor_id is null then
      v_vendor_id := v_product.vendor_id;
    elsif v_vendor_id is distinct from v_product.vendor_id then
      raise exception 'checkout no longer matches current product state';
    end if;

    select coalesce(sum(iri.quantity), 0)
    into v_held_quantity
    from public.inventory_reservation_items iri
    join public.inventory_reservations ir
      on ir.id = iri.reservation_id
    where iri.product_id = v_product.id
      and ir.id <> v_reservation.id
      and ir.status in ('ACTIVE', 'PAYMENT_PENDING')
      and ir.expires_at > now();

    if v_product.quantity - v_held_quantity < v_item.quantity then
      raise exception 'checkout no longer has sufficient stock';
    end if;
  end loop;

  update public.inventory_reservations ir
  set expires_at = v_new_expires_at
  where ir.id = v_reservation.id
    and ir.status = 'PAYMENT_PENDING'
    and ir.expires_at <= now()
  returning ir.expires_at into v_persisted_expires_at;

  if not found then
    raise exception 'reservation is no longer renewable';
  end if;

  update public.reward_redemptions rr
  set expires_at = greatest(rr.expires_at, v_persisted_expires_at)
  where rr.reservation_id = v_reservation.id
    and rr.status = 'RESERVED';

  renewed := true;
  expires_at := v_persisted_expires_at;
  return next;
end;
$$;

revoke all on function public.renew_expired_payment_pending_checkout(uuid, text) from public;
revoke all on function public.renew_expired_payment_pending_checkout(uuid, text) from anon;
revoke all on function public.renew_expired_payment_pending_checkout(uuid, text) from authenticated;
grant execute on function public.renew_expired_payment_pending_checkout(uuid, text) to service_role;
