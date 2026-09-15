-- Release only an expired, Razorpay-bound checkout that the server has
-- independently verified as abandoned and unpaid.
-- Provider verification is intentionally performed by the server route; this
-- function validates and mutates only trusted internal database state.

create function public.release_abandoned_unpaid_checkout(
  p_reservation_id uuid,
  p_razorpay_order_id text
)
returns table (
  released boolean,
  redemption_released boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reservation public.inventory_reservations%rowtype;
  v_redemption public.reward_redemptions%rowtype;
  v_user_id uuid;
  v_has_payment_event boolean;
  v_has_refund_record boolean;
begin
  if p_reservation_id is null
     or nullif(btrim(p_razorpay_order_id), '') is null then
    raise exception 'invalid abandoned checkout request';
  end if;

  -- Match the per-customer lock used by Zeshu Cash reservation/release RPCs.
  select user_id
  into v_user_id
  from public.inventory_reservations
  where id = p_reservation_id;

  if not found then
    raise exception 'reservation not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 61129));

  -- Re-read after taking the customer lock so concurrent redemption work is
  -- serialized before any release decision is made.
  select *
  into v_reservation
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if v_reservation.status <> 'EXPIRED'
     or v_reservation.razorpay_order_id is null
     or v_reservation.razorpay_order_id <> btrim(p_razorpay_order_id) then
    raise exception 'reservation is not an expired abandoned checkout';
  end if;

  -- Any provider event other than a successfully processed payment.failed
  -- event is treated as evidence that the provider state needs reconciliation.
  -- This function never trusts provider status supplied by the client.
  select exists (
    select 1
    from public.payment_provider_events e
    where e.razorpay_order_id = v_reservation.razorpay_order_id
      and not (e.event_type = 'payment.failed' and e.status = 'PROCESSED')
  )
  into v_has_payment_event;

  if v_has_payment_event then
    raise exception 'payment reconciliation required';
  end if;

  -- Any reconciliation/refund record is retained as a fail-closed signal.
  select exists (
    select 1
    from public.payment_reconciliation_refunds r
    where r.reservation_id = v_reservation.id
  )
  into v_has_refund_record;

  if v_has_refund_record then
    raise exception 'payment reconciliation required';
  end if;

  select *
  into v_redemption
  from public.reward_redemptions
  where reservation_id = v_reservation.id
  for update;

  if not found then
    return query select true, false;
    return;
  end if;

  if v_redemption.order_id is not null then
    raise exception 'payment reconciliation required';
  end if;

  if v_redemption.razorpay_order_id is not null
     and v_redemption.razorpay_order_id <> v_reservation.razorpay_order_id then
    raise exception 'payment reconciliation required';
  end if;

  if v_redemption.status = 'RELEASED' then
    return query select true, false;
    return;
  end if;

  if v_redemption.status <> 'RESERVED' then
    raise exception 'payment reconciliation required';
  end if;

  -- The customer balance is ledger-derived minus RESERVED holds.  Releasing
  -- the hold is therefore the only accounting mutation required; the expired
  -- reservation's historical pricing remains unchanged.
  update public.reward_redemptions
  set status = 'RELEASED',
      released_at = now()
  where id = v_redemption.id
    and status = 'RESERVED';

  if not found then
    raise exception 'payment reconciliation required';
  end if;

  return query select true, true;
end;
$$;

revoke all on function public.release_abandoned_unpaid_checkout(uuid, text) from public;
revoke all on function public.release_abandoned_unpaid_checkout(uuid, text) from anon;
revoke all on function public.release_abandoned_unpaid_checkout(uuid, text) from authenticated;
grant execute on function public.release_abandoned_unpaid_checkout(uuid, text) to service_role;
