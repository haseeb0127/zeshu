-- Draft only: review before deployment. No application path writes this table yet.
create table public.recharge_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  service text not null check (service = 'mobile'),
  planapi_operator_code text not null,
  operator_name text,
  circle_name text,
  provider_operator_code text,
  provider_circle_code text,
  plan_id text,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  payment_provider text check (payment_provider is null or payment_provider = 'RAZORPAY'),
  payment_order_id text,
  payment_id text,
  provider text not null check (provider = 'A1TOPUP'),
  provider_order_id text not null unique,
  provider_txid text,
  provider_status text,
  status text not null default 'CREATED' check (status in ('CREATED', 'PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'PROVIDER_SUBMITTING', 'PROVIDER_PENDING', 'SUCCESS', 'FAILED', 'REVERSAL_PENDING', 'REVERSED')),
  mobile_last4 text check (mobile_last4 is null or mobile_last4 ~ '^[0-9]{4}$'),
  mobile_lookup_hmac text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recharge_payment_provider_ids_ck check (
    (payment_order_id is null and payment_id is null)
    or payment_provider = 'RAZORPAY'
  ),
  constraint recharge_payment_requires_order_ck check (
    payment_id is null or payment_order_id is not null
  )
);

alter table public.recharge_transactions enable row level security;
revoke all on table public.recharge_transactions from anon, authenticated;

comment on column public.recharge_transactions.mobile_lookup_hmac is
'Keyed server-side HMAC for lookup/deduplication only. Never store a plain or unsalted phone hash; the HMAC key remains server-only and this value cannot recover or decrypt the mobile number.';

create function public.set_recharge_transactions_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_recharge_transactions_updated_at() from public, anon, authenticated;

create trigger recharge_transactions_updated_at
before update on public.recharge_transactions
for each row execute function public.set_recharge_transactions_updated_at();

create unique index recharge_transactions_payment_order_uidx
on public.recharge_transactions (payment_order_id)
where payment_order_id is not null;

create unique index recharge_transactions_payment_id_uidx
on public.recharge_transactions (payment_id)
where payment_id is not null;

create index recharge_transactions_user_created_idx
on public.recharge_transactions (user_id, created_at desc);

create index recharge_transactions_status_updated_idx
on public.recharge_transactions (status, updated_at);
