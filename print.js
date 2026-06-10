// print.js
// Handles QR Code generation and printing logic

/**
 * Generate a unique ticket code
 * Format: PW-YYYYMMDD-XXXX (e.g., PW-20260507-0042)
 */
function generateTicketCode() {
    const prefix = 'PW';
    const date = new Date();
    const dateStr = date.getFullYear() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0');

    // Generate random 4 character alphanumeric
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();

    return `${prefix}-${dateStr}-${randomStr}`;
}

/**
 * Print tickets
 * @param {Array} tickets Array of ticket objects
 * @param {String} cashierName Name of the cashier
 */
async function printTickets(tickets, cashierName) {
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = ''; // Clear previous

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];

        // Create ticket label container
        const label = document.createElement('div');
        label.className = 'ticket-label';

        const dateStr = new Date(ticket.created_at).toLocaleString('id-ID', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });

        label.innerHTML = `
            <div class="ticket-content">
                <div class="qr-wrapper">
                    <div class="qr-container"></div>
                </div>
                <div class="ticket-details">
                    <h1>PANCORAN</h1>
                    <h2>WATERPARK</h2>
                    <div class="ticket-type">${ticket.category.toUpperCase()}</div>
                    <div class="ticket-price">Rp ${ticket.price.toLocaleString('id-ID')}</div>
                    <div class="ticket-footer">
                        <div>ID: ${ticket.ticket_code}</div>
                        <div>${dateStr}</div>
                    </div>
                </div>
            </div>
        `;

        printArea.appendChild(label);

        // Generate QR Code back for audit
        const qrContainer = label.querySelector('.qr-container');
        new QRCode(qrContainer, {
            text: ticket.ticket_code,
            width: 40,
            height: 40,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    // Wait a brief moment before calling print
    return new Promise(resolve => {
        setTimeout(() => {
            window.print();
            resolve();
        }, 500);
    });
}
