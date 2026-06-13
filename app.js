// app.js
// Main UI logic and state management

// ================================================================
// Webhook Configuration
// ================================================================
// Masukkan URL Custom Webhook dari Make.com / n8n / platform lainnya
const REPORT_WEBHOOK_URL = "https://hook.eu1.make.com/qhnfq865gukfpcd8biliwg17dftfp5or";

// ================================================================
// Application State
// ================================================================
const state = {
    currentStaff: null,
    currentShift: null,
    currentUnit: null,
    activeBookingRef: null, // { id, booking_number, group_name }
    order: {
        pax: 1,
        promo: 0 // percentage
    },
    prices: {
        adult_regular: 28000,
        adult_rombongan: 20000, // min 30 pax
        rombongan_min_pax: 30
    }
};

// DOM Elements
const screens = {
    login: document.getElementById('login-screen'),
    cashier: document.getElementById('cashier-screen'),
    closing: document.getElementById('closing-screen')
};

// ================================================================
// Utility
// ================================================================
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function formatRp(amount) {
    return 'Rp ' + amount.toLocaleString('id-ID');
}

function formatTime(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Harga Rp 20.000 HANYA berlaku jika:
 * - Sumber = "Rombongan Sekolah" (bukan rombongan umum)
 * - Total pax >= 30
 */
function isRombonganSekolahPrice() {
    const totalPax = state.order.pax;
    const source = document.getElementById('visitor-source')?.value;
    return source === 'rombongan-sekolah' && totalPax >= state.prices.rombongan_min_pax;
}

function getAdultPrice() {
    return isRombonganSekolahPrice() ? state.prices.adult_rombongan : state.prices.adult_regular;
}

// ================================================================
// Initialization
// ================================================================
async function initApp() {
    // Bind Event Listeners
    document.getElementById('submit-only-btn').addEventListener('click', () => processPayment(false));
    document.getElementById('print-submit-btn').addEventListener('click', () => processPayment(true));
    document.getElementById('close-shift-btn').addEventListener('click', showClosingScreen);
    document.getElementById('cancel-closing-btn').addEventListener('click', hideClosingScreen);
    document.getElementById('confirm-closing-btn').addEventListener('click', submitClosingShift);

    try {
        // Populate cashier select
        const allStaff = await db.staff.toArray();
        const select = document.getElementById('cashier-select');
        while (select.options.length > 1) select.remove(1);

        if (allStaff.length === 0) {
            console.warn("No staff found in IndexedDB!");
        }
        allStaff.forEach(staff => {
            const option = document.createElement('option');
            option.value = staff.id;
            option.textContent = staff.name;
            select.appendChild(option);
        });

        // Get the first unit
        const units = await db.units.toArray();
        if (units.length > 0) state.currentUnit = units[0];
    } catch (e) {
        console.error("Init Error:", e);
    }
}

// ================================================================
// Navigation — Screens
// ================================================================
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

// ================================================================
// Navigation — Sidebar Tabs
// ================================================================
function switchTab(tabName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navBtn = document.getElementById(`nav-${tabName}`);
    if (navBtn) navBtn.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    const tab = document.getElementById(`tab-${tabName}`);
    if (tab) tab.classList.add('active');

    // Load data when switching tabs
    if (tabName === 'booking') loadAllBookings();
    if (tabName === 'history') loadTodayHistory();
}

// ================================================================
// Login & Shift Management
// ================================================================
async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();

    const select = document.getElementById('cashier-select');
    const pinInput = document.getElementById('pin-input');
    const staffId = select.value;
    const pin = pinInput.value;

    if (!staffId || !pin) {
        alert("Pilih kasir dan masukkan PIN.");
        return;
    }

    try {
        if (!window.db) throw new Error("Database belum siap. Coba refresh halaman.");

        const staff = await db.staff.get(staffId);
        if (!staff || staff.pin !== pin) {
            alert("PIN salah!");
            return;
        }

        state.currentStaff = staff;

        // Check for open shift
        const staffShifts = await db.shifts.where('cashier_id').equals(staff.id).toArray();
        const openShifts = staffShifts.filter(s => s.status === 'open');

        if (openShifts.length > 0) {
            state.currentShift = openShifts[0];
        } else {
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

        // Setup dashboard UI
        const initials = staff.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        document.getElementById('avatar-initials').textContent = initials;
        document.getElementById('sidebar-cashier-name').textContent = staff.name;

        const shiftTime = new Date(state.currentShift.opened_at);
        document.getElementById('header-terminal').textContent =
            `Terminal #01 | Shift ${shiftTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} | ${staff.name}`;

        document.getElementById('pin-input').value = '';
        resetTransactionForm();
        switchTab('sales');
        showScreen('cashier');

        // Load today's bookings in background for the sales tab
        setTimeout(loadTodayBookings, 500);

    } catch (err) {
        console.error("Login Error:", err);
        alert("Gagal Login: " + err.message);
    }
}

// ================================================================
// Transaction Form
// ================================================================
window.updateCount = function (type, change) {
    if (type !== 'pax') return;
    const input = document.getElementById(`pax-count`);
    let newVal = parseInt(input.value) + change;
    if (newVal < 1) newVal = 1;
    input.value = newVal;
    state.order.pax = newVal;
    updateOrderSummary();
};

window.handleCountInput = function (type) {
    if (type !== 'pax') return;
    const input = document.getElementById(`pax-count`);
    let newVal = parseInt(input.value);
    if (isNaN(newVal) || input.value === '') {
        state.order.pax = 1;
        updateOrderSummary();
        return;
    }
    if (newVal < 1) { newVal = 1; input.value = 1; }
    state.order.pax = newVal;
    updateOrderSummary();
};

window.handlePromoInput = function () {
    const input = document.getElementById('promo-input');
    let newVal = parseInt(input.value);
    if (isNaN(newVal) || input.value === '') { newVal = 0; }
    if (newVal < 0) { newVal = 0; input.value = 0; }
    if (newVal > 100) { newVal = 100; input.value = 100; }
    state.order.promo = newVal;
    updateOrderSummary();
}

window.handleSourceChange = function () {
    updateOrderSummary();
};

window.updateOrderSummary = function () {
    const adultPrice = getAdultPrice();
    const subtotal = state.order.pax * adultPrice;
    
    // Calculate promo
    const discount = Math.round((subtotal * state.order.promo) / 100);
    const total = subtotal - discount;

    // Update price badge
    const badge = document.getElementById('price-badge');
    const badgeLabel = document.getElementById('price-badge-label');
    const badgeValue = document.getElementById('price-badge-value');
    const rombonganHint = document.getElementById('rombongan-hint');
    const rombonganUmumHint = document.getElementById('rombongan-umum-hint');
    const source = document.getElementById('visitor-source')?.value;
    const totalPax = state.order.pax;

    if (isRombonganSekolahPrice()) {
        badge.className = 'price-badge rombongan';
        badgeLabel.textContent = 'Rombongan Sekolah';
        badgeValue.textContent = 'Rp 20.000 / orang';
        rombonganHint.classList.remove('hidden');
        rombonganUmumHint.classList.add('hidden');
    } else if (source === 'rombongan-sekolah' && totalPax < state.prices.rombongan_min_pax) {
        badge.className = 'price-badge regular';
        badgeLabel.textContent = 'Reguler';
        badgeValue.textContent = `Rp 28.000 / orang`;
        rombonganHint.classList.add('hidden');
        rombonganUmumHint.classList.remove('hidden');
        rombonganUmumHint.textContent = `⚠️ Perlu min. 30 pax untuk harga sekolah (saat ini ${totalPax} pax)`;
    } else if (source === 'rombongan-umum') {
        badge.className = 'price-badge regular';
        badgeLabel.textContent = 'Reguler';
        badgeValue.textContent = 'Rp 28.000 / orang';
        rombonganHint.classList.add('hidden');
        rombonganUmumHint.classList.remove('hidden');
        rombonganUmumHint.textContent = 'ℹ️ Rombongan umum: harga reguler Rp 28.000/org';
    } else {
        badge.className = 'price-badge regular';
        badgeLabel.textContent = 'Reguler';
        badgeValue.textContent = 'Rp 28.000 / orang';
        rombonganHint.classList.add('hidden');
        rombonganUmumHint.classList.add('hidden');
    }

    // Summary panel
    document.getElementById('summary-guests').textContent = `${totalPax} Pengunjung`;
    document.getElementById('summary-subtotal').textContent = formatRp(subtotal);
    document.getElementById('summary-promo-pct').textContent = state.order.promo > 0 ? `(${state.order.promo}%)` : '';
    document.getElementById('summary-discount').textContent = '- ' + formatRp(discount);
    document.getElementById('summary-total').textContent = formatRp(total);
};

function resetTransactionForm() {
    state.order = { pax: 1, promo: 0 };
    state.activeBookingRef = null;
    document.getElementById('pax-count').value = 1;
    document.getElementById('promo-input').value = 0;
    document.getElementById('visitor-source').value = 'walk-in';
    document.getElementById('payment-method').value = 'cash';

    // Hide booking reference badge
    document.getElementById('booking-ref-badge').classList.add('hidden');

    updateOrderSummary();
}

// ================================================================
// Booking Reference (auto-fill dari booking card)
// ================================================================
window.clearBookingRef = function () {
    state.activeBookingRef = null;
    document.getElementById('booking-ref-badge').classList.add('hidden');
    document.getElementById('visitor-source').value = 'walk-in';
    updateOrderSummary();
};

function setBookingRef(booking) {
    state.activeBookingRef = booking;
    const totalPax = (booking.adult_count || 0) + (booking.child_count || 0);

    // Auto-fill jumlah pengunjung
    document.getElementById('pax-count').value = totalPax || 1;
    state.order.pax = totalPax || 1;

    // Auto-set sumber pengunjung sesuai tipe booking:
    const visitorSource = booking.booking_type === 'sekolah' ? 'rombongan-sekolah' : 'rombongan-umum';
    document.getElementById('visitor-source').value = visitorSource;

    // Tampilkan badge referensi booking
    const badge = document.getElementById('booking-ref-badge');
    badge.classList.remove('hidden');
    const typeLabel = booking.booking_type === 'sekolah' ? '🏫 Sekolah' : '👥 Umum';
    document.getElementById('booking-ref-text').textContent =
        `Reservasi: ${booking.booking_number} — ${booking.group_name} (${typeLabel})`;

    updateOrderSummary();

    // Switch ke tab Sales
    switchTab('sales');
}

// ================================================================
// Process Payment
// ================================================================
async function processPayment(withPrint) {
    const totalGuests = state.order.pax;
    if (totalGuests < 1) {
        alert("Minimal 1 pengunjung.");
        return;
    }

    const adultPrice = getAdultPrice();
    const subtotal = totalGuests * adultPrice;
    const discountAmount = Math.round((subtotal * state.order.promo) / 100);
    const total = subtotal - discountAmount;

    const paymentMethod = document.getElementById('payment-method').value;
    const visitorSource = document.getElementById('visitor-source').value;

    const btnSubmit = document.getElementById('submit-only-btn');
    const btnPrint = document.getElementById('print-submit-btn');
    btnSubmit.disabled = true;
    btnPrint.disabled = true;
    btnSubmit.textContent = 'Menyimpan...';
    btnPrint.innerHTML = '⏳ Memproses...';

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
            unit_id: state.currentUnit?.id || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            shift_id: state.currentShift.id,
            cashier_id: state.currentStaff.id,
            order_number: orderNum,
            total_guests: totalGuests,
            // Kita simpan ke adult_count untuk kompatibilitas schema, child & free = 0
            adult_count: totalGuests,
            child_count: 0,
            free_count: 0,
            adult_price: adultPrice,
            subtotal: subtotal,
            discount_amount: discountAmount,
            total_price: total,
            payment_method: paymentMethod,
            visitor_source: visitorSource,
            booking_ref: state.activeBookingRef?.booking_number || null,
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

        for (let i = 0; i < totalGuests; i++) newTickets.push(createTicketData('dewasa', adultPrice));

        // 3. Simpan ke IndexedDB (local-first)
        await db.transaction('rw', db.orders, db.tickets, async () => {
            await db.orders.add(newOrder);
            await db.tickets.bulkAdd(newTickets);
        });

        // 4. Tandai booking sebagai "arrived" jika ada referensi
        if (state.activeBookingRef) {
            await markBookingArrived(state.activeBookingRef.id);
        }

        // 5. Print Queue
        if (withPrint) {
            let queuedSuccessfully = false;
            if (navigator.onLine && window.supabaseInstance) {
                try {
                    await window.supabaseInstance.from('orders').upsert([newOrder]);
                    await window.supabaseInstance.from('tickets').upsert(newTickets);
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
                        showPrintQueueNotice(orderNum);
                    }
                } catch (syncErr) {
                    console.warn('Sync error, fallback lokal:', syncErr.message);
                }
            }
            if (!queuedSuccessfully) {
                await printTickets(newTickets, state.currentStaff.name);
            }
        }

        // 6. Reset form & sinkronisasi background
        resetTransactionForm();
        if (typeof syncData === 'function') syncData();

        if (!withPrint) {
            btnSubmit.textContent = '✓ Tersimpan!';
            setTimeout(() => { 
                btnSubmit.textContent = 'Submit'; 
                btnPrint.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <polyline points="6 9 6 2 18 2 18 9"/>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                    <rect x="6" y="14" width="12" height="8"/>
                </svg> Submit &amp; Print`;
            }, 1500);
        } else {
            btnPrint.innerHTML = '✓ Selesai!';
            setTimeout(() => { 
                btnSubmit.textContent = 'Submit'; 
                btnPrint.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <polyline points="6 9 6 2 18 2 18 9"/>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                    <rect x="6" y="14" width="12" height="8"/>
                </svg> Submit &amp; Print`;
            }, 1500);
        }

    } catch (err) {
        console.error("Error processing payment:", err);
        alert("Gagal memproses transaksi: " + err.message);
    } finally {
        btnSubmit.disabled = false;
        btnPrint.disabled = false;
    }
}

// ================================================================
// TODAY'S HISTORY (Transaksi Kasir)
// ================================================================
window.loadTodayHistory = async function () {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Memuat...</p></div>';

    try {
        if (!state.currentShift) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Belum ada shift aktif. Silakan buka shift terlebih dahulu.</p></div>';
            return;
        }

        const allOrders = await db.orders.toArray();
        const todayOrders = allOrders
            .filter(o => o.shift_id === state.currentShift.id)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (todayOrders.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Belum ada transaksi di shift ini</p></div>';
            return;
        }

        list.innerHTML = '';
        const methodIcon = { cash: '💵', qris: '📲', transfer: '🏦' };
        todayOrders.forEach(order => {
            const card = document.createElement('div');
            card.className = 'history-card';
            card.innerHTML = `
                <div class="history-card-icon">${methodIcon[order.payment_method] || '🧾'}</div>
                <div class="history-card-info">
                    <div class="history-card-num">${order.order_number}</div>
                    <div class="history-card-meta">${formatTime(order.created_at)} · ${order.total_guests} orang · ${order.visitor_source || 'walk-in'}</div>
                </div>
                <div>
                    <div class="history-card-amount">${formatRp(order.total_price)}</div>
                    <div class="history-card-method">${order.payment_method}</div>
                </div>
            `;
            list.appendChild(card);
        });
    } catch (err) {
        if(list) list.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Gagal memuat riwayat</p></div>';
        console.error("History Error:", err);
    }
}

// ================================================================
// PRINT Z-REPORT (Automatic on Closing Shift)
// ================================================================
window.printZReport = async function(shiftData) {
    if (!shiftData) return;

    try {
        // Ambil semua order pada shift ini
        const allOrders = await db.orders.where('shift_id').equals(shiftData.id).toArray();
        let totalGuests = 0;

        allOrders.forEach(o => {
            totalGuests += o.total_guests;
        });

        const dateStr = new Date().toLocaleString('id-ID', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Buat window baru untuk nge-print dengan ukuran kertas struk (80mm)
        const printWindow = window.open('', '_blank', 'width=400,height=600');
        printWindow.document.write(`
            <html>
            <head>
                <title>Z-Report Kasir</title>
                <style>
                    body { font-family: monospace; width: 100%; max-width: 300px; margin: 0 auto; padding: 10px; color: #000; }
                    @page { size: auto; margin: 5mm; }
                    hr { border: none; border-top: 1px dashed #000; margin: 10px 0; }
                    .row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px; }
                    .header { text-align: center; margin-bottom: 15px; }
                    .bold { font-weight: bold; }
                    .footer { text-align: center; font-size: 11px; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2 style="margin: 0; font-size: 18px;">PANCORAN WATERPARK</h2>
                    <div style="font-size: 14px; margin-top: 5px;">Z-REPORT (LAPORAN PENUTUPAN)</div>
                    <div style="font-size: 12px; margin-top: 3px;">Terminal #01</div>
                </div>
                
                <div style="font-size: 13px; margin-bottom: 10px;">
                    <div>Waktu Cetak : ${dateStr}</div>
                    <div>Nama Kasir  : ${state.currentStaff?.name || '-'}</div>
                    <div>Waktu Buka  : ${new Date(shiftData.opened_at).toLocaleString('id-ID')}</div>
                    <div>Waktu Tutup : ${new Date(shiftData.closed_at).toLocaleString('id-ID')}</div>
                </div>
                
                <hr>
                <div class="row">
                    <span>Total Transaksi:</span>
                    <span>${allOrders.length}</span>
                </div>
                <div class="row">
                    <span>Total Pengunjung:</span>
                    <span>${totalGuests} pax</span>
                </div>
                <hr>
                
                <div class="row">
                    <span>Sistem Cash:</span>
                    <span>${formatRp(shiftData.system_cash)}</span>
                </div>
                <div class="row">
                    <span>Sistem QRIS:</span>
                    <span>${formatRp(shiftData.system_qris)}</span>
                </div>
                <div class="row">
                    <span>Sistem Transfer:</span>
                    <span>${formatRp(shiftData.system_transfer)}</span>
                </div>
                <hr>
                
                <div class="row bold" style="font-size: 14px;">
                    <span>TOTAL SISTEM:</span>
                    <span>${formatRp(shiftData.system_cash + shiftData.system_qris + shiftData.system_transfer)}</span>
                </div>
                <hr>
                
                <div class="row bold" style="font-size: 15px;">
                    <span>UANG FISIK:</span>
                    <span>${formatRp(shiftData.counted_cash)}</span>
                </div>
                <div class="row bold" style="font-size: 15px; color: ${shiftData.difference < 0 ? 'red' : 'black'};">
                    <span>SELISIH:</span>
                    <span>${formatRp(shiftData.difference)}</span>
                </div>
                
                <hr>
                <div class="footer">
                    <div style="margin-top: 30px; display: flex; justify-content: space-between; padding: 0 10px;">
                        <div style="text-align: center;">
                            <div>Diserahkan,</div>
                            <div style="margin-top: 40px;">( ${state.currentStaff?.name || 'Kasir'} )</div>
                        </div>
                        <div style="text-align: center;">
                            <div>Diterima,</div>
                            <div style="margin-top: 40px;">( Finance )</div>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        
        // Timeout agar browser me-render HTML dulu
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);

    } catch (err) {
        console.error("Print Report Error:", err);
        alert("Gagal mencetak laporan.");
    }
}

// ================================================================
// BOOKING FEATURE
// ================================================================

/**
 * Tampilkan daftar booking hari ini di tab Sales
 */
window.loadTodayBookings = async function () {
    const list = document.getElementById('sales-booking-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Memuat reservasi...</p></div>';

    // Pull from Supabase jika online
    await syncBookingsFromSupabase();

    try {
        const today = new Date().toISOString().slice(0, 10);
        let bookings = await db.bookings
            .where('visit_date').equals(today)
            .toArray();

        // Hanya tampilkan yang belum diproses (pending) di tab Sales
        bookings = bookings.filter(b => b.status === 'pending');

        bookings.sort((a, b) => {
            return (a.arrival_time || '').localeCompare(b.arrival_time || '');
        });

        if (bookings.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><p>Tidak ada reservasi hari ini</p></div>';
            return;
        }

        list.innerHTML = '';
        bookings.forEach(booking => renderBookingCard(booking, list, true));
    } catch (err) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Gagal memuat reservasi</p></div>';
        console.error("Booking load Error:", err);
    }
}

/**
 * Tampilkan daftar booking SEMUA (Kecuali Hari ini) di tab Reservasi
 */
window.loadAllBookings = async function () {
    const list = document.getElementById('all-booking-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Memuat reservasi...</p></div>';

    // Pull from Supabase jika online
    await syncBookingsFromSupabase();

    try {
        const today = new Date().toISOString().slice(0, 10);
        // Load all
        let bookings = await db.bookings.toArray();
        
        // Tampilkan semua data, KECUALI yang jadwalnya hari ini DAN masih pending
        // (Karena yang hari ini dan masih pending sudah tampil di halaman depan/Sales)
        bookings = bookings.filter(b => !(b.visit_date === today && b.status === 'pending'));

        // Sort descending by date
        bookings.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));

        if (bookings.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><p>Belum ada data reservasi lain</p></div>';
            return;
        }

        list.innerHTML = '';
        bookings.forEach(booking => renderBookingCard(booking, list, false));
    } catch (err) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Gagal memuat reservasi</p></div>';
        console.error("All Booking load Error:", err);
    }
}

/**
 * Render satu kartu booking ke dalam container
 * showProcessBtn: apakah menampilkan tombol "Proses Tiket" atau tidak
 */
function renderBookingCard(booking, container, showProcessBtn = true) {
    const totalPax = (booking.adult_count || 0) + (booking.child_count || 0);
    const isSekolah = booking.booking_type === 'sekolah';
    const isDiskonSekolah = isSekolah && totalPax >= state.prices.rombongan_min_pax;
    const isArrived = booking.status === 'arrived';
    const isCancelled = booking.status === 'cancelled';

    const statusLabel = { pending: 'Menunggu', arrived: 'Sudah Datang', cancelled: 'Batal' };
    const statusClass  = { pending: 'badge-pending', arrived: 'badge-arrived', cancelled: 'badge-cancelled' };

    const card = document.createElement('div');
    card.className = `booking-card ${isArrived ? 'arrived' : ''}`;
    card.innerHTML = `
        <div class="booking-card-header">
            <div>
                <div class="booking-number">${booking.booking_number}</div>
                <div class="booking-group-name">${booking.group_name}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
                <span class="booking-status-badge ${statusClass[booking.status] || 'badge-pending'}">
                    ${statusLabel[booking.status] || booking.status}
                </span>
                <span class="booking-type-badge ${isSekolah ? 'type-sekolah' : 'type-umum'}">
                    ${isSekolah ? '🏫 Sekolah' : '👥 Umum'}
                </span>
            </div>
        </div>

        <div class="booking-card-details">
            <div class="booking-detail-item">
                <span class="booking-detail-icon">📅</span>
                <span>${formatVisitDate(booking.visit_date)}</span>
            </div>
            <div class="booking-detail-item">
                <span class="booking-detail-icon">🕐</span>
                <span>Datang jam <strong>${booking.arrival_time || '—'}</strong></span>
            </div>
            ${booking.contact_name ? `
            <div class="booking-detail-item">
                <span class="booking-detail-icon">👤</span>
                <span>PIC: <strong>${booking.contact_name}</strong></span>
            </div>` : ''}
            ${booking.contact_phone ? `
            <div class="booking-detail-item">
                <span class="booking-detail-icon">📞</span>
                <span>${booking.contact_phone}</span>
            </div>` : ''}
        </div>

        <div class="booking-pax-row">
            <span class="pax-chip total">Total: ${totalPax} pax</span>
            ${isDiskonSekolah
                ? `<span class="rombongan-price-tag">🏷️ Rp 20.000/org</span>`
                : isSekolah && totalPax < state.prices.rombongan_min_pax
                    ? `<span class="rombongan-price-tag warn">⚠️ Butuh min.30 pax utk harga sekolah</span>`
                    : `<span class="rombongan-price-tag reguler">Rp 28.000/org</span>`
            }
        </div>

        ${booking.notes ? `<div class="booking-card-notes">📝 ${booking.notes}</div>` : ''}

        <div class="booking-card-footer" style="display: flex; gap: 8px; justify-content: flex-end;">
            ${showProcessBtn ? (
                !isArrived && !isCancelled ? `
                <button class="btn-process" onclick="processBookingToSales('${booking.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
                        <polyline points="9 11 12 14 22 4"/>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                    Proses Tiket
                </button>
                ` : `
                <span class="btn-process-done">
                    ${isArrived ? '✅ Sudah Diproses' : '❌ Dibatalkan'}
                </span>
                `
            ) : `
                <!-- Edit Button -->
                <button class="btn secondary outline" style="padding: 6px 12px; font-size: 12px; min-width: 0;" onclick="openBookingModal('${booking.id}')">
                    ✏️ Edit
                </button>
            `}
        </div>
    `;
    container.appendChild(card);
}

/**
 * User klik "Proses Tiket" pada kartu booking → auto-fill form transaksi
 */
window.processBookingToSales = async function (bookingId) {
    try {
        const booking = await db.bookings.get(bookingId);
        if (!booking) { alert("Data booking tidak ditemukan."); return; }

        setBookingRef(booking);
    } catch (err) {
        console.error("processBookingToSales error:", err);
        alert("Gagal memuat data booking: " + err.message);
    }
};

/**
 * Tandai booking sebagai "arrived" di IndexedDB (dan Supabase jika online)
 */
async function markBookingArrived(bookingId) {
    try {
        await db.bookings.update(bookingId, { status: 'arrived' });

        // Sync ke Supabase jika online
        if (navigator.onLine && window.supabaseInstance) {
            await window.supabaseInstance
                .from('bookings')
                .update({ status: 'arrived' })
                .eq('id', bookingId);
        }

        // Refresh booking list di sales tab
        await loadTodayBookings();
    } catch (err) {
        console.warn("markBookingArrived error:", err);
    }
}

/**
 * Pull booking dari Supabase ke IndexedDB
 */
async function syncBookingsFromSupabase() {
    if (!navigator.onLine || !window.supabaseInstance) return;

    try {
        // Karena kita butuh semua data untuk history dan hari ini, fetch semua yg belum arrived/cancelled hari ini
        // Atau ambil semuanya saja dan replace local db (selama tidak conflict)
        const { data, error } = await window.supabaseInstance
            .from('bookings')
            .select('*')
            .order('visit_date', { ascending: false })
            .limit(100);

        if (error) {
            console.warn("Booking sync (Supabase):", error.message);
            return;
        }

        if (data && data.length > 0) {
            await db.bookings.bulkPut(data);
        }
    } catch (err) {
        console.warn("syncBookingsFromSupabase:", err.message);
    }
}

/**
 * Format tanggal kunjungan ke format Indonesia
 */
function formatVisitDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ================================================================
// BOOKING CRUD MANAGEMENT (MODAL)
// ================================================================

window.openBookingModal = async function(bookingId = null) {
    document.getElementById('booking-modal').classList.remove('hidden');
    const form = document.getElementById('booking-form');
    form.reset();
    
    if (bookingId) {
        document.getElementById('booking-modal-title').textContent = "Edit Reservasi";
        try {
            const booking = await db.bookings.get(bookingId);
            if (booking) {
                document.getElementById('booking-id').value = booking.id;
                document.getElementById('bk-name').value = booking.group_name;
                document.getElementById('bk-type').value = booking.booking_type || 'sekolah';
                document.getElementById('bk-pax').value = (booking.adult_count || 0) + (booking.child_count || 0);
                document.getElementById('bk-date').value = booking.visit_date;
                document.getElementById('bk-time').value = booking.arrival_time;
                document.getElementById('bk-pic').value = booking.contact_name;
                document.getElementById('bk-phone').value = booking.contact_phone;
                document.getElementById('bk-notes').value = booking.notes;
            }
        } catch (e) {
            console.error(e);
            alert("Gagal memuat data booking.");
        }
    } else {
        document.getElementById('booking-modal-title').textContent = "Tambah Reservasi";
        document.getElementById('booking-id').value = '';
    }
};

window.closeBookingModal = function() {
    document.getElementById('booking-modal').classList.add('hidden');
};

window.saveBooking = async function(event) {
    event.preventDefault();
    
    const id = document.getElementById('booking-id').value;
    const isNew = !id;
    const bookingId = isNew ? uuidv4() : id;
    const pax = parseInt(document.getElementById('bk-pax').value) || 0;
    
    // Generate simple booking number if new
    let bookingNumber = '';
    if (isNew) {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        bookingNumber = `BK-${dateStr}-${randomNum}`;
    }

    const bookingData = {
        id: bookingId,
        unit_id: state.currentUnit?.id || 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        group_name: document.getElementById('bk-name').value,
        booking_type: document.getElementById('bk-type').value,
        adult_count: pax, // All mapped to adult_count to match DB schema total
        child_count: 0,
        visit_date: document.getElementById('bk-date').value,
        arrival_time: document.getElementById('bk-time').value,
        contact_name: document.getElementById('bk-pic').value,
        contact_phone: document.getElementById('bk-phone').value,
        notes: document.getElementById('bk-notes').value,
        status: 'pending',
        updated_at: new Date().toISOString()
    };
    
    if (isNew) {
        bookingData.booking_number = bookingNumber;
        bookingData.created_at = new Date().toISOString();
    }

    try {
        // Save to Local DB
        if (isNew) {
            await db.bookings.add(bookingData);
        } else {
            const existing = await db.bookings.get(bookingId);
            await db.bookings.update(bookingId, { ...existing, ...bookingData });
        }

        // Save to Supabase
        if (navigator.onLine && window.supabaseInstance) {
            const { error } = await window.supabaseInstance
                .from('bookings')
                .upsert([isNew ? bookingData : { ...bookingData, booking_number: (await db.bookings.get(bookingId)).booking_number }]);
            
            if (error) console.error("Supabase booking error:", error);
        }

        closeBookingModal();
        alert(isNew ? "Reservasi berhasil ditambahkan!" : "Reservasi berhasil diperbarui!");
        
        // Refresh lists
        loadAllBookings();
        loadTodayBookings();
    } catch (e) {
        console.error("Save booking failed:", e);
        alert("Gagal menyimpan reservasi: " + e.message);
    }
};

// ================================================================
// Closing Shift & Email Report
// ================================================================

function generateCSV(orders) {
    const headers = [
        "order_number", "total_guests", "adult_count", "child_count", 
        "free_count", "adult_price", "subtotal", "discount_amount", 
        "total_price", "payment_method", "visitor_source", 
        "booking_ref", "created_at"
    ];
    
    let csvRows = [];
    csvRows.push(headers.join(","));
    
    orders.forEach(order => {
        const row = [
            order.order_number || "",
            order.total_guests || 0,
            order.adult_count || 0,
            order.child_count || 0,
            order.free_count || 0,
            order.adult_price || 0,
            order.subtotal || 0,
            order.discount_amount || 0,
            order.total_price || 0,
            order.payment_method || "",
            order.visitor_source || "",
            order.booking_ref || "",
            order.created_at || ""
        ];
        const escapedRow = row.map(val => {
            const str = String(val);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        });
        csvRows.push(escapedRow.join(","));
    });
    
    return csvRows.join("\n");
}

async function sendClosingReportWebhook(shiftData) {
    if (!REPORT_WEBHOOK_URL || REPORT_WEBHOOK_URL === "MASUKKAN_URL_WEBHOOK_ANDA_DISINI") {
        console.warn("Webhook URL belum diatur.");
        return false;
    }
    
    try {
        const orders = await db.orders.where({ shift_id: shiftData.id }).toArray();
        let totalCash = 0, totalQris = 0, totalTransfer = 0;
        let totalPax = 0;
        let regulerPax = 0, sekolahPax = 0;
        let totalDiskon = 0;
        let grossSubtotal = 0;

        orders.forEach(order => {
            if (order.payment_method === 'cash') totalCash += order.total_price;
            else if (order.payment_method === 'qris') totalQris += order.total_price;
            else if (order.payment_method === 'transfer') totalTransfer += order.total_price;
            
            totalPax += order.total_guests;
            grossSubtotal += order.subtotal;
            totalDiskon += order.discount_amount || 0;

            if (order.adult_price === state.prices.adult_rombongan) {
                sekolahPax += order.total_guests;
            } else {
                regulerPax += order.total_guests;
            }
        });

        // Buat file CSV mentah (langsung dikirim sebagai teks agar Make.com bisa menulisnya langsung ke file)
        const csvContent = generateCSV(orders);

        const payload = {
            kasir_name: state.currentStaff?.name || "Kasir",
            tanggal: new Date(shiftData.opened_at).toLocaleDateString('id-ID'),
            waktu_buka: new Date(shiftData.opened_at).toLocaleString('id-ID'),
            waktu_tutup: new Date(shiftData.closed_at).toLocaleString('id-ID'),
            jumlah_transaksi: orders.length,
            jumlah_pengunjung: totalPax,
            rincian_pengunjung: `Reguler: ${regulerPax} org, Sekolah/Rombongan: ${sekolahPax} org`,
            total_diskon: formatRp(totalDiskon),
            pendapatan_kotor: formatRp(grossSubtotal),
            total_cash: formatRp(totalCash),
            total_qris: formatRp(totalQris),
            total_transfer: formatRp(totalTransfer),
            sistem_total: formatRp(totalCash + totalQris + totalTransfer),
            fisik_uang: formatRp(shiftData.counted_cash),
            selisih: formatRp(shiftData.difference),
            catatan: shiftData.notes || "-",
            attachment_csv_base64: csvContent, // Diisi raw text agar Make.com langsung menulis teks CSV ke dalam file
            attachment_csv_raw: csvContent,
            attachment_filename: `Laporan_Shift_Pancoran_Waterpark_tgl_${new Date(shiftData.opened_at).toLocaleDateString('id-ID').replace(/\//g, '-')}.csv`
        };

        const response = await fetch(REPORT_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("Network response was not ok");
        console.log("Webhook sent successfully");
        return true;
    } catch (err) {
        console.error("Failed to send webhook:", err);
        return false;
    }
}

// ================================================================
// Closing Shift
// ================================================================
async function showClosingScreen() {
    const orders = await db.orders.where({ shift_id: state.currentShift.id }).toArray();

    let totalCash = 0, totalQris = 0, totalTransfer = 0;
    orders.forEach(order => {
        if (order.payment_method === 'cash') totalCash += order.total_price;
        else if (order.payment_method === 'qris') totalQris += order.total_price;
        else if (order.payment_method === 'transfer') totalTransfer += order.total_price;
    });

    document.getElementById('close-total-orders').textContent = orders.length;
    document.getElementById('close-system-cash').textContent = formatRp(totalCash);
    document.getElementById('close-system-qris').textContent = formatRp(totalQris);
    document.getElementById('close-system-transfer').textContent = formatRp(totalTransfer);

    state.currentShift.system_cash = totalCash;
    state.currentShift.system_qris = totalQris;
    state.currentShift.system_transfer = totalTransfer;

    const countedInput = document.getElementById('counted-cash');
    countedInput.value = '';
    countedInput.addEventListener('input', updateDifference);
    updateDifference();

    showScreen('closing');
}

function updateDifference() {
    const countedCash = parseInt(document.getElementById('counted-cash').value) || 0;
    const systemCash = state.currentShift.system_cash;
    const diff = countedCash - systemCash;
    const diffSpan = document.getElementById('close-difference');

    if (diff === 0) { diffSpan.className = 'neutral'; diffSpan.textContent = 'Rp 0 (Pas)'; }
    else if (diff > 0) { diffSpan.className = 'positive'; diffSpan.textContent = `+ ${formatRp(diff)} (Lebih)`; }
    else { diffSpan.className = 'negative'; diffSpan.textContent = `- ${formatRp(Math.abs(diff))} (Kurang)`; }
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

        if (navigator.onLine && window.supabaseInstance) {
            const shiftData = await db.shifts.get(state.currentShift.id);
            const cleanShiftData = { ...shiftData };
            delete cleanShiftData.is_synced; // Remove local-only field before sending to Supabase
            await window.supabaseInstance.from('shifts').upsert([cleanShiftData]);
        }

        // --- KIRIM REPORT KE WEBHOOK ---
        const btnConfirm = document.getElementById('confirm-closing-btn');
        const originalText = btnConfirm.textContent;
        btnConfirm.textContent = 'Mengirim Data ke Server...';
        btnConfirm.disabled = true;

        const shiftDataUpdated = await db.shifts.get(state.currentShift.id);
        const webhookSent = await sendClosingReportWebhook(shiftDataUpdated);

        btnConfirm.textContent = originalText;
        btnConfirm.disabled = false;

        if (webhookSent) {
            alert("Shift berhasil ditutup dan Data Laporan terkirim!");
        } else {
            alert("Shift ditutup, namun GAGAL mengirim laporan ke server. Harap pastikan koneksi/URL Webhook benar.");
        }

        // Panggil print Z-Report setelah penutupan shift berhasil
        await printZReport(shiftDataUpdated);

        state.currentStaff = null;
        state.currentShift = null;
        showScreen('login');
    } catch (err) {
        console.error("Error closing shift:", err);
        alert("Gagal menutup shift: " + err.message);
    }
}

// ================================================================
// Bootstrap
// ================================================================
window.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// ================================================================
// Print Queue Notification Toast
// ================================================================
function showPrintQueueNotice(orderNum) {
    const existing = document.getElementById('print-queue-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'print-queue-toast';
    toast.innerHTML = `
        <span style="font-size:20px">🖨</span>
        <div>
            <strong>Antrian Cetak Dikirim</strong>
            <div style="font-size:12px;opacity:0.85;margin-top:2px">${orderNum} — PC printer akan mencetak otomatis</div>
        </div>
    `;
    toast.style.cssText = `
        position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
        background:#0f172a; color:white; padding:14px 20px; border-radius:12px;
        display:flex; align-items:center; gap:12px; box-shadow:0 8px 24px rgba(0,0,0,0.3);
        z-index:9999; font-family:inherit; min-width:300px;
        animation:toastSlideUp 0.3s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `@keyframes toastSlideUp { from { transform:translateX(-50%) translateY(20px); opacity:0; } to { transform:translateX(-50%) translateY(0); opacity:1; } }`;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
