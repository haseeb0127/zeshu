create or replace function public.admin_assign_rider(
  p_order_id uuid,
  p_rider_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_rider public.riders%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin access required';
  end if;

  if p_order_id is null or p_rider_id is null then
    raise exception 'invalid rider assignment request';
  end if;

  -- Lock the order first so status/assignment cannot change underneath us.
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  if v_order.status <> 'READY_FOR_PICKUP' then
    raise exception 'order is not ready for rider assignment';
  end if;

  -- Lock and verify the selected rider.
  select *
  into v_rider
  from public.riders
  where id = p_rider_id
  for update;

  if not found then
    raise exception 'rider not found';
  end if;

  if v_rider.user_id is null
     or v_rider.is_active is distinct from true
     or v_rider.admin_suspended is distinct from false then
    raise exception 'rider is not available for assignment';
  end if;

  update public.orders
  set
    rider_id = v_rider.id,
    assigned_rider_id = v_rider.user_id
  where id = v_order.id
    and status = 'READY_FOR_PICKUP'
  returning * into v_order;

  if not found then
    raise exception 'order is no longer ready for rider assignment';
  end if;

  return v_order;
end;
$$;

create or replace function public.advance_rider_order_status(
  p_order_id uuid,
  p_next_status text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_auth_user_id uuid := auth.uid();
    v_rider_id uuid;
    v_order_rider_id uuid;
    v_assigned_rider_user_id uuid;
    v_current_status text;
begin
    -- Authentication required
    if v_auth_user_id is null then
        raise exception 'unauthenticated';
    end if;

    -- Resolve exactly one rider profile for this authenticated user.
    select r.id
    into v_rider_id
    from public.riders r
    where r.user_id = v_auth_user_id
    limit 1;

    if v_rider_id is null then
        raise exception 'rider profile missing';
    end if;

    -- Lock the order before checking/changing its lifecycle state.
    select
        o.rider_id,
        o.assigned_rider_id,
        o.status
    into
        v_order_rider_id,
        v_assigned_rider_user_id,
        v_current_status
    from public.orders o
    where o.id = p_order_id
    for update;

    if not found then
        raise exception 'order not found';
    end if;

    -- Both assignment relationships must identify this rider.
    if v_order_rider_id is distinct from v_rider_id
       or v_assigned_rider_user_id is distinct from v_auth_user_id then
        raise exception 'order not assigned to rider';
    end if;

    -- Permit only forward rider lifecycle transitions.
    if not (
        (v_current_status = 'READY_FOR_PICKUP'
            and p_next_status = 'PICKED_UP')
        or
        (v_current_status = 'PICKED_UP'
            and p_next_status = 'OUT_FOR_DELIVERY')
        or
        (v_current_status = 'OUT_FOR_DELIVERY'
            and p_next_status = 'DELIVERED')
    ) then
        raise exception 'invalid transition from % to %',
            v_current_status,
            p_next_status;
    end if;

    -- Status is the ONLY order column modified by this function.
    update public.orders
    set status = p_next_status
    where id = p_order_id;

    return p_next_status;
end;
$$;

revoke all on function public.admin_assign_rider(uuid, uuid) from public;
revoke all on function public.advance_rider_order_status(uuid, text) from public;

grant execute on function public.admin_assign_rider(uuid, uuid) to authenticated;
grant execute on function public.advance_rider_order_status(uuid, text) to authenticated;
