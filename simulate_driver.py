import httpx
import time

# Simulation: Moving from Jagtial Bus Stand towards the Main Road
path = [
    {"lat": 18.7917, "lng": 78.9133},
    {"lat": 18.7925, "lng": 78.9140},
    {"lat": 18.7935, "lng": 78.9155},
    {"lat": 18.7945, "lng": 78.9170},
    {"lat": 18.7955, "lng": 78.9185},
]

print("🚀 Starting Driver Simulation for Order #1...")

for coord in path:
    try:
        # Sending the location to your FastAPI backend
        response = httpx.post("https://zeshu-api.onrender.com/admin/update-location/1", json=coord)
        if response.status_code == 200:
            print(f"📍 Driver moved to: {coord['lat']}, {coord['lng']}")
        else:
            print("❌ Error sending location.")
    except Exception as e:
        print(f"⚠️ Is your main.py running? Error: {e}")
    
    time.sleep(5) # Wait 5 seconds before the next move

print("🏁 Delivery Simulation Finished!")