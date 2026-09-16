-- Supersede one currently active, provider-reconciled unpaid checkout so a
-- customer's structurally valid different basket can continue immediately.
-- The server performs the live Razorpay order/payment verification first.

create function public.supersede_active_unpaid_checkout(
  p_reservation_id uuid,
  p_razorpay_order_id text
)
returns table (
  superseded boolean,
  redemption_released boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
  v_user_id uuid;
  v_release_result record;
  v_abandoned_at timestamptz;
begin
  if p_reservation_id is null
     or nullif(btrim(p_razorpay_order_id), '') is null then
    raise exception 'invalid active checkout request';
  end if;

  select ir.user_id
  into v_user_id
  from public.inventory_reservations ir
  where ir.id = p_reservation_id;

  if v_user_id is null then
    raise exception 'reservation not found';
  end if;

  -- Match the per-customer lock used by reservation creation, renewal,
  -- abandonment, and Zeshu Cash holds.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 61129));

  select ir.*
  into v_reservation
  from public.inventory_reservations ir
  where ir.id = p_reservation_id
  for update;

  if v_reservation.razorpay_order_id is distinct from btrim(p_razorpay_order_id) then
    raise exception 'reservation payment binding mismatch';
  end if;

  if v_reservation.status <> 'PAYMENT_PENDING'
     or v_reservation.expires_at <= now()
     or v_reservation.abandoned_at is not null then
    raise exception 'reservation is not an active payment checkout';
  end if;

  -- There must be exactly one unexpired payment-pending row for this user.
  -- If the database ever contains multiple active rows, fail closed rather
  -- than choosing which payment checkout to supersede.
  if exists (
    select 1
    from public.inventory_reservations ir
    where ir.user_id = v_user_id
      and ir.status = 'PAYMENT_PENDING'
      and ir.expires_at > now()
      and ir.id <> v_reservation.id
  ) then
    raise exception 'multiple active payment checkouts require reconciliation';
  end if;

  -- The live server reconciliation is authoritative for the current provider
  -- state; these durable records remain fail-closed race evidence.
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

  -- A payment-bound reward hold must itself still be safely releasable.
  -- reservation_id is unique in reward_redemptions, so this cannot select an
  -- arbitrary historical hold.
  if exists (
    select 1
    from public.reward_redemptions rr
    where rr.reservation_id = v_reservation.id
      and (
        rr.status <> 'RESERVED'
        or rr.order_id is not null
        or (rr.razorpay_order_id is not null
            and rr.razorpay_order_id is distinct from v_reservation.razorpay_order_id)
        or rr.expires_at is null
        or rr.expires_at <= now()
      )
  ) then
    raise exception 'payment reconciliation required';
  end if;

  -- The transition and release are one transaction.  If release fails, the
  -- EXPIRED transition rolls back and the active checkout remains intact.
  update public.inventory_reservations ir
  set status = 'EXPIRED'
  where ir.id = v_reservation.id
    and ir.status = 'PAYMENT_PENDING'
    and ir.expires_at > now()
    and ir.abandoned_at is null;

  if not found then
    raise exception 'reservation is no longer supersedable';
  end if;

  select r.released, r.redemption_released
  into v_release_result
  from public.release_abandoned_unpaid_checkout(
    v_reservation.id,
    btrim(p_razorpay_order_id)
  ) r;

  if not found or v_release_result.released is not true then
    raise exception 'payment reconciliation required';
  end if;

  update public.inventory_reservations ir
  set abandoned_at = coalesce(ir.abandoned_at, now())
  where ir.id = v_reservation.id
    and ir.status = 'EXPIRED'
    and ir.razorpay_order_id = btrim(p_razorpay_order_id)
  returning ir.abandoned_at into v_abandoned_at;

  if not found or v_abandoned_at is null then
    raise exception 'payment reconciliation required';
  end if;

  return query
  select true, (v_release_result.redemption_released is true);
end;
$$;

revoke all on function public.supersede_active_unpaid_checkout(uuid, text) from public;
revoke all on function public.supersede_active_unpaid_checkout(uuid, text) from anon;
revoke all on function public.supersede_active_unpaid_checkout(uuid, text) from authenticated;
grant execute on function public.supersede_active_unpaid_checkout(uuid, text) to service_role;
