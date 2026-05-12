# 🔥 Grill Me Results: Sistem Kasir Wahana Air + Barcode

> **Tanggal:** 7 Mei 2026  
> **Proyek:** Pancoran Waterpark POS System  
> **Tujuan:** Sistem kasir digital dengan QR Code untuk mengecek pendapatan, jumlah transaksi, dan growth perusahaan — serta **menutup kebocoran kas** yang sering terjadi.

---

## 1. Model Bisnis Tiket

| Keputusan | Detail |
|---|---|
| Model tiket | **1 tiket = akses semua wahana** (terusan/all-access) |
| Harga Dewasa | Flat **Rp 28.000** per orang per hari |
| Harga Anak <5 tahun | **Rp 10.000** per orang per hari |
| Tiket Gratis/VIP | Ada — perlu diakomodasi dalam sistem (harga Rp 0) |
| Promo/Diskon | Insidental, akan dikendalikan dari manajemen (bukan kasir) |
| Bundling | Tidak ada saat ini |

---

## 2. Flow Operasional

```
Pengunjung datang
    → Loket Kasir (2 kasir, PC → migrasi ke Tablet)
        → Bayar (Cash / QRIS / Transfer)
        → Sistem catat transaksi + generate QR Code
        → Cetak stiker QR (50x20mm) → Tempel di gelang wahana
    → Gate Masuk (petugas terpisah)
        → Scan QR Code (barcode scanner gun)
        → Validasi: tiket valid & belum digunakan
        → 1x scan = 1x masuk, tiket hangus setelah scan
    → Masuk Wahana
```

**Jam operasional:** 08:00 — 17:00 (1 shift)

---

## 3. Teknologi & Hardware

| Komponen | Spesifikasi | Budget |
|---|---|---|
| **QR Code** | Barcode 2D, berisi ID unik saja (lookup ke database) | — |
| **Printer** | Thermal label printer, kertas 50x20mm, 2 unit (1 per kasir) | ~Rp 500.000/unit |
| **Scanner** | Barcode scanner gun di gate | ~Rp 200-500rb |
| **Device kasir** | PC (saat ini) → Tablet (rencana) | Existing |
| **Koneksi** | Modem dedicated untuk stabilitas internet | TBD |

> [!WARNING]
> Jika migrasi ke tablet, pastikan printer thermal mendukung **Bluetooth** atau siapkan **USB OTG adapter**.

---

## 4. Arsitektur Software

| Aspek | Keputusan |
|---|---|
| **Tipe aplikasi** | Web app (browser-based) |
| **Backend/Database** | Supabase (PostgreSQL) |
| **Offline handling** | Offline-first di sisi kasir (IndexedDB + sync queue) |
| **Gate offline** | Manual (foto QR + scan ulang saat online) |
| **Skalabilitas** | Multi-tenant (support unit lain: wahana permainan, hotel, karaoke) |

### QR Code Flow
```
Kasir buat transaksi → Generate ID unik (misal: PW-20260507-0042)
    → ID disimpan di Supabase + IndexedDB lokal
    → QR Code berisi HANYA ID unik
    → Dicetak di stiker 50x20mm
    
Gate scan QR → Baca ID → Lookup di database
    → Jika valid & belum dipakai → ✅ Boleh masuk, tandai "used"
    → Jika sudah dipakai → ❌ Ditolak (anti-duplikasi)
    → Jika tidak ditemukan → ❌ Ditolak (tiket palsu)
```

---

## 5. Database Schema

### Tabel: `orders` (Transaksi)
| Field | Type | Keterangan |
|---|---|---|
| `id` | UUID | Primary key |
| `unit_id` | VARCHAR | Unit bisnis (waterpark, wahana, dll) |
| `order_number` | VARCHAR | Nomor order (PW-20260507-0042) |
| `total_guests` | INT | Jumlah orang dalam 1 transaksi |
| `total_price` | INT | Total harga setelah diskon |
| `payment_method` | ENUM | cash / qris / transfer |
| `visitor_source` | VARCHAR | walk-in / rombongan / travel-agent / dll |
| `promo_code` | VARCHAR | Kode promo (nullable) |
| `discount_amount` | INT | Potongan harga |
| `cashier_id` | UUID | FK ke staff |
| `shift_id` | UUID | FK ke shift |
| `created_at` | TIMESTAMP | Waktu transaksi |

### Tabel: `tickets` (Tiket per individu)
| Field | Type | Keterangan |
|---|---|---|
| `id` | UUID | Primary key |
| `order_id` | UUID | FK ke orders |
| `ticket_code` | VARCHAR | ID unik di QR Code |
| `category` | ENUM | dewasa / anak |
| `price` | INT | Harga tiket ini |
| `status` | ENUM | sold / used / expired |
| `scanned_at` | TIMESTAMP | Waktu scan di gate (nullable) |
| `created_at` | TIMESTAMP | Waktu cetak tiket |

### Tabel: `shifts` (Shift kasir)
| Field | Type | Keterangan |
|---|---|---|
| `id` | UUID | Primary key |
| `unit_id` | VARCHAR | Unit bisnis |
| `cashier_id` | UUID | FK ke staff |
| `opened_at` | TIMESTAMP | Jam buka shift |
| `closed_at` | TIMESTAMP | Jam tutup shift (nullable) |
| `system_total` | INT | Total penjualan menurut sistem |
| `cash_counted` | INT | Uang fisik yang dihitung kasir |
| `qris_total` | INT | Total QRIS menurut sistem |
| `transfer_total` | INT | Total transfer menurut sistem |
| `difference` | INT | Selisih (system vs fisik) |
| `status` | ENUM | open / closed |

---

## 6. Keamanan & Anti-Fraud

| Risiko | Solusi |
|---|---|
| 🔴 Kasir tidak input transaksi | Setiap penjualan WAJIB menghasilkan QR Code cetak. Tanpa QR = pengunjung tidak bisa masuk gate |
| 🔴 Tiket duplikat | QR Code hanya valid 1x scan. Scan kedua → ditolak |
| 🔴 Diskon fiktif | Kasir **tidak bisa** buat diskon sendiri. Promo di-set dari dashboard manajemen |
| 🔴 Selisih kas | Closing shift WAJIB. Sistem hitung otomatis per metode bayar, kasir input uang fisik, selisih langsung terlihat |
| 🟡 Kasir logout tanpa closing | Sistem **blokir logout** sampai closing shift selesai |

> [!IMPORTANT]
> **Masalah utama yang harus diselesaikan:** Kebocoran kas yang SERING terjadi. Sistem barcode ini adalah alat kontrol utama — bukan hanya fitur kenyamanan.

---

## 7. Scope & Prioritas (2 Minggu)

### ✅ Fase 1 — MVP (2 minggu, HARUS JADI)
- **Kasir Web App**
  - Form input transaksi (jumlah tamu, kategori, metode bayar, sumber pengunjung)
  - Generate QR Code unik per tiket
  - Cetak stiker QR ke thermal printer
  - Offline-first (IndexedDB + sync ke Supabase)
- **Closing Shift**
  - Rekap otomatis: total penjualan per metode bayar
  - Input uang fisik oleh kasir
  - Hitung selisih otomatis
  - Wajib sebelum bisa tutup sistem

### ⏸️ Fase 2 — Segera Setelah MVP
- Gate scanner + validasi QR (1x scan)
- Dashboard manajemen (rekap harian, bulanan)

### ⏸️ Fase 3 — Setelah Stabil
- Growth chart + perbandingan antar periode
- Multi-unit support (wahana permainan dengan tiket terpisah)
- Segmentasi pengunjung berdasarkan sumber

---

## 8. Skalabilitas (Rencana Masa Depan)

| Unit | Model Tiket | Status |
|---|---|---|
| 🏊 Pancoran Waterpark | 1 tiket all-access | **Target pertama** |
| 🎡 Wahana Permainan | Tiket masuk + tiket per wahana (terpisah) | Fase masa depan |
| 🏨 Hotel | Per kamar/malam (berbeda model) | TBD |
| 🎤 Karaoke | Per jam (berbeda model) | TBD |

Database didesain **multi-tenant** dari awal (`unit_id`) sehingga tidak perlu rebuild saat ekspansi.

---

## 9. Resolved Questions

- [x] Harga tiket anak <5 tahun → **Rp 10.000**
- [x] Sumber pengunjung → **Walk-in, Rombongan, Travel Agent**
- [x] Tiket gratis/VIP → **Ya, perlu diakomodasi**
- [x] Budget Supabase → **Free tier**
- [x] Maintenance → **Tim IT perusahaan**
