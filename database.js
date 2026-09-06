const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Gunakan folder .data jika di Glitch / cloud hosting agar data permanen
const dataDir = fs.existsSync(path.join(__dirname, '.data')) ? path.join(__dirname, '.data') : __dirname;
const DB_PATH = path.join(dataDir, 'absensi.db');
const db = new DatabaseSync(DB_PATH);

// Inisialisasi Tabel
function initDatabase() {
  // Tabel Pengaturan Sistem & Titik GPS Kedai
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Tabel Data Pegawai / Crew
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Crew',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // Tabel Riwayat Absensi
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      check_in_time TEXT NOT NULL,
      check_out_time TEXT,
      check_in_lat REAL,
      check_in_lng REAL,
      check_in_distance REAL,
      check_out_lat REAL,
      check_out_lng REAL,
      check_out_distance REAL,
      total_minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'CHECKED_IN'
    );
  `);

  // Set default settings jika belum ada
  const defaultSettings = [
    { key: 'shop_name', value: 'KAPEBOONSEEN' },
    { key: 'latitude', value: '-6.2088' },
    { key: 'longitude', value: '106.8456' },
    { key: 'radius_meters', value: '50' },
    { key: 'owner_pin', value: '123456' },
    { key: 'gps_enforced', value: '1' }
  ];

  const checkSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSettingStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const s of defaultSettings) {
    const existing = checkSettingStmt.get(s.key);
    if (!existing) {
      insertSettingStmt.run(s.key, s.value);
    }
  }

  // Tambah pegawai sampel jika tabel masih kosong
  const empCount = db.prepare('SELECT COUNT(*) as count FROM employees').get();
  if (empCount && empCount.count === 0) {
    const insertEmp = db.prepare(`
      INSERT INTO employees (employee_id, name, pin, role, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    const now = new Date().toISOString();
    insertEmp.run('BRS-01', 'Rian', '1111', 'Barista', now);
    insertEmp.run('KSR-01', 'Siti', '2222', 'Kasir', now);
    insertEmp.run('KIT-01', 'Budi', '3333', 'Kitchen', now);
  }
}

// Rumus Haversine: Menghitung jarak GPS dalam satuan meter
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return 0;
  const R = 6371e3; // Radius bumi dalam meter
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Helper Pengaturan
function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function updateSetting(key, value) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(key, String(value));
}

// Helper Pegawai
function findEmployeeByCredentials(employeeId, pin) {
  const stmt = db.prepare(`
    SELECT id, employee_id, name, role, is_active 
    FROM employees 
    WHERE UPPER(employee_id) = UPPER(?) AND pin = ? AND is_active = 1
  `);
  return stmt.get(employeeId, pin);
}

function getAllEmployees(includeInactive = false) {
  const query = includeInactive 
    ? 'SELECT id, employee_id, name, pin, role, is_active, created_at FROM employees ORDER BY employee_id ASC'
    : 'SELECT id, employee_id, name, pin, role, is_active, created_at FROM employees WHERE is_active = 1 ORDER BY employee_id ASC';
  return db.prepare(query).all();
}

function addEmployee(employeeId, name, pin, role) {
  const stmt = db.prepare(`
    INSERT INTO employees (employee_id, name, pin, role, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  return stmt.run(employeeId.trim().toUpperCase(), name.trim(), pin.trim(), role.trim(), new Date().toISOString());
}

function updateEmployee(id, employeeId, name, pin, role, isActive) {
  if (pin && pin.trim().length > 0) {
    const stmt = db.prepare(`
      UPDATE employees 
      SET employee_id = ?, name = ?, pin = ?, role = ?, is_active = ?
      WHERE id = ?
    `);
    return stmt.run(employeeId.trim().toUpperCase(), name.trim(), pin.trim(), role.trim(), isActive ? 1 : 0, id);
  } else {
    const stmt = db.prepare(`
      UPDATE employees 
      SET employee_id = ?, name = ?, role = ?, is_active = ?
      WHERE id = ?
    `);
    return stmt.run(employeeId.trim().toUpperCase(), name.trim(), role.trim(), isActive ? 1 : 0, id);
  }
}

// Ubah PIN Pegawai Mandiri oleh Pegawai
function updateEmployeePin(employeeId, newPin) {
  const stmt = db.prepare(`
    UPDATE employees 
    SET pin = ? 
    WHERE UPPER(employee_id) = UPPER(?)
  `);
  return stmt.run(newPin.trim(), employeeId.trim());
}

function deleteEmployee(id) {
  // Soft-delete agar riwayat absensi tidak hilang
  const stmt = db.prepare('UPDATE employees SET is_active = 0 WHERE id = ?');
  return stmt.run(id);
}

// Helper Absensi
function getTodayAttendance(employeeId, dateStr) {
  const stmt = db.prepare(`
    SELECT * FROM attendances 
    WHERE UPPER(employee_id) = UPPER(?) AND date = ?
    ORDER BY id DESC LIMIT 1
  `);
  return stmt.get(employeeId, dateStr);
}

function createCheckIn(employeeId, dateStr, timeStr, lat, lng, distance) {
  const stmt = db.prepare(`
    INSERT INTO attendances 
      (employee_id, date, check_in_time, check_in_lat, check_in_lng, check_in_distance, status, total_minutes)
    VALUES (?, ?, ?, ?, ?, ?, 'CHECKED_IN', 0)
  `);
  return stmt.run(employeeId.toUpperCase(), dateStr, timeStr, lat, lng, distance);
}

function performCheckOut(attendanceId, timeStr, lat, lng, distance, totalMinutes) {
  const stmt = db.prepare(`
    UPDATE attendances 
    SET check_out_time = ?, 
        check_out_lat = ?, 
        check_out_lng = ?, 
        check_out_distance = ?, 
        total_minutes = ?, 
        status = 'COMPLETED'
    WHERE id = ?
  `);
  return stmt.run(timeStr, lat, lng, distance, totalMinutes, attendanceId);
}

// Menghitung ringkasan kerja harian, mingguan, dan bulanan untuk seorang pegawai
function getEmployeeSummary(employeeId, todayDateStr) {
  // 1. Hari Ini
  const todayRecord = getTodayAttendance(employeeId, todayDateStr);
  let todayMinutes = 0;
  if (todayRecord) {
    todayMinutes = todayRecord.total_minutes || 0;
    // Jika masih CHECKED_IN dan belum check-out, hitung menit berjalan
    if (todayRecord.status === 'CHECKED_IN' && todayRecord.check_in_time) {
      const [hIn, mIn] = todayRecord.check_in_time.split(':').map(Number);
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const inMin = hIn * 60 + mIn;
      todayMinutes = Math.max(0, currentMin - inMin);
    }
  }

  // 2. Minggu Ini (Senin sampai Minggu ini)
  const d = new Date(todayDateStr);
  const day = d.getDay(); // 0: Minggu, 1: Senin, ...
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const startWeekStr = monday.toISOString().split('T')[0];
  const endWeekStr = sunday.toISOString().split('T')[0];

  const weekRows = db.prepare(`
    SELECT total_minutes FROM attendances 
    WHERE UPPER(employee_id) = UPPER(?) AND date >= ? AND date <= ? AND status = 'COMPLETED'
  `).all(employeeId, startWeekStr, endWeekStr);

  let weekMinutes = weekRows.reduce((acc, row) => acc + (row.total_minutes || 0), 0);
  if (todayRecord && todayRecord.status === 'CHECKED_IN') {
    weekMinutes += todayMinutes;
  }

  // 3. Bulan Ini (YYYY-MM)
  const monthPrefix = todayDateStr.substring(0, 7); // e.g. "2026-09"
  const monthRows = db.prepare(`
    SELECT total_minutes FROM attendances 
    WHERE UPPER(employee_id) = UPPER(?) AND date LIKE ? AND status = 'COMPLETED'
  `).all(employeeId, `${monthPrefix}%`);

  let monthMinutes = monthRows.reduce((acc, row) => acc + (row.total_minutes || 0), 0);
  if (todayRecord && todayRecord.status === 'CHECKED_IN') {
    monthMinutes += todayMinutes;
  }

  // Riwayat 7 absensi terakhir pegawai ini
  const history = db.prepare(`
    SELECT date, check_in_time, check_out_time, total_minutes, status 
    FROM attendances 
    WHERE UPPER(employee_id) = UPPER(?)
    ORDER BY date DESC, id DESC LIMIT 10
  `).all(employeeId);

  return {
    today: {
      minutes: todayMinutes,
      hoursText: formatMinutesToHours(todayMinutes),
      record: todayRecord
    },
    thisWeek: {
      startDate: startWeekStr,
      endDate: endWeekStr,
      minutes: weekMinutes,
      hoursText: formatMinutesToHours(weekMinutes)
    },
    thisMonth: {
      month: monthPrefix,
      minutes: monthMinutes,
      hoursText: formatMinutesToHours(monthMinutes)
    },
    history
  };
}

// Rekapan Harian untuk Owner
function getDailyRecapForAdmin(dateStr) {
  const rows = db.prepare(`
    SELECT e.employee_id, e.name, e.role, 
           a.id as attendance_id, a.date, a.check_in_time, a.check_out_time, 
           a.check_in_distance, a.total_minutes, a.status
    FROM employees e
    LEFT JOIN attendances a ON UPPER(e.employee_id) = UPPER(a.employee_id) AND a.date = ?
    WHERE e.is_active = 1
    ORDER BY e.employee_id ASC
  `).all(dateStr);

  return rows.map(r => ({
    ...r,
    formatted_duration: formatMinutesToHours(r.total_minutes || 0)
  }));
}

// Rekapan Mingguan untuk Owner
function getWeeklyRecapForAdmin(startDateStr, endDateStr) {
  const rows = db.prepare(`
    SELECT e.employee_id, e.name, e.role,
           COUNT(a.id) as total_days_present,
           COALESCE(SUM(a.total_minutes), 0) as total_minutes
    FROM employees e
    LEFT JOIN attendances a ON UPPER(e.employee_id) = UPPER(a.employee_id) 
         AND a.date >= ? AND a.date <= ? AND a.status = 'COMPLETED'
    WHERE e.is_active = 1
    GROUP BY e.employee_id
    ORDER BY total_minutes DESC
  `).all(startDateStr, endDateStr);

  return rows.map(r => ({
    ...r,
    formatted_duration: formatMinutesToHours(r.total_minutes)
  }));
}

// Rekapan Bulanan untuk Owner
function getMonthlyRecapForAdmin(yearMonthStr) {
  const rows = db.prepare(`
    SELECT e.employee_id, e.name, e.role,
           COUNT(a.id) as total_days_present,
           COALESCE(SUM(a.total_minutes), 0) as total_minutes
    FROM employees e
    LEFT JOIN attendances a ON UPPER(e.employee_id) = UPPER(a.employee_id) 
         AND a.date LIKE ? AND a.status = 'COMPLETED'
    WHERE e.is_active = 1
    GROUP BY e.employee_id
    ORDER BY total_minutes DESC
  `).all(`${yearMonthStr}%`);

  return rows.map(r => ({
    ...r,
    formatted_duration: formatMinutesToHours(r.total_minutes)
  }));
}

// Helper Format Menit ke "X Jam Y Menit (Total Z Menit)"
function formatMinutesToHours(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) {
    return {
      hours: 0,
      minutes: 0,
      totalMinutes: 0,
      textShort: '0 Jam 0 Menit',
      textFull: '0 Jam 0 Menit (Total 0 Menit)'
    };
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    hours,
    minutes,
    totalMinutes,
    textShort: `${hours} Jam ${minutes} Menit`,
    textFull: `${hours} Jam ${minutes} Menit (Total ${totalMinutes.toLocaleString('id-ID')} Menit)`
  };
}

module.exports = {
  initDatabase,
  calculateDistanceMeters,
  getAllSettings,
  updateSetting,
  findEmployeeByCredentials,
  getAllEmployees,
  addEmployee,
  updateEmployee,
  updateEmployeePin,
  deleteEmployee,
  getTodayAttendance,
  createCheckIn,
  performCheckOut,
  getEmployeeSummary,
  getDailyRecapForAdmin,
  getWeeklyRecapForAdmin,
  getMonthlyRecapForAdmin,
  formatMinutesToHours
};
