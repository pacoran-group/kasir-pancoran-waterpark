# Sistem Kasir Wahana Air — Pancoran Waterpark POS

Sistem kasir digital berbasis web app dengan QR Code untuk Pancoran Waterpark. Misi utama: **menutup kebocoran kas** yang sering terjadi, sekaligus mendigitalisasi pencatatan pendapatan dan transaksi.

> [!IMPORTANT]
> **Scope MVP (2 minggu):** Kasir Web App (input transaksi + cetak QR) + Closing Shift (rekonsiliasi kas). Gate scanner dan dashboard manajemen masuk fase berikutnya.

## Proposed Changes

### Supabase Database Setup

#### [NEW] Supabase Schema (SQL Migration)

Buat tabel-tabel berikut di Supabase:

**`units`** — Master data unit bisnis
```sql
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  code VARCHAR NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**`staff`** — Data kasir/petugas
```sql
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id),
  name VARCHAR NOT NULL,
  pin VARCHAR NOT NULL,
  role VARCHAR DEFAULT 'cashier',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**`promos`** — Promo yang di-set manajemen
```sql
CREATE TABLE promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id),
  code VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  discount_type VARCHAR NOT NULL,
  discount_value INT NOT NULL,
  valid_from DATE,
  valid_until DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**`shifts`** — Shift kasir
```sql
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id),
  cashier_id UUID REFERENCES staff(id),
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  system_cash INT DEFAULT 0,
  system_qris INT DEFAULT 0,
  system_transfer INT DEFAULT 0,
  counted_cash INT,
  difference INT,
  notes TEXT,
  status VARCHAR DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**`orders`** — Transaksi penjualan
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id),
  shift_id UUID REFERENCES shifts(id),
  cashier_id UUID REFERENCES staff(id),
  order_number VARCHAR NOT NULL UNIQUE,
  total_guests INT NOT NULL DEFAULT 1,
  adult_count INT DEFAULT 0,
  child_count INT DEFAULT 0,
  free_count INT DEFAULT 0,
  subtotal INT NOT NULL,
  discount_amount INT DEFAULT 0,
  total_price INT NOT NULL,
  payment_method VARCHAR NOT NULL,
  visitor_source VARCHAR,
  promo_id UUID REFERENCES promos(id),
  is_synced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**`tickets`** — Tiket per individu (QR Code)
```sql
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  ticket_code VARCHAR NOT NULL UNIQUE,
  category VARCHAR NOT NULL,
  price INT NOT NULL,
  status VARCHAR DEFAULT 'sold',
  scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

### File Structure

```
Kasir_Pancoran/
├── grill_me_results.md
├── implementation_plan.md
├── index.html
├── styles.css
├── app.js
├── db.js
├── sync.js
├── print.js
├── supabase-config.js
└── assets/
    └── logo.png
```

---

## User Review Required

> [!IMPORTANT]
> **Keputusan arsitektur yang perlu di-review:**
> 1. **Tanpa framework** — Pure HTML/CSS/JS
> 2. **PIN login** — Kasir pilih nama + input PIN 4-6 digit
> 3. **Supabase service key di client** — Untuk MVP internal
> 4. **Printer via browser print dialog** — `window.print()` + CSS `@page`

> [!WARNING]
> **Risiko:**
> - Print label 50x20mm memerlukan konfigurasi printer di OS
> - Supabase free tier: 500MB / 50,000 rows (~6 bulan operasional)

---

## Verification Plan

### Manual Verification
1. Login kasir → Open shift → Jual tiket → Cetak QR → Closing shift
2. Offline test: WiFi off → Jual tiket → WiFi on → Verifikasi sync
3. Printer test: Cetak ke thermal printer 50x20mm
4. Anti-fraud: Tutup browser tanpa closing → shift tetap open
