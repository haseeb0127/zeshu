alter table public.products
  add column if not exists brand text null;

alter table public.products
  drop constraint if exists products_brand_length_check;

alter table public.products
  add constraint products_brand_length_check
  check (brand is null or char_length(btrim(brand)) between 1 and 120);

create or replace function public.vendor_update_product_brand(
  p_product_id uuid,
  p_brand text
)
returns public.products
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product public.products%rowtype;
begin
  if auth.uid() is null or p_product_id is null then
    raise exception 'invalid product update';
  end if;

  select *
  into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found
     or not exists (
       select 1
       from public.vendors
       where id = v_product.vendor_id
         and owner_id = auth.uid()
     ) then
    raise exception 'invalid product update';
  end if;

  update public.products
  set brand = nullif(btrim(p_brand), '')
  where id = p_product_id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.vendor_update_product_brand(uuid, text) from public;
revoke all on function public.vendor_update_product_brand(uuid, text) from anon;
grant execute on function public.vendor_update_product_brand(uuid, text) to authenticated;
