import flet as ft
import httpx
import flet_map as fm

# Point this to your live Vercel server!
API_URL = "https://www.zeshu.in"

def main(page: ft.Page):
    page.title = "Zeshu God Mode"
    page.theme_mode = "dark"
    page.padding = 20

    # UI Elements
    header = ft.Text("👑 ZESHU GOD MODE", size=30, weight="bold", color=ft.Colors.BLUE_400)
    revenue_text = ft.Text("Total Revenue: ₹0", size=24, weight="bold", color=ft.Colors.GREEN_400)

    # MASTER MAP COMPONENT (Fixed for older flet_map versions)
    map_view = fm.Map(
        expand=2, # Map takes up 2/3 of the screen
        initial_center=fm.MapLatitudeLongitude(18.796, 78.915), # Jagtial
        initial_zoom=13,
        layers=[
            fm.TileLayer(
                url_template="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            ),
        ],
    )

    marker_layer = fm.MarkerLayer(markers=[])
    map_view.layers.append(marker_layer)

    orders_list = ft.ListView(expand=1, spacing=10) # List takes up 1/3 of the screen

    def fetch_orders(e=None):
        try:
            # 1. Fetch Orders from Database
            orders_res = httpx.get(f"{API_URL}/admin/orders")
            orders = orders_res.json() if orders_res.status_code == 200 else []

            # 2. Fetch Live Driver Locations
            loc_res = httpx.get(f"{API_URL}/admin/get-all-active-locations")
            locations = loc_res.json() if loc_res.status_code == 200 else []

            orders_list.controls.clear()
            marker_layer.markers.clear()

            # Calculate Actual Revenue
            total_revenue = sum([float(o.get("total_price", 0)) for o in orders])
            revenue_text.value = f"Total Revenue: ₹{total_revenue}"

            # Add markers to the map for active locations
            for loc in locations:
                lat, lng = loc.get("lat"), loc.get("lng")
                if lat and lng:
                    marker_layer.markers.append(
                        fm.Marker(
                            content=ft.Icon(ft.Icons.LOCATION_ON, color=ft.Colors.RED_ACCENT, size=40),
                            coordinates=fm.MapLatitudeLongitude(lat, lng),
                        )
                    )

            # Add order cards to the list
            for data in orders:
                order_id = data.get("id")
                status = data.get("status", "Pending").upper()
                summary = data.get("items_summary", "")
                price = data.get("total_price", 0)

                # Pick color based on status
                status_color = ft.Colors.AMBER_400 if status == "PENDING" else ft.Colors.GREEN_400

                orders_list.controls.append(ft.Card(
                    elevation=5,
                    content=ft.Container(
                        padding=15,
                        content=ft.Column([
                            ft.Text(f"Order #{order_id}", weight="bold", size=18),
                            ft.Text(f"Status: {status}", color=status_color, weight="bold"),
                            ft.Text(f"Items: {summary}"),
                            ft.Text(f"Amount: ₹{price}", color=ft.Colors.GREEN_400, weight="bold"),
                        ])
                    )
                ))
            
            page.update()
        except Exception as ex:
            print(f"Error fetching data: {ex}")

    # Build the screen layout
    page.add(
        header,
        revenue_text,
        ft.ElevatedButton("Refresh Live Data", icon=ft.Icons.REFRESH, on_click=fetch_orders),
        ft.Row([map_view, orders_list], expand=True) 
    )
    
    # Automatically fetch data when the app opens
    fetch_orders()

if __name__ == "__main__":
    ft.run(main)