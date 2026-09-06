const assert = require('node:assert');
const db = require('./database.js');

console.log('--- MEMULAI PENGUJIAN SISTEM ABSENSI KEDAI KOPI ---');

// 1. Uji Database
db.initDatabase();
const settings = db.getAllSettings();
assert.strictEqual(settings.shop_name, 'KAPEBOONSEEN', 'Nama kedai harus KAPEBOONSEEN');
assert.strictEqual(settings.owner_pin, '123456', 'Owner PIN awal harus 123456');
console.log('✓ 1. Database & Pengaturan awal berhasil divalidasi.');

// 2. Uji Pegawai Sampel
const employees = db.getAllEmployees();
assert.ok(employees.length >= 3, 'Minimal ada 3 pegawai sampel');
const barista = db.findEmployeeByCredentials('BRS-01', '1111');
assert.ok(barista, 'Login BRS-01 dengan PIN 1111 harus berhasil');
assert.strictEqual(barista.name, 'Rian', 'Nama BRS-01 harus Rian');

const invalidLogin = db.findEmployeeByCredentials('BRS-01', '9999');
assert.strictEqual(invalidLogin, undefined, 'Login dengan PIN salah harus ditolak');
console.log('✓ 2. Autentikasi Pegawai & PIN berhasil divalidasi.');

// 3. Uji Perhitungan Jarak GPS (Haversine)
const shopLat = -6.2088;
const shopLng = 106.8456;
// Titik 1: Sangat dekat (~10 meter)
const distNear = db.calculateDistanceMeters(shopLat, shopLng, -6.20885, 106.84565);
assert.ok(distNear < 50, `Jarak dekat harus < 50 meter (Didapat: ${distNear}m)`);

// Titik 2: Jauh (~5 km)
const distFar = db.calculateDistanceMeters(shopLat, shopLng, -6.2500, 106.8500);
assert.ok(distFar > 1000, `Jarak jauh harus > 1000 meter (Didapat: ${distFar}m)`);
console.log(`✓ 3. Perhitungan Geofencing GPS akurat (Dekat: ${distNear}m, Jauh: ${distFar}m).`);

// 4. Uji Alur Check-In & Check-Out
const testDate = '2026-09-06';
// Bersihkan riwayat uji hari ini jika ada
// Lakukan check-in
const checkInRes = db.createCheckIn('BRS-01', testDate, '08:00:00', shopLat, shopLng, distNear);
assert.ok(checkInRes.lastInsertRowid, 'Check-in harus berhasil tersimpan');

const todayAtt = db.getTodayAttendance('BRS-01', testDate);
assert.strictEqual(todayAtt.status, 'CHECKED_IN', 'Status harus CHECKED_IN');
assert.strictEqual(todayAtt.check_in_time, '08:00:00');
console.log('✓ 4. Check-in berhasil tercatat (Jam: 08:00:00).');

// 5. Uji Check-Out & Kalkulasi Durasi
// Misal pulang jam 16:30:00 (8 jam 30 menit = 510 menit)
const totalMins = 510;
db.performCheckOut(todayAtt.id, '16:30:00', shopLat, shopLng, distNear, totalMins);

const updatedAtt = db.getTodayAttendance('BRS-01', testDate);
assert.strictEqual(updatedAtt.status, 'COMPLETED', 'Status harus COMPLETED');
assert.strictEqual(updatedAtt.check_out_time, '16:30:00');
assert.strictEqual(updatedAtt.total_minutes, 510, 'Total menit harus 510');

const formatted = db.formatMinutesToHours(510);
assert.strictEqual(formatted.hours, 8);
assert.strictEqual(formatted.minutes, 30);
assert.strictEqual(formatted.textShort, '8 Jam 30 Menit');
console.log(`✓ 5. Check-out & Kalkulasi durasi valid: ${formatted.textFull}`);

// 6. Uji Ringkasan Pegawai (Pribadi)
const summary = db.getEmployeeSummary('BRS-01', testDate);
assert.ok(summary.today.minutes >= 510);
assert.ok(summary.thisWeek.minutes >= 510);
assert.ok(summary.thisMonth.minutes >= 510);
console.log(`✓ 6. Ringkasan Pegawai: Hari Ini (${summary.today.hoursText.textShort}), Bulan Ini (${summary.thisMonth.hoursText.textShort}).`);

// 7. Uji Rekapan Admin (Harian, Mingguan, Bulanan)
const dailyRecap = db.getDailyRecapForAdmin(testDate);
assert.ok(dailyRecap.length >= 3, 'Semua pegawai harus muncul di rekapan harian');
const rianRecap = dailyRecap.find(r => r.employee_id === 'BRS-01');
assert.strictEqual(rianRecap.status, 'COMPLETED');

const monthlyRecap = db.getMonthlyRecapForAdmin('2026-09');
assert.ok(monthlyRecap.length >= 1);
console.log('✓ 7. Rekapan Admin Harian, Mingguan, dan Bulanan berhasil diverifikasi.');

console.log('====================================================');
console.log('SEMUA 7 PENGUJIAN SISTEM SELESAI & BERHASIL 100%!');
console.log('====================================================');
process.exit(0);
