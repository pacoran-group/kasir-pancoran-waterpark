// app.js
// Main UI logic and state management

// Application State
const state = {
    currentStaff: null,
    currentShift: null,
    currentUnit: null,
    order: {
        adult: 1,
        child: 0,
        free: 0
    },
    prices: {
        adult: 28000,
        child: 10000,
        free: 0
    }
};

// DOM Elements
const screens = {
    login: document.getElementById('login-screen'),
    cashier: document.getElementById('cashier-screen'),
    closing: document.getElementById('closing-screen')
};

// Utility function for UUID v4 generation (since we need them offline)
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- Initialization ---

async function initApp() {
    // Bind Event Listeners FIRST so even if DB fails, form won't reload
    document.getElementById('process-payment-btn').addEventListener('click', processPayment);
    document.getElementById('close-shift-btn').addEventListener('click', showClosingScreen);
    document.getElementById('cancel-closing-btn').addEventListener('click', hideClosingScreen);
    document.getElementById('confirm-closing-btn').addEventListener('click', submitClosingShift);
    
    // Payment method changes
    document.querySelectorAll('input[name="payment"]').forEach(radio => {
        radio.addEventListener('change', updateOrderSummary);
    });

    try {
        // Populate cashier select
        const allStaff = await db.staff.toArray();
        // Fallback filter to show all staff if is_active is tricky
        const staffMembers = allStaff.length > 0 ? allStaff : [];
        const select = document.getElementById('cashier-select');
        
        // Clear existing options (except placeholder)
        while(select.options.length > 1) {
            select.remove(1);
        }

        if (staffMembers.length === 0) {
            console.warn("No staff found in IndexedDB!");
        }

        staffMembers.forEach(staff => {
            const option = document.createElement('option');
            option.value = staff.id;
            option.textContent = staff.name;
            select.appendChild(option);
        });

        // Get the first unit (safely)
        const units = await db.units.toArray();
        if (units.length > 0) {
            state.currentUnit = units[0];
        }
    } catch (e) {
        console.error("Init Error:", e);
    }
}

// --- Navigation ---

function showScreen(screenName) {
    Object.keys(screens).forEach(key => {
        if (key === screenName) {
            screens[key].classList.add('active');
            screens[key].classList.remove('hidden');
        } else {
            screens[key].classList.remove('active');
            screens[key].classList.add('hidden');
        }
    });
}

// --- Login & Shift Management ---

async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault(); // Prevent any default action

    console.log("Attempting login...");
    
    const select = document.getElementById('cashier-select');
    const pinInput = document.getElementById('pin-input');
    
    const staffId = select.value;
    const pin = pinInput.value;

    if (!staffId || !pin) {
        alert("Pilih kasir dan masukkan PIN.");
        return;
    }

    try {
        if (!window.db) {
            throw new Error("Database belum siap. Coba refresh halaman.");
        }
        
        const staff = await db.staff.get(staffId);
        
        if (!staff || staff.pin !== pin) {
            alert("PIN salah!");
            return;
        }

        console.log("Login success for:", staff.name);
        state.currentStaff = staff;

    // Check for open shift using simple index + memory filter
    const staffShifts = await db.shifts.where('cashier_id').equals(staff.id).toArray();
    const openShifts = staffShifts.filter(s => s.status === 'open');

    if (openShifts.length > 0) {
        state.currentShift = openShifts[0];
    } else {
        // Open new shift
        const newShift = {
            id: uuidv4(),
            unit_id: staff.unit_id,
            cashier_id: staff.id,
            opened_at: new Date().toISOString(),
            status: 'open',
            system_cash: 0,
            system_qris: 0,
            system_transfer: 0,
            is_synced: 0
        };
        await db.shifts.add(newShift);
        state.currentShift = newShift;
    }

    // Setup Cashier Dashboard
    document.getElementById('current-cashier-name').textContent = staff.name;
    const shiftTime = new Date(state.currentShift.opened_at);
    document.getElementById('current-shift-time').textContent = shiftTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    // Reset inputs
    document.getElementById('pin-input').value = '';
    resetTransactionForm();

    showScreen('cashier');
    } catch (err) {
        console.error("Login Error:", err);
        alert("Gagal Login: " + err.message);
    }
}

// --- Transaction Form ---

// Global function exposed to HTML for onclick events
window.updateCount = function (type, change) {
    const input = document.getElementById(`${type}-count`);
    let newVal = parseInt(input.value) + change;

    // Minimum 0, except for adult which minimum is 1 (unless other types are selected, but for simplicity minimum 0 globally, and we validate on submit)
    if (newVal < 0) newVal = 0;

    input.value = newVal;
    state.order[type] = newVal;

    updateOrderSummary();
};

function updateOrderSummary() {
    const adultTotal = state.order.adult * state.prices.adult;
    const childTotal = state.order.child * state.prices.child;
    const totalGuests = state.order.adult + state.order.child + state.order.free;
    const subtotal = adultTotal + childTotal;

    // No dynamic discount logic yet (Promo feature for future)
    const discount = 0;
    const total = subtotal - discount;

    document.getElementById('summary-guests').textContent = `${totalGuests} Orang`;
    document.getElementById('summary-subtotal').textContent = `Rp ${subtotal.toLocaleString('id-ID')}`;
    document.getElementById('summary-discount').textContent = `Rp ${discount.toLocaleString('id-ID')}`;
    document.getElementById('summary-total').textContent = `Rp ${total.toLocaleString('id-ID')}`;
}

function resetTransactionForm() {
    state.order = { adult: 1, child: 0, free: 0 };
    document.getElementById('adult-count').value = 1;
    document.getElementById('child-count').value = 0;
    document.getElementById('free-count').value = 0;
    document.getElementById('visitor-source').value = 'walk-in';
    document.querySelector('input[name="payment"][value="cash"]').checked = true;
    updateOrderSummary();
}

async function processPayment() {
    const totalGuests = state.order.adult + state.order.child + state.order.free;

    if (totalGuests === 0) {
        alert("Minimal 1 pengunjung.");
        return;
    }

    const adultTotal = state.order.adult * state.prices.adult;
    const childTotal = state.order.child * state.prices.child;
    const subtotal = adultTotal + childTotal;
    const total = subtotal; // No discount implemented in MVP UI yet

    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
    const visitorSource = document.getElementById('visitor-source').value;

    const btn = document.getElementById('process-payment-btn');
    btn.disabled = true;
    btn.textContent = "Memproses...";

    try {
        // 1. Create Order
        const orderId = uuidv4();
        // Format order number PW-20260507-ORDERXXX
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const timeStr = now.getHours().toString().padStart(2, '0') + 
                        now.getMinutes().toString().padStart(2, '0') + 
                        now.getSeconds().toString().padStart(2, '0');
        const orderCount = await db.orders.where('shift_id').equals(state.currentShift.id).count();
        const orderNum = `ORD-${dateStr}-${timeStr}-${String(orderCount + 1).padStart(3, '0')}`;

        const newOrder = {
            id: orderId,
            unit_id: state.currentUnit.id,
            shift_id: state.currentShift.id,
            cashier_id: state.currentStaff.id,
            order_number: orderNum,
            total_guests: totalGuests,
            adult_count: state.order.adult,
            child_count: state.order.child,
            free_count: state.order.free,
            subtotal: subtotal,
            discount_amount: 0,
            total_price: total,
            payment_method: paymentMethod,
            visitor_source: visitorSource,
            is_synced: 0, // 0 = false for IndexedDB
            created_at: new Date().toISOString()
        };

        // 2. Generate Tickets
        const newTickets = [];
        const createTicketData = (category, price) => {
            return {
                id: uuidv4(),
                order_id: orderId,
                ticket_code: generateTicketCode(),
                category: category,
                price: price,
                status: 'sold',
                created_at: new Date().toISOString()
            };
        };

        for (let i = 0; i < state.order.adult; i++) newTickets.push(createTicketData('dewasa', state.prices.adult));
        for (let i = 0; i < state.order.child; i++) newTickets.push(createTicketData('anak', state.prices.child));
        for (let i = 0; i < state.order.free; i++) newTickets.push(createTicketData('gratis', 0));

        // 3. Save to Local DB Transactionally
        await db.transaction('rw', db.orders, db.tickets, async () => {
            await db.orders.add(newOrder);
            await db.tickets.bulkAdd(newTickets);
        });

        // 4. Print Tickets (this calls window.print internally)
        await printTickets(newTickets, state.currentStaff.name);

        // 5. Success
        resetTransactionForm();

        // Try background sync immediately
        if (typeof syncData === 'function') syncData();

    } catch (err) {
        console.error("Error processing payment:", err);
        alert("Gagal memproses transaksi: " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Proses Pembayaran & Cetak QR";
    }
}

// --- Closing Shift ---

async function showClosingScreen() {
    // Calculate system totals from local DB for this shift
    const orders = await db.orders.where({ shift_id: state.currentShift.id }).toArray();

    let totalCash = 0, totalQris = 0, totalTransfer = 0;

    orders.forEach(order => {
        if (order.payment_method === 'cash') totalCash += order.total_price;
        else if (order.payment_method === 'qris') totalQris += order.total_price;
        else if (order.payment_method === 'transfer') totalTransfer += order.total_price;
    });

    document.getElementById('close-total-orders').textContent = orders.length;
    document.getElementById('close-system-cash').textContent = `Rp ${totalCash.toLocaleString('id-ID')}`;
    document.getElementById('close-system-qris').textContent = `Rp ${totalQris.toLocaleString('id-ID')}`;
    document.getElementById('close-system-transfer').textContent = `Rp ${totalTransfer.toLocaleString('id-ID')}`;

    // Save to state for closing
    state.currentShift.system_cash = totalCash;
    state.currentShift.system_qris = totalQris;
    state.currentShift.system_transfer = totalTransfer;

    // Setup listener for physical cash input
    const countedInput = document.getElementById('counted-cash');
    countedInput.value = ''; // clear previous
    countedInput.addEventListener('input', updateDifference);
    updateDifference(); // Initial difference calculation

    showScreen('closing');
}

function updateDifference() {
    const countedCash = parseInt(document.getElementById('counted-cash').value) || 0;
    const systemCash = state.currentShift.system_cash;
    const diff = countedCash - systemCash;

    const diffSpan = document.getElementById('close-difference');
    diffSpan.textContent = `Rp ${Math.abs(diff).toLocaleString('id-ID')}`;

    if (diff === 0) {
        diffSpan.className = 'neutral';
        diffSpan.textContent = 'Rp 0 (Pas)';
    } else if (diff > 0) {
        diffSpan.className = 'positive';
        diffSpan.textContent = `+ Rp ${diff.toLocaleString('id-ID')} (Lebih)`;
    } else {
        diffSpan.className = 'negative';
        diffSpan.textContent = `- Rp ${Math.abs(diff).toLocaleString('id-ID')} (Kurang)`;
    }
}

function hideClosingScreen() {
    showScreen('cashier');
}

async function submitClosingShift() {
    const countedCash = parseInt(document.getElementById('counted-cash').value);

    if (isNaN(countedCash)) {
        alert("Mohon masukkan jumlah uang fisik yang dihitung.");
        return;
    }

    const difference = countedCash - state.currentShift.system_cash;
    const notes = document.getElementById('closing-notes').value;

    try {
        await db.shifts.update(state.currentShift.id, {
            closed_at: new Date().toISOString(),
            status: 'closed',
            system_cash: state.currentShift.system_cash,
            system_qris: state.currentShift.system_qris,
            system_transfer: state.currentShift.system_transfer,
            counted_cash: countedCash,
            difference: difference,
            notes: notes,
            is_synced: 0
        });

        // Try background sync to push closed shift status (could be implemented in sync.js, but handled here for MVP simplicity if online)
        if (navigator.onLine && window.supabaseInstance) {
            const shiftData = await db.shifts.get(state.currentShift.id);
            await window.supabaseInstance.from('shifts').upsert([shiftData]);
        }

        alert("Shift berhasil ditutup!");

        // Reset state
        state.currentStaff = null;
        state.currentShift = null;

        showScreen('login');

    } catch (err) {
        console.error("Error closing shift:", err);
        alert("Gagal menutup shift: " + err.message);
    }
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
    initApp();
});
