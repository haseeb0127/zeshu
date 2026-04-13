import flet as ft
import flet_map as fm
import httpx
import asyncio

API_BASE = "https://api.zeshu.in"

async def main(page: ft.Page):
    page.title = "Zeshu Super App"
    page.bgcolor = "#f8fafc"

    cart = []
    user_phone = ft.TextField(label="Phone")

    # ---------------- LOGIN ----------------
    def open_login(e):
        page.dialog = ft.AlertDialog(
            title=ft.Text("Login"),
            content=user_phone,
            actions=[
                ft.FilledButton("Continue", on_click=login_success)
            ]
        )
        page.dialog.open = True
        page.update()

    def login_success(e):
        page.dialog.open = False
        page.snack_bar = ft.SnackBar(ft.Text(f"Logged in: {user_phone.value}"))
        page.snack_bar.open = True
        page.update()

    # ---------------- CART ----------------
    def add_to_cart(name, price):
        cart.append({"name": name, "price": price})
        update_cart()

    cart_text = ft.Text("0 Items | ₹0", color="white")

    def update_cart():
        total = sum(i["price"] for i in cart)
        cart_bar.visible = len(cart) > 0
        cart_text.value = f"{len(cart)} Items | ₹{total}"
        page.update()

    def open_cart(e):
        items = [
            ft.Row([
                ft.Text(i["name"], expand=True),
                ft.Text(f"₹{i['price']}")
            ]) for i in cart
        ]

        total = sum(i["price"] for i in cart)

        page.dialog = ft.AlertDialog(
            title=ft.Text("Cart"),
            content=ft.Column(items + [ft.Divider(), ft.Text(f"Total ₹{total}")]),
            actions=[
                ft.TextButton("Close", on_click=lambda e: close_dialog()),
                ft.FilledButton("Checkout", on_click=process_payment)
            ]
        )
        page.dialog.open = True
        page.update()

    def close_dialog():
        page.dialog.open = False
        page.update()

    # ---------------- PAYMENT ----------------
    async def process_payment(e):
        total = sum(i["price"] for i in cart)

        async with httpx.AsyncClient() as client:
            order = await client.post(f"{API_BASE}/admin/add-order", json={
                "items_summary": str(cart),
                "total_price": total,
                "address": "Jagtial",
                "phone": user_phone.value or "9999999999",
                "email": "test@zeshu.com"
            })

            order_id = order.json().get("id")

            pay = await client.post(f"{API_BASE}/create-payment-link", json={
                "order_id": order_id,
                "amount": total
            })

            url = pay.json().get("payment_url")

            if url:
                await page.launch_url(url)
                await show_tracking(order_id)

    # ---------------- TRACKING ----------------
    async def show_tracking(order_id):
        page.clean()

        marker = fm.Marker(
            coordinates=fm.MapLatitudeLongitude(18.79, 78.91),
            content=ft.Icon(ft.Icons.DELIVERY_DINING, color="blue")
        )

        map_view = fm.Map(
            expand=True,
            initial_center=fm.MapLatitudeLongitude(18.79, 78.91),
            initial_zoom=15,
            layers=[
                fm.TileLayer(url_template="https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
                fm.MarkerLayer(markers=[marker])
            ]
        )

        status = ft.Text("Waiting for driver...")

        page.add(
            ft.AppBar(title=ft.Text("Live Tracking")),
            status,
            map_view
        )

        while True:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{API_BASE}/admin/get-all-active-locations")
                data = res.json()

                for d in data:
                    if d["order_id"] == order_id:
                        marker.coordinates = fm.MapLatitudeLongitude(d["lat"], d["lng"])
                        status.value = "Driver is coming 🚀"

            page.update()
            await asyncio.sleep(5)

    # ---------------- UI ----------------
    products = [
        {"name": "Milk", "price": 30},
        {"name": "Bread", "price": 40},
        {"name": "Apples", "price": 120},
        {"name": "Chips", "price": 20},
    ]

    grid = ft.GridView(expand=True, runs_count=2)

    for p in products:
        grid.controls.append(
            ft.Card(
                content=ft.Container(
                    padding=15,
                    content=ft.Column([
                        ft.Text(p["name"], weight="bold"),
                        ft.Text(f"₹{p['price']}"),
                        ft.FilledButton("Add", on_click=lambda e, n=p["name"], pr=p["price"]: add_to_cart(n, pr))
                    ])
                )
            )
        )

    cart_bar = ft.Container(
        bgcolor="green",
        padding=10,
        visible=False,
        content=ft.Row([
            cart_text,
            ft.Container(expand=True),
            ft.FilledButton("View Cart", on_click=open_cart)
        ])
    )

    page.add(
        ft.Column([
            ft.Row([
                ft.Text("Zeshu", size=24, weight="bold"),
                ft.Container(expand=True),
                ft.IconButton(ft.Icons.PERSON, on_click=open_login)
            ]),
            grid,
            cart_bar
        ], expand=True)
    )

ft.app(main)