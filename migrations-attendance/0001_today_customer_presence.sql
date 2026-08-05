CREATE TABLE IF NOT EXISTS today_customer_presence (
  business_date TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  in_shop INTEGER NOT NULL DEFAULT 1,
  balance_before INTEGER NOT NULL DEFAULT 0,
  current_balance INTEGER NOT NULL DEFAULT 0,
  chip_change INTEGER NOT NULL DEFAULT 0,
  movement_count INTEGER NOT NULL DEFAULT 0,
  last_movement_amount INTEGER NOT NULL DEFAULT 0,
  entered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  exited_at TEXT,
  PRIMARY KEY (business_date, customer_code)
);

CREATE INDEX IF NOT EXISTS idx_today_customer_presence_active
  ON today_customer_presence (business_date, in_shop, updated_at);
