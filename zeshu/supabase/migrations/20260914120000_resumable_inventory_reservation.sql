-- Server-only lookup for resuming an unexpired payment-pending checkout.

create or replace function public.get_resumable_inventory_reservation(
  p_user_id uuid
)
returns table (
  reservation_id uuid,
  razorpay_order_id text,
  expected_total_paid numeric,
  delivery_address text,
  vendor_id uuid,
  pricing_snapshot jsonb,
  reservation_items jsonb,
  expires_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    ir.id,
    ir.razorpay_order_id,
    ir.expected_total_paid,
    ir.delivery_address,
    ir.vendor_id,
    ir.pricing_snapshot,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', iri.product_id,
          'quantity', iri.quantity,
          'unit_price', iri.unit_price
        )
        order by iri.product_id
      ) filter (where iri.product_id is not null),
      '[]'::jsonb
    ),
    ir.expires_at
  from public.inventory_reservations ir
  left join public.inventory_reservation_items iri
    on iri.reservation_id = ir.id
  where ir.user_id = p_user_id
    and ir.status = 'PAYMENT_PENDING'
    and ir.razorpay_order_id is not null
    and ir.expires_at > now()
  group by ir.id
  order by ir.created_at desc
  limit 1;
$$;

revoke all on function public.get_resumable_inventory_reservation(uuid) from public;
revoke all on function public.get_resumable_inventory_reservation(uuid) from authenticated;
grant execute on function public.get_resumable_inventory_reservation(uuid) to service_role;
