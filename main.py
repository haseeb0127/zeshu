import flet as ft
import flet_map as fm
import httpx
import asyncio

# --- CONFIGURATION ---
BASE_URL = "https://zeshu-api.onrender.com"

# --- HELPER FUNCTIONS (Design & Hover) ---
def toggle_hover(e):
    e.control.scale = 1.05 if e.data == "true" else 1.0
    e.control.update()

def create_category_card(title, image_url, bg_color):
    return ft.Container(
        content=ft.Column([
            ft.Image(src=image_url, height=60, fit="contain"),
            ft.Text(title, weight="bold", size=12, text_align="center", color="black"),
        ], alignment="center", horizontal_alignment="center", spacing=5),
        bgcolor=bg_color,
        padding=10,
        border_radius=15,
        alignment=ft.Alignment(0, 0),
        shadow=ft.BoxShadow(blur_radius=10, color="#0D000000"), 
        col={"xs": 6, "sm": 4, "md": 3}, 
        on_hover=lambda e: toggle_hover(e),
        animate_scale=ft.Animation(300, "decelerate"),
    )

# --- CLOUD API HELPERS ---
async def get_products():
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BASE_URL}/catalog")
            return response.json()
        except: return []

async def get_driver_location(order_id):
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BASE_URL}/admin/get-all-active-locations")
            locations = response.json()
            for loc in locations:
                if loc['order_id'] == order_id:
                    return loc['lat'], loc['lng']
            return None, None
        except: return None, None

# --- MAIN APP ---
async def main(page: ft.Page):
    page.title = "Zeshu Store"
    page.theme_mode = ft.ThemeMode.LIGHT
    page.bgcolor = "#FFFFFF" 
    page.padding = 0

    # --- TRACKING VIEW ---
    async def show_tracking_screen(order_id):
        page.clean()
        marker = fm.Marker(
            content=ft.Icon(ft.Icons.DELIVERY_DINING_ROUNDED, color="blue", size=40),
            coordinates=fm.MapLatitudeLongitude(18.79, 78.91),
        )
        map_view = fm.Map(
            expand=True,
            configuration=fm.MapConfiguration(initial_center=fm.MapLatitudeLongitude(18.79, 78.91), initial_zoom=15),
            layers=[
                fm.TileLayer(url_template="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"),
                fm.MarkerLayer(markers=[marker]),
            ],
        )
        status_text = ft.Text(f"Order #{order_id} Confirmed!", size=18, weight="bold")
        page.add(
            ft.AppBar(title=ft.Text("Live Tracking"), bgcolor="#3b82f6", color="white"),
            ft.Container(
                content=ft.Column([
                    status_text,
                    ft.Container(content=map_view, expand=True, border_radius=20, clip_behavior=ft.ClipBehavior.HARD_EDGE),
                    ft.FilledButton("Back to Store", on_click=lambda _: asyncio.create_task(show_store_view()), width=200)
                ]),
                padding=20, expand=True
            )
        )
        while True:
            lat, lng = await get_driver_location(order_id)
            if lat and lng:
                marker.coordinates = fm.MapLatitudeLongitude(lat, lng)
                status_text.value = "Driver is on the way! 🛵"
                status_text.color = "green"
            page.update()
            await asyncio.sleep(5)

    # --- STORE VIEW ---
    async def show_store_view():
        page.clean()
        page.padding = 0
        cart = []
        global_items = [] # We will store the products here for the search to use

        # --- DIALOGS ---
        phone_history_input = ft.TextField(label="Phone Number", height=50)
        history_list = ft.ListView(expand=True, spacing=10, height=300)
        phone_input = ft.TextField(label="Mobile Number")
        email_input = ft.TextField(label="Email Address")
        
        history_dialog = ft.AlertDialog(
            title=ft.Text("My Order History", weight="bold"),
            content=ft.Column([
                ft.Row([phone_history_input, ft.IconButton(ft.Icons.SEARCH, on_click=lambda e: asyncio.create_task(fetch_history(e)))], alignment="center"),
                history_list
            ], tight=True)
        )

        checkout_dialog = ft.AlertDialog(
            title=ft.Text("Checkout"),
            content=ft.Column([phone_input, email_input], tight=True)
        )

        loading_dialog = ft.AlertDialog(title=ft.Text("Connecting..."))
        page.overlay.extend([history_dialog, checkout_dialog, loading_dialog])

        # --- ASYNC LOGIC ---
        async def fetch_history(e):
            phone = phone_history_input.value
            if not phone: return
            history_list.controls.clear()
            history_list.controls.append(ft.ProgressBar())
            page.update()
            try:
                async with httpx.AsyncClient() as client:
                    res = await client.get(f"{BASE_URL}/admin/orders")
                    if res.status_code == 200:
                        my_orders = [o for o in res.json() if str(o.get("phone")) == str(phone)]
                        history_list.controls.clear()
                        for o in my_orders:
                            history_list.controls.append(ft.Card(content=ft.Container(padding=15, content=ft.Column([
                                ft.Text(f"Order #{o['id']} - {o.get('status', 'Pending').upper()}", weight="bold", color="#3b82f6"),
                                ft.Text(o.get('items_summary', '')),
                                ft.Text(f"₹{o.get('total_price', 0)}", color="green", weight="bold")
                            ]))))
            except: history_list.controls.append(ft.Text("Error!"))
            page.update()

        async def process_payment(e):
            if not phone_input.value or not email_input.value: return
            checkout_dialog.open = False
            loading_dialog.open = True
            page.update()
            summary = ", ".join([item['name'] for item in cart])
            total = sum([item['price'] for item in cart])
            async with httpx.AsyncClient() as client:
                try:
                    order_res = await client.post(f"{BASE_URL}/admin/add-order", json={
                        "items_summary": summary, "total_price": total, "address": "Jagtial", 
                        "phone": phone_input.value, "email": email_input.value
                    })
                    order_id = order_res.json().get("id")
                    pay_res = await client.post(f"{BASE_URL}/create-payment-link", json={"order_id": order_id, "amount": total})
                    await page.launch_url(pay_res.json().get("payment_url"))
                except: pass
            loading_dialog.open = False
            page.update()

        # --- UI COMPONENTS ---
        header = ft.Container(
            padding=20,
            content=ft.Row([
                ft.Column([
                    ft.Text("ZESHU", size=28, weight="bold", color="#3b82f6"),
                    ft.Row([ft.Icon(ft.Icons.LOCATION_ON, size=14, color="grey"), ft.Text("Jagtial, Telangana", color="grey", size=12)])
                ], spacing=0),
                ft.IconButton(ft.Icons.RECEIPT_LONG, icon_color="#3b82f6", on_click=lambda _: setattr(history_dialog, 'open', True) or page.update())
            ], alignment="spaceBetween")
        )

        def handle_search(e):
            query = e.control.value.lower()
            filtered_items = [
                item for item in global_items 
                if query in item.get('name', '').lower()
            ]
            render_product_cards(filtered_items)

        search_bar = ft.Container(
            padding=ft.Padding(20, 0, 20, 10),
            content=ft.TextField(
                hint_text='Search "egg" or "milk"',
                prefix_icon=ft.Icons.SEARCH,
                border_radius=15,
                bgcolor="#f3f4f6",
                border_color="transparent",
                filled=True,
                on_change=handle_search
            )
        )

        categories_grid = ft.ResponsiveRow([
            create_category_card("Veg & Fruits", "https://cdn-icons-png.flaticon.com/512/2329/2329865.png", "#E8F5E9"),
            create_category_card("Dairy & Bread", "https://cdn-icons-png.flaticon.com/512/3050/3050158.png", "#E3F2FD"),
            create_category_card("Atta & Dal", "https://cdn-icons-png.flaticon.com/512/3348/3348094.png", "#FFF3E0"),
            create_category_card("Snacks", "https://cdn-icons-png.flaticon.com/512/2553/2553691.png", "#FCE4EC"),
        ], spacing=15, run_spacing=15)

        products_grid = ft.GridView(expand=True, runs_count=2, max_extent=250, child_aspect_ratio=0.7, spacing=15)

        cart_status_text = ft.Text("0 Items | ₹0", color="white", weight="bold")
        checkout_bar = ft.Container(
            content=ft.Row([cart_status_text, ft.FilledButton("Checkout", on_click=lambda _: setattr(checkout_dialog, 'open', True) or page.update(), bgcolor="white", color="#3b82f6")], alignment="spaceBetween"),
            bgcolor="#3b82f6", padding=15, border_radius=15, visible=False, margin=20
        )

        def add_to_cart(e, name, price):
            cart.append({"name": name, "price": price})
            total = sum(i['price'] for i in cart)
            checkout_bar.visible = True
            cart_status_text.value = f"{len(cart)} Items | ₹{total}"
            page.update()

        def render_product_cards(items_to_show):
            products_grid.controls.clear()
            for item in items_to_show:
                stock = item.get('stock', 10) # Default to 10 if API doesn't have stock yet
                is_out_of_stock = stock <= 0
                
                products_grid.controls.append(ft.Container(
                    content=ft.Column([
                        ft.Image(src=item.get('image_url'), height=120, fit="cover", border_radius=10),
                        ft.Text(item.get('name'), weight="bold", size=14),
                        ft.Text(f"₹{item.get('price')}", color="grey" if is_out_of_stock else "green", weight="bold"),
                        
                        ft.Text("Out of Stock", color="red", size=12, weight="bold") if is_out_of_stock else 
                        ft.IconButton(ft.Icons.ADD_CIRCLE, icon_color="#3b82f6", on_click=lambda e, n=item['name'], p=item['price']: add_to_cart(e, n, p))
                    ], spacing=5),
                    padding=10, bgcolor="#f9fafb", border_radius=15,
                    opacity=0.5 if is_out_of_stock else 1.0
                ))
            page.update()

        # --- ASSEMBLE PAGE ---
        main_content = ft.Column([
            header,
            search_bar,
            ft.Container(padding=20, content=ft.Column([
                ft.Text("Shop by Category", size=18, weight="bold"),
                categories_grid,
                ft.Divider(height=40, color="transparent"),
                ft.Text("Fresh for You", size=18, weight="bold"),
                products_grid
            ])),
        ], scroll="auto", expand=True)

        page.add(
            ft.Stack([
                main_content, 
                ft.Container(
                    content=checkout_bar, 
                    alignment=ft.Alignment(0, 1)
                )
            ], expand=True)
        )

        # LOAD DATA AND RENDER ONCE
        global_items = await get_products()
        render_product_cards(global_items)
        
        checkout_dialog.actions = [
            ft.TextButton("Cancel", on_click=lambda _: setattr(checkout_dialog, 'open', False) or page.update()),
            ft.FilledButton("Pay Now", on_click=process_payment)
        ]
        page.update()

    await show_store_view()

if __name__ == "__main__":
    ft.app(main)