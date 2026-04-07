import sqlite3

def add_orders_table():
    conn = sqlite3.connect("zeshu.db")
    cursor = conn.cursor()
    
    # Create the Orders Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            items_summary TEXT,
            total_price REAL,
            address TEXT,
            status TEXT DEFAULT 'Pending',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()
    print("✅ Orders table added to zeshu.db!")

if __name__ == "__main__":
    add_orders_table()