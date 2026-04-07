import flet as ft
import flet_map as fm
import httpx
import asyncio
import math

# --- 📐 THE MATH: Haversine Formula ---
def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371 
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2)**2 + 
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2)**2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c 

async def main(page: ft.Page):
    page.title = "Zeshu Command Center - Jagtial"
    page.theme_mode = ft.ThemeMode.LIGHT
    page.bgcolor = ft.Colors.BLUE_GREY_50
    page.window.maximized = True
    
    # --- 🗄️ GLOBAL STATE ---
    all_orders_data = []
    # { order_id: {"marker": fm.Marker, "history": [], "trail": fm.PolylineMarker} }
    fleet_state = {} 

    # --- 🗺️ THE GLOBAL FLEET MAP ---
    jagtial_center = fm.MapLatitudeLongitude(18.7917, 78.9133)
    
    map_control = fm.Map(
        expand=True,
        initial_center=jagtial_center,
        initial_zoom=14,
        layers=[
            fm.TileLayer(url_template="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"),
            fm.CircleLayer(circles=[
                fm.CircleMarker(
                    radius=1500, coordinates=jagtial_center,
                    color=ft.Colors.with_opacity(0.1, ft.Colors.BLUE_200),
                    border_color=ft.Colors.with_opacity(0.2, ft.Colors.BLUE_400),
                    use_radius_in_meter=True
                )
            ]),
            fm.PolylineLayer(polylines=[]), # Layer Index 2: Trails
            fm.MarkerLayer(markers=[]),     # Layer Index 3: Drivers
        ],
    )

    # --- 🛰️ RECONCILIATION TASK (The "Brain") ---
    async def sync_fleet():
        AVERAGE_SPEED = 25 # km/h
        while True:
            try:
                async with httpx.AsyncClient() as client:
                    # NEW ENDPOINT: Fetch all active coordinates at once
                    res = await client.get("https://zeshu-api.onrender.com/admin/get-all-active-locations")
                    if res.status_code == 200:
                        locations = res.json()
                        active_now_ids = set()

                        for driver in locations:
                            oid = str(driver['order_id'])
                            active_now_ids.add(oid)
                            coord = fm.MapLatitudeLongitude(driver['lat'], driver['lng'])

                            # 1. NEW DRIVER detected
                            if oid not in fleet_state:
                                marker = fm.Marker(
                                    content=ft.Tooltip(
                                        message=f"Order #{oid}",
                                        content=ft.Icon(ft.Icons.LOCATION_ON, color=ft.Colors.RED, size=30)
                                    ),
                                    coordinates=coord
                                )
                                trail = fm.PolylineMarker(
                                    coordinates=[coord],
                                    border_color=ft.Colors.BLUE_ACCENT_400,
                                    border_stroke_width=3
                                )
                                fleet_state[oid] = {"marker": marker, "trail": trail, "history": [coord]}
                                map_control.layers[3].markers.append(marker)
                                map_control.layers[2].polylines.append(trail)

                            # 2. UPDATE EXISTING DRIVER
                            else:
                                state = fleet_state[oid]
                                state["marker"].coordinates = coord
                                if coord != state["history"][-1]:
                                    state["history"].append(coord)
                                    state["trail"].coordinates = state["history"]

                        # 3. CLEANUP: Remove drivers who are no longer active
                        for oid in list(fleet_state.keys()):
                            if oid not in active_now_ids:
                                map_control.layers[3].markers.remove(fleet_state[oid]["marker"])
                                map_control.layers[2].polylines.remove(fleet_state[oid]["trail"])
                                del fleet_state[oid]

                        page.update()
            except: pass
            await asyncio.sleep(5)

    # --- 📋 ORDER LIST UI ---
    orders_list = ft.ListView(expand=True, spacing=10)
    revenue_text = ft.Text("₹0", size=20, weight="bold", color=ft.Colors.GREEN_700)
    
    def render_orders(data):
        orders_list.controls.clear()
        revenue = sum(o['total_price'] for o in data)
        revenue_text.value = f"₹{revenue}"
        for o in data:
            orders_list.controls.append(
                ft.ListTile(
                    leading=ft.Icon(ft.Icons.SHOPPING_BAG, color=ft.Colors.BLUE_GREY_400),
                    title=ft.Text(f"Order #{o['id']}", weight="bold"),
                    subtitle=ft.Text(f"{o['address']}\n{o['items_summary']}", size=12),
                    trailing=ft.Text(o['status'], color=ft.Colors.ORANGE_700 if o['status'] == "Pending" else ft.Colors.GREEN_700),
                    is_three_line=True,
                )
            )
        page.update()

    async def fetch_orders():
        nonlocal all_orders_data
        async with httpx.AsyncClient() as client:
            res = await client.get("https://zeshu-api.onrender.com/admin/orders")
            all_orders_data = res.json()
            render_orders(all_orders_data)

    # --- 🏗️ DASHBOARD LAYOUT ---
    sidebar = ft.Container(
        width=350,
        padding=20,
        bgcolor=ft.Colors.WHITE,
        content=ft.Column([
            ft.Row([ft.Icon(ft.Icons.DASHBOARD), ft.Text("Zeshu Fleet", size=20, weight="bold")]),
            ft.Divider(),
            ft.Row([ft.Text("Total Revenue:"), revenue_text], alignment=ft.MainAxisAlignment.SPACE_BETWEEN),
            ft.TextField(hint_text="Search address...", prefix_icon=ft.Icons.SEARCH, on_change=lambda e: render_orders([o for o in all_orders_data if e.control.value.lower() in o['address'].lower()])),
            ft.Text("Active Deliveries", weight="bold"),
            orders_list
        ])
    )

    page.add(
        ft.Row([
            sidebar,
            ft.Container(content=map_control, expand=True, padding=10, bgcolor=ft.Colors.BLUE_GREY_100)
        ], expand=True)
    )

    page.run_task(sync_fleet)
    await fetch_orders()

ft.run(main)