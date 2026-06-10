-- ================================================================
--  PANCORAN WATERPARK POS — SUPABASE COMPLETE SETUP QUERY
--  Jalankan seluruh file ini sekali di Supabase SQL Editor.
--  Dashboard → SQL Editor → New Query → Paste → RUN
-- ================================================================

-- ----------------------------------------------------------------
-- EKSTENSI
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ================================================================
-- TABEL 1: units — Master data unit bisnis
-- ================================================================
CREATE TABLE IF NOT EXISTS units (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR     NOT NULL,
  code        VARCHAR     NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read units"   ON units FOR SELECT USING (true);
CREATE POLICY "Allow insert units" ON units FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update units" ON units FOR UPDATE USING (true) WITH CHECK (true);


-- ================================================================
-- TABEL 2: staff — Data kasir / petugas
-- ================================================================
CREATE TABLE IF NOT EXISTS staff (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID        REFERENCES units(id) ON DELETE CASCADE,
  name        VARCHAR     NOT NULL,
  pin         VARCHAR     NOT NULL,
  role        VARCHAR     DEFAULT 'cashier',  -- 'cashier' | 'admin'
  is_active   BOOLEAN     DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_staff_unit   ON staff(unit_id);
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(is_active);

-- RLS
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read staff"   ON staff FOR SELECT USING (true);
CREATE POLICY "Allow insert staff" ON staff FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update staff" ON staff FOR UPDATE USING (true) WITH CHECK (true);


-- ================================================================
-- TABEL 3: promos — Promo yang di-set manajemen
-- ================================================================
CREATE TABLE IF NOT EXISTS promos (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID        REFERENCES units(id) ON DELETE CASCADE,
  code            VARCHAR     NOT NULL,
  name            VARCHAR     NOT NULL,
  discount_type   VARCHAR     NOT NULL,  -- 'percentage' | 'fixed'
  discount_value  INT         NOT NULL,
  valid_from      DATE,
  valid_until     DATE,
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE promos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read promos"   ON promos FOR SELECT USING (true);
CREATE POLICY "Allow insert promos" ON promos FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update promos" ON promos FOR UPDATE USING (true) WITH CHECK (true);


-- ================================================================
-- TABEL 4: shifts — Shift kasir (buka / tutup sesi)
-- ================================================================
CREATE TABLE IF NOT EXISTS shifts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          UUID        REFERENCES units(id) ON DELETE CASCADE,
  cashier_id       UUID        REFERENCES staff(id) ON DELETE RESTRICT,
  opened_at        TIMESTAMPTZ DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  system_cash      INT         DEFAULT 0,   -- total cash menurut sistem
  system_qris      INT         DEFAULT 0,   -- total QRIS menurut sistem
  system_transfer  INT         DEFAULT 0,   -- total transfer menurut sistem
  counted_cash     INT,                     -- fisik uang dihitung kasir
  difference       INT,                     -- selisih (counted - system)
  notes            TEXT,
  status           VARCHAR     DEFAULT 'open',  -- 'open' | 'closed'
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_shifts_cashier ON shifts(cashier_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_unit    ON shifts(unit_id, opened_at DESC);

-- RLS
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on shifts" ON shifts FOR ALL USING (true) WITH CHECK (true);


-- ================================================================
-- TABEL 5: orders — Transaksi penjualan tiket
-- ================================================================
CREATE TABLE IF NOT EXISTS orders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID        REFERENCES units(id)   ON DELETE CASCADE,
  shift_id        UUID        REFERENCES shifts(id)  ON DELETE RESTRICT,
  cashier_id      UUID        REFERENCES staff(id)   ON DELETE RESTRICT,

  order_number    VARCHAR     NOT NULL UNIQUE,  -- contoh: ORD-20260611-090001-001

  -- Rincian pengunjung
  total_guests    INT         NOT NULL DEFAULT 1,
  adult_count     INT         DEFAULT 0,
  child_count     INT         DEFAULT 0,
  free_count      INT         DEFAULT 0,

  -- Harga yang berlaku saat transaksi
  -- (disimpan agar laporan historis tetap akurat walaupun harga berubah)
  adult_price     INT         DEFAULT 28000,  -- 28000 (reguler) atau 20000 (sekolah)

  -- Nilai transaksi
  subtotal        INT         NOT NULL,
  discount_amount INT         DEFAULT 0,
  total_price     INT         NOT NULL,

  -- Sumber & metode
  payment_method  VARCHAR     NOT NULL,  -- 'cash' | 'qris' | 'transfer'
  visitor_source  VARCHAR,               -- 'walk-in' | 'rombongan-sekolah' | 'rombongan-umum' | 'travel-agent'
  booking_ref     VARCHAR,               -- nomor booking (jika berasal dari reservasi)

  promo_id        UUID        REFERENCES promos(id) ON DELETE SET NULL,

  is_synced       BOOLEAN     DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index untuk laporan harian dan per shift
CREATE INDEX IF NOT EXISTS idx_orders_shift      ON orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_unit_date  ON orders(unit_id, created_at DESC);

-- RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on orders" ON orders FOR ALL USING (true) WITH CHECK (true);


-- ================================================================
-- TABEL 6: tickets — Tiket individu + QR Code
-- ================================================================
CREATE TABLE IF NOT EXISTS tickets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID        REFERENCES orders(id) ON DELETE CASCADE,
  ticket_code  VARCHAR     NOT NULL UNIQUE,  -- kode unik untuk QR
  category     VARCHAR     NOT NULL,          -- 'dewasa' | 'anak' | 'gratis'
  price        INT         NOT NULL,
  status       VARCHAR     DEFAULT 'sold',    -- 'sold' | 'used' | 'expired'
  scanned_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Index untuk scan tiket (lookup cepat by ticket_code)
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_code  ON tickets(ticket_code);

-- RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on tickets" ON tickets FOR ALL USING (true) WITH CHECK (true);


-- ================================================================
-- TABEL 7: print_queue — Antrian cetak tiket
-- PC printer melakukan polling tabel ini setiap beberapa detik.
-- Kasir tablet memasukkan job ke sini → printer mencetak otomatis.
-- ================================================================
CREATE TABLE IF NOT EXISTS print_queue (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID        REFERENCES orders(id) ON DELETE CASCADE,
  order_number  VARCHAR     NOT NULL,
  cashier_name  VARCHAR     NOT NULL,
  tickets_json  JSONB       NOT NULL,    -- array tiket lengkap dalam format JSON
  status        VARCHAR     DEFAULT 'pending',  -- 'pending' | 'printing' | 'done' | 'error'
  created_at    TIMESTAMPTZ DEFAULT now(),
  printed_at    TIMESTAMPTZ
);

-- Index agar PC printer query antrian pending dengan cepat
CREATE INDEX IF NOT EXISTS idx_print_queue_status ON print_queue(status, created_at ASC);

-- RLS: printer server dan kasir sama-sama pakai anon key
ALTER TABLE print_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on print_queue" ON print_queue FOR ALL USING (true) WITH CHECK (true);


-- ================================================================
-- TABEL 8: bookings — Reservasi rombongan / sekolah
--
-- Alur kerja:
--   1. Admin/manajemen INSERT ke tabel ini sebelum hari kunjungan.
--   2. Kasir membuka tab "Reservasi" → aplikasi SELECT booking hari ini.
--   3. Kasir klik "Proses Tiket" → form transaksi auto-terisi.
--   4. Setelah Submit, status booking di-UPDATE menjadi 'arrived'.
--
-- Aturan harga:
--   booking_type = 'sekolah' + total_guests >= 30 → Rp 20.000/org
--   booking_type = 'umum'                         → Rp 28.000/org (selalu)
-- ================================================================
CREATE TABLE IF NOT EXISTS bookings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID        REFERENCES units(id) ON DELETE CASCADE,

  -- Nomor booking (dibuat otomatis atau oleh admin)
  booking_number  VARCHAR     NOT NULL UNIQUE,  -- contoh: BK-20260611-001

  -- Data rombongan
  group_name      VARCHAR     NOT NULL,    -- nama sekolah / instansi / rombongan
  contact_name    VARCHAR,                 -- nama PIC (penanggung jawab)
  contact_phone   VARCHAR,                 -- nomor HP PIC

  -- Jadwal
  visit_date      DATE        NOT NULL,    -- tanggal kedatangan
  arrival_time    VARCHAR(5),              -- jam kedatangan, format HH:MM (misal: '09:00')

  -- Jumlah peserta
  adult_count     INT         DEFAULT 0,  -- jumlah dewasa
  child_count     INT         DEFAULT 0,  -- jumlah anak < 5 tahun
  -- total_guests dihitung otomatis oleh database (tidak perlu diisi manual)
  total_guests    INT         GENERATED ALWAYS AS (adult_count + child_count) STORED,

  -- Catatan khusus dari sekolah / admin
  notes           TEXT,

  -- Jenis kunjungan (menentukan tarif yang digunakan kasir):
  -- 'sekolah' → kunjungan resmi sekolah, berhak harga Rp 20.000 (jika >= 30 pax)
  -- 'umum'    → rombongan liburan/umum, selalu Rp 28.000 reguler
  booking_type    VARCHAR     DEFAULT 'sekolah',  -- 'sekolah' | 'umum'

  -- Status proses:
  -- 'pending'   → sudah booking, belum datang
  -- 'arrived'   → sudah datang dan tiket sudah diproses kasir
  -- 'cancelled' → dibatalkan (tidak jadi datang)
  status          VARCHAR     DEFAULT 'pending',

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Index untuk query cepat berdasarkan tanggal kunjungan
CREATE INDEX IF NOT EXISTS idx_bookings_visit_date ON bookings(visit_date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_unit       ON bookings(unit_id, visit_date DESC);

-- RLS:
-- Kasir (anon key) bisa SELECT semua booking dan UPDATE status-nya.
-- INSERT & DELETE sebaiknya dilakukan oleh admin (bisa via Supabase Dashboard atau form admin).
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow select bookings"        ON bookings FOR SELECT USING (true);
CREATE POLICY "Allow insert bookings"        ON bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update booking status"  ON bookings FOR UPDATE USING (true) WITH CHECK (true);


-- ================================================================
-- TRIGGER: auto-update updated_at pada tabel bookings
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_bookings_updated_at ON bookings;
CREATE TRIGGER set_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ================================================================
-- DATA AWAL (WAJIB DIJALANKAN)
-- Masukkan unit dan staff kasir.
-- Gunakan UUID yang sama persis agar cocok dengan IndexedDB di aplikasi.
-- ================================================================

-- Unit: Pancoran Waterpark
INSERT INTO units (id, name, code)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Pancoran Waterpark', 'PW')
ON CONFLICT (code) DO NOTHING;

-- Staff: Kasir 1 dan Kasir 2
-- (PIN bisa diubah sesuai kebutuhan)
INSERT INTO staff (id, unit_id, name, pin, role, is_active)
VALUES
  ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
   'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'Kasir 1', '1234', 'cashier', true),
  ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13',
   'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
   'Kasir 2', '5678', 'cashier', true)
ON CONFLICT (id) DO NOTHING;


-- ================================================================
-- CONTOH BOOKING (OPSIONAL — untuk testing hari ini)
-- Hapus tanda komentar (--) di bawah ini untuk menjalankan.
-- Ganti tanggal jika diperlukan (CURRENT_DATE = hari ini otomatis).
-- ================================================================

/*
INSERT INTO bookings (
  unit_id, booking_number,
  group_name, contact_name, contact_phone,
  visit_date, arrival_time,
  adult_count, child_count,
  booking_type, notes
)
VALUES
  -- Kunjungan sekolah (52 pax → harga Rp 20.000/org)
  (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-001',
    'SDN Pancoran 05', 'Pak Budi', '082112345678',
    CURRENT_DATE, '09:00',
    40, 12,
    'sekolah', 'Mohon siapkan area loker'
  ),
  -- Kunjungan sekolah (88 pax → harga Rp 20.000/org)
  (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-002',
    'SMP Al-Hikmah Jakarta', 'Bu Sari', '085676543210',
    CURRENT_DATE, '10:30',
    60, 28,
    'sekolah', ''
  ),
  -- Rombongan umum / liburan (45 pax → tetap Rp 28.000/org)
  (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'BK-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-003',
    'Keluarga Besar Pak Hendra', 'Pak Hendra', '081298765432',
    CURRENT_DATE, '10:00',
    35, 10,
    'umum', 'Acara reuni keluarga'
  );
*/


-- ================================================================
-- QUERY BERGUNA UNTUK MANAJEMEN
-- (Simpan sebagai referensi, jalankan sesuai kebutuhan)
-- ================================================================

-- [ LIHAT SEMUA BOOKING HARI INI ]
-- SELECT booking_number, group_name, arrival_time, adult_count, child_count,
--        total_guests, booking_type, status
-- FROM   bookings
-- WHERE  visit_date = CURRENT_DATE
-- ORDER  BY arrival_time ASC;

-- [ TAMBAH BOOKING BARU ]
-- INSERT INTO bookings (unit_id, booking_number, group_name, contact_name,
--   contact_phone, visit_date, arrival_time, adult_count, child_count, booking_type, notes)
-- VALUES (
--   'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
--   'BK-20260615-001',
--   'SD Negeri 01 Mampang', 'Ibu Dewi', '08123456789',
--   '2026-06-15', '08:30',
--   50, 10,
--   'sekolah', 'Butuh pemandu wisata'
-- );

-- [ TAMBAH KASIR BARU ]
-- INSERT INTO staff (unit_id, name, pin, role, is_active)
-- VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Kasir 3', '9999', 'cashier', true);

-- [ GANTI PIN KASIR ]
-- UPDATE staff SET pin = '4321' WHERE name = 'Kasir 1';

-- [ NONAKTIFKAN KASIR ]
-- UPDATE staff SET is_active = false WHERE name = 'Kasir 2';

-- [ LAPORAN PENJUALAN HARI INI (per metode bayar) ]
-- SELECT
--   payment_method,
--   visitor_source,
--   COUNT(*)          AS jumlah_transaksi,
--   SUM(total_guests) AS total_pengunjung,
--   SUM(total_price)  AS total_pendapatan
-- FROM  orders
-- WHERE created_at::DATE = CURRENT_DATE
-- GROUP BY payment_method, visitor_source
-- ORDER BY payment_method;

-- [ LAPORAN PER SHIFT HARI INI ]
-- SELECT
--   s.id, st.name AS kasir,
--   s.opened_at, s.closed_at, s.status,
--   s.system_cash, s.system_qris, s.system_transfer,
--   (s.system_cash + s.system_qris + s.system_transfer) AS total_shift,
--   s.counted_cash, s.difference
-- FROM  shifts s
-- JOIN  staff st ON st.id = s.cashier_id
-- WHERE s.opened_at::DATE = CURRENT_DATE
-- ORDER BY s.opened_at DESC;

-- [ BATALKAN BOOKING ]
-- UPDATE bookings SET status = 'cancelled' WHERE booking_number = 'BK-20260611-001';
