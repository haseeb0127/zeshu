import sqlite3

DB_PATH = r"D:\zeeshu\zeshu.db"

def add_status_column():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # This is the SQL command you mentioned
        cursor.execute("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'Pending'")
        
        conn.commit()
        print("Success: 'status' column added to the orders table!")
        conn.close()
    except sqlite3.OperationalError:
        print("Note: The 'status' column already exists.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    add_status_column()