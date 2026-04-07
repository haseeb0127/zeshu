import flet as ft
import httpx

# Point this to your FastAPI server 
API_BASE_URL = "http://127.0.0.1:8000"

async def main(page: ft.Page):
    # --- SETUP & STATE ---
    page.title = "Zeshu - Jagtial Quick Commerce"
    page.window_width = 400
    page.window_height = 800
    page.bgcolor = ft.Colors.GREY_50
    page.theme_mode = ft.ThemeMode.LIGHT
    
    cart = {} 
    products_data = []
    product_list = ft.ListView(expand=True, spacing=10, padding=15)

    # --- LOGIC: UPDATE UI ---
    def update_cart_ui():
        total_items = sum(cart.values())
        total_price = sum(next((p['price'] for p in products_data if p['id'] == p_id), 0) * qty for p_id, qty in cart.items())
        
        if total_items > 0:
            cart_bar.visible = True
            cart_bar.content.controls[0].value = f"{total_items} Items"
            cart_bar.content.controls[2].value = f"₹{total_price}"
        else:
            cart_bar.visible = False
        page.update()

    # --- LOGIC: CHECKOUT ---
    async def open_checkout(e):
        items_list = []
        cart_items_payload = [] 
        total_price = 0
        
        for p_id, qty in cart.items():
            p = next((item for item in products_data if item['id'] == p_id), None)
            if p:
                items_list.append(f"{p['name']} x{qty}")
                cart_items_payload.append({"id": p['id'], "qty": qty})
                total_price += p['price'] * qty
        
        summary_text = ", ".join(items_list)
        
        phone_input = ft.TextField(label="Phone Number", hint_text="10-digit mobile number")
        address_input = ft.TextField(label="Delivery Address in Jagtial", hint_text="House No, Area Name...")

        bs = ft.BottomSheet(ft.Container(padding=20))
        page.overlay.append(bs)

        async def confirm_order(e):
            if not address_input.value or not phone_input.value:
                page.snack_bar = ft.SnackBar(ft.Text("Please enter phone and address!"))
                page.snack_bar.open = True
                page.update()
                return

            order_data = {
                "phone": phone_input.value,
                "email": "", 
                "items_summary": summary_text,
                "cart_items": cart_items_payload, 
                "total_price": total_price,
                "address": address_input.value
            }

            async with httpx.AsyncClient() as client:
                try:
                    res = await client.post(f"{API_BASE_URL}/place-order", json=order_data)
                    if res.status_code == 200:
                        cart.clear()
                        bs.open = False 
                        # Refresh data from server to get updated stock!
                        await load_data() 
                        update_cart_ui()
                        page.dialog = ft.AlertDialog(
                            title=ft.Text("Order Placed!"),
                            content=ft.Text("Zeshu is bringing your groceries in 10 mins."),
                            actions=[ft.TextButton("OK", on_click=lambda _: setattr(page.dialog, "open", False))]
                        )
                        page.dialog.open = True
                        page.update()
                except Exception as err:
                    print(f"Order Error: {err}")

        bs.content.content = ft.Column([
            ft.Text("Checkout Summary", size=20, weight="bold"),
            ft.Divider(),
            ft.Text(f"Items: {summary_text}"),
            ft.Text(f"Total: ₹{total_price}", size=18, weight="bold", color=ft.Colors.GREEN_700),
            phone_input,
            address_input,
            ft.ElevatedButton("Place Order", bgcolor=ft.Colors.GREEN_800, color="white", width=400, on_click=confirm_order),
        ], tight=True, spacing=15)
        
        bs.open = True
        page.update()

    # --- UI: CART BAR ---
    cart_bar = ft.Container(
        content=ft.Row([
            ft.Text("0 Items", color=ft.Colors.WHITE, weight="bold"),
            ft.VerticalDivider(color=ft.Colors.WHITE30),
            ft.Text("₹0", color=ft.Colors.WHITE, weight="bold"),
            ft.Container(expand=True), 
            ft.Text("View Cart ➔", color=ft.Colors.WHITE, weight="bold")
        ]),
        bgcolor=ft.Colors.GREEN_800, padding=15, border_radius=12, margin=10, visible=False,
        on_click=open_checkout 
    )

    # --- LOGIC: QUANTITY SELECTOR ---
    def update_quantity(p_id, change):
        current = cart.get(p_id, 0)
        new_qty = max(0, current + change)
        if new_qty == 0: cart.pop(p_id, None)
        else: cart[p_id] = new_qty
        refresh_product_list()
        update_cart_ui()

    # --- UPDATED: Live Inventory Selector ---
    def create_selector(p_id, count, stock):
        if stock <= 0:
            return ft.Container(
                content=ft.Text("OUT OF STOCK", color=ft.Colors.RED_700, size=10, weight="bold"),
                padding=ft.padding.symmetric(horizontal=10, vertical=5),
                border=ft.border.all(1, ft.Colors.RED_200),
                border_radius=5,
                bgcolor=ft.Colors.RED_50
            )
        
        if count == 0:
            return ft.Container(
                content=ft.Text("ADD", color=ft.Colors.GREEN_700, weight="bold"),
                border=ft.border.all(1, ft.Colors.GREEN_700),
                padding=ft.padding.symmetric(horizontal=20, vertical=5),
                border_radius=5,
                on_click=lambda _: update_quantity(p_id, 1)
            )
        
        return ft.Container(
            bgcolor=ft.Colors.GREEN_700, border_radius=5,
            content=ft.Row([
                ft.IconButton(ft.Icons.REMOVE, icon_color="white", icon_size=16, on_click=lambda _: update_quantity(p_id, -1)),
                ft.Text(str(count), color="white", weight="bold"),
                ft.IconButton(ft.Icons.ADD, icon_color="white", icon_size=16, 
                              on_click=lambda _: update_quantity(p_id, 1) if count < stock else None),
            ], spacing=0)
        )

    # --- UPDATED: Live Inventory Refresh ---
    def refresh_product_list():
        product_list.controls.clear()
        for p in products_data:
            count = cart.get(p['id'], 0)
            stock = p.get('stock', 0)
            
            img_url = f"https://dummyimage.com/50x50/2e7d32/ffffff&text={p['name'][:3].upper()}"

            product_list.controls.append(
                ft.Card(
                    elevation=0.5,
                    opacity=1.0 if stock > 0 else 0.5, # Gray out if empty!
                    content=ft.Container(
                        padding=12,
                        content=ft.Row([
                            ft.Image(src=img_url, width=50, height=50, fit="contain"),
                            ft.Column([
                                ft.Text(p['name'], weight="bold"), 
                                ft.Text(f"₹{p['price']}"),
                                ft.Text(f"Stock: {stock}", size=10, color=ft.Colors.GREY_500) if stock > 0 else ft.Container()
                            ], expand=True),
                            create_selector(p['id'], count, stock) # Passed stock here!
                        ])
                    )
                )
            )
        page.update()

    # --- INITIALIZATION ---
    async def load_data():
        nonlocal products_data
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{API_BASE_URL}/products")
                products_data = res.json()
                refresh_product_list()
        except Exception as e:
            print(f"Server offline: {e}")

    page.add(
        ft.Container(
            content=ft.Column([
                ft.Text("Zeshu", size=24, weight="bold", color=ft.Colors.GREEN_800),
                ft.Text("Delivering to Jagtial", size=12, color=ft.Colors.GREY_600),
            ], spacing=0),
            padding=ft.Padding(left=15, top=10, right=0, bottom=0) 
        ),
        product_list, 
        cart_bar
    )
    await load_data()

if __name__ == "__main__":
    ft.run(main, view=ft.AppView.WEB_BROWSER, port=5000)