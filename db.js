// db.js
// Initialize Dexie for offline IndexedDB storage

const db = new Dexie('PancoranPOSDB');
window.db = db; // Ensure global access for app.js

// Define database schema
// Version 1: original tables
db.version(1).stores({
    units: 'id, code, name',
    staff: 'id, unit_id, name, pin, role, is_active',
    promos: 'id, unit_id, code, is_active',
    shifts: 'id, unit_id, cashier_id, status, opened_at, is_synced',
    orders: 'id, shift_id, order_number, is_synced',
    tickets: 'id, order_id, ticket_code, status'
});

// Version 2: add bookings table
db.version(2).stores({
    units: 'id, code, name',
    staff: 'id, unit_id, name, pin, role, is_active',
    promos: 'id, unit_id, code, is_active',
    shifts: 'id, unit_id, cashier_id, status, opened_at, is_synced',
    orders: 'id, shift_id, order_number, is_synced',
    tickets: 'id, order_id, ticket_code, status',
    // Tabel booking rombongan/sekolah
    bookings: 'id, unit_id, booking_number, visit_date, status, booking_type, created_at'
});

// Seed data function (for MVP / testing without live Supabase)
async function seedMasterData() {
    try {
        const staffCount = await db.staff.count();
        if (staffCount === 0) {
            const unitId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

            // Check units just in case
            const unitsCount = await db.units.count();
            if (unitsCount === 0) {
                await db.units.add({
                    id: unitId,
                    code: 'PW',
                    name: 'Pancoran Waterpark'
                });
            }

            // Dummy Staff (Using valid UUIDs for Supabase compatibility)
            await db.staff.bulkAdd([
                { id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', unit_id: unitId, name: 'Kasir 1', pin: '1234', role: 'cashier', is_active: true },
                { id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', unit_id: unitId, name: 'Kasir 2', pin: '5678', role: 'cashier', is_active: true }
            ]);

            console.log("Local master data seeded.");
        }

        // Seed dummy bookings untuk hari ini (testing)
        const bookingCount = await db.bookings.count();
        if (bookingCount === 0) {
            const today = new Date().toISOString().slice(0, 10);
            const unitId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
            await db.bookings.bulkAdd([
                {
                    id: 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14',
                    unit_id: unitId,
                    booking_number: 'BK-' + today.replace(/-/g,'') + '-001',
                    group_name: 'SDN Pancoran 05',
                    contact_name: 'Pak Budi',
                    contact_phone: '08211234567',
                    visit_date: today,
                    arrival_time: '09:00',
                    total_guests: 52,
                    adult_count: 40,
                    child_count: 12,
                    booking_type: 'sekolah',  // → harga Rp 20.000 jika >= 30 pax
                    notes: 'Mohon siapkan area loker',
                    status: 'pending',
                    created_at: new Date().toISOString()
                },
                {
                    id: 'e2eebc99-9c0b-4ef8-bb6d-6bb9bd380a15',
                    unit_id: unitId,
                    booking_number: 'BK-' + today.replace(/-/g,'') + '-002',
                    group_name: 'Keluarga Besar Pak Hendra',
                    contact_name: 'Pak Hendra',
                    contact_phone: '08567654321',
                    visit_date: today,
                    arrival_time: '10:00',
                    total_guests: 45,
                    adult_count: 35,
                    child_count: 10,
                    booking_type: 'umum',  // → tetap Rp 28.000 (bukan sekolah)
                    notes: 'Acara reuni keluarga',
                    status: 'pending',
                    created_at: new Date().toISOString()
                },
                {
                    id: 'f3eebc99-9c0b-4ef8-bb6d-6bb9bd380a16',
                    unit_id: unitId,
                    booking_number: 'BK-' + today.replace(/-/g,'') + '-003',
                    group_name: 'SMP Al-Hikmah Jakarta',
                    contact_name: 'Bu Sari',
                    contact_phone: '08567654321',
                    visit_date: today,
                    arrival_time: '10:30',
                    total_guests: 88,
                    adult_count: 60,
                    child_count: 28,
                    booking_type: 'sekolah',  // → harga Rp 20.000
                    notes: '',
                    status: 'pending',
                    created_at: new Date().toISOString()
                }
            ]);
            console.log("Dummy bookings seeded for today.");
        }
    } catch (e) {
        console.error("Seed error:", e);
    }
}

// Call seed data
seedMasterData();
