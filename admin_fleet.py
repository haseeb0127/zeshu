import flet as ft
import flet_map as fm
import httpx
import asyncio
import math

# --- 📐 THE MATH ---
def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371 
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2)**2)
    return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

async def main(page: ft.Page):
    page.title = "Zeshu Command Center - Jagtial"
    page.theme_mode = ft.ThemeMode.LIGHT
    page.bgcolor = ft.Colors.BLUE_GREY_50
    page.window.maximized = True
    
    # --- 🗄️ GLOBAL STATE ---
    all_orders_data = []
    fleet_state = {} 
    jagtial_center_coord = [18.7917, 78.9133]
    jagtial_center = fm.MapLatitudeLongitude(jagtial_center_coord[0], jagtial_center_coord[1])

    # --- 🗺️ MAP LAYERS ---
    live_map = fm.Map(
        expand=True, initial_center=jagtial_center, initial_zoom=14,
        layers=[
            fm.TileLayer(url_template="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"),
            fm.PolylineLayer(polylines=[]), 
            fm.MarkerLayer(markers=[]),     
        ],
    )

    heatmap_layer = fm.CircleLayer(circles=[])
    analytics_map = fm.Map(
        expand=True, initial_center=jagtial_center, initial_zoom=14,
        layers=[
            fm.TileLayer(url_template="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"),
            heatmap_layer
        ],
    )

    # --- 🛰️ SYNC LOOP ---
    async def sync_fleet():
        while True:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    res = await client.get("https://zeshu-api.onrender.com/admin/get-all-active-locations")
                    if res.status_code == 200:
                        locations = res.json()
                        active_now_ids = set()
                        for driver in locations:
                            oid = str(driver['order_id'])
                            active_now_ids.add(oid)
                            coord = fm.MapLatitudeLongitude(driver['lat'], driver['lng'])
                            
                            if oid not in fleet_state:
                                marker = fm.Marker(content=ft.Icon(ft.Icons.LOCAL_SHIPPING, color="red", size=35), coordinates=coord)
                                trail = fm.PolylineMarker(coordinates=[coord], border_color=ft.Colors.BLUE_400, border_stroke_width=4)
                                fleet_state[oid] = {"marker": marker, "trail": trail, "history": [coord]}
                                live_map.layers[2].markers.append(marker)
                                live_map.layers[1].polylines.append(trail)
                            else:
                                state = fleet_state[oid]
                                state["marker"].coordinates = coord
                                if coord != state["history"][-1]:
                                    state["history"].append(coord)
                                    state["trail"].coordinates = state["history"]

                        for oid in list(fleet_state.keys()):
                            if oid not in active_now_ids:
                                live_map.layers[2].markers.remove(fleet_state[oid]["marker"])
                                live_map.layers[1].polylines.remove(fleet_state[oid]["trail"])
                                del fleet_state[oid]
                        
                        page.update()
            except: pass
            await asyncio.sleep(5)

    # --- 📊 ANALYTICS & DELIVERED LOGIC ---
    leaderboard_list = ft.ListView(expand=True, spacing=10)
    
    async def load_leaderboard():
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get("https://zeshu-api.onrender.com/admin/leaderboard")
                if res.status_code == 200:
                    data = res.json()
                    leaderboard_list.controls.clear()
                    for d in data:
                        leaderboard_list.controls.append(
                            ft.ListTile(
                                leading=ft.Icon(ft.Icons.PERSON),
                                title=ft.Text(f"Driver: {d['driver_id']}"), 
                                subtitle=ft.Text(f"Deliveries: {d['delivery_count']}")
                            )
                        )
                    page.update()
        except: pass

    async def load_heatmap():
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get("https://zeshu-api.onrender.com/admin/heatmap")
                if res.status_code == 200:
                    data = res.json()
                    heatmap_layer.circles.clear()
                    for p in data:
                        heatmap_layer.circles.append(
                            fm.CircleMarker(
                                radius=150, 
                                coordinates=fm.MapLatitudeLongitude(p['lat'], p['lng']), 
                                color=ft.Colors.with_opacity(0.4, "red"), 
                                use_radius_in_meter=True
                            )
                        )
                    page.update()
        except: pass

    async def change_status(e, order_id):
        e.control.disabled = True
        page.update()
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"https://zeshu-api.onrender.com/admin/complete-order/{order_id}"
            res = await client.post(url)
            if res.status_code == 200:
                page.snack_bar = ft.SnackBar(ft.Text(f"Order #{order_id} Delivered!"), bgcolor="green")
                page.snack_bar.open = True
                await fetch_orders()
                await load_heatmap()
                await load_leaderboard()
            else:
                e.control.disabled = False
            page.update()

    # --- 📋 ORDERS LIST ---
    orders_list = ft.ListView(expand=True, spacing=10)
    revenue_text = ft.Text("₹0", size=22, weight="bold", color="green")

    def render_orders(data):
        orders_list.controls.clear()
        delivered_revenue = sum(o['total_price'] for o in data if o['status'] == 'Delivered')
        revenue_text.value = f"₹{delivered_revenue}"

        for o in data:
            oid = str(o['id'])
            is_active = oid in fleet_state
            orders_list.controls.append(
                ft.Container(
                    padding=15, border_radius=10, bgcolor=ft.Colors.WHITE,
                    content=ft.Column([
                        ft.Row([ft.Text(f"Order #{o['id']}", weight="bold"), ft.Text(o['status'].upper(), size=10, color="orange" if o['status']=="Pending" else "green")]),
                        ft.Text(f"📍 {o['address']}", size=12),
                        ft.Divider(),
                        ft.FilledButton(
                            "Mark Delivered", 
                            icon=ft.Icons.CHECK_CIRCLE,
                            visible=o['status'] == "Pending",
                            on_click=lambda e, curr_id=o['id']: page.run_task(change_status, e, curr_id)
                        )
                    ])
                )
            )
        page.update()

    async def fetch_orders():
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get("https://zeshu-api.onrender.com/admin/orders")
                if res.status_code == 200:
                    render_orders(res.json())
        except: pass

    # --- 🏗️ LAYOUT ---
    sidebar = ft.Container(width=350, padding=20, bgcolor=ft.Colors.WHITE, content=ft.Column([
        ft.Text("Zeshu Command", size=24, weight="bold"),
        ft.Row([ft.Text("Total Revenue:"), revenue_text], alignment=ft.MainAxisAlignment.SPACE_BETWEEN),
        ft.Divider(),
        orders_list
    ]))

    # --- 🏗️ MODERN TABS (Compatibility Fix for your Version) ---
    tabs = ft.Tabs(
        selected_index=0, 
        length=3, 
        expand=True,
        content=ft.Column(
            expand=True,
            controls=[
                ft.TabBar(
                    tabs=[
                        # Changed 'text' to 'label' to fix the TypeError
                        ft.Tab(label="Live Tracking", icon=ft.Icons.SATELLITE_ALT),
                        ft.Tab(label="Heatmap", icon=ft.Icons.MAP),
                        ft.Tab(label="Leaderboard", icon=ft.Icons.LEADERBOARD),
                    ]
                ),
                ft.TabBarView(
                    expand=True,
                    controls=[
                        ft.Container(content=live_map, padding=10),
                        ft.Container(content=analytics_map, padding=10),
                        ft.Container(content=leaderboard_list, padding=30),
                    ]
                )
            ]
        )
    )

    page.add(ft.Row([sidebar, tabs], expand=True))
    
    # Startup tasks
    page.run_task(sync_fleet)
    await fetch_orders()
    await load_heatmap()
    await load_leaderboard()

if __name__ == "__main__":
    ft.run(main)