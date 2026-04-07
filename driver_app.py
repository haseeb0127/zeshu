import flet as ft
import httpx
import asyncio

async def main(page: ft.Page):
    # --- 🛡️ CLEAN WEB SETUP ---
    page.title = "Zeshu Web Tracker"
    page.bgcolor = "#020617"
    page.theme_mode = ft.ThemeMode.DARK
    page.vertical_alignment = "center"
    page.horizontal_alignment = "center"

    status_text = ft.Text("Waiting for start...", color="grey")
    order_id_input = ft.TextField(
        label="Order ID", 
        border_color="#3b82f6", 
        width=300,
        color="white"
    )

    # 1. This function sends coordinates to your cloud
    async def sync_to_cloud(lat, lng):
        oid = order_id_input.value
        if not oid: return
        try:
            async with httpx.AsyncClient() as client:
                url = f"https://zeshu-api.onrender.com/admin/update-location/{oid}"
                await client.post(url, json={"lat": lat, "lng": lng}, timeout=5)
            status_text.value = f"✅ Live Syncing: {lat:.4f}, {lng:.4f}"
            status_text.color = "green"
        except:
            status_text.value = "❌ Cloud Sync Error"
        page.update()

    # 2. This is the BUILT-IN Flet location handler
    async def on_position(e):
        # This will trigger whenever the browser detects movement
        await sync_to_cloud(e.latitude, e.longitude)

    async def start_tracking(e):
        if not order_id_input.value:
            status_text.value = "⚠️ Please enter an Order ID"
            page.update()
            return

        # Connect the built-in location listener
        page.on_location_change = on_position
        status_text.value = "🛰️ Browser GPS Activated!"
        page.update()

    # --- UI ---
    page.add(
        ft.Icon(ft.Icons.LOCATION_ON, size=80, color="#3b82f6"),
        ft.Text("ZESHU WEB DRIVER", size=28, weight="bold", color="white"),
        ft.Container(height=10),
        order_id_input,
        # Using FilledButton to fix the deprecation warning
        ft.FilledButton(
            "Start Live Tracking", 
            on_click=start_tracking, 
            width=300, 
            height=50
        ),
        ft.Container(height=10),
        status_text
    )

if __name__ == "__main__":
    # Use ft.app(main) which is the most stable entry point
    ft.app(target=main)