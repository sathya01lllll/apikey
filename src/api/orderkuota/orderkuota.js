const axios = require('axios');
const fs = require('fs');
const crypto = require("crypto");
const FormData = require('form-data');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const { ImageUploadService } = require('node-upload-images')

// Fungsi untuk konversi CRC16
function convertCRC16(str) {
    if (!str || typeof str !== 'string') {
        throw new Error('Input tidak valid untuk perhitungan CRC16');
    }
    
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

// Fungsi untuk membuat ID transaksi unik
function generateTransactionId() {
    return crypto.randomBytes(5).toString('hex').toUpperCase()
}

// Fungsi untuk membuat waktu kedaluwarsa (30 menit dari sekarang)
function generateExpirationTime() {
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 30);
    return expirationTime.toISOString();
}

// Fungsi untuk mengunggah file gambar
async function elxyzFile(buffer) {
    return new Promise(async (resolve, reject) => {
        try {
            const service = new ImageUploadService('pixhost.to');
            let { directLink } = await service.uploadFromBinary(buffer, 'sathya.png');
            resolve(directLink);
        } catch (error) {
            console.error('🚫 Gagal mengunggah:', error);
            reject(error);
        }
    });
}

// Fungsi untuk membuat QRIS
async function generateQRIS(jumlah) {
    try {
        if (!jumlah || isNaN(jumlah)) {
            throw new Error('Jumlah tidak valid');
        }

        let qrisData = "code qris lu";

        qrisData = qrisData.slice(0, -4);
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        jumlah = jumlah.toString();
        let uang = "54" + ("0" + jumlah.length).slice(-2) + jumlah;
        uang += "5802ID";

        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

        const buffer = await QRCode.toBuffer(result);

        const uploadedFile = await elxyzFile(buffer);

        return {
            idTransaksi: generateTransactionId(),
            jumlah: jumlah,
            waktuKedaluwarsa: generateExpirationTime(),
            urlGambarQR: uploadedFile
        };
    } catch (error) {
        console.error('Error saat membuat dan mengunggah QR code:', error);
        throw error;
    }
}

// Fungsi untuk membuat QRIS dengan kode QR khusus
async function createQRIS(jumlah, kodeQR) {
    try {
        if (!jumlah || isNaN(jumlah)) {
            throw new Error('Jumlah tidak valid');
        }
        if (!kodeQR || typeof kodeQR !== 'string') {
            throw new Error('Data QR code tidak valid');
        }

        let qrisData = kodeQR;

        qrisData = qrisData.slice(0, -4);
        const step1 = qrisData.replace("010211", "010212");
        const step2 = step1.split("5802ID");

        jumlah = jumlah.toString();
        let uang = "54" + ("0" + jumlah.length).slice(-2) + jumlah;
        uang += "5802ID";

        const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

        const buffer = await QRCode.toBuffer(result);

        const uploadedFile = await elxyzFile(buffer);

        return {
            idTransaksi: generateTransactionId(),
            jumlah: jumlah,
            kedaluwarsa: generateExpirationTime(),
            gambarQR: { 
                url: uploadedFile
            }
        };
    } catch (error) {
        console.error('Error saat membuat dan mengunggah QR code:', error);
        throw error;
    }
}

// Fungsi untuk memeriksa status QRIS (YANG DIPERBAIKI)
async function checkQRISStatus(merchant, kunciAPI) {
    try {
        if (!merchant || !kunciAPI) {
            throw new Error('Merchant dan kunci API diperlukan');
        }

        const urlAPI = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${kunciAPI}`;
        const response = await axios.get(urlAPI, {
            timeout: 10000 // Timeout 10 detik
        });
        
        if (!response.data) {
            throw new Error('Respon tidak valid dari server');
        }

        const hasil = response.data;
        const data = hasil.data || [];
        
        // Format teks untuk output
        let teksOutput = '*MUTASI QRIS*\n\n';
        
        if (data.length === 0) {
            teksOutput += 'Tidak ada data mutasi.';
        } else {
            data.forEach(transaksi => {
                teksOutput += `📅 Tanggal: ${transaksi.date || 'Tidak diketahui'}\n`;
                teksOutput += `🏦 Issuer: ${transaksi.brand_name || 'Tidak diketahui'}\n`;
                teksOutput += `💵 Nominal: Rp ${transaksi.amount || '0'}\n\n`;
            });
        }
        
        return {
            sukses: true,
            data: data,
            pesan: teksOutput
        };
    } catch (error) {
        console.error('Gagal memeriksa status QRIS:', error);
        
        // Menentukan pesan error yang lebih spesifik
        let pesanError = 'Gagal memeriksa status QRIS';
        if (error.response) {
            if (error.response.status === 404) {
                pesanError = 'Endpoint tidak ditemukan';
            } else if (error.response.status === 401) {
                pesanError = 'Autentikasi gagal, kunci API tidak valid';
            }
        } else if (error.request) {
            pesanError = 'Tidak ada respon dari server';
        }
        
        throw new Error(`${pesanError}: ${error.message}`);
    }
}

// Ekspor modul dengan endpoint API
module.exports = function(app) {
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    // Middleware untuk penanganan error
    app.use((err, req, res, next) => {
        console.error(err.stack);
        res.status(500).json({ 
            status: false,
            pesan: 'Terjadi kesalahan internal server',
            error: err.message 
        });
    });

    // Endpoint untuk membuat pembayaran
    app.get('/orderkuota/createpayment', async (req, res, next) => {
        try {
            const { apikey, jumlah, kodeqr } = req.query;
            
            if (!global.apikey || !global.apikey.includes(apikey)) {
                return res.status(401).json({
                    status: false,
                    pesan: "Kunci API tidak valid."
                });
            }
            
            if (!jumlah || !kodeqr) {
                return res.status(400).json({
                    status: false,
                    pesan: "Jumlah dan kode QR diperlukan"
                });
            }

            const dataQR = await createQRIS(jumlah, kodeqr);
            res.status(200).json({
                status: true,
                hasil: dataQR
            });      
        } catch (error) {
            next(error);
        }
    });
    
    // Endpoint untuk memeriksa status (YANG DIPERBAIKI)
    app.get('/orderkuota/cekstatus', async (req, res, next) => {
        try {
            const { merchant, kunciorkut, apikey } = req.query;
            
            if (!global.apikey || !global.apikey.includes(apikey)) {
                return res.status(401).json({
                    status: false,
                    pesan: "Kunci API tidak valid."
                });
            }
            
            if (!merchant || !kunciorkut) {
                return res.status(400).json({
                    status: false,
                    pesan: "Merchant dan kunci API QRIS diperlukan"
                });
            }

            const status = await checkQRISStatus(merchant, kunciorkut);
            
            res.status(200).json({
                status: status.sukses,
                hasil: status.data,
                pesan: status.pesan
            });
        } catch (error) {
            next(error);
        }
    });

    // Endpoint untuk memeriksa saldo
    app.get('/orderkuota/ceksaldo', async (req, res, next) => {
        try {
            const { merchant, kunciorkut, apikey } = req.query;
            
            if (!global.apikey || !global.apikey.includes(apikey)) {
                return res.status(401).json({
                    status: false,
                    pesan: "Kunci API tidak valid."
                });
            }
            
            if (!merchant || !kunciorkut) {
                return res.status(400).json({
                    status: false,
                    pesan: "Merchant dan kunci API QRIS diperlukan"
                });
            }

            const status = await checkQRISStatus(merchant, kunciorkut);
            
            // Cari saldo dari transaksi terakhir
            const saldo = status.data && status.data.length > 0 
                ? status.data[0].balance 
                : null;
            
            if (saldo !== null) {
                res.status(200).json({
                    status: true,
                    hasil: {
                        saldo_qris: saldo
                    }
                });
            } else {
                res.status(404).json({ 
                    status: false,
                    pesan: "Informasi saldo tidak ditemukan" 
                });
            }
        } catch (error) {
            next(error);
        }
    });

    // Penangan untuk endpoint yang tidak ditemukan
    app.use((req, res) => {
        res.status(404).json({
            status: false,
            pesan: "Endpoint tidak ditemukan"
        });
    });
};
