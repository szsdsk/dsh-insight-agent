PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  signup_date TEXT NOT NULL
);

CREATE TABLE orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  ordered_at TEXT NOT NULL,
  status TEXT NOT NULL,
  amount NUMERIC
);

CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL
);

CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders(order_id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

INSERT INTO customers VALUES
  (1, 'Ada',  'East',  '2023-11-20'),
  (2, 'Lin',  'West',  '2024-02-14'),
  (3, 'Maya', 'East',  '2024-07-01'),
  (4, 'Noah', NULL,    '2025-01-12'),
  (5, 'Iris', 'North', '2025-03-05');

INSERT INTO orders VALUES
  (101, 1, '2024-01-05', 'paid',      120.00),
  (102, 1, '2024-02-10', 'paid',       80.00),
  (103, 2, '2024-02-11', 'cancelled',  50.00),
  (104, 2, '2025-01-02', 'paid',      200.00),
  (105, 3, '2025-01-15', 'paid',         NULL),
  (106, 3, '2025-02-01', 'refunded',   40.00),
  (107, 4, '2025-02-28', 'paid',       60.00),
  (108, 1, '2025-03-01', 'paid',      140.00);

INSERT INTO products VALUES
  (1, 'Keyboard', 'hardware'),
  (2, 'Mouse',    'hardware'),
  (3, 'Guide',    'book'),
  (4, 'Sticker',  'merch');

INSERT INTO order_items VALUES
  (101, 1, 1, 100.00),
  (101, 2, 1,  20.00),
  (102, 3, 2,  40.00),
  (103, 2, 2,  25.00),
  (104, 1, 2, 100.00),
  (106, 3, 1,  40.00),
  (107, 2, 3,  20.00),
  (108, 1, 1, 100.00),
  (108, 3, 1,  40.00);
