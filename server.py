from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import sqlite3

# 1. Initialize FastAPI and enable CORS (crucial for web apps)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Setup SQLite Database & Dummy Data
def init_db():
    conn = sqlite3.connect("zeshu.db")
    cursor = conn.cursor()
    
    # TEMPORARY: Drop the old table so we can recreate it with the image_url column
    cursor.execute('DROP TABLE IF EXISTS products') 
    
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (phone TEXT UNIQUE, email TEXT, address TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, stock INTEGER, image_url TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, items_summary TEXT, total_price REAL, address TEXT, phone TEXT)''')
    
    # Insert dummy products if the table is empty
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

# 3. API Routes

# --- UPDATED: Send ALL products, even if stock is 0 ---
@app.get("/products")
async def get_products():
    conn = sqlite3.connect("zeshu.db")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    # Removed "WHERE stock > 0" so the frontend can display "Out of Stock"
    cursor.execute("SELECT id, name, price, stock, image_url FROM products")
    products = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return products

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

@app.post("/place-order") 
async def add_order(request: Request):
    data = await request.json()
    phone = data.get("phone", "Unknown")
    email = data.get("email", "")
    address = data.get("address", "No Address")
    cart_items = data.get("cart_items", []) 
    
    conn = sqlite3.connect("zeshu.db")
    cursor = conn.cursor()
    
    # Update or Create User
    cursor.execute("""
        INSERT INTO users (phone, email, address) 
        VALUES (?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET 
        email=excluded.email, address=excluded.address
    """, (phone, email, address))
    
    # Deduct Stock
    for item in cart_items:
        cursor.execute("""
            UPDATE products 
            SET stock = stock - ? 
            WHERE id = ? AND stock >= ?
        """, (item['qty'], item['id'], item['qty']))
        
    # Save Order
    cursor.execute("""
        INSERT INTO orders (items_summary, total_price, address, phone) 
        VALUES (?, ?, ?, ?)
    """, (data.get("items_summary"), data.get("total_price"), address, phone))
    
    order_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return {"status": "success", "id": order_id}