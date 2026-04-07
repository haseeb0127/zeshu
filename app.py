import flet as ft
import httpx

async def main(page: ft.Page):
    # --- 1. SETUP & STATE ---
    page.title = "Zeshu - Jagtial Quick Commerce"
    page.window_width = 400
    page.window_height = 800
    page.bgcolor = ft.Colors.GREY_50
    page.theme_mode = ft.ThemeMode.LIGHT
    
    cart = {} # {product_id: quantity}
    products_data = []
    product_list = ft.ListView(expand=True, spacing=10, padding=15)

    # --- 2. LOGIC: UPDATE UI ---
    def update_cart_ui():
        total_items = sum(cart.values())
        total_price = 0
        for p_id, qty in cart.items():
            product = next((p for p in products_data if p['id'] == p_id), None)
            if product:
                total_price += product['price'] * qty
        
        if total_items > 0:
            cart_bar.visible = True
            cart_bar.content.controls[0].value = f"{total_items} Items"
            cart_bar.content.controls[2].value = f"₹{total_price}"
        else:
            cart_bar.visible = False
        page.update()

    # --- 3. LOGIC: CHECKOUT ---
    async def open_checkout(e):
        items_list = []
        total_price = 0
        for p_id, qty in cart.items():
            p = next((item for item in products_data if item['id'] == p_id), None)
            if p:
                items_list.append(f"{p['name']} x{qty}")
                total_price += p['price'] * qty
        
        summary_text = ", ".join(items_list)
        address_input = ft.TextField(label="Delivery Address in Jagtial", hint_text="House No, Area Name...")

        async def confirm_order(e):
            if not address_input.value:
                page.snack_bar = ft.SnackBar(ft.Text("Please enter an address!"))
                page.snack_bar.open = True
                page.update()
                return

            order_data = {
                "items_summary": summary_text,
                "total_price": total_price,
                "address": address_input.value
            }

            async with httpx.AsyncClient() as client:
                try:
                    res = await client.post("https://zeshu-api.onrender.com/place-order", json=order_data)
                    if res.status_code == 200:
                        cart.clear()
                        bs.open = False
                        refresh_product_list()
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

        bs = ft.BottomSheet(
            ft.Container(
                padding=20,
                content=ft.Column([
                    ft.Text("Checkout Summary", size=20, weight="bold"),
                    ft.Divider(),
                    ft.Text(f"Items: {summary_text}"),
                    ft.Text(f"Total: ₹{total_price}", size=18, weight="bold", color=ft.Colors.GREEN_700),
                    address_input,
                    ft.ElevatedButton("Place Order", bgcolor=ft.Colors.GREEN_800, color="white", width=400, on_click=confirm_order),
                ], tight=True, spacing=15),
            ),
        )
        page.overlay.append(bs)
        bs.open = True
        page.update()

    # --- 4. UI: CART BAR ---
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

    # --- 5. LOGIC: QUANTITY SELECTOR ---
    def update_quantity(p_id, change):
        current = cart.get(p_id, 0)
        new_qty = max(0, current + change)
        if new_qty == 0: cart.pop(p_id, None)
        else: cart[p_id] = new_qty
        refresh_product_list()
        update_cart_ui()

    def create_selector(p_id, count):
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
                ft.IconButton(ft.Icons.ADD, icon_color="white", icon_size=16, on_click=lambda _: update_quantity(p_id, 1)),
            ], spacing=0)
        )

    def refresh_product_list():
        product_list.controls.clear()
        for p in products_data:
            count = cart.get(p['id'], 0)
            product_list.controls.append(
                ft.Card(
                    elevation=0.5,
                    content=ft.Container(
                        padding=12,
                        content=ft.Row([
                            ft.Container(width=50, height=50, bgcolor=ft.Colors.GREY_100, border_radius=5),
                            ft.Column([ft.Text(p['name'], weight="bold"), ft.Text(f"₹{p['price']}")], expand=True),
                            create_selector(p['id'], count)
                        ])
                    )
                )
            )
        page.update()

    # --- 6. INITIALIZATION ---
    async def load_data():
        nonlocal products_data
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get("https://zeshu-api.onrender.com/products")
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
            padding=ft.padding.only(left=15, top=10)
        ),
        product_list, 
        cart_bar
    )
    await load_data()
from fastapi import APIRouter, Request
import sqlite3

# --- NEW: Fetch User Profile ---
@app.get("/user/{phone}")
async def get_user_profile(phone: str):
    conn = sqlite3.connect("zeshu.db")
    cursor = conn.cursor()
    cursor.execute("SELECT email, address FROM users WHERE phone=?", (phone,))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {"found": True, "email": user[0], "address": user[1]}
    return {"found": False}

# --- UPGRADED: Add Order & Manage Stock ---
@app.post("/admin/add-order")
async def add_order(request: Request):
    data = await request.json()
    phone = data.get("phone")
    email = data.get("email")
    address = data.get("address")
    cart_items = data.get("cart_items", []) # We will send a list of items from Flet now
    
    conn = sqlite3.connect("zeshu.db")
    cursor = conn.cursor()
    
    # 1. Update or Create the User Profile (Save address for next time)
    cursor.execute("""
        INSERT INTO users (phone, email, address) 
        VALUES (?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET 
        email=excluded.email, address=excluded.address
    """, (phone, email, address))
    
    # 2. Deduct Stock for Live Inventory
    for item in cart_items:
        cursor.execute("""
            UPDATE products 
            SET stock = stock - ? 
            WHERE name = ? AND stock >= ?
        """, (item['qty'], item['name'], item['qty']))
        
    # 3. Save the Order (Your existing logic)
    cursor.execute("""
        INSERT INTO orders (items_summary, total_price, address, phone) 
        VALUES (?, ?, ?, ?)
    """, (data.get("items_summary"), data.get("total_price"), address, phone))
    
    order_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return {"status": "success", "id": order_id}
if __name__ == "__main__":
    ft.app(target=main, view=ft.AppView.WEB_BROWSER)