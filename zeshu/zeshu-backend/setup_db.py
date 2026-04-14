import sqlite3
import os

db_path = r"D:\zeeshu\zeshu.db"

def setup_db():
    # Ensure the directory exists
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Drop the old table if it exists to fix the column mismatch
    cursor.execute("DROP TABLE IF EXISTS products")
    
    # 2. Create Products Table (5 columns)
    cursor.execute('''CREATE TABLE IF NOT EXISTS products 
                      (id INTEGER PRIMARY KEY, name TEXT, weight TEXT, price REAL, category TEXT)''')
    
    # 3. Add Blinkit-style starter items (5 values per row)
    sample_items = [
        (1, 'Buffalo Milk', '1L', 66.0, 'Dairy'),
        (2, 'Brown Bread', '400g', 50.0, 'Bakery'),
        (3, 'Potato (Aloo)', '1kg', 30.0, 'Vegetables'),
        (4, 'Tomato', '500g', 25.0, 'Vegetables')
    ]
    
    cursor.executemany("INSERT INTO products VALUES (?,?,?,?,?)", sample_items)
    
    # 4. Create Orders Table
    cursor.execute('''CREATE TABLE IF NOT EXISTS orders 
                      (id INTEGER PRIMARY KEY AUTOINCREMENT, items_summary TEXT, 
                       total_price REAL, address TEXT, status TEXT DEFAULT 'Pending')''')
    
    conn.commit()
    conn.close()
    print("✅ Database refreshed! Table structure fixed and products added.")

if __name__ == "__main__":
    setup_db()