from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
import sqlite3
import httpx 
import requests
import os
import time
from dotenv import load_dotenv

# 1. Load secrets from the hidden .env file
load_dotenv()

app = FastAPI(title="Zeshu Production Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Securely load your hidden keys
A1_USERNAME = os.getenv("A1_USERNAME")
A1_PASSWORD = os.getenv("A1_PASSWORD")
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")

SUPABASE_URL = "https://isofiudzgpuxgenzicdb.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlzb2ZpdWR6Z3B1eGdlbnppY2RiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDQ5NDQsImV4cCI6MjA5MTQ4MDk0NH0.iLa4Bw_jVdu1TwtouQR97dXZC6hycj1Qp3kMet4zixw"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 3. Setup SQLite Database for Orders & Products
DB_PATH = "/tmp/zeshu.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DROP TABLE IF EXISTS products') 
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (phone TEXT UNIQUE, email TEXT, address TEXT)''')
    # Added "unit" column for your grocery items
    cursor.execute('''CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, stock INTEGER, image_url TEXT, unit TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, items_summary TEXT, total_price REAL, address TEXT, phone TEXT)''')
    
    cursor.execute("SELECT COUNT(*) FROM products")
    if cursor.fetchone()[0] == 0:
        # Added your new grocery data directly into the database!
        products = [
            (1, "Vegetables & Fruits", 149.0, 50, "https://cdn-icons-png.flaticon.com/512/3194/3194591.png", "1 kg"),
            (2, "Atta, Rice & Dal", 299.0, 100, "https://cdn-icons-png.flaticon.com/512/5753/5753696.png", "5 kg"),
            (3, "Oil, Ghee & Masala", 180.0, 200, "https://cdn-icons-png.flaticon.com/512/9944/9944111.png", "1 L"),
            (4, "Dairy, Bread & Eggs", 66.0, 200, "https://cdn-icons-png.flaticon.com/512/869/869474.png", "1 L"),
            (5, "Cold Coffee", 50.0, 200, "https://cdn-icons-png.flaticon.com/512/924/924514.png", "250 ml")
        ]
        cursor.executemany("INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)", products)
    conn.commit()
    conn.close()

init_db()

# --- DATA MODELS ---
class RechargeRequest(BaseModel):
    operator_code: str
    number: str
    amount: int
    order_id: str
    dob: str = None 

# --- API ENDPOINTS ---

@app.head("/")
@app.get("/")
def read_root():
    return {"status": "online", "message": "Zeshu Backend is running securely!"}

# FIXED: Now returns the exact format your frontend is expecting
@app.get("/api/products")
async def get_products():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, price, stock, image_url, unit FROM products")
    products = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "success", "data": products}

# RESTORED: The actual live A1Topup connection!
@app.post("/api/recharge")
def process_recharge(req: RechargeRequest):
    # 13 is the circle code for AP/Telangana
    url = f"https://business.a1topup.com/recharge/api?username={A1_USERNAME}&pwd={A1_PASSWORD}&circlecode=13&operatorcode={req.operator_code}&number={req.number}&amount={req.amount}&orderid={req.order_id}&format=json"
    
    if req.dob:
        url += f"&value1={req.dob}"
        
    try:
        response = requests.get(url)
        data = response.json()
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/admin/add-order") 
async def add_order(request: Request):
    data = await request.json()
    phone = data.get("phone", "Unknown")
    address = data.get("address", "No Address")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO orders (items_summary, total_price, address, phone) 
        VALUES (?, ?, ?, ?)
    """, (data.get("items_summary"), data.get("total_price"), address, phone))
    
    order_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return {"status": "success", "id": order_id}

@app.post("/create-payment-link")
async def create_payment_link(request: Request):
    data = await request.json()
    amount = data.get("amount", 0)
    order_id = data.get("order_id")

    unique_ref = f"zeshu_{order_id}_{int(time.time())}"

    payment_link_data = {
        "amount": int(amount * 100),
        "currency": "INR",
        "reference_id": unique_ref,
        "description": "Zeshu Order",
        "callback_url": "https://www.zeshu.in",
        "callback_method": "get"
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.razorpay.com/v1/payment_links",
            json=payment_link_data,
            auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
        )
        
        razorpay_response = response.json()
        return {"payment_url": razorpay_response.get("short_url")}

# FIXED: Removed the accidentally pasted /api/products route from inside this function
@app.get("/api/recommendations")
async def get_recommendations(cart_categories: str):
    try:
        categories = cart_categories.split(',')
        suggested_category = "Snacks"
        if "Dairy" in categories: suggested_category = "Groceries"
        if "Snacks" in categories: suggested_category = "Drinks"
        
        response = supabase.table("products").select("*").eq("category", suggested_category).limit(3).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/admin/get-all-active-locations")
async def get_active_locations():
    return [
        {"order_id": 1, "lat": 18.7905, "lng": 78.9105} 
    ]