// sync.js
// Handles synchronization between IndexedDB and Supabase

/**
 * Check online status and update UI indicator
 */
function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    const indicator = document.querySelector('#sync-status .indicator');
    const text = document.querySelector('#sync-status').lastChild;
    
    if (isOnline) {
        indicator.className = 'indicator online';
        text.textContent = ' Online';
        // Attempt to sync when back online
        syncData();
    } else {
        indicator.className = 'indicator offline';
        text.textContent = ' Offline';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/**
 * Sync logic: Push unsynced orders and their tickets to Supabase
 */
async function syncData() {
    if (!navigator.onLine || !window.supabaseInstance) return;

    const indicator = document.querySelector('#sync-status .indicator');
    const text = document.querySelector('#sync-status').lastChild;
    
    indicator.className = 'indicator syncing';
    text.textContent = ' Syncing...';

    try {
        // 0. Sync Shifts (Force sync anything not marked as 1)
        const unsyncedShifts = await db.shifts.filter(s => s.is_synced !== 1).toArray();
        if (unsyncedShifts.length > 0) {
            for (const shift of unsyncedShifts) {
                // Explicitly pick only the columns that exist in the Supabase schema
                const cleanShiftData = {
                    id: shift.id,
                    unit_id: shift.unit_id,
                    cashier_id: shift.cashier_id,
                    opened_at: shift.opened_at,
                    closed_at: shift.closed_at || null,
                    system_cash: shift.system_cash || 0,
                    system_qris: shift.system_qris || 0,
                    system_transfer: shift.system_transfer || 0,
                    counted_cash: shift.counted_cash || null,
                    difference: shift.difference || null,
                    notes: shift.notes || null,
                    status: shift.status
                };
                
                const { error } = await window.supabaseInstance.from('shifts').upsert([cleanShiftData]);
                if (error) {
                    console.error("Shift Sync Error:", error);
                    alert(`Gagal sinkron Shift: ${error.message}\nCode: ${error.code}\nHint: ${error.hint}`);
                    throw error;
                }
                await db.shifts.update(shift.id, { is_synced: 1 });
            }
        }

        // 1. Sync Orders
        const unsyncedOrders = await db.orders.filter(o => o.is_synced !== 1).toArray();
        
        if (unsyncedOrders.length > 0) {
            for (const order of unsyncedOrders) {
                const tickets = await db.tickets.where('order_id').equals(order.id).toArray();
                
                // Explicitly pick only the columns that exist in the Supabase schema
                const cleanOrderData = {
                    id: order.id,
                    unit_id: order.unit_id,
                    shift_id: order.shift_id,
                    cashier_id: order.cashier_id,
                    order_number: order.order_number,
                    total_guests: order.total_guests,
                    adult_count: order.adult_count,
                    child_count: order.child_count,
                    free_count: order.free_count,
                    subtotal: order.subtotal,
                    discount_amount: order.discount_amount || 0,
                    total_price: order.total_price,
                    payment_method: order.payment_method,
                    visitor_source: order.visitor_source || null,
                    promo_id: order.promo_id || null,
                    created_at: order.created_at
                };
                
                const { error: orderError } = await window.supabaseInstance.from('orders').upsert([cleanOrderData], { onConflict: 'order_number' });
                
                let orderConflict = false;
                if (orderError) {
                    if (orderError.code === '23505' || orderError.status === 409) {
                        orderConflict = true; // Mark as conflict but proceed
                    } else {
                        console.error("Order Sync Error:", orderError);
                        alert(`Gagal sinkron Order: ${orderError.message}\nCode: ${orderError.code}\nDetail: ${orderError.details}`);
                        throw orderError;
                    }
                }
                
                if (tickets.length > 0 && !orderConflict) {
                    const cleanTicketsData = tickets.map(t => ({
                        id: t.id,
                        order_id: t.order_id,
                        ticket_code: t.ticket_code,
                        category: t.category,
                        price: t.price,
                        status: t.status,
                        created_at: t.created_at
                    }));

                    const { error: ticketsError } = await window.supabaseInstance.from('tickets').upsert(cleanTicketsData);
                    if (ticketsError && ticketsError.code !== '23505' && ticketsError.code !== '23503') {
                        console.error("Tickets Sync Error:", ticketsError);
                        alert(`Gagal sinkron Tiket: ${ticketsError.message}\nCode: ${ticketsError.code}`);
                        throw ticketsError;
                    }
                }
                
                await db.orders.update(order.id, { is_synced: 1 });
            }
        }
        
        indicator.className = 'indicator online';
        text.textContent = ' Online';
    } catch (error) {
        // Only log to console for minor errors to avoid annoying alerts if it's just a retry
        console.error("Global Sync error:", error);
        indicator.className = 'indicator offline';
        text.textContent = ' Sync Error';
    }
}

// Initial check
updateOnlineStatus();
// Run sync periodically (every 1 minute)
setInterval(syncData, 60000);
