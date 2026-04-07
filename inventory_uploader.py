import flet as ft
import httpx
import csv
import asyncio

# Point this to your live Render backend
BASE_URL = "https://zeshu-api.onrender.com"

def main(page: ft.Page):
    page.title = "Zeshu Admin Dashboard"
    page.theme_mode = ft.ThemeMode.LIGHT
    page.window_width = 500
    page.window_height = 600
    page.padding = 30

    # UI Elements
    status_text = ft.Text("Ready to upload.", color="grey", size=16)
    progress_bar = ft.ProgressBar(width=400, color="blue", value=0, visible=False)
    log_list = ft.ListView(expand=True, spacing=5, auto_scroll=True)

    # --- THE UPLOAD LOGIC ---
    async def process_csv(file_path):
        progress_bar.visible = True
        progress_bar.value = None # Infinite loading animation
        status_text.value = "Reading CSV file..."
        status_text.color = "blue"
        log_list.controls.clear()
        page.update()

        try:
            # 1. Open the file you selected
            with open(file_path, mode='r', encoding='utf-8-sig') as file:
                csv_reader = csv.DictReader(file)
                products = list(csv_reader)
            
            total_items = len(products)
            status_text.value = f"Found {total_items} products. Uploading to Render..."
            page.update()

            # 2. Send each product to your cloud backend
            success_count = 0
            async with httpx.AsyncClient() as client:
                for item in products:
                    try:
                        payload = {
                            "name": item["name"],
                            "price": float(item["price"]),
                            "image_url": item["image_url"]
                        }
                        
                        res = await client.post(f"{BASE_URL}/admin/add-product", json=payload)
                        
                        if res.status_code == 200 or res.status_code == 201:
                            success_count += 1
                            log_list.controls.append(ft.Text(f"✅ Added: {item['name']}", color="green"))
                        else:
                            log_list.controls.append(ft.Text(f"❌ Failed: {item['name']} - {res.text}", color="red"))
                    except Exception as e:
                        log_list.controls.append(ft.Text(f"⚠️ Error on {item['name']}: {str(e)}", color="orange"))
                    
                    page.update()
            
            # 3. Finish up
            progress_bar.visible = False
            status_text.value = f"Complete! Successfully uploaded {success_count} out of {total_items} items."
            status_text.color = "green"
            page.update()

        except Exception as ex:
            progress_bar.visible = False
            status_text.value = f"System Error: {str(ex)}"
            status_text.color = "red"
            page.update()

    # --- FILE PICKER CONTROLLER ---
    # FIXED: The new Flet 0.80+ way to use FilePicker (No overlays required!)
    async def handle_file_pick(e):
        files = await ft.FilePicker().pick_files(allowed_extensions=["csv"])
        if files: # If the user didn't hit cancel
            file_path = files[0].path
            await process_csv(file_path)

    # --- UI LAYOUT ---
    page.add(
        ft.Row([
            ft.Icon(ft.Icons.ADMIN_PANEL_SETTINGS, size=40, color="blue"),
            ft.Text("Zeshu Inventory Manager", size=24, weight="bold")
        ]),
        ft.Divider(),
        ft.Text("Upload your products.csv file to update the live database instantly."),
        ft.FilledButton(
            "Select CSV File", 
            icon=ft.Icons.UPLOAD_FILE, 
            on_click=handle_file_pick, # FIXED: Triggers the direct async function
            height=50,
            width=200
        ),
        ft.Container(height=20),
        status_text,
        progress_bar,
        ft.Divider(),
        ft.Text("Upload Log:", weight="bold"),
        ft.Container(content=log_list, expand=True, bgcolor="#f9fafb", padding=10, border_radius=10)
    )

if __name__ == "__main__":
    ft.run(main)