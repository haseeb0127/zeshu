import sqlite3

def upgrade_database():
    conn = sqlite3.connect("zeshu.db")
    cursor = conn.cursor()
    
    # 1. Create a Users Table (Saves their Address permanently)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            phone TEXT PRIMARY KEY,
            email TEXT,
            address TEXT
        )
    """)

    # 2. Create a Products Table for Live Inventory
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            price REAL,
            image_url TEXT,
            stock INTEGER DEFAULT 20
        )
    """)
    
    conn.commit()
    conn.close()
    print("✅ Database Upgraded: Users and Inventory active!")

if __name__ == "__main__":
    upgrade_database()