-- Verified customer reviews for delivered orders and purchased products.

create table if not exists public.order_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  rider_id uuid null references public.riders(id),
  overall_rating integer not null check (overall_rating between 1 and 5),
  delivery_rating integer null check (delivery_rating is null or delivery_rating between 1 and 5),
  store_rating integer null check (store_rating is null or store_rating between 1 and 5),
  comment text null check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, user_id)
);

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text null check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, product_id, user_id)
);

create index if not exists order_reviews_vendor_idx on public.order_reviews(vendor_id, created_at desc);
create index if not exists product_reviews_product_idx on public.product_reviews(product_id, created_at desc);

alter table public.order_reviews enable row level security;
alter table public.product_reviews enable row level security;

drop policy if exists "customers read own order reviews" on public.order_reviews;
create policy "customers read own order reviews"
  on public.order_reviews for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "customers read own product reviews" on public.product_reviews;
create policy "customers read own product reviews"
  on public.product_reviews for select to authenticated
  using (user_id = auth.uid());

create or replace function public.customer_submit_order_review(
  p_order_id uuid,
  p_overall_rating integer,
  p_delivery_rating integer,
  p_store_rating integer,
  p_comment text
)
returns public.order_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_review public.order_reviews;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_order_id is null then raise exception 'order not found'; end if;
  if p_overall_rating is null
     or p_overall_rating not between 1 and 5
     or (p_delivery_rating is not null and p_delivery_rating not between 1 and 5)
     or (p_store_rating is not null and p_store_rating not between 1 and 5) then
    raise exception 'rating must be between 1 and 5';
  end if;
  if v_comment is not null and char_length(v_comment) > 1000 then
    raise exception 'comment is too long';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;
  if not found or v_order.status <> 'DELIVERED' then
    raise exception 'only delivered orders can be reviewed';
  end if;
  if v_order.vendor_id is null then raise exception 'order vendor is unavailable'; end if;

  insert into public.order_reviews(order_id, user_id, vendor_id, rider_id, overall_rating, delivery_rating, store_rating, comment)
  values (v_order.id, v_user_id, v_order.vendor_id, v_order.rider_id, p_overall_rating, p_delivery_rating, p_store_rating, v_comment)
  on conflict (order_id, user_id) do update set
    overall_rating = excluded.overall_rating,
    delivery_rating = excluded.delivery_rating,
    store_rating = excluded.store_rating,
    comment = excluded.comment,
    vendor_id = excluded.vendor_id,
    rider_id = excluded.rider_id,
    updated_at = now()
  returning * into v_review;
  return v_review;
end;
$$;

create or replace function public.customer_submit_product_review(
  p_order_id uuid,
  p_product_id uuid,
  p_rating integer,
  p_comment text
)
returns public.product_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_review public.product_reviews;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_order_id is null or p_product_id is null then raise exception 'order or product not found'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'rating must be between 1 and 5'; end if;
  if v_comment is not null and char_length(v_comment) > 1000 then raise exception 'comment is too long'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_user_id
  for update;
  if not found or v_order.status <> 'DELIVERED' then raise exception 'only delivered orders can be reviewed'; end if;
  if not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(v_order.items) = 'array' then v_order.items else '[]'::jsonb end) as item
    where coalesce(item->'item'->>'id', item->>'product_id', item->'item_snapshot'->>'id', item->>'id') = p_product_id::text
  ) then
    raise exception 'product was not purchased in this order';
  end if;

  insert into public.product_reviews(order_id, user_id, product_id, rating, comment)
  values (v_order.id, v_user_id, p_product_id, p_rating, v_comment)
  on conflict (order_id, product_id, user_id) do update set
    rating = excluded.rating,
    comment = excluded.comment,
    updated_at = now()
  returning * into v_review;
  return v_review;
end;
$$;

create or replace function public.get_product_review_aggregates(p_product_ids uuid[])
returns table(product_id uuid, average_rating numeric, review_count bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select pr.product_id, round(avg(pr.rating)::numeric, 2), count(*)
  from public.product_reviews pr
  where pr.product_id = any(coalesce(p_product_ids, '{}'::uuid[]))
  group by pr.product_id;
$$;

create or replace function public.get_vendor_review_aggregates(p_vendor_ids uuid[])
returns table(vendor_id uuid, average_store_rating numeric, store_review_count bigint, average_delivery_rating numeric, delivery_review_count bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select r.vendor_id,
    round(
      (avg(r.store_rating) filter (where r.store_rating is not null))::numeric,
      2
    ),
    count(r.store_rating),
    round(
      (avg(r.delivery_rating) filter (where r.delivery_rating is not null))::numeric,
      2
    ),
    count(r.delivery_rating)
  from public.order_reviews r
  where r.vendor_id = any(coalesce(p_vendor_ids, '{}'::uuid[]))
  group by r.vendor_id;
$$;

revoke all on function public.customer_submit_order_review(uuid, integer, integer, integer, text) from public;
revoke all on function public.customer_submit_product_review(uuid, uuid, integer, text) from public;
revoke all on function public.get_product_review_aggregates(uuid[]) from public;
revoke all on function public.get_vendor_review_aggregates(uuid[]) from public;
grant execute on function public.customer_submit_order_review(uuid, integer, integer, integer, text) to authenticated;
grant execute on function public.customer_submit_product_review(uuid, uuid, integer, text) to authenticated;
grant execute on function public.get_product_review_aggregates(uuid[]) to anon, authenticated;
grant execute on function public.get_vendor_review_aggregates(uuid[]) to anon, authenticated;
