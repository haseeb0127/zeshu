-- Keep one current verified product review per customer/product and expose a
-- privacy-safe public feed. Existing rows are deduplicated by latest update.

with ranked_reviews as (
  select id,
    row_number() over (
      partition by user_id, product_id
      order by updated_at desc, created_at desc, id desc
    ) as row_number
  from public.product_reviews
)
delete from public.product_reviews pr
using ranked_reviews rr
where pr.id = rr.id
  and rr.row_number > 1;

create unique index if not exists product_reviews_one_current_per_user_product_idx
  on public.product_reviews(user_id, product_id);

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
  on conflict (user_id, product_id) do update set
    order_id = excluded.order_id,
    rating = excluded.rating,
    comment = excluded.comment,
    updated_at = now()
  returning * into v_review;
  return v_review;
end;
$$;

create or replace function public.get_public_product_reviews(
  p_product_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  rating integer,
  comment text,
  created_at timestamptz,
  updated_at timestamptz,
  verified_purchase boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    pr.rating,
    pr.comment,
    pr.created_at,
    pr.updated_at,
    true as verified_purchase
  from public.product_reviews pr
  where pr.product_id = p_product_id
    and pr.comment is not null
    and char_length(btrim(pr.comment)) > 0
  order by pr.updated_at desc, pr.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.customer_submit_product_review(uuid, uuid, integer, text) from public;
revoke all on function public.get_public_product_reviews(uuid, integer, integer) from public;
grant execute on function public.customer_submit_product_review(uuid, uuid, integer, text) to authenticated;
grant execute on function public.get_public_product_reviews(uuid, integer, integer) to anon, authenticated;
