-- Business-readiness foundations. Review and deploy separately; this file is
-- intentionally not executed by the application task.

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'OPEN' check (status in ('OPEN', 'WAITING', 'RESOLVED')),
  order_id uuid null references public.orders(id) on delete set null,
  subject text not null default 'Customer support',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_user_id uuid null references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('CUSTOMER', 'ADMIN', 'AI')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_conversations_user_updated_idx
  on public.support_conversations(user_id, updated_at desc);
create index if not exists support_messages_conversation_created_idx
  on public.support_messages(conversation_id, created_at);

create table if not exists public.category_reward_rules (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  provider text null,
  basis text not null check (basis in ('REALIZED_COMMISSION', 'GROSS_MARGIN', 'FIXED')),
  fixed_amount numeric(12,2) null check (fixed_amount is null or fixed_amount >= 0),
  percentage numeric(7,4) null check (percentage is null or percentage >= 0),
  minimum_transaction_amount numeric(12,2) null check (minimum_transaction_amount is null or minimum_transaction_amount >= 0),
  cap_per_transaction numeric(12,2) null check (cap_per_transaction is null or cap_per_transaction >= 0),
  campaign_starts_at timestamptz null,
  campaign_ends_at timestamptz null,
  funded_by text not null check (funded_by in ('ZESHU', 'SUPPLIER', 'BRAND', 'PROVIDER')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  check (campaign_ends_at is null or campaign_starts_at is null or campaign_ends_at > campaign_starts_at)
);

create table if not exists public.supplier_metadata (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  category text not null,
  service_area text null,
  lead_time text null,
  minimum_order_quantity numeric null check (minimum_order_quantity is null or minimum_order_quantity >= 0),
  landed_cost numeric(12,2) null check (landed_cost is null or landed_cost >= 0),
  scheme_notes text null,
  return_sla text null,
  reliability_status text not null default 'UNREVIEWED' check (reliability_status in ('UNREVIEWED', 'REVIEWING', 'APPROVED', 'BLOCKED')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_fulfillment_metadata (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  product_id uuid null references public.products(id) on delete cascade,
  location_key text null,
  delivery_class text not null check (delivery_class in ('FIVE_HOUR', 'SAME_DAY', 'STANDARD_3_5_DAYS')),
  eligible boolean not null default false,
  supplier_id uuid null references public.supplier_metadata(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (location_key is null or btrim(location_key) <> ''),
  unique(service_key, product_id, location_key, delivery_class)
);

-- PostgreSQL UNIQUE constraints treat NULLs as distinct. This expression index
-- makes the logical scope key null-safe without changing the nullable API.
create unique index if not exists service_fulfillment_metadata_logical_key_idx
  on public.service_fulfillment_metadata (
    service_key,
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(nullif(btrim(location_key), ''), '__GLOBAL__'),
    delivery_class
  );

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.category_reward_rules enable row level security;
alter table public.supplier_metadata enable row level security;
alter table public.service_fulfillment_metadata enable row level security;

revoke all on public.support_conversations from public, anon, authenticated;
revoke all on public.support_messages from public, anon, authenticated;
revoke all on public.category_reward_rules from public, anon, authenticated;
revoke all on public.supplier_metadata from public, anon, authenticated;
revoke all on public.service_fulfillment_metadata from public, anon, authenticated;
grant all on public.support_conversations to service_role;
grant all on public.support_messages to service_role;
grant all on public.category_reward_rules to service_role;
grant all on public.supplier_metadata to service_role;
grant all on public.service_fulfillment_metadata to service_role;

create policy "customers read own support conversations"
  on public.support_conversations for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "customers create own support conversations"
  on public.support_conversations for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'OPEN'
    and resolved_at is null
    and length(btrim(subject)) between 1 and 160
    and (
      order_id is null
      or exists (
        select 1 from public.orders o
        where o.id = order_id and o.user_id = auth.uid()
      )
    )
  );
create policy "admins manage support conversations"
  on public.support_conversations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "conversation participants read messages"
  on public.support_messages for select to authenticated
  using (exists (select 1 from public.support_conversations c where c.id = conversation_id and (c.user_id = auth.uid() or public.is_admin())));
create policy "customers create support messages"
  on public.support_messages for insert to authenticated
  with check (sender_user_id = auth.uid() and sender_role = 'CUSTOMER' and exists (select 1 from public.support_conversations c where c.id = conversation_id and c.user_id = auth.uid() and c.status <> 'RESOLVED'));
create policy "admins create support messages"
  on public.support_messages for insert to authenticated
  with check (public.is_admin() and sender_user_id = auth.uid() and sender_role = 'ADMIN');

create policy "admins manage reward rules"
  on public.category_reward_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admins manage suppliers"
  on public.supplier_metadata for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admins manage fulfillment metadata"
  on public.service_fulfillment_metadata for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
