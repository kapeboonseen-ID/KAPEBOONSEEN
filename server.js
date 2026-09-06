const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const os = require('node:os');
const db = require('./database.js');
const tunnel = require('./tunnel.js');

// Inisialisasi database SQLite
db.initDatabase();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Helper parsing JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    if (req.body && typeof req.body === 'string') {
      try {
        return resolve(JSON.parse(req.body));
      } catch (err) {
        return resolve({});
      }
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Batasi ukuran request agar aman (max 1MB)
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper kirim JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-owner-pin'
  });
  res.end(JSON.stringify(data));
}

// Verifikasi akses Owner via Header x-owner-pin
function isOwnerAuthorized(req) {
  const pinHeader = req.headers['x-owner-pin'];
  const settings = db.getAllSettings();
  return pinHeader && pinHeader === settings.owner_pin;
}

// Request Handler Utama
async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Tangani preflight CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-owner-pin'
    });
    return res.end();
  }

  // ===================== API ROUTES =====================
  if (pathname.startsWith('/api/')) {
    try {
      // 0. Info Server & Tautan Barcode HP (WiFi / Cloudflare HTTPS)
      if (pathname === '/api/server-info' && method === 'GET') {
        const ips = getLocalIpAddresses();
        let tunnelUrl = null;
        const tunnelFile = path.join(__dirname, 'tunnel.url');
        if (fs.existsSync(tunnelFile)) {
          try { tunnelUrl = fs.readFileSync(tunnelFile, 'utf8').trim(); } catch (e) {}
        }
        const localUrl = ips.length > 0 ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`;
        const activeUrl = tunnelUrl || localUrl;
        return sendJson(res, 200, {
          success: true,
          port: PORT,
          local_ip: ips.length > 0 ? ips[0] : 'localhost',
          local_url: localUrl,
          tunnel_url: tunnelUrl,
          active_url: activeUrl,
          is_https: !!tunnelUrl
        });
      }

      // 1. Publik: Dapatkan Info Pengaturan Kedai & Titik GPS
      if (pathname === '/api/settings/public' && method === 'GET') {
        const settings = db.getAllSettings();
        return sendJson(res, 200, {
          shop_name: settings.shop_name,
          latitude: parseFloat(settings.latitude) || -6.2088,
          longitude: parseFloat(settings.longitude) || 106.8456,
          radius_meters: parseInt(settings.radius_meters, 10) || 50,
          gps_enforced: settings.gps_enforced === '1'
        });
      }

      // 2. Login (Pegawai atau Owner)
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { employee_id, pin } = await parseJsonBody(req);
        if (!employee_id || !pin) {
          return sendJson(res, 400, { success: false, message: 'ID dan PIN harus diisi!' });
        }

        const settings = db.getAllSettings();
        // Cek jika login sebagai Owner
        if (employee_id.trim().toUpperCase() === 'OWNER' && pin.trim() === settings.owner_pin) {
          return sendJson(res, 200, {
            success: true,
            role: 'owner',
            user: { employee_id: 'OWNER', name: 'Pemilik Kedai', role: 'Owner' }
          });
        }

        // Cek login Pegawai
        const emp = db.findEmployeeByCredentials(employee_id.trim(), pin.trim());
        if (emp) {
          return sendJson(res, 200, {
            success: true,
            role: 'crew',
            user: emp
          });
        }

        return sendJson(res, 401, {
          success: false,
          message: 'ID Pegawai atau PIN salah! Silakan tanyakan PIN ke Owner jika lupa.'
        });
      }

      // 3. Status Absensi Hari Ini untuk Pegawai
      if (pathname === '/api/attendance/status' && method === 'POST') {
        const { employee_id, date } = await parseJsonBody(req);
        if (!employee_id || !date) {
          return sendJson(res, 400, { success: false, message: 'Parameter tidak lengkap' });
        }
        const todayRecord = db.getTodayAttendance(employee_id, date);
        const summary = db.getEmployeeSummary(employee_id, date);
        return sendJson(res, 200, {
          success: true,
          record: todayRecord || null,
          summary
        });
      }

      // 4. CHECK IN Pegawai
      if (pathname === '/api/attendance/check-in' && method === 'POST') {
        const { employee_id, pin, lat, lng, date, time } = await parseJsonBody(req);

        // Validasi identitas pegawai
        const emp = db.findEmployeeByCredentials(employee_id, pin);
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'Autentikasi gagal. PIN atau ID salah.' });
        }

        // Cek apakah sudah pernah check-in hari ini
        const existing = db.getTodayAttendance(employee_id, date);
        if (existing) {
          return sendJson(res, 400, {
            success: false,
            message: `Anda sudah melakukan check-in hari ini pada pukul ${existing.check_in_time}. Check-in hanya bisa dilakukan 1x per hari.`
          });
        }

        // Validasi Lokasi GPS Kedai
        const settings = db.getAllSettings();
        const shopLat = parseFloat(settings.latitude);
        const shopLng = parseFloat(settings.longitude);
        const radiusMeters = parseInt(settings.radius_meters, 10) || 50;
        const gpsEnforced = settings.gps_enforced === '1';

        let distance = 0;
        if (lat !== undefined && lng !== undefined) {
          distance = db.calculateDistanceMeters(lat, lng, shopLat, shopLng);
        }

        // Jika GPS wajib dan pegawai di luar radius
        if (gpsEnforced) {
          if (lat === undefined || lng === undefined) {
            return sendJson(res, 400, {
              success: false,
              message: 'Gagal mendeteksi lokasi GPS Anda. Pastikan GPS HP aktif dan Anda memberikan izin lokasi ke browser.'
            });
          }

          if (distance > radiusMeters) {
            return sendJson(res, 403, {
              success: false,
              message: `Anda berada di luar area kedai kopi! Jarak Anda saat ini: ${distance} meter (Batas toleransi: ${radiusMeters} meter). Silakan mendekat ke area kedai/meja barcode.`
            });
          }
        }

        // Catat Check-in
        db.createCheckIn(employee_id, date, time, lat || null, lng || null, distance);

        return sendJson(res, 200, {
          success: true,
          message: `Check-in berhasil! Jam masuk Anda: ${time}. Selamat bertugas!`,
          time,
          distance
        });
      }

      // 5. CHECK OUT Pegawai
      if (pathname === '/api/attendance/check-out' && method === 'POST') {
        const { employee_id, pin, lat, lng, date, time } = await parseJsonBody(req);

        // Validasi identitas pegawai
        const emp = db.findEmployeeByCredentials(employee_id, pin);
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'Autentikasi gagal. PIN atau ID salah.' });
        }

        // Ambil absensi hari ini
        const record = db.getTodayAttendance(employee_id, date);
        if (!record) {
          return sendJson(res, 400, {
            success: false,
            message: 'Belum ada catatan Check-In hari ini. Anda harus Check-In terlebih dahulu.'
          });
        }

        if (record.status === 'COMPLETED') {
          return sendJson(res, 400, {
            success: false,
            message: `Anda sudah melakukan Check-Out hari ini pada pukul ${record.check_out_time}.`
          });
        }

        // Hitung total durasi kerja hari ini dalam menit
        const [hIn, mIn] = record.check_in_time.split(':').map(Number);
        const [hOut, mOut] = time.split(':').map(Number);
        let totalMinutes = (hOut * 60 + mOut) - (hIn * 60 + mIn);
        if (totalMinutes < 0) totalMinutes = 0; // proteksi jika shift melewati tengah malam

        // Hitung jarak saat check out jika ada koordinat
        const settings = db.getAllSettings();
        let distance = 0;
        if (lat !== undefined && lng !== undefined) {
          distance = db.calculateDistanceMeters(lat, lng, parseFloat(settings.latitude), parseFloat(settings.longitude));
        }

        db.performCheckOut(record.id, time, lat || null, lng || null, distance, totalMinutes);

        const durationInfo = db.formatMinutesToHours(totalMinutes);

        return sendJson(res, 200, {
          success: true,
          message: `Check-Out berhasil pada pukul ${time}! Total waktu kerja Anda hari ini: ${durationInfo.textShort}. Terima kasih atas kerja keras Anda!`,
          duration: durationInfo
        });
      }

      // 5b. Ganti PIN Akun Pribadi Pegawai
      if (pathname === '/api/attendance/change-pin' && method === 'POST') {
        const { employee_id, old_pin, new_pin } = await parseJsonBody(req);
        if (!employee_id || !old_pin || !new_pin) {
          return sendJson(res, 400, { success: false, message: 'Semua kolom wajib diisi!' });
        }
        if (new_pin.trim().length < 4) {
          return sendJson(res, 400, { success: false, message: 'PIN baru minimal harus 4 digit angka/karakter!' });
        }
        const emp = db.findEmployeeByCredentials(employee_id, old_pin.trim());
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'PIN lama Anda tidak cocok! Silakan coba lagi.' });
        }
        db.updateEmployeePin(employee_id, new_pin.trim());
        return sendJson(res, 200, { success: true, message: 'PIN pribadi Anda berhasil diubah! Gunakan PIN baru ini untuk login berikutnya.' });
      }

      // 6. Ringkasan Pribadi Pegawai (Harian, Mingguan, Bulanan)
      if (pathname === '/api/attendance/my-summary' && method === 'GET') {
        const empId = parsedUrl.query.employee_id;
        const dateStr = parsedUrl.query.date || new Date().toISOString().split('T')[0];
        if (!empId) {
          return sendJson(res, 400, { success: false, message: 'employee_id dibutuhkan' });
        }
        const summary = db.getEmployeeSummary(empId, dateStr);
        return sendJson(res, 200, { success: true, summary });
      }

      // ===================== OWNER / ADMIN ROUTES =====================
      // 7. Owner: Verifikasi PIN Owner
      if (pathname === '/api/admin/verify' && method === 'POST') {
        const { pin } = await parseJsonBody(req);
        const settings = db.getAllSettings();
        if (pin === settings.owner_pin) {
          return sendJson(res, 200, { success: true });
        }
        return sendJson(res, 401, { success: false, message: 'PIN Owner salah!' });
      }

      // 8. Owner: Rekapan Harian
      if (pathname === '/api/admin/recap/daily' && method === 'GET') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const dateStr = parsedUrl.query.date || new Date().toISOString().split('T')[0];
        const recap = db.getDailyRecapForAdmin(dateStr);
        return sendJson(res, 200, { success: true, date: dateStr, recap });
      }

      // 9. Owner: Rekapan Mingguan
      if (pathname === '/api/admin/recap/weekly' && method === 'GET') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const start = parsedUrl.query.start;
        const end = parsedUrl.query.end;
        if (!start || !end) {
          return sendJson(res, 400, { success: false, message: 'Tanggal awal dan akhir harus diisi' });
        }
        const recap = db.getWeeklyRecapForAdmin(start, end);
        return sendJson(res, 200, { success: true, start, end, recap });
      }

      // 10. Owner: Rekapan Bulanan
      if (pathname === '/api/admin/recap/monthly' && method === 'GET') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const month = parsedUrl.query.month || new Date().toISOString().substring(0, 7);
        const recap = db.getMonthlyRecapForAdmin(month);
        return sendJson(res, 200, { success: true, month, recap });
      }

      // 11. Owner: Kelola Data Pegawai
      if (pathname === '/api/admin/employees' && method === 'GET') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const includeInactive = parsedUrl.query.all === '1';
        const employees = db.getAllEmployees(includeInactive);
        return sendJson(res, 200, { success: true, employees });
      }

      if (pathname === '/api/admin/employees' && method === 'POST') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const { employee_id, name, pin, role } = await parseJsonBody(req);
        if (!employee_id || !name || !pin) {
          return sendJson(res, 400, { success: false, message: 'ID Pegawai, Nama, dan PIN wajib diisi!' });
        }
        try {
          db.addEmployee(employee_id, name, pin, role || 'Crew');
          return sendJson(res, 200, { success: true, message: 'Pegawai baru berhasil ditambahkan!' });
        } catch (err) {
          return sendJson(res, 400, { success: false, message: 'ID Pegawai sudah terdaftar atau terjadi error: ' + err.message });
        }
      }

      if (pathname.startsWith('/api/admin/employees/') && method === 'PUT') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const id = parseInt(pathname.split('/')[4], 10);
        const { employee_id, name, pin, role, is_active } = await parseJsonBody(req);
        db.updateEmployee(id, employee_id, name, pin, role, is_active !== false);
        return sendJson(res, 200, { success: true, message: 'Data pegawai berhasil diperbarui!' });
      }

      if (pathname.startsWith('/api/admin/employees/') && method === 'DELETE') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const id = parseInt(pathname.split('/')[4], 10);
        db.deleteEmployee(id);
        return sendJson(res, 200, { success: true, message: 'Pegawai berhasil dinonaktifkan!' });
      }

      // 12. Owner: Ambil & Simpan Pengaturan Kedai
      if (pathname === '/api/admin/settings' && method === 'GET') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const settings = db.getAllSettings();
        return sendJson(res, 200, { success: true, settings });
      }

      if (pathname === '/api/admin/settings' && method === 'POST') {
        if (!isOwnerAuthorized(req)) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const newSettings = await parseJsonBody(req);
        for (const [key, value] of Object.entries(newSettings)) {
          if (value !== undefined) {
            db.updateSetting(key, value);
          }
        }
        return sendJson(res, 200, { success: true, message: 'Pengaturan kedai berhasil disimpan!' });
      }

      // Jika endpoint API tidak ditemukan
      return sendJson(res, 404, { success: false, message: 'Endpoint API tidak ditemukan' });
    } catch (err) {
      console.error('API Error:', err);
      return sendJson(res, 500, { success: false, message: 'Internal Server Error: ' + err.message });
    }
  }

  // ===================== STATIC FILE SERVING =====================
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback 404
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
}

// Mendapatkan Alamat IP Komputer di Jaringan WiFi Lokal
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Hanya ambil IPv4 non-internal
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIpAddresses();
    console.log('====================================================');
    console.log('         KAPEBOONSEEN - SISTEM ABSENSI CREW         ');
    console.log('====================================================');
    console.log(`Server berhasil berjalan!`);
    console.log(`- Akses Lokal di Komputer Ini : http://localhost:${PORT}`);
    if (ips.length > 0) {
      console.log(`- Akses dari HP / WiFi Kedai : http://${ips[0]}:${PORT}`);
    }
    console.log(`- Halaman Owner / Pemilik    : http://localhost:${PORT}/owner.html`);
    console.log(`- Halaman Cetak Barcode Kedai: http://localhost:${PORT}/print-qr.html`);
    console.log('====================================================');

    // Jalankan Cloudflare Tunnel gratis untuk akses HP (HTTPS + GPS)
    tunnel.startTunnel(PORT);
  });

  process.on('SIGINT', () => {
    tunnel.stopTunnel();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    tunnel.stopTunnel();
    process.exit(0);
  });
}

module.exports = handleRequest;
