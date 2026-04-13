from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
    allow_origins=["*"], # Allowing all for now to prevent CORS blocking
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

# 3. Setup SQLite Database for Orders
DB_PATH = "/tmp/zeshu.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DROP TABLE IF EXISTS products') 
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (phone TEXT UNIQUE, email TEXT, address TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, stock INTEGER, image_url TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, items_summary TEXT, total_price REAL, address TEXT, phone TEXT)''')
    
    cursor.execute("SELECT COUNT(*) FROM products")
    if cursor.fetchone()[0] == 0:
        products = [
            (1, "Aashirvaad Atta 5kg", 250.0, 50, "https://m.media-amazon.com/images/I/71R8P8XzC9L._SX679_.jpg"),
            (2, "Amul Gold Milk 1L", 66.0, 100, "https://m.media-amazon.com/images/I/61N+V3qD3hL._SX679_.jpg"),
            (3, "Lays Magic Masala", 20.0, 200, "https://m.media-amazon.com/images/I/71XmO4g36yL._SX679_.jpg")
        ]
        cursor.executemany("INSERT INTO products VALUES (?, ?, ?, ?, ?)", products)
    conn.commit()
    conn.close()

init_db()

@app.get("/")
def read_root():
    return {"status": "online", "message": "Zeshu Backend is running securely!"}

@app.get("/products")
async def get_products():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, price, stock, image_url FROM products")
    products = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return products

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

# FIXED: Separated the Razorpay function so it doesn't crash
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

# FIXED: Moved recommendations outside of the Razorpay function
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