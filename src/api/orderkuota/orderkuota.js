
const axios = require('axios');
const crypto = require("crypto");
const QRCode = require('qrcode');
const { ImageUploadService } = require('node-upload-images');

function convertCRC16(str) {
    let crc = 0xFFFF;
    const strlen = str.length;

    for (let c = 0; c < strlen; c++) {
        crc ^= str.charCodeAt(c) << 8;

        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }

    let hex = crc & 0xFFFF;
    hex = ("000" + hex.toString(16).toUpperCase()).slice(-4);
    return hex;
}

function generateTransactionId() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function generateExpirationTime() {
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 30);
    return expirationTime;
}

async function elxyzFile(buffer) {
    return new Promise(async (resolve, reject) => {
        try {
            const service = new ImageUploadService('pixhost.to');
            let { directLink } = await service.uploadFromBinary(buffer, 'qris.png');
            resolve(directLink);
        } catch (error) {
            console.error('🚫 Upload Failed:', error);
            reject(error);
        }
    });
}

async function createQRIS(amount, codeqr) {
    try {
        let qrisData = codeqr;

        qrisData = qrisData.slice(0, -4); // Remove CRC
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        amount = amount.toString();
        let uang = "54" + ("0" + amount.length).slice(-2) + amount;
        uang += "5802ID";

        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

        const buffer = await QRCode.toBuffer(result);
        const uploadedFile = await elxyzFile(buffer);

        return {
            idtransaksi: generateTransactionId(),
            jumlah: amount,
            expired: generateExpirationTime(),
            imageqris: {
                url: uploadedFile
            }
        };
    } catch (error) {
        console.error('Error generating and uploading QR code:', error);
        throw error;
    }
}

async function checkQRISStatus(merchant, keyorkut) {
    try {
        const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
        const response = await axios.get(apiUrl);
        const result = response.data;

        const latestTransaction = result.data && result.data.length > 0 ? result.data[0] : null;
        return latestTransaction;
    } catch (error) {
        throw error;
    }
}

module.exports = function(app) {

    // 🔸 QRIS Order Kuota Create Payment
    app.get('/orderkuota/createpayment', async (req, res) => {
        const { apikey, amount, codeqr } = req.query;
        if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");

        try {
            const qrData = await createQRIS(amount, codeqr);
            res.status(200).json({
                status: true,
                result: qrData
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 🔸 QRIS Order Kuota Cek Status
    app.get('/orderkuota/cekstatus', async (req, res) => {
        const { merchant, keyorkut, apikey } = req.query;
        if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");

        try {
            const latestTransaction = await checkQRISStatus(merchant, keyorkut);
            if (latestTransaction) {
                res.status(200).json({
                    status: true,
                    result: latestTransaction
                });
            } else {
                res.json({ message: "No transactions found." });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 🔸 QRIS Order Kuota Cek Saldo
    app.get('/orderkuota/ceksaldo', async (req, res) => {
        const { merchant, keyorkut, apikey } = req.query;
        if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");

        try {
            const latestTransaction = await checkQRISStatus(merchant, keyorkut);
            if (latestTransaction) {
                res.status(200).json({
                    status: true,
                    result: {
                        saldo_qris: latestTransaction.balance
                    }
                });
            } else {
                res.json({ message: "No transactions found." });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ✅ QRIS Global: Create QRIS (tambahan)
    app.get('/createQRIS', async (req, res) => {
        const { apikey, amount, codeqr } = req.query;
        if (!global.apikey.includes(apikey)) return res.json({ status: false, message: "Apikey tidak valid." });

        if (!amount || !codeqr) {
            return res.status(400).json({
                status: false,
                message: "Parameter 'amount' dan 'codeqr' wajib diisi"
            });
        }

        try {
            const qrData = await createQRIS(amount, codeqr);
            res.status(200).json({
                status: true,
                message: "QRIS berhasil dibuat",
                result: qrData
            });
        } catch (error) {
            res.status(500).json({
                status: false,
                message: "Gagal membuat QRIS",
                error: error.message
            });
        }
    });
};
