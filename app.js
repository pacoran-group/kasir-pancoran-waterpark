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
    document.getElementById('submit-only-btn').addEventListener('click', () => processPayment(false));
    document.getElementById('print-submit-btn').addEventListener('click', () => processPayment(true));
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

// Global function exposed to HTML for onclick events (tombol + dan -)
window.updateCount = function (type, change) {
    const input = document.getElementById(`${type}-count`);
    let newVal = parseInt(input.value) + change;

    // Minimum 0, except for adult which minimum is 1 (unless other types are selected, but for simplicity minimum 0 globally, and we validate on submit)
    if (newVal < 0) newVal = 0;

    input.value = newVal;
    state.order[type] = newVal;

    updateOrderSummary();
};

// Handle direct keyboard input in counter fields
window.handleCountInput = function (type) {
    const input = document.getElementById(`${type}-count`);
    let newVal = parseInt(input.value);

    // Jika kosong atau NaN (sedang mengetik), biarkan sementara
    if (isNaN(newVal) || input.value === '') {
        state.order[type] = 0;
        updateOrderSummary();
        return;
    }

    // Pastikan tidak negatif
    if (newVal < 0) {
        newVal = 0;
        input.value = 0;
    }

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

/**
 * processPayment - inti pemrosesan transaksi
 * @param {boolean} withPrint - true = cetak tiket setelah simpan, false = simpan saja
 */
async function processPayment(withPrint) {
    const totalGuests = state.order.adult + state.order.child + state.order.free;

    if (totalGuests === 0) {
        alert("Minimal 1 pengunjung.");
        return;
    }

    const adultTotal = state.order.adult * state.prices.adult;
    const childTotal = state.order.child * state.prices.child;
    const subtotal = adultTotal + childTotal;
    const total = subtotal;

    const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
    const visitorSource = document.getElementById('visitor-source').value;

    // Disable kedua tombol agar tidak double-submit
    const btnSubmit = document.getElementById('submit-only-btn');
    const btnPrint  = document.getElementById('print-submit-btn');
    btnSubmit.disabled = true;
    btnPrint.disabled  = true;
    btnSubmit.textContent = withPrint ? 'Submit' : 'Menyimpan...';
    btnPrint.textContent  = withPrint ? 'Mencetak...' : 'Print & Submit';

    try {
        // 1. Buat Order
        const orderId = uuidv4();
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
            is_synced: 0,
            created_at: new Date().toISOString()
        };

        // 2. Generate Tiket
        const newTickets = [];
        const createTicketData = (category, price) => ({
            id: uuidv4(),
            order_id: orderId,
            ticket_code: generateTicketCode(),
            category: category,
            price: price,
            status: 'sold',
            created_at: new Date().toISOString()
        });

        for (let i = 0; i < state.order.adult; i++) newTickets.push(createTicketData('dewasa', state.prices.adult));
        for (let i = 0; i < state.order.child; i++) newTickets.push(createTicketData('anak', state.prices.child));
        for (let i = 0; i < state.order.free; i++) newTickets.push(createTicketData('gratis', 0));

        // 3. Simpan ke IndexedDB (local-first)
        await db.transaction('rw', db.orders, db.tickets, async () => {
            await db.orders.add(newOrder);
            await db.tickets.bulkAdd(newTickets);
        });

        // 4. Jika Print & Submit: kirim ke antrian cetak (print queue) di Supabase
        //    PC printer akan polling dan auto-print dari antrian ini.
        //    Jika offline, fallback ke print langsung dari browser ini.
        if (withPrint) {
            let queuedSuccessfully = false;

            if (navigator.onLine && window.supabaseInstance) {
                try {
                    // Sync order ke Supabase dulu (agar FK valid di print_queue)
                    await window.supabaseInstance.from('orders').upsert([newOrder]);
                    await window.supabaseInstance.from('tickets').upsert(newTickets);

                    // Masukkan ke antrian cetak
                    const { error: queueError } = await window.supabaseInstance
                        .from('print_queue')
                        .insert({
                            id: uuidv4(),
                            order_id: orderId,
                            order_number: orderNum,
                            cashier_name: state.currentStaff.name,
                            tickets_json: newTickets,
                            status: 'pending',
                            created_at: new Date().toISOString()
                        });

                    if (!queueError) {
                        queuedSuccessfully = true;
                        // Tampilkan notifikasi antrian diterima
                        showPrintQueueNotice(orderNum);
                    } else {
                        console.warn('Gagal kirim ke antrian, fallback print lokal:', queueError.message);
                    }
                } catch (syncErr) {
                    console.warn('Sync error sebelum print queue, fallback lokal:', syncErr.message);
                }
            }

            // Fallback: jika offline atau antrian gagal, print langsung dari browser ini
            if (!queuedSuccessfully) {
                await printTickets(newTickets, state.currentStaff.name);
            }
        }

        // 5. Reset form & sinkronisasi background
        resetTransactionForm();
        if (typeof syncData === 'function') syncData();

        if (!withPrint) {
            // Berikan konfirmasi visual singkat
            btnSubmit.textContent = '✓ Tersimpan!';
            setTimeout(() => {
                btnSubmit.textContent = '✓ Submit';
            }, 1500);
        }


    } catch (err) {
        console.error("Error processing payment:", err);
        alert("Gagal memproses transaksi: " + err.message);
    } finally {
        btnSubmit.disabled = false;
        btnPrint.disabled  = false;
        if (withPrint) {
            btnSubmit.innerHTML = '<span class="btn-icon">✓</span> Submit';
            btnPrint.innerHTML  = '<span class="btn-icon">🖨</span> Print & Submit';
        }
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

// --- Print Queue Notification ---

/**
 * Tampilkan notifikasi toast bahwa tiket berhasil masuk antrian cetak.
 * PC printer yang sedang berjalan akan memprosesnya secara otomatis.
 */
function showPrintQueueNotice(orderNum) {
    // Hapus toast lama jika ada
    const existing = document.getElementById('print-queue-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'print-queue-toast';
    toast.innerHTML = `
        <span style="font-size:20px">🖨</span>
        <div>
            <strong>Antrian Cetak Dikirim</strong>
            <div style="font-size:13px;opacity:0.9">${orderNum} — PC printer akan mencetak otomatis</div>
        </div>
    `;
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: white;
        padding: 14px 20px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        z-index: 9999;
        font-family: inherit;
        min-width: 300px;
        animation: slideUp 0.3s ease;
    `;

    // Tambahkan animasi
    const style = document.createElement('style');
    style.textContent = `@keyframes slideUp { from { transform: translateX(-50%) translateY(20px); opacity:0; } to { transform: translateX(-50%) translateY(0); opacity:1; } }`;
    document.head.appendChild(style);

    document.body.appendChild(toast);

    // Auto-hilang setelah 4 detik
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

