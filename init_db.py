import sqlite3

db_path = r"D:\zeeshu\zeshu.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 1. THE SHELF (Products)
cur.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        image_url TEXT,
        category TEXT DEFAULT 'General'
    )
""")

# 2. THE LOG (Orders)
cur.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        items_summary TEXT,
        total_price REAL,
        address TEXT,
        status TEXT DEFAULT 'Pending'
    )
""")

# 3. THE RADAR (GPS Tracking)
cur.execute("""
    CREATE TABLE IF NOT EXISTS delivery_tracking (
        order_id INTEGER PRIMARY KEY,
        lat REAL,
        lng REAL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")

conn.commit()
conn.close()
print("✅ Database Fully Armed and Ready!")