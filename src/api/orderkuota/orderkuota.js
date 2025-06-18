const axios = require('axios');
const fs = require('fs');
const crypto = require("crypto");
const FormData = require('form-data');
const QRCode = require('qrcode');
const { ImageUploadService } = require('node-upload-images');

// Improved transaction status tracking
const transactionStore = new Map();

function convertCRC16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return ("000" + (crc & 0xFFFF).toString(16).toUpperCase()).slice(-4);
}

function generateTransactionId() {
    const txId = crypto.randomBytes(5).toString('hex').toUpperCase();
    transactionStore.set(txId, {
        status: 'pending',
        createdAt: new Date()
    });
    return txId;
}

function generateExpirationTime() {
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 30);
    return expirationTime;
}

async function elxyzFile(buffer) {
    try {
        const service = new ImageUploadService('pixhost.to');
        const { directLink } = await service.uploadFromBinary(buffer, 'qris.png');
        return directLink;
    } catch (error) {
        console.error('🚫 Upload Failed:', error);
        throw error;
    }
}

async function createQRIS(amount, codeqr) {
    try {
        let qrisData = codeqr;
        qrisData = qrisData.slice(0, -4);
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        amount = amount.toString();
        let uang = "54" + ("0" + amount.length).slice(-2) + amount + "5802ID";

        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);
        const buffer = await QRCode.toBuffer(result);
        const uploadedFile = await elxyzFile(buffer);

        const txId = generateTransactionId();
        
        return {
            idtransaksi: txId,
            jumlah: amount,
            expired: generateExpirationTime(),
            imageqris: { url: uploadedFile },
            status_url: `/orderkuota/cekstatus/${txId}` // Added direct status check URL
        };
    } catch (error) {
        console.error('Error generate QRIS:', error);
        throw error;
    }
}

// Enhanced status checking with transaction caching
async function checkPaymentStatus(merchant, keyorkut, txId = null) {
    try {
        const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
        const response = await axios.get(apiUrl);
        const transactions = response.data?.data || [];

        if (txId) {
            // Check specific transaction
            const txData = transactionStore.get(txId);
            if (!txData) {
                return { status: 'error', message: 'Transaction not found' };
            }

            const foundTx = transactions.find(tx => 
                tx.amount === txData.amount && 
                new Date(tx.timestamp) > txData.createdAt
            );

            if (foundTx) {
                // Update transaction status
                transactionStore.set(txId, {
                    ...txData,
                    status: 'completed',
                    completedAt: new Date(),
                    reference: foundTx.reference_id
                });
                return { 
                    status: 'completed',
                    data: foundTx,
                    transaction_id: txId
                };
            }

            return {
                status: txData.status,
                transaction_id: txId,
                expired: txData.expired,
                amount: txData.amount
            };
        }

        // Return all recent transactions if no txId specified
        return {
            status: 'success',
            count: transactions.length,
            transactions
        };
    } catch (error) {
        console.error('Error checking payment status:', error);
        throw error;
    }
}

module.exports = function(app) {

    app.get('/orderkuota/createpayment', async (req, res) => {
        const { apikey, amount, codeqr } = req.query;
        if (!global.apikey.includes(apikey)) return res.json({ status: false, message: "Apikey tidak valid." });
        if (!amount || !codeqr) return res.status(400).json({ status: false, message: "Amount dan codeqr diperlukan." });

        try {
            const qrData = await createQRIS(amount, codeqr);
            
            // Store transaction details
            transactionStore.set(qrData.idtransaksi, {
                amount: qrData.jumlah,
                status: 'pending',
                createdAt: new Date(),
                expired: qrData.expired
            });

            res.status(200).json({ 
                status: true, 
                result: qrData,
                instructions: "Gunakan QR code di atas untuk pembayaran. Anda bisa cek status dengan ID transaksi: " + qrData.idtransaksi
            });
        } catch (error) {
            res.status(500).json({ status: false, error: error.message });
        }
    });

    // Enhanced status check endpoint
    app.get('/orderkuota/cekstatus/:txId', async (req, res) => {
        const { merchant, keyorkut, apikey } = req.query;
        const { txId } = req.params;
        
        if (!global.apikey.includes(apikey)) return res.json({ status: false, message: "Apikey tidak valid." });

        try {
            const status = await checkPaymentStatus(merchant, keyorkut, txId);
            
            if (status.status === 'completed') {
                res.status(200).json({
                    status: true,
                    payment_status: 'completed',
                    transaction_id: txId,
                    payment_data: status.data,
                    message: "Pembayaran berhasil diterima"
                });
            } else if (status.status === 'pending') {
                res.status(200).json({
                    status: true,
                    payment_status: 'pending',
                    transaction_id: txId,
                    expired: status.expired,
                    message: "Menunggu pembayaran"
                });
            } else {
                res.status(404).json({
                    status: false,
                    message: "Transaksi tidak ditemukan atau sudah kadaluarsa"
                });
            }
        } catch (error) {
            console.error('Error cekstatus:', error);
            res.status(500).json({ status: false, error: error.message });
        }
    });

    // Batch status check
    app.get('/orderkuota/cekstatus', async (req, res) => {
        const { merchant, keyorkut, apikey } = req.query;
        if (!global.apikey.includes(apikey)) return res.json({ status: false, message: "Apikey tidak valid." });

        try {
            const status = await checkPaymentStatus(merchant, keyorkut);
            res.status(200).json({ status: true, result: status });
        } catch (error) {
            console.error('Error cekstatus:', error);
            res.status(500).json({ status: false, error: error.message });
        }
    });

    app.get('/orderkuota/ceksaldo', async (req, res) => {
        const { merchant, keyorkut, apikey } = req.query;
        if (!global.apikey.includes(apikey)) return res.json({ status: false, message: "Apikey tidak valid." });

        try {
            const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
            const response = await axios.get(apiUrl);
            const result = response.data;

            const latestTransaction = result?.data?.[0];
            if (latestTransaction) {
                res.status(200).json({
                    status: true,
                    result: { 
                        saldo_qris: latestTransaction.balance || "Tidak diketahui",
                        last_updated: new Date().toISOString()
                    }
                });
            } else {
                res.status(200).json({ 
                    status: false, 
                    message: "No transactions found.",
                    result: { saldo_qris: 0 }
                });
            }
        } catch (error) {
            console.error('Error ceksaldo:', error);
            res.status(500).json({ status: false, error: error.message });
        }
    });

    // New endpoint to get transaction history
    app.get('/orderkuota/history', async (req, res) => {
        const { merchant, keyorkut, apikey, limit = 10 } = req.query;
        if (!global.apikey.includes(apikey)) return res.json({ status: false, message: "Apikey tidak valid." });

        try {
            const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}?limit=${limit}`;
            const response = await axios.get(apiUrl);
            const result = response.data;

            res.status(200).json({
                status: true,
                count: result.data?.length || 0,
                transactions: result.data || []
            });
        } catch (error) {
            console.error('Error getting history:', error);
            res.status(500).json({ status: false, error: error.message });
        }
    });
};
