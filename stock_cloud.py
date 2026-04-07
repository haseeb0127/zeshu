import httpx
import asyncio

# Make sure this matches your Render URL exactly
BASE_URL = "https://zeshu-api.onrender.com"

groceries = [
    {
        "name": "Amul Gold Milk (1L)",
        "price": 66.0,
        "stock": 50,
        "image_url": "https://m.media-amazon.com/images/I/61D87wA23HL._SX679_.jpg",
        "category": "Dairy"
    },
    {
        "name": "Lays Magic Masala",
        "price": 20.0,
        "stock": 100,
        "image_url": "https://m.media-amazon.com/images/I/71X8k7+HtkL._SX679_.jpg",
        "category": "Snacks"
    },
    {
        "name": "Coca Cola (750ml)",
        "price": 45.0,
        "stock": 100,
        "image_url": "https://m.media-amazon.com/images/I/51v8nyxSOYL._SX679_.jpg",
        "category": "Beverages"
    }
]

async def stock_shelves():
    print("🚚 Delivery truck arriving at Cloud Store...")
    async with httpx.AsyncClient() as client:
        for item in groceries:
            try:
                response = await client.post(f"{BASE_URL}/admin/add-product", json=item)
                if response.status_code == 200:
                    print(f"✅ Added {item['name']} to the cloud!")
                else:
                    print(f"❌ Failed to add {item['name']}. Status: {response.status_code}")
            except Exception as e:
                print(f"⚠️ Error connecting to server: {e}")

asyncio.run(stock_shelves())