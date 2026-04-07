import sqlite3

db_path = r"D:\zeeshu\zeshu.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Adding sample products so the Customer App isn't empty
sample_products = [
    ('Amul Gold Milk (1L)', 66.0, 100, 'https://m.media-amazon.com/images/I/71uK8V9MhTL.jpg', 'Dairy'),
    ('Lays Magic Masala', 20.0, 50, 'https://m.media-amazon.com/images/I/81vJ9S7G8DL.jpg', 'Snacks'),
    ('Coca Cola (750ml)', 45.0, 30, 'https://m.media-amazon.com/images/I/51v8nyS19PL.jpg', 'Drinks')
]

cur.executemany("INSERT INTO products (name, price, stock, image_url, category) VALUES (?, ?, ?, ?, ?)", sample_products)

conn.commit()
conn.close()
print("🛒 Store stocked with Milk, Chips, and Soda!")