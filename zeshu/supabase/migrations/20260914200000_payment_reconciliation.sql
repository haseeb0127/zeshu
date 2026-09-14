create table if not exists public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'razorpay'),
  provider_event_id text not null unique,
  event_type text not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  payload_hash text not null,
  status text not null check (status in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED_REVIEW')),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payment_provider_events_order_idx
  on public.payment_provider_events(razorpay_order_id);

create table if not exists public.payment_reconciliation_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null unique,
  razorpay_order_id text not null,
  reservation_id uuid not null references public.inventory_reservations(id) on delete restrict,
  refund_id text unique,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null check (status in ('PENDING', 'REFUND_REQUESTED', 'REFUNDED', 'FAILED_REVIEW')),
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_reconciliation_refunds_reservation_idx
  on public.payment_reconciliation_refunds(reservation_id);

alter table public.payment_provider_events enable row level security;
alter table public.payment_reconciliation_refunds enable row level security;

revoke all on table public.payment_provider_events from public;
revoke all on table public.payment_provider_events from anon;
revoke all on table public.payment_provider_events from authenticated;
revoke all on table public.payment_reconciliation_refunds from public;
revoke all on table public.payment_reconciliation_refunds from anon;
revoke all on table public.payment_reconciliation_refunds from authenticated;
grant all on table public.payment_provider_events to service_role;
grant all on table public.payment_reconciliation_refunds to service_role;

create or replace function public.release_refunded_zeshu_cash_redemption(
  p_reservation_id uuid,
  p_razorpay_payment_id text,
  p_razorpay_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_reservation public.inventory_reservations%rowtype;
  v_redemption public.reward_redemptions%rowtype;
  v_payment_id text := nullif(btrim(p_razorpay_payment_id), '');
  v_order_id text := nullif(btrim(p_razorpay_order_id), '');
begin
  if p_reservation_id is null or v_payment_id is null or v_order_id is null then
    raise exception 'invalid refunded checkout request';
  end if;

  select ir.user_id into v_user_id
  from public.inventory_reservations ir
  where ir.id = p_reservation_id;

  if v_user_id is null then
    raise exception 'reservation not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 61129));

  select ir.* into v_reservation
  from public.inventory_reservations ir
  where ir.id = p_reservation_id
  for update;

  select rr.* into v_redemption
  from public.reward_redemptions rr
  where rr.reservation_id = p_reservation_id
  for update;

  if not found then
    raise exception 'reward redemption not found';
  end if;
  if v_redemption.status = 'RELEASED' then
    return false;
  end if;
  if v_redemption.status <> 'RESERVED'
     or v_reservation.status <> 'EXPIRED'
     or v_redemption.order_id is not null
     or v_reservation.razorpay_order_id is distinct from v_order_id
     or v_redemption.razorpay_order_id is distinct from v_order_id then
    raise exception 'refunded checkout is not releasable';
  end if;

  if not exists (
    select 1
    from public.payment_reconciliation_refunds prr
    where prr.payment_id = v_payment_id
      and prr.razorpay_order_id = v_order_id
      and prr.reservation_id = p_reservation_id
      and prr.status = 'REFUNDED'
  ) then
    raise exception 'refund is not confirmed';
  end if;

  update public.inventory_reservations ir
  set expected_total_paid = ir.pre_reward_total_paid,
      pricing_snapshot = jsonb_set(
        jsonb_set(
          ir.pricing_snapshot,
          '{discount_total}',
          coalesce(ir.pricing_snapshot -> 'base_discount_total', '0'::jsonb),
          true
        ),
        '{zeshu_cash_redemption}',
        '0'::jsonb,
        true
      )
  where ir.id = p_reservation_id;

  update public.reward_redemptions rr
  set status = 'RELEASED', released_at = now()
  where rr.id = v_redemption.id and rr.status = 'RESERVED';

  if not found then
    raise exception 'reward redemption is no longer available';
  end if;
  return true;
end;
$$;

revoke all on function public.release_refunded_zeshu_cash_redemption(uuid, text, text) from public;
revoke all on function public.release_refunded_zeshu_cash_redemption(uuid, text, text) from anon;
revoke all on function public.release_refunded_zeshu_cash_redemption(uuid, text, text) from authenticated;
grant execute on function public.release_refunded_zeshu_cash_redemption(uuid, text, text) to service_role;
