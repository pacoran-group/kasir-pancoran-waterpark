-- Supabase Schema for Pancoran Waterpark POS

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. `units` — Master data unit bisnis
CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  code VARCHAR NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. `staff` — Data kasir/petugas
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  pin VARCHAR NOT NULL,
  role VARCHAR DEFAULT 'cashier',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. `promos` — Promo yang di-set manajemen
CREATE TABLE IF NOT EXISTS promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  code VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  discount_type VARCHAR NOT NULL, -- e.g., 'percentage', 'fixed'
  discount_value INT NOT NULL,
  valid_from DATE,
  valid_until DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. `shifts` — Shift kasir
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES staff(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  system_cash INT DEFAULT 0,
  system_qris INT DEFAULT 0,
  system_transfer INT DEFAULT 0,
  counted_cash INT,
  difference INT,
  notes TEXT,
  status VARCHAR DEFAULT 'open', -- 'open', 'closed'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. `orders` — Transaksi penjualan
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE RESTRICT,
  cashier_id UUID REFERENCES staff(id) ON DELETE RESTRICT,
  order_number VARCHAR NOT NULL UNIQUE,
  total_guests INT NOT NULL DEFAULT 1,
  adult_count INT DEFAULT 0,
  child_count INT DEFAULT 0,
  free_count INT DEFAULT 0,
  subtotal INT NOT NULL,
  discount_amount INT DEFAULT 0,
  total_price INT NOT NULL,
  payment_method VARCHAR NOT NULL, -- 'cash', 'qris', 'transfer'
  visitor_source VARCHAR, -- 'walk-in', 'rombongan', 'travel-agent', dll
  promo_id UUID REFERENCES promos(id) ON DELETE SET NULL,
  is_synced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. `tickets` — Tiket per individu (QR Code)
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  ticket_code VARCHAR NOT NULL UNIQUE,
  category VARCHAR NOT NULL, -- 'dewasa', 'anak', 'gratis'
  price INT NOT NULL,
  status VARCHAR DEFAULT 'sold', -- 'sold', 'used', 'expired'
  scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. `print_queue` — Antrian cetak tiket dari tablet kasir
-- Status: 'pending' (menunggu), 'printing' (sedang dicetak), 'done' (selesai), 'error'
CREATE TABLE IF NOT EXISTS print_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  order_number VARCHAR NOT NULL,
  cashier_name VARCHAR NOT NULL,
  tickets_json JSONB NOT NULL,    -- Array tiket dalam format JSON
  status VARCHAR DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  printed_at TIMESTAMPTZ
);

-- Index agar PC printer bisa query antrian pending dengan cepat
CREATE INDEX IF NOT EXISTS idx_print_queue_status ON print_queue(status, created_at ASC);

-- RLS: izinkan anon insert dan update (kasir & print server sama-sama pakai anon key)
ALTER TABLE print_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on print_queue" ON print_queue FOR ALL USING (true) WITH CHECK (true);

-- Insert dummy data for initialization (Optional but recommended for testing)
-- INSERT INTO units (id, name, code) VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Pancoran Waterpark', 'PW');
-- INSERT INTO staff (unit_id, name, pin, role) VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Kasir 1', '1234', 'cashier');
-- INSERT INTO staff (unit_id, name, pin, role) VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Kasir 2', '5678', 'cashier');
