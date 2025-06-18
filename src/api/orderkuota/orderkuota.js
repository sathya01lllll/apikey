const express = require('express');
const axios = require('axios');
const fs = require('fs');
const crypto = require("crypto");
const QRCode = require('qrcode');
const { ImageUploadService } = require('node-upload-images');

const app = express();
const PORT = 3000;

// Telegram Bot Config
const botToken = '7252598042:AAGJxClzLIlAsfTm3fs6o16fwxNDBWur12Q';
const chatId = '1498401058';

// Global API Key
global.apikey = ['new2026']; // ganti sesuai key Anda

// Notifikasi via Telegram
async function sendTelegramNotification(text) {
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text,
            parse_mode: "Markdown"
        });
    } catch (err) {
        console.error('Telegram Error:', err.response?.data || err.message);
    }
}

// QRIS Helper
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
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function generateExpirationTime() {
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 30);
    return expirationTime;
}

async function elxyzFile(buffer) {
    const service = new ImageUploadService('pixhost.to');
    const { directLink } = await service.uploadFromBinary(buffer, 'qris.png');
    return directLink;
}

async function createQRIS(amount, codeqr) {
    codeqr = codeqr.slice(0, -4);
    const step1 = codeqr.replace("010211", "010212");
    const step2 = step1.split("5802ID");
    const uang = "54" + ("0" + amount.length).slice(-2) + amount + "5802ID";
    const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);
    const buffer = await QRCode.toBuffer(result);
    const uploadedFile = await elxyzFile(buffer);

    return {
        idtransaksi: generateTransactionId(),
        jumlah: amount,
        expired: generateExpirationTime(),
        imageqris: { url: uploadedFile }
    };
}

// ROUTES
app.get('/orderkuota/createpayment', async (req, res) => {
    const { apikey, amount, codeqr } = req.query;
    if (!global.apikey.includes(apikey)) return res.json({ status: false, message: "Apikey tidak valid." });
    try {
        const qrData = await createQRIS(amount, codeqr);
        res.status(200).json({ status: true, result: qrData });
    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});

app.get('/orderkuota/cekstatus', async (req, res) => {
    const { merchant, keyorkut, apikey } = req.query;
    if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");
    try {
        const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
        const { data } = await axios.get(apiUrl);
        const latest = data.data?.[0] || null;
        if (latest) {
            res.status(200).json({ status: true, creator: "sathyastore", result: latest });
        } else {
            res.json({ message: "No transactions found." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/orderkuota/ceksaldo', async (req, res) => {
    const { merchant, keyorkut, apikey } = req.query;
    if (!global.apikey.includes(apikey)) return res.json("Apikey tidak valid.");
    try {
        const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
        const { data } = await axios.get(apiUrl);
        const latest = data.data?.[0] || null;
        if (latest) {
            res.status(200).json({ status: true, result: { saldo_qris: latest.balance } });
        } else {
            res.json({ message: "No transactions found." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ Cek Mutasi Setiap 10 Detik
let lastTxId = null;

setInterval(async () => {
    try {
        const merchant = "OK1736896";
        const keyorkut = "730592217190613531736896OKCT38A92991B103BA13AAE2DF0A0839A8AA";
        const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
        const { data } = await axios.get(apiUrl);
        const tx = data.data?.[0];
        if (tx && tx.issuer_reff !== lastTxId) {
            lastTxId = tx.issuer_reff;
            const msg = `*✅ PEMBAYARAN QRIS BERHASIL*\n\n*Tanggal:* ${tx.date}\n*Nominal:* Rp ${tx.amount}\n*Via:* ${tx.brand_name}\n*Ref:* ${tx.issuer_reff}`;
            console.log('[NOTIF] New Transaction Detected');
            await sendTelegramNotification(msg);
        }
    } catch (err) {
        console.error('AutoCheck Error:', err.message);
    }
}, 10000); // setiap 10 detik

// START SERVER
app.listen(PORT, () => {
    console.log(`⚡ Server ready on http://localhost:${PORT}`);
});
