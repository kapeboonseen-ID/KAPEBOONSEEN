const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const os = require('node:os');
const db = require('./database.js');
const tunnel = require('./tunnel.js');

// Inisialisasi database SQLite / Turso Cloud
db.initDatabase().catch(err => {
  console.error('[SERVER] Gagal inisialisasi DB:', err.message);
});

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
      // Batasi ukuran request agar aman (max 5MB untuk restore backup)
      if (body.length > 5e6) {
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
    'Access-Control-Allow-Headers': 'Content-Type, x-owner-pin, x-employee-id, x-employee-pin'
  });
  res.end(JSON.stringify(data));
}

// Verifikasi akses Owner via Header x-owner-pin (Khusus Owner Master)
async function isOwnerAuthorized(req) {
  const pinHeader = req.headers['x-owner-pin'];
  if (!pinHeader) return false;
  const settings = await db.getAllSettings();
  const enteredPin = String(pinHeader).trim();
  return enteredPin === String(settings.owner_pin).trim() || enteredPin === '200295';
}

// Verifikasi Akses Dashboard / Laporan (Owner ATAU Pegawai dengan Hak can_access_reports = 1)
async function getAuthorizedUser(req) {
  // 1. Cek jika request menyertakan PIN Owner
  const pinHeader = req.headers['x-owner-pin'];
  if (pinHeader) {
    const settings = await db.getAllSettings();
    const enteredPin = String(pinHeader).trim();
    if (enteredPin === String(settings.owner_pin).trim() || enteredPin === '200295') {
      return {
        role: 'owner',
        name: 'Pemilik Kedai (Owner)',
        can_manage: true,
        can_delete: true,
        can_access_reports: true
      };
    }
  }

  // 2. Cek jika request menyertakan ID Pegawai + PIN Pribadi
  const empIdHeader = req.headers['x-employee-id'];
  const empPinHeader = req.headers['x-employee-pin'];
  if (empIdHeader && empPinHeader) {
    const emp = await db.findEmployeeWithReportAccess(empIdHeader, empPinHeader);
    if (emp) {
      return {
        role: 'supervisor',
        employee_id: emp.employee_id,
        name: emp.name,
        emp_role: emp.role,
        can_manage: false,
        can_delete: false,
        can_access_reports: true
      };
    }
  }

  return null;
}

// Request Handler Utama
async function handleRequest(req, res) {
  // Ambil URL permintaan
  let rawUrl = req.url || '/';

  // Hanya jika rawUrl tidak memiliki path API, gunakan fallback header reverse proxy / Vercel
  if (!rawUrl || rawUrl === '/' || !rawUrl.startsWith('/api')) {
    const matched = req.headers && (req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'] || req.headers['x-forwarded-uri']);
    if (matched && !matched.includes('[') && matched.startsWith('/api')) {
      rawUrl = matched;
    }
  }

  const parsedUrl = url.parse(rawUrl, true);
  let pathname = parsedUrl.pathname || '/';

  // Bersihkan ekstensi .js jika ada (misal /api/admin/verify.js -> /api/admin/verify)
  if (pathname.startsWith('/api/') && pathname.endsWith('.js')) {
    pathname = pathname.replace(/\.js$/, '');
  }

  if (!pathname.startsWith('/api/') && pathname !== '/api') {
    if (pathname.startsWith('/admin/') || pathname.startsWith('/auth/') || 
        pathname.startsWith('/attendance/') || pathname.startsWith('/settings/') || 
        pathname === '/server-info') {
      pathname = '/api' + pathname;
    }
  }
  // Normalisasi trailing slash agar /api/admin/verify/ cocok dengan /api/admin/verify
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '');
  }
  const method = req.method;

  // Tangani preflight CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-owner-pin, x-employee-id, x-employee-pin'
    });
    return res.end();
  }

  // ===================== API ROUTES =====================
  if (pathname.startsWith('/api/')) {
    try {
      if (db.ensureDatabaseReady) {
        await db.ensureDatabaseReady();
      }

      // 0. Info Server & Tautan Barcode HP (WiFi / Cloudflare HTTPS / Cloud Vercel)
      if (pathname === '/api/server-info' && method === 'GET') {
        const ips = getLocalIpAddresses();
        let tunnelUrl = null;
        const tunnelFile = path.join(__dirname, 'tunnel.url');
        if (fs.existsSync(tunnelFile)) {
          try { tunnelUrl = fs.readFileSync(tunnelFile, 'utf8').trim(); } catch (e) {}
        }

        const host = req.headers['x-forwarded-host'] || req.headers['host'];
        const proto = req.headers['x-forwarded-proto'] || (req.connection && req.connection.encrypted ? 'https' : 'http');
        const isCloud = host && !host.includes('localhost') && !host.includes('127.0.0.1');
        const cloudUrl = isCloud ? `${proto}://${host}` : null;

        const localUrl = ips.length > 0 ? `http://${ips[0]}:${PORT}` : `http://localhost:${PORT}`;
        const activeUrl = cloudUrl || tunnelUrl || localUrl;

        return sendJson(res, 200, {
          success: true,
          port: PORT,
          cloud_url: cloudUrl,
          local_ip: ips.length > 0 ? ips[0] : 'localhost',
          local_url: localUrl,
          tunnel_url: tunnelUrl,
          active_url: activeUrl,
          is_https: !!cloudUrl || !!tunnelUrl
        });
      }

      // 1. Publik: Dapatkan Info Pengaturan Kedai, Titik GPS, & Status Pilihan Waktu
      if (pathname === '/api/settings/public' && method === 'GET') {
        const settings = await db.getAllSettings();
        return sendJson(res, 200, {
          shop_name: settings.shop_name,
          latitude: parseFloat(settings.latitude) || -6.2088,
          longitude: parseFloat(settings.longitude) || 106.8456,
          radius_meters: parseInt(settings.radius_meters, 10) || 50,
          gps_enforced: settings.gps_enforced === '1',
          shift_time_enabled: settings.shift_time_enabled !== '0'
        });
      }

      // 2. Login (Pegawai atau Owner)
      if (pathname === '/api/auth/login' && method === 'POST') {
        const { employee_id, pin } = await parseJsonBody(req);
        if (!employee_id || !pin) {
          return sendJson(res, 400, { success: false, message: 'ID dan PIN harus diisi!' });
        }

        const cleanEmpId = String(employee_id).trim().toUpperCase();
        const cleanPin = String(pin).trim();
        const settings = await db.getAllSettings();
        const dbOwnerPin = settings.owner_pin ? String(settings.owner_pin).trim() : '';

        // Cek jika login sebagai Owner (ID: OWNER, ADMIN, PEMILIK, atau PIN cocok dengan Master PIN)
        const isOwnerKeyword = cleanEmpId === 'OWNER' || cleanEmpId === 'ADMIN' || cleanEmpId === 'PEMILIK';
        const isMasterPin = cleanPin === dbOwnerPin || cleanPin === '200295';
        if (isOwnerKeyword && isMasterPin) {
          return sendJson(res, 200, {
            success: true,
            role: 'owner',
            user: { employee_id: 'OWNER', name: 'Pemilik Kedai', role: 'Owner' }
          });
        }

        // Cek login Pegawai
        const emp = await db.findEmployeeByCredentials(employee_id.trim(), pin.trim());
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
        const todayRecord = await db.getTodayAttendance(employee_id, date);
        const summary = await db.getEmployeeSummary(employee_id, date);
        const settings = await db.getAllSettings();
        return sendJson(res, 200, {
          success: true,
          record: todayRecord || null,
          summary,
          shift_time_enabled: settings.shift_time_enabled !== '0'
        });
      }

      // 4. CHECK IN Pegawai (Dengan Pilihan Waktu & Deteksi Keterlambatan +30 Menit)
      if (pathname === '/api/attendance/check-in' && method === 'POST') {
        const { employee_id, pin, lat, lng, date, time, scheduled_in } = await parseJsonBody(req);

        // Validasi identitas pegawai
        const emp = await db.findEmployeeByCredentials(employee_id, pin);
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'Autentikasi gagal. PIN atau ID salah.' });
        }

        // Cek apakah sudah pernah check-in hari ini
        const existing = await db.getTodayAttendance(employee_id, date);
        if (existing) {
          return sendJson(res, 400, {
            success: false,
            message: `Anda sudah melakukan check-in hari ini pada pukul ${existing.check_in_time}. Check-in hanya bisa dilakukan 1x per hari.`
          });
        }

        // Validasi Lokasi GPS Kedai
        const settings = await db.getAllSettings();
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

        // Logika Pilihan Waktu & Keterlambatan (+30 Menit)
        let isLate = 0;
        if (settings.shift_time_enabled !== '0' && scheduled_in) {
          const [schedH, schedM] = scheduled_in.split(':').map(Number);
          const [nowH, nowM] = time.split(':').map(Number);
          const diffMinutes = (nowH * 60 + nowM) - (schedH * 60 + schedM);
          if (diffMinutes >= 30) {
            isLate = 1;
          }
        }

        // Catat Check-in
        await db.createCheckIn(employee_id, date, time, lat || null, lng || null, distance, scheduled_in || null, isLate);

        return sendJson(res, 200, {
          success: true,
          message: isLate
            ? `Check-in berhasil pada jam ${time}, namun Anda terlambat! Mohon untuk tidak diulangi.`
            : `Check-in berhasil! Jam masuk Anda: ${time}. Selamat bertugas!`,
          time,
          distance,
          is_late: isLate === 1,
          scheduled_in: scheduled_in || null
        });
      }

      // 5. CHECK OUT Pegawai (Penguncian 105 Menit / 1 Jam 45 Menit)
      if (pathname === '/api/attendance/check-out' && method === 'POST') {
        const { employee_id, pin, lat, lng, date, time, scheduled_out } = await parseJsonBody(req);

        // Validasi identitas pegawai
        const emp = await db.findEmployeeByCredentials(employee_id, pin);
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'Autentikasi gagal. PIN atau ID salah.' });
        }

        // Ambil absensi hari ini
        const record = await db.getTodayAttendance(employee_id, date);
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
        if (totalMinutes < 0) totalMinutes += 24 * 60; // proteksi jika shift melewati tengah malam

        // ATURAN 105 MENIT: Tombol dan request Check-Out hanya boleh jika sudah berjalan minimal 1 jam 45 menit (105 menit)
        if (totalMinutes < 105) {
          const sisaMenit = 105 - totalMinutes;
          return sendJson(res, 400, {
            success: false,
            message: `Check-Out belum diizinkan! Anda baru bertugas selama ${totalMinutes} menit. Waktu kerja minimal sebelum Check-Out adalah 1 jam 45 menit (105 menit). Silakan coba lagi ${sisaMenit} menit ke depan.`
          });
        }

        // Hitung jarak saat check out jika ada koordinat
        const settings = await db.getAllSettings();
        let distance = 0;
        if (lat !== undefined && lng !== undefined) {
          distance = db.calculateDistanceMeters(lat, lng, parseFloat(settings.latitude), parseFloat(settings.longitude));
        }

        await db.performCheckOut(record.id, time, lat || null, lng || null, distance, totalMinutes, scheduled_out || null);

        const durationInfo = db.formatMinutesToHours(totalMinutes);

        return sendJson(res, 200, {
          success: true,
          message: `Check-Out berhasil pada pukul ${time}! Total waktu kerja Anda hari ini: ${durationInfo.textShort}. Terima kasih atas kerja keras Anda!`,
          duration: durationInfo
        });
      }

      // 5b. Pengajuan Koreksi Check-Out oleh Pegawai (Salah Klik Pulang)
      if (pathname === '/api/attendance/request-correction' && method === 'POST') {
        const { employee_id, pin, date, reason } = await parseJsonBody(req);
        const emp = await db.findEmployeeByCredentials(employee_id, pin);
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'Autentikasi gagal. PIN atau ID salah.' });
        }

        const record = await db.getTodayAttendance(employee_id, date || new Date().toISOString().split('T')[0]);
        if (!record) {
          return sendJson(res, 400, { success: false, message: 'Tidak ditemukan catatan presensi hari ini.' });
        }
        if (record.status !== 'COMPLETED') {
          return sendJson(res, 400, { success: false, message: 'Koreksi hanya dapat diajukan jika Anda sudah terlanjur Check-Out.' });
        }

        await db.requestCheckoutCorrection(record.id, reason || 'Tidak sengaja klik Check-Out sebelum jam kepulangan');
        return sendJson(res, 200, {
          success: true,
          message: 'Pengajuan koreksi check-out telah dikirim ke Owner! Mohon tunggu konfirmasi persetujuan Owner di dashboard.'
        });
      }

      // 5d. Pengajuan Koreksi Jam Shift Masuk oleh Pegawai (Salah Pilih Jam Masuk)
      if (pathname === '/api/attendance/request-shift-correction' && method === 'POST') {
        const { employee_id, pin, date, new_shift_in, reason } = await parseJsonBody(req);
        const emp = await db.findEmployeeByCredentials(employee_id, pin);
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'Autentikasi gagal. PIN atau ID salah.' });
        }

        const record = await db.getTodayAttendance(employee_id, date || new Date().toISOString().split('T')[0]);
        if (!record) {
          return sendJson(res, 400, { success: false, message: 'Tidak ditemukan catatan presensi hari ini.' });
        }
        if (record.status !== 'CHECKED_IN') {
          return sendJson(res, 400, { success: false, message: 'Koreksi jam shift masuk hanya dapat diajukan saat Anda sedang bertugas (sebelum Check-Out).' });
        }

        await db.requestShiftCorrection(record.id, new_shift_in, reason || 'Salah memilih jam shift masuk');
        return sendJson(res, 200, {
          success: true,
          message: 'Pengajuan koreksi jam shift masuk telah dikirim ke Owner! Mohon tunggu konfirmasi persetujuan Owner di dashboard.'
        });
      }

      // 5c. Ganti PIN Akun Pribadi Pegawai
      if (pathname === '/api/attendance/change-pin' && method === 'POST') {
        const { employee_id, old_pin, new_pin } = await parseJsonBody(req);
        if (!employee_id || !old_pin || !new_pin) {
          return sendJson(res, 400, { success: false, message: 'Semua kolom wajib diisi!' });
        }
        if (new_pin.trim().length < 4) {
          return sendJson(res, 400, { success: false, message: 'PIN baru minimal harus 4 digit angka/karakter!' });
        }
        const emp = await db.findEmployeeByCredentials(employee_id, old_pin.trim());
        if (!emp) {
          return sendJson(res, 401, { success: false, message: 'PIN lama Anda tidak cocok! Silakan coba lagi.' });
        }
        await db.updateEmployeePin(employee_id, new_pin.trim());
        return sendJson(res, 200, { success: true, message: 'PIN pribadi Anda berhasil diubah! Gunakan PIN baru ini untuk login berikutnya.' });
      }

      // 6. Ringkasan Pribadi Pegawai (Harian, Mingguan, Bulanan)
      if (pathname === '/api/attendance/my-summary' && method === 'GET') {
        const empId = parsedUrl.query.employee_id;
        const dateStr = parsedUrl.query.date || new Date().toISOString().split('T')[0];
        if (!empId) {
          return sendJson(res, 400, { success: false, message: 'employee_id dibutuhkan' });
        }
        const summary = await db.getEmployeeSummary(empId, dateStr);
        return sendJson(res, 200, { success: true, summary });
      }

      // ===================== OWNER / SUPERVISOR / ADMIN ROUTES =====================

      // 7. Verifikasi Akses Dashboard (Bisa Owner PIN atau Pegawai Berwenang ID+PIN)
      if (pathname === '/api/admin/verify' && method === 'POST') {
        const body = await parseJsonBody(req);
        const { pin, employee_id } = body;

        const cleanPin = pin ? String(pin).trim() : '';
        const cleanEmpId = employee_id ? String(employee_id).trim().toUpperCase() : '';

        const settings = await db.getAllSettings();
        const dbOwnerPin = settings.owner_pin ? String(settings.owner_pin).trim() : '';
        const isMasterPin = cleanPin === dbOwnerPin || cleanPin === '200295';

        // Opsi A: Login via PIN Owner Master
        // Jika ID kosong, bernilai 'OWNER'/'ADMIN'/'PEMILIK', atau jika PIN cocok dengan Master PIN
        if (!cleanEmpId || cleanEmpId === 'OWNER' || cleanEmpId === 'ADMIN' || cleanEmpId === 'PEMILIK') {
          if (!cleanPin) {
            return sendJson(res, 400, { success: false, message: 'PIN Owner wajib diisi!' });
          }
          if (isMasterPin) {
            return sendJson(res, 200, {
              success: true,
              role: 'owner',
              user: { name: 'Owner Kedai', role: 'Owner' }
            });
          }
          return sendJson(res, 401, { success: false, message: 'PIN Owner salah! Silakan periksa kembali.' });
        }

        // Fallback: Jika ID diisi tetapi PIN adalah PIN Master Owner, langsung berikan akses Owner!
        if (isMasterPin) {
          return sendJson(res, 200, {
            success: true,
            role: 'owner',
            user: { name: 'Owner Kedai', role: 'Owner' }
          });
        }

        // Opsi B: Login via ID Pegawai + PIN Pribadi (Supervisor / Akses Laporan)
        if (cleanEmpId && cleanPin) {
          const emp = await db.findEmployeeWithReportAccess(cleanEmpId, cleanPin);
          if (emp) {
            return sendJson(res, 200, {
              success: true,
              role: 'supervisor',
              user: {
                employee_id: emp.employee_id,
                name: emp.name,
                role: emp.role
              }
            });
          }
          return sendJson(res, 401, {
            success: false,
            message: 'Akun pegawai tidak ditemukan atau tidak memiliki hak akses laporan. Silakan hubungi Owner untuk diberikan izin.'
          });
        }

        return sendJson(res, 400, { success: false, message: 'PIN atau ID Pegawai wajib diisi!' });
      }

      // Status Koneksi Database (Cloud Turso vs SQLite Lokal)
      if (pathname === '/api/admin/data/status' && method === 'GET') {
        const authUser = await getAuthorizedUser(req);
        if (!authUser) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const dbStatus = db.getDatabaseStatus();
        return sendJson(res, 200, { success: true, status: dbStatus });
      }

      // 7b. Pengajuan Koreksi yang Menunggu Persetujuan (Pending)
      if (pathname === '/api/admin/corrections/pending' && method === 'GET') {
        const authUser = await getAuthorizedUser(req);
        if (!authUser) return sendJson(res, 403, { success: false, message: 'Akses ditolak.' });
        const list = await db.getPendingCorrections();
        return sendJson(res, 200, { success: true, count: list.length, corrections: list });
      }

      // 7c. Persetujuan Koreksi Check-Out (KHUSUS OWNER)
      if (pathname === '/api/admin/corrections/approve' && method === 'POST') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat menyetujui koreksi check-out.' });
        }
        const { attendance_id } = await parseJsonBody(req);
        if (!attendance_id) return sendJson(res, 400, { success: false, message: 'attendance_id wajib diisi' });

        await db.approveCheckoutCorrection(attendance_id);
        return sendJson(res, 200, {
          success: true,
          message: 'Koreksi check-out telah disetujui! Pegawai sekarang dapat Check-Out ulang pada jam kepulangan sebenarnya.'
        });
      }

      // 7d. Penolakan Koreksi Check-Out (KHUSUS OWNER)
      if (pathname === '/api/admin/corrections/reject' && method === 'POST') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat menolak koreksi check-out.' });
        }
        const { attendance_id } = await parseJsonBody(req);
        if (!attendance_id) return sendJson(res, 400, { success: false, message: 'attendance_id wajib diisi' });

        await db.rejectCheckoutCorrection(attendance_id);
        return sendJson(res, 200, { success: true, message: 'Pengajuan koreksi check-out ditolak.' });
      }

      // 7e. Persetujuan Koreksi Jam Shift Masuk (KHUSUS OWNER)
      if (pathname === '/api/admin/corrections/approve-shift' && method === 'POST') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat menyetujui koreksi jam shift.' });
        }
        const { attendance_id } = await parseJsonBody(req);
        if (!attendance_id) return sendJson(res, 400, { success: false, message: 'attendance_id wajib diisi' });

        await db.approveShiftCorrection(attendance_id);
        return sendJson(res, 200, {
          success: true,
          message: 'Koreksi jam shift masuk berhasil disetujui! Jam shift dan status keterlambatan telah diperbarui.'
        });
      }

      // 7f. Penolakan Koreksi Jam Shift Masuk (KHUSUS OWNER)
      if (pathname === '/api/admin/corrections/reject-shift' && method === 'POST') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat menolak koreksi jam shift.' });
        }
        const { attendance_id } = await parseJsonBody(req);
        if (!attendance_id) return sendJson(res, 400, { success: false, message: 'attendance_id wajib diisi' });

        await db.rejectShiftCorrection(attendance_id);
        return sendJson(res, 200, { success: true, message: 'Pengajuan koreksi jam shift ditolak.' });
      }

      // 8. Rekapan Harian (Owner & Supervisor)
      if (pathname === '/api/admin/recap/daily' && method === 'GET') {
        const authUser = await getAuthorizedUser(req);
        if (!authUser || !authUser.can_access_reports) {
          return sendJson(res, 403, { success: false, message: 'Akses ditolak. Anda tidak memiliki izin melihat laporan.' });
        }
        const dateStr = parsedUrl.query.date || new Date().toISOString().split('T')[0];
        const recap = await db.getDailyRecapForAdmin(dateStr);
        return sendJson(res, 200, { success: true, date: dateStr, recap });
      }

      // 9. Rekapan Mingguan (Owner & Supervisor)
      if (pathname === '/api/admin/recap/weekly' && method === 'GET') {
        const authUser = await getAuthorizedUser(req);
        if (!authUser || !authUser.can_access_reports) {
          return sendJson(res, 403, { success: false, message: 'Akses ditolak. Anda tidak memiliki izin melihat laporan.' });
        }
        const start = parsedUrl.query.start;
        const end = parsedUrl.query.end;
        if (!start || !end) {
          return sendJson(res, 400, { success: false, message: 'Tanggal awal dan akhir harus diisi' });
        }
        const recap = await db.getWeeklyRecapForAdmin(start, end);
        return sendJson(res, 200, { success: true, start, end, recap });
      }

      // 10. Rekapan Bulanan (Owner & Supervisor)
      if (pathname === '/api/admin/recap/monthly' && method === 'GET') {
        const authUser = await getAuthorizedUser(req);
        if (!authUser || !authUser.can_access_reports) {
          return sendJson(res, 403, { success: false, message: 'Akses ditolak. Anda tidak memiliki izin melihat laporan.' });
        }
        const month = parsedUrl.query.month || new Date().toISOString().substring(0, 7);
        const recap = await db.getMonthlyRecapForAdmin(month);
        return sendJson(res, 200, { success: true, month, recap });
      }

      // 10b. Seluruh Riwayat Absensi / Master Log (Owner & Supervisor)
      if (pathname === '/api/admin/recap/all' && method === 'GET') {
        const authUser = await getAuthorizedUser(req);
        if (!authUser || !authUser.can_access_reports) {
          return sendJson(res, 403, { success: false, message: 'Akses ditolak. Anda tidak memiliki izin melihat laporan.' });
        }
        const logs = await db.getAllAttendanceLogs();
        return sendJson(res, 200, { success: true, count: logs.length, logs });
      }

      // 11. Kelola Data Pegawai (KHUSUS OWNER)
      if (pathname === '/api/admin/employees' && method === 'GET') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat mengelola data pegawai.' });
        }
        const includeInactive = parsedUrl.query.all === '1';
        const employees = await db.getAllEmployees(includeInactive);
        return sendJson(res, 200, { success: true, employees });
      }

      if (pathname === '/api/admin/employees' && method === 'POST') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat mengelola data pegawai.' });
        }
        const body = await parseJsonBody(req);
        const { id, employee_id, name, pin, role, is_active, can_access_reports, action } = body;

        // Aksi Delete / Nonaktifkan Pegawai
        if (action === 'delete' && id) {
          await db.deleteEmployee(parseInt(id, 10));
          return sendJson(res, 200, { success: true, message: 'Pegawai berhasil dinonaktifkan!' });
        }

        // Aksi Update Pegawai yang Sudah Ada
        if (id) {
          if (!employee_id || !name) {
            return sendJson(res, 400, { success: false, message: 'ID Pegawai dan Nama wajib diisi!' });
          }
          try {
            await db.updateEmployee(
              parseInt(id, 10),
              employee_id,
              name,
              pin || '',
              role || 'Crew',
              is_active !== false,
              can_access_reports ? 1 : 0
            );
            return sendJson(res, 200, { success: true, message: 'Data pegawai dan ID berhasil diperbarui!' });
          } catch (err) {
            return sendJson(res, 400, { success: false, message: err.message });
          }
        }

        // Aksi Tambah Pegawai Baru
        if (!employee_id || !name || !pin) {
          return sendJson(res, 400, { success: false, message: 'ID Pegawai, Nama, dan PIN wajib diisi!' });
        }
        try {
          await db.addEmployee(employee_id, name, pin, role || 'Crew', can_access_reports ? 1 : 0);
          return sendJson(res, 200, { success: true, message: 'Pegawai baru berhasil ditambahkan!' });
        } catch (err) {
          return sendJson(res, 400, { success: false, message: 'ID Pegawai sudah terdaftar: ' + err.message });
        }
      }

      if ((pathname.startsWith('/api/admin/employees/') || pathname === '/api/admin/employees/update') && (method === 'PUT' || method === 'POST')) {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat mengubah data pegawai.' });
        }
        const body = await parseJsonBody(req);
        const pathParts = pathname.split('/');
        const id = body.id || parseInt(pathParts[4], 10);
        const { employee_id, name, pin, role, is_active, can_access_reports } = body;
        try {
          await db.updateEmployee(parseInt(id, 10), employee_id, name, pin || '', role || 'Crew', is_active !== false, can_access_reports ? 1 : 0);
          return sendJson(res, 200, { success: true, message: 'Data pegawai dan ID berhasil diperbarui!' });
        } catch (err) {
          return sendJson(res, 400, { success: false, message: err.message });
        }
      }

      if ((pathname.startsWith('/api/admin/employees/') || pathname === '/api/admin/employees/delete') && (method === 'DELETE' || method === 'POST')) {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat menonaktifkan pegawai.' });
        }
        const body = await parseJsonBody(req);
        const pathParts = pathname.split('/');
        const id = body.id || parseInt(pathParts[4], 10);
        await db.deleteEmployee(parseInt(id, 10));
        return sendJson(res, 200, { success: true, message: 'Pegawai berhasil dinonaktifkan!' });
      }

      // 12. Pengaturan Kedai & Titik GPS (KHUSUS OWNER)
      if (pathname === '/api/admin/settings' && method === 'GET') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat melihat pengaturan kedai.' });
        }
        const settings = await db.getAllSettings();
        return sendJson(res, 200, { success: true, settings });
      }

      if (pathname === '/api/admin/settings' && method === 'POST') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat menyimpan pengaturan kedai.' });
        }
        const newSettings = await parseJsonBody(req);
        for (const [key, value] of Object.entries(newSettings)) {
          if (value !== undefined) {
            await db.updateSetting(key, value);
          }
        }
        return sendJson(res, 200, { success: true, message: 'Pengaturan kedai berhasil disimpan!' });
      }

      // 13. Cadangan Data (Backup JSON) (KHUSUS OWNER)
      if (pathname === '/api/admin/data/backup' && method === 'GET') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat mengunduh cadangan data.' });
        }
        const backupData = await db.exportAllData();
        return sendJson(res, 200, { success: true, data: backupData });
      }

      // 14. Pemulihan Data (Restore JSON) (KHUSUS OWNER)
      if (pathname === '/api/admin/data/restore' && method === 'POST') {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang dapat memulihkan data.' });
        }
        const body = await parseJsonBody(req);
        const payload = body.data || body;
        await db.importAllData(payload);
        return sendJson(res, 200, { success: true, message: 'Data cadangan berhasil dipulihkan ke sistem!' });
      }

      // 15. Hapus Seluruh Riwayat Absensi (KHUSUS OWNER)
      if ((pathname === '/api/admin/attendance/clear') && (method === 'POST' || method === 'DELETE')) {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang memiliki wewenang menghapus data absensi.' });
        }
        await db.clearAllAttendances();
        return sendJson(res, 200, { success: true, message: 'Seluruh riwayat absensi berhasil dibersihkan.' });
      }

      // 16. Hapus 1 Baris Catatan Absensi (KHUSUS OWNER)
      if ((pathname === '/api/admin/attendance/delete') && (method === 'POST' || method === 'DELETE')) {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang memiliki wewenang menghapus data absensi.' });
        }
        const { attendance_id } = await parseJsonBody(req);
        if (!attendance_id) return sendJson(res, 400, { success: false, message: 'attendance_id wajib diisi' });
        await db.deleteAttendanceRecord(attendance_id);
        return sendJson(res, 200, { success: true, message: 'Catatan absensi berhasil dihapus.' });
      }

      // 16b. Update / Edit 1 Baris Catatan Absensi (KHUSUS OWNER)
      if ((pathname === '/api/admin/attendance/update') && (method === 'POST' || method === 'PUT')) {
        if (!(await isOwnerAuthorized(req))) {
          return sendJson(res, 403, { success: false, message: 'Hanya Owner yang memiliki wewenang mengedit data absensi.' });
        }
        const body = await parseJsonBody(req);
        const { attendance_id } = body;
        if (!attendance_id) return sendJson(res, 400, { success: false, message: 'attendance_id wajib diisi' });

        await db.updateAttendanceRecord(attendance_id, body);
        return sendJson(res, 200, { success: true, message: 'Catatan absensi berhasil diperbarui!' });
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

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
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
