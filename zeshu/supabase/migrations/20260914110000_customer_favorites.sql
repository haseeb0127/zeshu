create table if not exists public.customer_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint customer_favorites_user_product_unique unique (user_id, product_id)
);

create index if not exists customer_favorites_user_created_idx
  on public.customer_favorites(user_id, created_at desc);

alter table public.customer_favorites enable row level security;

drop policy if exists "customers read own favorites" on public.customer_favorites;
create policy "customers read own favorites"
  on public.customer_favorites
  for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.customer_add_favorite(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_product_id is null or not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'product not found';
  end if;
  insert into public.customer_favorites(user_id, product_id)
  values (v_user_id, p_product_id)
  on conflict (user_id, product_id) do nothing;
  return true;
end;
$$;

create or replace function public.customer_remove_favorite(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_product_id is null then
    raise exception 'product not found';
  end if;
  delete from public.customer_favorites
  where user_id = auth.uid()
    and product_id = p_product_id;
  return true;
end;
$$;

revoke all on function public.customer_add_favorite(uuid) from public;
revoke all on function public.customer_add_favorite(uuid) from anon;
grant execute on function public.customer_add_favorite(uuid) to authenticated;

revoke all on function public.customer_remove_favorite(uuid) from public;
revoke all on function public.customer_remove_favorite(uuid) from anon;
grant execute on function public.customer_remove_favorite(uuid) to authenticated;
