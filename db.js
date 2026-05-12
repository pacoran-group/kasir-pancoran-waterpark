// db.js
// Initialize Dexie for offline IndexedDB storage

const db = new Dexie('PancoranPOSDB');
window.db = db; // Ensure global access for app.js

// Define database schema
// We need tables for:
// - units, staff, promos (master data synced from server)
// - shifts, orders, tickets (transactional data created locally)
db.version(1).stores({
    // Master data
    units: 'id, code, name',
    staff: 'id, unit_id, name, pin, role, is_active',
    promos: 'id, unit_id, code, is_active',

    // Transactional data
    shifts: 'id, unit_id, cashier_id, status, opened_at, is_synced',
    orders: 'id, shift_id, order_number, is_synced',
    tickets: 'id, order_id, ticket_code, status'
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
    } catch (e) {
        console.error("Seed error:", e);
    }
}

// Call seed data
seedMasterData();
