-- Durable marker for a Razorpay-bound checkout that was freshly reconciled
-- as unpaid and safely abandoned.  Historical rows are not backfilled: the
-- server must reconcile each row once before this marker is written.
alter table public.inventory_reservations
  add column abandoned_at timestamptz null;

create or replace function public.abandon_mismatched_payment_pending_checkout(
  p_reservation_id uuid,
  p_razorpay_order_id text
)
returns table (
  abandoned boolean,
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
    raise exception 'invalid abandoned checkout request';
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
    raise exception 'reservation is not expired';
  end if;

  if v_reservation.status not in ('EXPIRED', 'PAYMENT_PENDING') then
    raise exception 'reservation is not an expired abandoned checkout';
  end if;

  -- Any provider event other than a successfully processed payment.failed
  -- event is evidence that the payment state is not safe to abandon.
  if exists (
    select 1
    from public.payment_provider_events e
    where e.razorpay_order_id = v_reservation.razorpay_order_id
      and not (e.event_type = 'payment.failed' and e.status = 'PROCESSED')
  ) then
    raise exception 'payment reconciliation required';
  end if;

  -- A refund record is retained as a fail-closed signal for late-payment
  -- reconciliation and must never be discarded by abandonment.
  if exists (
    select 1
    from public.payment_reconciliation_refunds r
    where r.reservation_id = v_reservation.id
  ) then
    raise exception 'payment reconciliation required';
  end if;

  if v_reservation.status = 'PAYMENT_PENDING' then
    update public.inventory_reservations ir
    set status = 'EXPIRED'
    where ir.id = v_reservation.id
      and ir.status = 'PAYMENT_PENDING'
      and ir.expires_at <= now();

    if not found then
      raise exception 'reservation is no longer abandonable';
    end if;
  end if;

  -- Reuse the established ownership-safe reward-release implementation.  The
  -- durable marker is written only after this release returns success.
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

  return query select true, (v_release_result.redemption_released is true);
end;
$$;

revoke all on function public.abandon_mismatched_payment_pending_checkout(uuid, text) from public;
revoke all on function public.abandon_mismatched_payment_pending_checkout(uuid, text) from anon;
revoke all on function public.abandon_mismatched_payment_pending_checkout(uuid, text) from authenticated;
grant execute on function public.abandon_mismatched_payment_pending_checkout(uuid, text) to service_role;
