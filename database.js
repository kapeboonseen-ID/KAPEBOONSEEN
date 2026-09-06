let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  DatabaseSync = null;
}

const path = require('node:path');
const fs = require('node:fs');

// Path database SQLite
let DB_PATH;
if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  DB_PATH = '/tmp/absensi.db';
  const seedDb = path.join(__dirname, 'absensi.db');
  if (!fs.existsSync(DB_PATH) && fs.existsSync(seedDb)) {
    try { fs.copyFileSync(seedDb, DB_PATH); } catch (e) {}
  }
} else {
  const dataDir = fs.existsSync(path.join(__dirname, '.data')) ? path.join(__dirname, '.data') : __dirname;
  DB_PATH = path.join(dataDir, 'absensi.db');
}

let db = null;
if (DatabaseSync) {
  try {
    db = new DatabaseSync(DB_PATH);
  } catch (err) {
    console.error('[DB] Gagal inisialisasi node:sqlite, menggunakan mode JSON:', err.message);
    db = null;
  }
}

// ==================== MODE JSON FALLBACK ====================
const JSON_STORE_PATH = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
  ? '/tmp/absensi_data.json'
  : path.join(__dirname, 'absensi_data.json');

let jsonStore = null;

function getInitialJsonStore() {
  return {
    settings: {
      shop_name: 'KAPEBOONSEEN',
      latitude: '-6.882377731222678',
      longitude: '107.53165355029745',
      radius_meters: '25',
      owner_pin: '200295',
      gps_enforced: '1'
    },
    employees: [
      { id: 1, employee_id: 'CKBS01', name: 'Raska Novanpurian', pin: '111111', role: 'Barista', is_active: 1, created_at: '2026-09-06T07:03:53.541Z' },
      { id: 2, employee_id: 'CKBS02', name: 'Shiddiq Hibatullah M', pin: '222222', role: 'Head Bar', is_active: 1, created_at: '2026-09-06T07:03:53.541Z' },
      { id: 3, employee_id: 'CKBS03', name: 'Salsa Nabila', pin: '333333', role: 'Crew', is_active: 1, created_at: '2026-09-06T07:03:53.541Z' },
      { id: 4, employee_id: 'CKBS04', name: 'Luthfia Putri Hidayat', pin: '444444', role: 'Crew', is_active: 1, created_at: '2026-09-06T07:42:06.853Z' },
      { id: 5, employee_id: 'CKBS05', name: 'Riska Perilia', pin: '555555', role: 'Crew', is_active: 1, created_at: '2026-09-06T07:43:18.313Z' },
      { id: 6, employee_id: 'TEST01', name: 'KARYAWAN TEST', pin: '1234', role: 'Barista', is_active: 1, created_at: '2026-09-06T08:01:00.421Z' }
    ],
    attendances: []
  };
}

function loadJsonStore() {
  if (jsonStore) return jsonStore;
  if (fs.existsSync(JSON_STORE_PATH)) {
    try {
      jsonStore = JSON.parse(fs.readFileSync(JSON_STORE_PATH, 'utf8'));
      return jsonStore;
    } catch (e) {}
  }
  jsonStore = getInitialJsonStore();
  saveJsonStore();
  return jsonStore;
}

function saveJsonStore() {
  if (!jsonStore) return;
  try {
    fs.writeFileSync(JSON_STORE_PATH, JSON.stringify(jsonStore, null, 2), 'utf8');
  } catch (e) {}
}

// Inisialisasi Tabel
function initDatabase() {
  if (!db) {
    loadJsonStore();
    return;
  }

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
    { key: 'latitude', value: '-6.882377731222678' },
    { key: 'longitude', value: '107.53165355029745' },
    { key: 'radius_meters', value: '25' },
    { key: 'owner_pin', value: '200295' },
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

  // Tambah pegawai awal jika tabel masih kosong
  const empCount = db.prepare('SELECT COUNT(*) as count FROM employees').get();
  if (empCount && empCount.count === 0) {
    const insertEmp = db.prepare(`
      INSERT INTO employees (employee_id, name, pin, role, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    const now = new Date().toISOString();
    insertEmp.run('CKBS01', 'Raska Novanpurian', '111111', 'Barista', now);
    insertEmp.run('CKBS02', 'Shiddiq Hibatullah M', '222222', 'Head Bar', now);
    insertEmp.run('CKBS03', 'Salsa Nabila', '333333', 'Crew', now);
    insertEmp.run('CKBS04', 'Luthfia Putri Hidayat', '444444', 'Crew', now);
    insertEmp.run('CKBS05', 'Riska Perilia', '555555', 'Crew', now);
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
  if (!db) {
    const store = loadJsonStore();
    return { ...store.settings };
  }
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function updateSetting(key, value) {
  if (!db) {
    const store = loadJsonStore();
    store.settings[key] = String(value);
    saveJsonStore();
    return;
  }
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(key, String(value));
}

// Helper Pegawai
function findEmployeeByCredentials(employeeId, pin) {
  if (!db) {
    const store = loadJsonStore();
    return store.employees.find(e => 
      e.employee_id.toUpperCase() === String(employeeId).trim().toUpperCase() && 
      String(e.pin).trim() === String(pin).trim() && 
      e.is_active === 1
    ) || null;
  }
  const stmt = db.prepare(`
    SELECT id, employee_id, name, role, is_active 
    FROM employees 
    WHERE UPPER(employee_id) = UPPER(?) AND pin = ? AND is_active = 1
  `);
  return stmt.get(employeeId, pin);
}

function getAllEmployees(includeInactive = false) {
  if (!db) {
    const store = loadJsonStore();
    const list = includeInactive ? store.employees : store.employees.filter(e => e.is_active === 1);
    return list.slice().sort((a, b) => a.employee_id.localeCompare(b.employee_id));
  }
  const query = includeInactive 
    ? 'SELECT id, employee_id, name, pin, role, is_active, created_at FROM employees ORDER BY employee_id ASC'
    : 'SELECT id, employee_id, name, pin, role, is_active, created_at FROM employees WHERE is_active = 1 ORDER BY employee_id ASC';
  return db.prepare(query).all();
}

function addEmployee(employeeId, name, pin, role) {
  const cleanId = employeeId.trim().toUpperCase();
  if (!db) {
    const store = loadJsonStore();
    if (store.employees.some(e => e.employee_id.toUpperCase() === cleanId)) {
      throw new Error('ID Pegawai sudah terdaftar');
    }
    const maxId = store.employees.reduce((max, e) => Math.max(max, e.id || 0), 0);
    const newEmp = {
      id: maxId + 1,
      employee_id: cleanId,
      name: name.trim(),
      pin: pin.trim(),
      role: (role || 'Crew').trim(),
      is_active: 1,
      created_at: new Date().toISOString()
    };
    store.employees.push(newEmp);
    saveJsonStore();
    return { changes: 1 };
  }
  const stmt = db.prepare(`
    INSERT INTO employees (employee_id, name, pin, role, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  return stmt.run(cleanId, name.trim(), pin.trim(), role.trim(), new Date().toISOString());
}

function updateEmployee(id, employeeId, name, pin, role, isActive) {
  const cleanId = employeeId.trim().toUpperCase();
  if (!db) {
    const store = loadJsonStore();
    const emp = store.employees.find(e => e.id === Number(id));
    if (emp) {
      emp.employee_id = cleanId;
      emp.name = name.trim();
      if (pin && pin.trim().length > 0) emp.pin = pin.trim();
      emp.role = role.trim();
      emp.is_active = isActive ? 1 : 0;
      saveJsonStore();
    }
    return { changes: 1 };
  }
  if (pin && pin.trim().length > 0) {
    const stmt = db.prepare(`
      UPDATE employees 
      SET employee_id = ?, name = ?, pin = ?, role = ?, is_active = ?
      WHERE id = ?
    `);
    return stmt.run(cleanId, name.trim(), pin.trim(), role.trim(), isActive ? 1 : 0, id);
  } else {
    const stmt = db.prepare(`
      UPDATE employees 
      SET employee_id = ?, name = ?, role = ?, is_active = ?
      WHERE id = ?
    `);
    return stmt.run(cleanId, name.trim(), role.trim(), isActive ? 1 : 0, id);
  }
}

// Ubah PIN Pegawai Mandiri oleh Pegawai
function updateEmployeePin(employeeId, newPin) {
  const cleanId = employeeId.trim().toUpperCase();
  if (!db) {
    const store = loadJsonStore();
    const emp = store.employees.find(e => e.employee_id.toUpperCase() === cleanId);
    if (emp) {
      emp.pin = newPin.trim();
      saveJsonStore();
    }
    return { changes: 1 };
  }
  const stmt = db.prepare(`
    UPDATE employees 
    SET pin = ? 
    WHERE UPPER(employee_id) = UPPER(?)
  `);
  return stmt.run(newPin.trim(), employeeId.trim());
}

function deleteEmployee(id) {
  if (!db) {
    const store = loadJsonStore();
    const emp = store.employees.find(e => e.id === Number(id));
    if (emp) {
      emp.is_active = 0;
      saveJsonStore();
    }
    return { changes: 1 };
  }
  const stmt = db.prepare('UPDATE employees SET is_active = 0 WHERE id = ?');
  return stmt.run(id);
}

// Helper Absensi
function getTodayAttendance(employeeId, dateStr) {
  const cleanId = employeeId.toUpperCase();
  if (!db) {
    const store = loadJsonStore();
    return store.attendances.slice().reverse().find(a => 
      a.employee_id.toUpperCase() === cleanId && a.date === dateStr
    ) || null;
  }
  const stmt = db.prepare(`
    SELECT * FROM attendances 
    WHERE UPPER(employee_id) = UPPER(?) AND date = ?
    ORDER BY id DESC LIMIT 1
  `);
  return stmt.get(employeeId, dateStr);
}

function createCheckIn(employeeId, dateStr, timeStr, lat, lng, distance) {
  const cleanId = employeeId.toUpperCase();
  if (!db) {
    const store = loadJsonStore();
    const maxId = store.attendances.reduce((max, a) => Math.max(max, a.id || 0), 0);
    const newAtt = {
      id: maxId + 1,
      employee_id: cleanId,
      date: dateStr,
      check_in_time: timeStr,
      check_out_time: null,
      check_in_lat: lat || null,
      check_in_lng: lng || null,
      check_in_distance: distance || 0,
      check_out_lat: null,
      check_out_lng: null,
      check_out_distance: null,
      total_minutes: 0,
      status: 'CHECKED_IN'
    };
    store.attendances.push(newAtt);
    saveJsonStore();
    return { changes: 1 };
  }
  const stmt = db.prepare(`
    INSERT INTO attendances 
      (employee_id, date, check_in_time, check_in_lat, check_in_lng, check_in_distance, status, total_minutes)
    VALUES (?, ?, ?, ?, ?, ?, 'CHECKED_IN', 0)
  `);
  return stmt.run(cleanId, dateStr, timeStr, lat, lng, distance);
}

function performCheckOut(attendanceId, timeStr, lat, lng, distance, totalMinutes) {
  if (!db) {
    const store = loadJsonStore();
    const record = store.attendances.find(a => a.id === Number(attendanceId));
    if (record) {
      record.check_out_time = timeStr;
      record.check_out_lat = lat || null;
      record.check_out_lng = lng || null;
      record.check_out_distance = distance || 0;
      record.total_minutes = totalMinutes;
      record.status = 'COMPLETED';
      saveJsonStore();
    }
    return { changes: 1 };
  }
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
  const cleanId = employeeId.toUpperCase();
  const todayRecord = getTodayAttendance(cleanId, todayDateStr);
  let todayMinutes = 0;
  if (todayRecord) {
    todayMinutes = todayRecord.total_minutes || 0;
    if (todayRecord.status === 'CHECKED_IN' && todayRecord.check_in_time) {
      const [hIn, mIn] = todayRecord.check_in_time.split(':').map(Number);
      const now = new Date();
      const currentMin = now.getHours() * 60 + now.getMinutes();
      const inMin = hIn * 60 + mIn;
      todayMinutes = Math.max(0, currentMin - inMin);
    }
  }

  // 2. Minggu Ini
  const d = new Date(todayDateStr);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const startWeekStr = monday.toISOString().split('T')[0];
  const endWeekStr = sunday.toISOString().split('T')[0];

  let weekMinutes = 0;
  let monthMinutes = 0;
  const monthPrefix = todayDateStr.substring(0, 7);
  let history = [];

  if (!db) {
    const store = loadJsonStore();
    const compRows = store.attendances.filter(a => 
      a.employee_id.toUpperCase() === cleanId && a.status === 'COMPLETED'
    );
    weekMinutes = compRows
      .filter(a => a.date >= startWeekStr && a.date <= endWeekStr)
      .reduce((sum, a) => sum + (a.total_minutes || 0), 0);
    monthMinutes = compRows
      .filter(a => a.date.startsWith(monthPrefix))
      .reduce((sum, a) => sum + (a.total_minutes || 0), 0);
    history = store.attendances
      .filter(a => a.employee_id.toUpperCase() === cleanId)
      .sort((a, b) => b.id - a.id)
      .slice(0, 10)
      .map(a => ({
        date: a.date,
        check_in_time: a.check_in_time,
        check_out_time: a.check_out_time,
        total_minutes: a.total_minutes,
        status: a.status
      }));
  } else {
    const weekRows = db.prepare(`
      SELECT total_minutes FROM attendances 
      WHERE UPPER(employee_id) = UPPER(?) AND date >= ? AND date <= ? AND status = 'COMPLETED'
    `).all(employeeId, startWeekStr, endWeekStr);
    weekMinutes = weekRows.reduce((acc, row) => acc + (row.total_minutes || 0), 0);

    const monthRows = db.prepare(`
      SELECT total_minutes FROM attendances 
      WHERE UPPER(employee_id) = UPPER(?) AND date LIKE ? AND status = 'COMPLETED'
    `).all(employeeId, `${monthPrefix}%`);
    monthMinutes = monthRows.reduce((acc, row) => acc + (row.total_minutes || 0), 0);

    history = db.prepare(`
      SELECT date, check_in_time, check_out_time, total_minutes, status 
      FROM attendances 
      WHERE UPPER(employee_id) = UPPER(?)
      ORDER BY date DESC, id DESC LIMIT 10
    `).all(employeeId);
  }

  if (todayRecord && todayRecord.status === 'CHECKED_IN') {
    weekMinutes += todayMinutes;
    monthMinutes += todayMinutes;
  }

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
  if (!db) {
    const store = loadJsonStore();
    const activeEmps = store.employees.filter(e => e.is_active === 1).sort((a, b) => a.employee_id.localeCompare(b.employee_id));
    return activeEmps.map(e => {
      const att = store.attendances.slice().reverse().find(a => a.employee_id.toUpperCase() === e.employee_id.toUpperCase() && a.date === dateStr);
      const totalMin = att ? (att.total_minutes || 0) : 0;
      return {
        employee_id: e.employee_id,
        name: e.name,
        role: e.role,
        attendance_id: att ? att.id : null,
        date: att ? att.date : null,
        check_in_time: att ? att.check_in_time : null,
        check_out_time: att ? att.check_out_time : null,
        check_in_distance: att ? att.check_in_distance : null,
        total_minutes: att ? att.total_minutes : null,
        status: att ? att.status : null,
        formatted_duration: formatMinutesToHours(totalMin)
      };
    });
  }

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
  if (!db) {
    const store = loadJsonStore();
    const activeEmps = store.employees.filter(e => e.is_active === 1);
    return activeEmps.map(e => {
      const atts = store.attendances.filter(a => 
        a.employee_id.toUpperCase() === e.employee_id.toUpperCase() && 
        a.date >= startDateStr && a.date <= endDateStr && 
        a.status === 'COMPLETED'
      );
      const totalDays = atts.length;
      const totalMinutes = atts.reduce((sum, a) => sum + (a.total_minutes || 0), 0);
      return {
        employee_id: e.employee_id,
        name: e.name,
        role: e.role,
        total_days_present: totalDays,
        total_minutes: totalMinutes,
        formatted_duration: formatMinutesToHours(totalMinutes)
      };
    }).sort((a, b) => b.total_minutes - a.total_minutes);
  }

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
  if (!db) {
    const store = loadJsonStore();
    const activeEmps = store.employees.filter(e => e.is_active === 1);
    return activeEmps.map(e => {
      const atts = store.attendances.filter(a => 
        a.employee_id.toUpperCase() === e.employee_id.toUpperCase() && 
        a.date.startsWith(yearMonthStr) && 
        a.status === 'COMPLETED'
      );
      const totalDays = atts.length;
      const totalMinutes = atts.reduce((sum, a) => sum + (a.total_minutes || 0), 0);
      return {
        employee_id: e.employee_id,
        name: e.name,
        role: e.role,
        total_days_present: totalDays,
        total_minutes: totalMinutes,
        formatted_duration: formatMinutesToHours(totalMinutes)
      };
    }).sort((a, b) => b.total_minutes - a.total_minutes);
  }

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
