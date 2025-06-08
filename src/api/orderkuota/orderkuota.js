const axios = require('axios');
const fs = require('fs');
const crypto = require("crypto");
const QRCode = require('qrcode');
const { ImageUploadService } = require('node-upload-images')

function convertCRC16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    let hex = crc & 0xFFFF;
    return ("000" + hex.toString(16).toUpperCase()).slice(-4);
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
    try {
        const service = new ImageUploadService('pixhost.to');
        const { directLink } = await service.uploadFromBinary(buffer, 'skyzo.png');
        return directLink;
    } catch (error) {
        console.error('ðŸš« Upload Failed:', error);
        throw error;
    }
}

async function createQRIS(amount, codeqr) {
    try {
        let qrisData = codeqr.slice(0, -4).replace("010211", "010212");
        const step2 = qrisData.split("5802ID");

        amount = amount.toString();
        let uang = "54" + ("0" + amount.length).slice(-2) + amount + "5802ID";
        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

        const buffer = await QRCode.toBuffer(result);
        const uploadedFile = await elxyzFile(buffer);

        return {
            transactionId: generateTransactionId(),
            amount: amount,
            expirationTime: generateExpirationTime(),
            qrImageUrl: uploadedFile,
        };
    } catch (error) {
        console.error('Error generating and uploading QR code:', error);
        throw error;
    }
}

module.exports = function(app) {
    app.get('/orderkuota/createpayment', async (req, res) => {
        const { apikey, amount, codeqr } = req.query;
        if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");

        try {
            const qrData = await createQRIS(amount, codeqr);
            res.status(200).json({ status: true, result: qrData });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/orderkuota/cekstatus', async (req, res) => {
        const { merchant, keyorkut, apikey } = req.query;
        if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");

        try {
            const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${global.merchantIdOrderKuota}/${global.apiOrderKuota}`;
            const response = await axios.get(apiUrl);
            const result = response.data;
            const latestTransaction = result.data && result.data.length > 0 ? result.data[0] : null;
            if (latestTransaction) {
                res.status(200).json({ status: true, result: latestTransaction });
            } else {
                res.json({ message: "No transactions found." });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/orderkuota/ceksaldo', async (req, res) => {
        const { merchant, keyorkut, apikey } = req.query;
        if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");

        try {
            const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
            const response = await axios.get(apiUrl);
            const result = response.data;
            const latestTransaction = result.data && result.data.length > 0 ? result.data[0] : null;
            if (latestTransaction) {
                res.status(200).json({ status: true, result: { saldo_qris: latestTransaction.balance } });
            } else {
                res.json({ message: "No transactions found." });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
};
