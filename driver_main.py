import os
import psycopg2
import razorpay
import httpx
import resend
from twilio.rest import Client
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg2.extras import RealDictCursor

app = FastAPI(title="Zeshu Cloud Backend (Omnichannel)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIG & KEYS ---
DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:[YOUR_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")
RZP_ID = os.getenv("RAZORPAY_KEY_ID", "YOUR_TEST_KEY_ID")
RZP_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "YOUR_TEST_KEY_SECRET")

# Omnichannel Keys
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "WAITING")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "WAITING")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "WAITING")

client = razorpay.Client(auth=(RZP_ID, RZP_SECRET))

def get_conn():
    return psycopg2.connect(DB_URL)

# --- DATA MODELS ---
class OrderCreate(BaseModel):
    items_summary: str
    total_price: float
    address: str
    phone: str
    email: str 

class PaymentRequest(BaseModel):
    order_id: int
    amount: float

class Product(BaseModel):
    name: str
    price: float
    image_url: str

class LocationUpdate(BaseModel):
    lat: float
    lng: float

# --- BACKGROUND NOTIFICATION ENGINES ---
def send_whatsapp_receipt(phone: str, order_id: int, total: float):
    if TWILIO_ACCOUNT_SID != "WAITING":
        try:
            twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            formatted_phone = f"+91{phone}" if len(phone) == 10 else phone
            
            msg = twilio_client.messages.create(
                from_='whatsapp:+14155238886', 
                body=f"🚀 *Zeshu Store*\nOrder #{order_id} confirmed!\nTotal: ₹{total}\nYour delivery is being prepared in Jagtial.",
                to=f'whatsapp:{formatted_phone}'
            )
            print(f"WhatsApp Sent: {msg.sid}")
        except Exception as e:
            print(f"WhatsApp Error: {e}")

def send_email_receipt(email: str, order_id: int, summary: str, total: float):
    if RESEND_API_KEY != "WAITING":
        try:
            resend.api_key = RESEND_API_KEY
            email_params = {
                "from": "Zeshu Store <onboarding@resend.dev>",
                "to": email, 
                "subject": f"🧾 Zeshu Store: Order #{order_id} Confirmed",
                "html": f"""
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #3b82f6;">Order Confirmed!</h2>
                    <p>Thank you for shopping with Zeshu Store.</p>
                    <div style="background-color: #f3f4f6; padding: 15px; border-radius: 10px;">
                        <strong>Order ID:</strong> #{order_id}<br>
                        <strong>Items:</strong> {summary}<br>
                        <strong>Total Paid:</strong> ₹{total}
                    </div>
                    <p>Your items are being packed and will be delivered shortly to Jagtial.</p>
                </div>
                """
            }
            resend.Emails.send(email_params)
        except Exception as e:
            print(f"Email Error: {e}")

# --- 1. CATALOG ---
@app.get("/catalog")
def get_catalog():
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM products WHERE stock > 0")
    items = cur.fetchall()
    cur.close()
    conn.close()
    return items

# --- 2. ORDER & OMNICHANNEL ALERTS ---
@app.post("/admin/add-order")
def add_order(order: OrderCreate, background_tasks: BackgroundTasks):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO orders (items_summary, total_price, address, status, phone) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (order.items_summary, order.total_price, order.address, "Pending", order.phone)
    )
    order_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()

    background_tasks.add_task(send_whatsapp_receipt, order.phone, order_id, order.total_price)
    background_tasks.add_task(send_email_receipt, order.email, order_id, order.items_summary, order.total_price)

    return {"status": "success", "id": order_id}

# --- 3. RAZORPAY PAYMENT LINK ---
@app.post("/create-payment-link")
def create_payment_link(req: PaymentRequest):
    try:
        payment_link = client.payment_link.create({
            "amount": int(req.amount * 100), 
            "currency": "INR",
            "description": f"Zeshu Order #{req.order_id}",
            "callback_url": "https://zeshu-store.vercel.app/", 
            "callback_method": "get"
        })
        return {"payment_url": payment_link['short_url']}
    except Exception as e:
        return {"error": str(e)}

# --- 4. ADMIN ORDERS ---
@app.get("/admin/orders")
def get_all_orders():
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM orders ORDER BY id DESC")
    orders = cur.fetchall()
    cur.close()
    conn.close()
    return orders

# --- 5. ACTIVE LOCATIONS ---
@app.get("/admin/get-all-active-locations")
def get_active():
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM delivery_tracking")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows

# --- 5.5 UPDATE DRIVER LOCATION ---
@app.post("/admin/update-location/{order_id}")
def update_location(order_id: int, loc: LocationUpdate):
    try:
        conn = get_conn()
        cur = conn.cursor()
        
        # Upsert: Update if exists, insert if new
        cur.execute("""
            INSERT INTO delivery_tracking (order_id, lat, lng, last_updated)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (order_id) DO UPDATE 
            SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, last_updated = NOW()
        """, (order_id, loc.lat, loc.lng))
        
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# --- 6. INVENTORY UPLOADER (NEW!) ---
@app.post("/admin/add-product")
def add_new_product(product: Product):
    try:
        conn = get_conn()
        cur = conn.cursor()
        
        # We insert the product and set stock to 100 so it appears in the app immediately!
        cur.execute(
            "INSERT INTO products (name, price, image_url, stock) VALUES (%s, %s, %s, %s)",
            (product.name, product.price, product.image_url, 100)
        )
        
        conn.commit()
        cur.close()
        conn.close()
        
        return {"status": "success", "message": f"Added {product.name}"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}