CREATE TABLE IF NOT EXISTS vps (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cycle_count INTEGER NOT NULL CHECK (cycle_count > 0),
  cycle_unit TEXT NOT NULL CHECK (cycle_unit IN ('day', 'month', 'year')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  category TEXT NOT NULL DEFAULT '',
  vendor_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  deactivated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vps_status_expires ON vps (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_vps_category ON vps (category);
