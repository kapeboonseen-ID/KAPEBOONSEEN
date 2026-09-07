let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  DatabaseSync = null;
}

const path = require('node:path');
const fs = require('node:fs');

// ==================== 1. KONFIGURASI TURSO CLOUD SQLITE ====================
// Turso menyediakan database SQLite di cloud 100% gratis selamanya (9GB, tanpa kartu kredit)
const TURSO_URL = process.env.TURSO_DATABASE_URL
  ? process.env.TURSO_DATABASE_URL.replace('libsql://', 'https://').replace(/\/$/, '')
  : null;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || null;

async function tursoExecute(sql, args = []) {
  if (!TURSO_URL || !TURSO_TOKEN) return null;
  const pipelineUrl = `${TURSO_URL}/v2/pipeline`;
  const formattedArgs = args.map(arg => {
    if (arg === null || arg === undefined) return { type: 'null' };
    if (typeof arg === 'number') {
      return Number.isInteger(arg)
        ? { type: 'integer', value: String(arg) }
        : { type: 'float', value: arg };
    }
    return { type: 'text', value: String(arg) };
  });

  const body = {
    requests: [
      {
        type: 'execute',
        stmt: { sql, args: formattedArgs }
      },
      { type: 'close' }
    ]
  };

  const res = await fetch(pipelineUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Turso HTTP Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const firstResult = data.results && data.results[0];
  if (firstResult && firstResult.type === 'error') {
    throw new Error(`Turso SQL Error: ${firstResult.error.message}`);
  }

  const response = firstResult && firstResult.response && firstResult.response.result;
  if (!response) return { rows: [], rowsAffected: 0 };

  const cols = response.cols ? response.cols.map(c => c.name) : [];
  const rows = (response.rows || []).map(row => {
    const obj = {};
    row.forEach((val, idx) => {
      const colName = cols[idx];
      if (!val || val.type === 'null') {
        obj[colName] = null;
      } else if (val.type === 'integer') {
        obj[colName] = Number(val.value);
      } else if (val.type === 'float') {
        obj[colName] = Number(val.value);
      } else {
        obj[colName] = val.value;
      }
    });
    return obj;
  });

  return {
    rows,
    rowsAffected: response.affected_row_count || 0,
    lastInsertRowid: response.last_insert_rowid
  };
}

// ==================== 2. LOCAL SQLITE & FALLBACK JSON ====================
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
if (!TURSO_URL && DatabaseSync) {
  try {
    db = new DatabaseSync(DB_PATH);
  } catch (err) {
    console.error('[DB] Gagal inisialisasi node:sqlite, menggunakan mode JSON:', err.message);
    db = null;
  }
}

// Mode JSON Fallback (jika SQLite binary & Turso tidak ada)
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
      gps_enforced: '1',
      shift_time_enabled: '1'
    },
    employees: [
      { id: 1, employee_id: 'CKBS01', name: 'Raska Novanpurian', pin: '111111', role: 'Barista', is_active: 1, can_access_reports: 1, created_at: '2026-09-06T07:03:53.541Z' },
      { id: 2, employee_id: 'CKBS02', name: 'Shiddiq Hibatullah M', pin: '222222', role: 'Head Bar', is_active: 1, can_access_reports: 1, created_at: '2026-09-06T07:03:53.541Z' },
      { id: 3, employee_id: 'CKBS03', name: 'Salsa Nabila', pin: '333333', role: 'Crew', is_active: 1, can_access_reports: 0, created_at: '2026-09-06T07:03:53.541Z' },
      { id: 4, employee_id: 'CKBS04', name: 'Luthfia Putri Hidayat', pin: '444444', role: 'Crew', is_active: 1, can_access_reports: 0, created_at: '2026-09-06T07:42:06.853Z' },
      { id: 5, employee_id: 'CKBS05', name: 'Riska Perilia', pin: '555555', role: 'Crew', is_active: 1, can_access_reports: 0, created_at: '2026-09-06T07:43:18.313Z' },
      { id: 6, employee_id: 'TEST01', name: 'KARYAWAN TEST', pin: '1234', role: 'Barista', is_active: 1, can_access_reports: 1, created_at: '2026-09-06T08:01:00.421Z' }
    ],
    attendances: []
  };
}

function loadJsonStore() {
  if (jsonStore) return jsonStore;
  if (fs.existsSync(JSON_STORE_PATH)) {
    try {
      jsonStore = JSON.parse(fs.readFileSync(JSON_STORE_PATH, 'utf8'));
      if (jsonStore.employees) {
        jsonStore.employees.forEach(e => {
          if (e.can_access_reports === undefined) e.can_access_reports = 0;
        });
      }
      if (!jsonStore.settings.shift_time_enabled) {
        jsonStore.settings.shift_time_enabled = '1';
      }
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

let dbReadyPromise = null;
function ensureDatabaseReady() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDatabase().catch(err => {
      dbReadyPromise = null;
      console.error('[DB] Gagal inisialisasi DB:', err.message);
    });
  }
  return dbReadyPromise;
}

// Inisialisasi Tabel & Skema
async function initDatabase() {
  // 1. Jika mode Turso Cloud aktif
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      await tursoExecute(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      await tursoExecute(`
        CREATE TABLE IF NOT EXISTS employees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          pin TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'Crew',
          is_active INTEGER NOT NULL DEFAULT 1,
          can_access_reports INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )
      `);
      await tursoExecute(`
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
          status TEXT NOT NULL DEFAULT 'CHECKED_IN',
          scheduled_in TEXT,
          scheduled_out TEXT,
          is_late INTEGER NOT NULL DEFAULT 0,
          correction_status TEXT,
          correction_reason TEXT,
          first_checkout_time TEXT,
          notes TEXT
        )
      `);

      // Cek alter kolom tambahan jika tabel sudah ada sebelumnya
      const alterCols = [
        'ALTER TABLE attendances ADD COLUMN scheduled_in TEXT',
        'ALTER TABLE attendances ADD COLUMN scheduled_out TEXT',
        'ALTER TABLE attendances ADD COLUMN is_late INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE attendances ADD COLUMN correction_status TEXT',
        'ALTER TABLE attendances ADD COLUMN correction_reason TEXT',
        'ALTER TABLE attendances ADD COLUMN first_checkout_time TEXT',
        'ALTER TABLE attendances ADD COLUMN notes TEXT'
      ];
      for (const colSql of alterCols) {
        try { await tursoExecute(colSql); } catch(e) {}
      }

      // Seed default settings jika belum ada
      const defaultSettings = [
        ['shop_name', 'KAPEBOONSEEN'],
        ['latitude', '-6.882377731222678'],
        ['longitude', '107.53165355029745'],
        ['radius_meters', '25'],
        ['owner_pin', '200295'],
        ['gps_enforced', '1'],
        ['shift_time_enabled', '1']
      ];
      for (const [key, val] of defaultSettings) {
        const exist = await tursoExecute('SELECT value FROM settings WHERE key = ?', [key]);
        if (!exist.rows || exist.rows.length === 0) {
          await tursoExecute('INSERT INTO settings (key, value) VALUES (?, ?)', [key, val]);
        }
      }

      // Seed default employees jika kosong
      const empCount = await tursoExecute('SELECT COUNT(*) as count FROM employees');
      let totalEmps = 0;
      if (empCount && empCount.rows && empCount.rows.length > 0) {
        const row0 = empCount.rows[0];
        const val = row0.count !== undefined ? row0.count : Object.values(row0)[0];
        totalEmps = Number(val) || 0;
      }
      if (totalEmps === 0) {
        const now = new Date().toISOString();
        const initialEmps = [
          ['CKBS01', 'Raska Novanpurian', '111111', 'Barista', 1, 1, now],
          ['CKBS02', 'Shiddiq Hibatullah M', '222222', 'Head Bar', 1, 1, now],
          ['CKBS03', 'Salsa Nabila', '333333', 'Crew', 1, 0, now],
          ['CKBS04', 'Luthfia Putri Hidayat', '444444', 'Crew', 1, 0, now],
          ['CKBS05', 'Riska Perilia', '555555', 'Crew', 1, 0, now]
        ];
        for (const emp of initialEmps) {
          try {
            await tursoExecute(`
              INSERT INTO employees (employee_id, name, pin, role, is_active, can_access_reports, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, emp);
          } catch (e) {}
        }
      }
      return;
    } catch (tursoErr) {
      console.error('[DB] Gagal inisialisasi Turso Cloud:', tursoErr.message);
    }
  }

  // 2. Jika mode SQLite lokal aktif
  if (db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        pin TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Crew',
        is_active INTEGER NOT NULL DEFAULT 1,
        can_access_reports INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // Tambah kolom can_access_reports jika tabel lama belum memilikinya
    try {
      db.exec('ALTER TABLE employees ADD COLUMN can_access_reports INTEGER NOT NULL DEFAULT 0');
    } catch (e) {}
    try {
      db.exec("UPDATE employees SET can_access_reports = 1 WHERE UPPER(employee_id) IN ('CKBS01', 'CKBS02', 'TEST01')");
    } catch (e) {}

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
        status TEXT NOT NULL DEFAULT 'CHECKED_IN',
        scheduled_in TEXT,
        scheduled_out TEXT,
        is_late INTEGER NOT NULL DEFAULT 0,
        correction_status TEXT,
        correction_reason TEXT,
        first_checkout_time TEXT,
        notes TEXT
      );
    `);

    // Tambah kolom-kolom baru jika tabel lama belum ada
    try { db.exec('ALTER TABLE attendances ADD COLUMN scheduled_in TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE attendances ADD COLUMN scheduled_out TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE attendances ADD COLUMN is_late INTEGER NOT NULL DEFAULT 0'); } catch (e) {}
    try { db.exec('ALTER TABLE attendances ADD COLUMN correction_status TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE attendances ADD COLUMN correction_reason TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE attendances ADD COLUMN first_checkout_time TEXT'); } catch (e) {}
    try { db.exec('ALTER TABLE attendances ADD COLUMN notes TEXT'); } catch (e) {}

    const defaultSettings = [
      { key: 'shop_name', value: 'KAPEBOONSEEN' },
      { key: 'latitude', value: '-6.882377731222678' },
      { key: 'longitude', value: '107.53165355029745' },
      { key: 'radius_meters', value: '25' },
      { key: 'owner_pin', value: '200295' },
      { key: 'gps_enforced', value: '1' },
      { key: 'shift_time_enabled', value: '1' }
    ];

    const checkSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const insertSettingStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

    for (const s of defaultSettings) {
      const existing = checkSettingStmt.get(s.key);
      if (!existing) {
        insertSettingStmt.run(s.key, s.value);
      }
    }

    const empCount = db.prepare('SELECT COUNT(*) as count FROM employees').get();
    if (empCount && empCount.count === 0) {
      const insertEmp = db.prepare(`
        INSERT INTO employees (employee_id, name, pin, role, is_active, can_access_reports, created_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `);
      const now = new Date().toISOString();
      insertEmp.run('CKBS01', 'Raska Novanpurian', '111111', 'Barista', 1, now);
      insertEmp.run('CKBS02', 'Shiddiq Hibatullah M', '222222', 'Head Bar', 1, now);
      insertEmp.run('CKBS03', 'Salsa Nabila', '333333', 'Crew', 0, now);
      insertEmp.run('CKBS04', 'Luthfia Putri Hidayat', '444444', 'Crew', 0, now);
      insertEmp.run('CKBS05', 'Riska Perilia', '555555', 'Crew', 0, now);
      insertEmp.run('TEST01', 'KARYAWAN TEST', '1234', 'Barista', 1, now);
    }
    return;
  }

  // 3. Mode JSON Fallback
  loadJsonStore();
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

// Status Penyimpanan Sistem
function getDatabaseStatus() {
  if (TURSO_URL && TURSO_TOKEN) {
    return {
      mode: 'turso_cloud',
      mode_name: 'Turso Cloud SQLite',
      is_persistent_cloud: true,
      description: 'Data tersimpan aman & permanen di Cloud SQLite. Tidak akan pernah hilang meskipun Vercel restart atau update kode.'
    };
  }
  if (db) {
    return {
      mode: 'sqlite_local',
      mode_name: 'SQLite Lokal',
      is_persistent_cloud: false,
      description: 'Penyimpanan lokal aktif. Untuk Vercel serverless, gunakan Turso Cloud agar data tersimpan permanen.'
    };
  }
  return {
    mode: 'json_store',
    mode_name: 'JSON Store Fallback',
    is_persistent_cloud: false,
    description: 'Mode cadangan JSON aktif. Untuk Vercel serverless, pasang Turso Cloud agar data tersimpan permanen.'
  };
}

// ==================== HELPER PENGATURAN KEDAI ====================
async function getAllSettings() {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute('SELECT key, value FROM settings');
      const settings = {};
      for (const row of res.rows) {
        settings[row.key] = row.value;
      }
      return settings;
    } catch (e) {}
  }
  if (db) {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }
  const store = loadJsonStore();
  return { ...store.settings };
}

async function updateSetting(key, value) {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      await tursoExecute(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `, [key, String(value)]);
      return;
    } catch (e) {}
  }
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(key, String(value));
    return;
  }
  const store = loadJsonStore();
  store.settings[key] = String(value);
  saveJsonStore();
}

// ==================== HELPER PEGAWAI ====================
async function findEmployeeByCredentials(employeeId, pin) {
  const cleanId = String(employeeId || '').trim().toUpperCase();
  const cleanPin = String(pin || '').trim();

  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute(`
        SELECT id, employee_id, name, pin, role, is_active, can_access_reports
        FROM employees
        WHERE UPPER(employee_id) = ? AND pin = ? AND is_active = 1
      `, [cleanId, cleanPin]);
      return res.rows[0] || null;
    } catch (e) {}
  }

  if (db) {
    const stmt = db.prepare(`
      SELECT id, employee_id, name, pin, role, is_active, can_access_reports
      FROM employees 
      WHERE UPPER(employee_id) = ? AND pin = ? AND is_active = 1
    `);
    return stmt.get(cleanId, cleanPin) || null;
  }

  const store = loadJsonStore();
  return store.employees.find(e => 
    e.employee_id.toUpperCase() === cleanId && 
    String(e.pin).trim() === cleanPin && 
    e.is_active === 1
  ) || null;
}

// Cek apakah pegawai memiliki izin akses laporan (can_access_reports = 1)
async function findEmployeeWithReportAccess(employeeId, pin) {
  const emp = await findEmployeeByCredentials(employeeId, pin);
  if (!emp) return null;
  if (emp.can_access_reports === 1 || emp.can_access_reports === '1') {
    return emp;
  }
  return null;
}

async function getAllEmployees(includeInactive = false) {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const sql = includeInactive
        ? 'SELECT id, employee_id, name, pin, role, is_active, can_access_reports, created_at FROM employees ORDER BY employee_id ASC'
        : 'SELECT id, employee_id, name, pin, role, is_active, can_access_reports, created_at FROM employees WHERE is_active = 1 ORDER BY employee_id ASC';
      let res = await tursoExecute(sql);
      if (!res || !res.rows || res.rows.length === 0) {
        // Auto-seed data awal jika Turso masih kosong
        const now = new Date().toISOString();
        const initialEmps = [
          ['CKBS01', 'Raska Novanpurian', '111111', 'Barista', 1, 1, now],
          ['CKBS02', 'Shiddiq Hibatullah M', '222222', 'Head Bar', 1, 1, now],
          ['CKBS03', 'Salsa Nabila', '333333', 'Crew', 1, 0, now],
          ['CKBS04', 'Luthfia Putri Hidayat', '444444', 'Crew', 1, 0, now],
          ['CKBS05', 'Riska Perilia', '555555', 'Crew', 1, 0, now]
        ];
        for (const emp of initialEmps) {
          try {
            await tursoExecute(`
              INSERT INTO employees (employee_id, name, pin, role, is_active, can_access_reports, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, emp);
          } catch (e) {}
        }
        res = await tursoExecute(sql);
      }
      return res && res.rows ? res.rows : [];
    } catch (e) {
      console.error('[DB] Gagal ambil pegawai Turso:', e.message);
    }
  }

  if (db) {
    const query = includeInactive 
      ? 'SELECT id, employee_id, name, pin, role, is_active, can_access_reports, created_at FROM employees ORDER BY employee_id ASC'
      : 'SELECT id, employee_id, name, pin, role, is_active, can_access_reports, created_at FROM employees WHERE is_active = 1 ORDER BY employee_id ASC';
    return db.prepare(query).all();
  }

  const store = loadJsonStore();
  const list = includeInactive ? store.employees : store.employees.filter(e => e.is_active === 1);
  return list.slice().sort((a, b) => a.employee_id.localeCompare(b.employee_id));
}

async function addEmployee(employeeId, name, pin, role, canAccessReports = 0) {
  const cleanId = employeeId.trim().toUpperCase();
  const reportPerm = canAccessReports ? 1 : 0;
  const now = new Date().toISOString();

  if (TURSO_URL && TURSO_TOKEN) {
    const exist = await tursoExecute('SELECT id FROM employees WHERE UPPER(employee_id) = ?', [cleanId]);
    if (exist.rows && exist.rows.length > 0) {
      throw new Error('ID Pegawai sudah terdaftar');
    }
    return tursoExecute(`
      INSERT INTO employees (employee_id, name, pin, role, is_active, can_access_reports, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `, [cleanId, name.trim(), pin.trim(), (role || 'Crew').trim(), reportPerm, now]);
  }

  if (db) {
    const stmt = db.prepare(`
      INSERT INTO employees (employee_id, name, pin, role, is_active, can_access_reports, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `);
    return stmt.run(cleanId, name.trim(), pin.trim(), (role || 'Crew').trim(), reportPerm, now);
  }

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
    can_access_reports: reportPerm,
    created_at: now
  };
  store.employees.push(newEmp);
  saveJsonStore();
  return { changes: 1 };
}

async function updateEmployee(id, employeeId, name, pin, role, isActive, canAccessReports = 0) {
  const cleanId = employeeId.trim().toUpperCase();
  const activeInt = isActive ? 1 : 0;
  const reportPerm = canAccessReports ? 1 : 0;
  const idNum = Number(id);

  if (TURSO_URL && TURSO_TOKEN) {
    // 1. Cek apakah ID baru sudah dipakai oleh pegawai lain
    const checkDup = await tursoExecute('SELECT id FROM employees WHERE UPPER(employee_id) = ? AND id != ?', [cleanId, idNum]);
    if (checkDup && checkDup.rows && checkDup.rows.length > 0) {
      throw new Error(`ID Pegawai "${cleanId}" sudah digunakan oleh pegawai lain!`);
    }

    // 2. Ambil ID lama pegawai untuk sinkronisasi data absensi
    const oldEmp = await tursoExecute('SELECT employee_id FROM employees WHERE id = ?', [idNum]);
    const oldEmpId = (oldEmp && oldEmp.rows && oldEmp.rows[0]) ? oldEmp.rows[0].employee_id : null;

    if (pin && pin.trim().length > 0) {
      await tursoExecute(`
        UPDATE employees 
        SET employee_id = ?, name = ?, pin = ?, role = ?, is_active = ?, can_access_reports = ?
        WHERE id = ?
      `, [cleanId, name.trim(), pin.trim(), (role || 'Crew').trim(), activeInt, reportPerm, idNum]);
    } else {
      await tursoExecute(`
        UPDATE employees 
        SET employee_id = ?, name = ?, role = ?, is_active = ?, can_access_reports = ?
        WHERE id = ?
      `, [cleanId, name.trim(), (role || 'Crew').trim(), activeInt, reportPerm, idNum]);
    }

    // 3. Jika ID diubah, perbarui seluruh riwayat absensi pegawai ini ke ID baru
    if (oldEmpId && oldEmpId.toUpperCase() !== cleanId) {
      await tursoExecute('UPDATE attendances SET employee_id = ? WHERE UPPER(employee_id) = ?', [cleanId, oldEmpId.toUpperCase()]);
    }

    return { changes: 1 };
  }

  if (db) {
    // 1. Cek duplikasi ID
    const checkDup = db.prepare('SELECT id FROM employees WHERE UPPER(employee_id) = ? AND id != ?').get(cleanId, idNum);
    if (checkDup) {
      throw new Error(`ID Pegawai "${cleanId}" sudah digunakan oleh pegawai lain!`);
    }

    // 2. Ambil ID lama
    const oldEmp = db.prepare('SELECT employee_id FROM employees WHERE id = ?').get(idNum);
    const oldEmpId = oldEmp ? oldEmp.employee_id : null;

    if (pin && pin.trim().length > 0) {
      const stmt = db.prepare(`
        UPDATE employees 
        SET employee_id = ?, name = ?, pin = ?, role = ?, is_active = ?, can_access_reports = ?
        WHERE id = ?
      `);
      stmt.run(cleanId, name.trim(), pin.trim(), (role || 'Crew').trim(), activeInt, reportPerm, idNum);
    } else {
      const stmt = db.prepare(`
        UPDATE employees 
        SET employee_id = ?, name = ?, role = ?, is_active = ?, can_access_reports = ?
        WHERE id = ?
      `);
      stmt.run(cleanId, name.trim(), (role || 'Crew').trim(), activeInt, reportPerm, idNum);
    }

    // 3. Sinkronkan riwayat absensi jika ID berubah
    if (oldEmpId && oldEmpId.toUpperCase() !== cleanId) {
      const stmtAtt = db.prepare('UPDATE attendances SET employee_id = ? WHERE UPPER(employee_id) = ?');
      stmtAtt.run(cleanId, oldEmpId.toUpperCase());
    }

    return { changes: 1 };
  }

  const store = loadJsonStore();
  const empDup = store.employees.find(e => e.employee_id.toUpperCase() === cleanId && e.id !== idNum);
  if (empDup) {
    throw new Error(`ID Pegawai "${cleanId}" sudah digunakan oleh pegawai lain!`);
  }

  const emp = store.employees.find(e => e.id === idNum);
  if (emp) {
    const oldEmpId = emp.employee_id;
    emp.employee_id = cleanId;
    emp.name = name.trim();
    if (pin && pin.trim().length > 0) emp.pin = pin.trim();
    emp.role = (role || 'Crew').trim();
    emp.is_active = activeInt;
    emp.can_access_reports = reportPerm;

    // Sinkronkan riwayat absensi jika ID berubah
    if (oldEmpId && oldEmpId.toUpperCase() !== cleanId) {
      store.attendances.forEach(a => {
        if (a.employee_id.toUpperCase() === oldEmpId.toUpperCase()) {
          a.employee_id = cleanId;
        }
      });
    }

    saveJsonStore();
  }
  return { changes: 1 };
}

async function updateEmployeePin(employeeId, newPin) {
  const cleanId = employeeId.trim().toUpperCase();
  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute(`
      UPDATE employees SET pin = ? WHERE UPPER(employee_id) = ?
    `, [newPin.trim(), cleanId]);
  }
  if (db) {
    const stmt = db.prepare(`
      UPDATE employees SET pin = ? WHERE UPPER(employee_id) = UPPER(?)
    `);
    return stmt.run(newPin.trim(), employeeId.trim());
  }
  const store = loadJsonStore();
  const emp = store.employees.find(e => e.employee_id.toUpperCase() === cleanId);
  if (emp) {
    emp.pin = newPin.trim();
    saveJsonStore();
  }
  return { changes: 1 };
}

async function deleteEmployee(id) {
  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute('UPDATE employees SET is_active = 0 WHERE id = ?', [id]);
  }
  if (db) {
    const stmt = db.prepare('UPDATE employees SET is_active = 0 WHERE id = ?');
    return stmt.run(id);
  }
  const store = loadJsonStore();
  const emp = store.employees.find(e => e.id === Number(id));
  if (emp) {
    emp.is_active = 0;
    saveJsonStore();
  }
  return { changes: 1 };
}

// ==================== HELPER ABSENSI & TRANSAKSI ====================
async function getTodayAttendance(employeeId, dateStr) {
  const cleanId = employeeId.toUpperCase();
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute(`
        SELECT * FROM attendances 
        WHERE UPPER(employee_id) = ? AND date = ?
        ORDER BY id DESC LIMIT 1
      `, [cleanId, dateStr]);
      return res.rows[0] || null;
    } catch (e) {}
  }
  if (db) {
    const stmt = db.prepare(`
      SELECT * FROM attendances 
      WHERE UPPER(employee_id) = UPPER(?) AND date = ?
      ORDER BY id DESC LIMIT 1
    `);
    return stmt.get(employeeId, dateStr) || null;
  }
  const store = loadJsonStore();
  return store.attendances.slice().reverse().find(a => 
    a.employee_id.toUpperCase() === cleanId && a.date === dateStr
  ) || null;
}

// Check-In dengan Pilihan Waktu & Keterlambatan
async function createCheckIn(employeeId, dateStr, timeStr, lat, lng, distance, scheduledIn = null, isLate = 0) {
  const cleanId = employeeId.toUpperCase();
  const lateVal = isLate ? 1 : 0;

  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute(`
      INSERT INTO attendances 
        (employee_id, date, check_in_time, check_in_lat, check_in_lng, check_in_distance, status, total_minutes, scheduled_in, is_late)
      VALUES (?, ?, ?, ?, ?, ?, 'CHECKED_IN', 0, ?, ?)
    `, [cleanId, dateStr, timeStr, lat || null, lng || null, distance || 0, scheduledIn, lateVal]);
  }
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO attendances 
        (employee_id, date, check_in_time, check_in_lat, check_in_lng, check_in_distance, status, total_minutes, scheduled_in, is_late)
      VALUES (?, ?, ?, ?, ?, ?, 'CHECKED_IN', 0, ?, ?)
    `);
    return stmt.run(cleanId, dateStr, timeStr, lat || null, lng || null, distance || 0, scheduledIn, lateVal);
  }
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
    status: 'CHECKED_IN',
    scheduled_in: scheduledIn,
    scheduled_out: null,
    is_late: lateVal,
    correction_status: null,
    correction_reason: null,
    first_checkout_time: null,
    notes: null
  };
  store.attendances.push(newAtt);
  saveJsonStore();
  return { changes: 1 };
}

// Check-Out
async function performCheckOut(attendanceId, timeStr, lat, lng, distance, totalMinutes, scheduledOut = null) {
  const idNum = Number(attendanceId);
  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute(`
      UPDATE attendances 
      SET check_out_time = ?, 
          check_out_lat = ?, 
          check_out_lng = ?, 
          check_out_distance = ?, 
          total_minutes = ?, 
          status = 'COMPLETED',
          scheduled_out = ?
      WHERE id = ?
    `, [timeStr, lat || null, lng || null, distance || 0, totalMinutes, scheduledOut, idNum]);
  }
  if (db) {
    const stmt = db.prepare(`
      UPDATE attendances 
      SET check_out_time = ?, 
          check_out_lat = ?, 
          check_out_lng = ?, 
          check_out_distance = ?, 
          total_minutes = ?, 
          status = 'COMPLETED',
          scheduled_out = ?
      WHERE id = ?
    `);
    return stmt.run(timeStr, lat || null, lng || null, distance, totalMinutes, scheduledOut, idNum);
  }
  const store = loadJsonStore();
  const record = store.attendances.find(a => a.id === idNum);
  if (record) {
    record.check_out_time = timeStr;
    record.check_out_lat = lat || null;
    record.check_out_lng = lng || null;
    record.check_out_distance = distance || 0;
    record.total_minutes = totalMinutes;
    record.status = 'COMPLETED';
    record.scheduled_out = scheduledOut;
    saveJsonStore();
  }
  return { changes: 1 };
}

// ==================== ALUR KOREKSI / BATAL CHECK-OUT ====================

// 1. Pegawai Mengajukan Koreksi Check-Out
async function requestCheckoutCorrection(attendanceId, reason = 'Salah klik check-out sebelum jam pulang') {
  const idNum = Number(attendanceId);
  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute(`
      UPDATE attendances 
      SET correction_status = 'PENDING',
          correction_reason = ?
      WHERE id = ?
    `, [reason, idNum]);
  }
  if (db) {
    const stmt = db.prepare(`
      UPDATE attendances 
      SET correction_status = 'PENDING',
          correction_reason = ?
      WHERE id = ?
    `);
    return stmt.run(reason, idNum);
  }
  const store = loadJsonStore();
  const record = store.attendances.find(a => a.id === idNum);
  if (record) {
    record.correction_status = 'PENDING';
    record.correction_reason = reason;
    saveJsonStore();
  }
  return { changes: 1 };
}

// 2. Owner Menyetujui Koreksi (Pegawai kembali CHECKED_IN & bisa Check-Out ulang)
async function approveCheckoutCorrection(attendanceId) {
  const idNum = Number(attendanceId);
  let prevCheckout = null;

  if (TURSO_URL && TURSO_TOKEN) {
    const cur = await tursoExecute('SELECT check_out_time, first_checkout_time, notes FROM attendances WHERE id = ?', [idNum]);
    if (cur.rows && cur.rows[0]) {
      prevCheckout = cur.rows[0].first_checkout_time || cur.rows[0].check_out_time || '-';
    }
    const noteText = `Koreksi: Salah klik checkout jam ${prevCheckout}`;
    return tursoExecute(`
      UPDATE attendances 
      SET status = 'CHECKED_IN',
          check_out_time = NULL,
          check_out_lat = NULL,
          check_out_lng = NULL,
          check_out_distance = NULL,
          total_minutes = 0,
          correction_status = 'APPROVED',
          first_checkout_time = COALESCE(first_checkout_time, ?),
          notes = ?
      WHERE id = ?
    `, [prevCheckout, noteText, idNum]);
  }

  if (db) {
    const cur = db.prepare('SELECT check_out_time, first_checkout_time, notes FROM attendances WHERE id = ?').get(idNum);
    if (cur) {
      prevCheckout = cur.first_checkout_time || cur.check_out_time || '-';
    }
    const noteText = `Koreksi: Salah klik checkout jam ${prevCheckout}`;
    const stmt = db.prepare(`
      UPDATE attendances 
      SET status = 'CHECKED_IN',
          check_out_time = NULL,
          check_out_lat = NULL,
          check_out_lng = NULL,
          check_out_distance = NULL,
          total_minutes = 0,
          correction_status = 'APPROVED',
          first_checkout_time = COALESCE(first_checkout_time, ?),
          notes = ?
      WHERE id = ?
    `);
    return stmt.run(prevCheckout, noteText, idNum);
  }

  const store = loadJsonStore();
  const record = store.attendances.find(a => a.id === idNum);
  if (record) {
    prevCheckout = record.first_checkout_time || record.check_out_time || '-';
    record.status = 'CHECKED_IN';
    record.first_checkout_time = record.first_checkout_time || record.check_out_time;
    record.notes = `Koreksi: Salah klik checkout jam ${prevCheckout}`;
    record.check_out_time = null;
    record.check_out_lat = null;
    record.check_out_lng = null;
    record.check_out_distance = null;
    record.total_minutes = 0;
    record.correction_status = 'APPROVED';
    saveJsonStore();
  }
  return { changes: 1 };
}

// 3. Owner Menolak Koreksi
async function rejectCheckoutCorrection(attendanceId) {
  const idNum = Number(attendanceId);
  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute(`
      UPDATE attendances SET correction_status = 'REJECTED' WHERE id = ?
    `, [idNum]);
  }
  if (db) {
    return db.prepare("UPDATE attendances SET correction_status = 'REJECTED' WHERE id = ?").run(idNum);
  }
  const store = loadJsonStore();
  const record = store.attendances.find(a => a.id === idNum);
  if (record) {
    record.correction_status = 'REJECTED';
    saveJsonStore();
  }
  return { changes: 1 };
}

// 4. Dapatkan Daftar Pengajuan Koreksi yang Menunggu (Pending)
async function getPendingCorrections() {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute(`
        SELECT a.id, a.employee_id, COALESCE(e.name, a.employee_id) as name, 
               COALESCE(e.role, 'Crew') as role, a.date, a.check_in_time, a.check_out_time,
               a.correction_reason, a.correction_status
        FROM attendances a
        LEFT JOIN employees e ON UPPER(a.employee_id) = UPPER(e.employee_id)
        WHERE a.correction_status = 'PENDING'
        ORDER BY a.id DESC
      `);
      return res.rows || [];
    } catch (e) {}
  }
  if (db) {
    return db.prepare(`
      SELECT a.id, a.employee_id, COALESCE(e.name, a.employee_id) as name, 
             COALESCE(e.role, 'Crew') as role, a.date, a.check_in_time, a.check_out_time,
             a.correction_reason, a.correction_status
      FROM attendances a
      LEFT JOIN employees e ON UPPER(a.employee_id) = UPPER(e.employee_id)
      WHERE a.correction_status = 'PENDING'
      ORDER BY a.id DESC
    `).all();
  }
  const store = loadJsonStore();
  const empMap = new Map(store.employees.map(e => [e.employee_id.toUpperCase(), e]));
  return store.attendances
    .filter(a => a.correction_status === 'PENDING')
    .map(a => {
      const emp = empMap.get(a.employee_id.toUpperCase()) || {};
      return {
        id: a.id,
        employee_id: a.employee_id,
        name: emp.name || a.employee_id,
        role: emp.role || 'Crew',
        date: a.date,
        check_in_time: a.check_in_time,
        check_out_time: a.check_out_time,
        correction_reason: a.correction_reason,
        correction_status: a.correction_status
      };
    });
}

// Menghitung ringkasan kerja harian, mingguan, dan bulanan untuk seorang pegawai
async function getEmployeeSummary(employeeId, todayDateStr) {
  const cleanId = employeeId.toUpperCase();
  const todayRecord = await getTodayAttendance(cleanId, todayDateStr);
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

  // Rentang Minggu Ini (Senin s/d Minggu)
  const d = new Date(todayDateStr);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const startWeekStr = monday.toISOString().split('T')[0];
  const endWeekStr = sunday.toISOString().split('T')[0];
  const monthPrefix = todayDateStr.substring(0, 7);

  let weekMinutes = 0;
  let monthMinutes = 0;
  let history = [];

  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const weekRes = await tursoExecute(`
        SELECT total_minutes FROM attendances 
        WHERE UPPER(employee_id) = ? AND date >= ? AND date <= ? AND status = 'COMPLETED'
      `, [cleanId, startWeekStr, endWeekStr]);
      weekMinutes = (weekRes.rows || []).reduce((acc, row) => acc + (Number(row.total_minutes) || 0), 0);

      const monthRes = await tursoExecute(`
        SELECT total_minutes FROM attendances 
        WHERE UPPER(employee_id) = ? AND date LIKE ? AND status = 'COMPLETED'
      `, [cleanId, `${monthPrefix}%`]);
      monthMinutes = (monthRes.rows || []).reduce((acc, row) => acc + (Number(row.total_minutes) || 0), 0);

      const histRes = await tursoExecute(`
        SELECT date, check_in_time, check_out_time, total_minutes, status 
        FROM attendances 
        WHERE UPPER(employee_id) = ?
        ORDER BY date DESC, id DESC LIMIT 10
      `, [cleanId]);
      history = histRes.rows || [];
    } catch (e) {}
  } else if (db) {
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
  } else {
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

// ==================== REKAPAN UNTUK OWNER & SUPERVISOR ====================
async function getDailyRecapForAdmin(dateStr) {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute(`
        SELECT e.employee_id, e.name, e.role, 
               a.id as attendance_id, a.date, a.check_in_time, a.check_out_time, 
               a.check_in_distance, a.check_out_distance, a.total_minutes, a.status,
               a.scheduled_in, a.scheduled_out, a.is_late, a.correction_status, 
               a.first_checkout_time, a.notes
        FROM employees e
        LEFT JOIN attendances a ON UPPER(e.employee_id) = UPPER(a.employee_id) AND a.date = ?
        WHERE e.is_active = 1
        ORDER BY e.employee_id ASC
      `, [dateStr]);
      return (res.rows || []).map(r => ({
        ...r,
        formatted_duration: formatMinutesToHours(Number(r.total_minutes) || 0)
      }));
    } catch (e) {}
  }

  if (db) {
    const rows = db.prepare(`
      SELECT e.employee_id, e.name, e.role, 
             a.id as attendance_id, a.date, a.check_in_time, a.check_out_time, 
             a.check_in_distance, a.check_out_distance, a.total_minutes, a.status,
             a.scheduled_in, a.scheduled_out, a.is_late, a.correction_status, 
             a.first_checkout_time, a.notes
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
      check_out_distance: att ? att.check_out_distance : null,
      total_minutes: att ? att.total_minutes : null,
      status: att ? att.status : null,
      scheduled_in: att ? att.scheduled_in : null,
      scheduled_out: att ? att.scheduled_out : null,
      is_late: att ? att.is_late : 0,
      correction_status: att ? att.correction_status : null,
      first_checkout_time: att ? att.first_checkout_time : null,
      notes: att ? att.notes : null,
      formatted_duration: formatMinutesToHours(totalMin)
    };
  });
}

// Rekapan Mingguan (Dengan Jumlah Terlambat)
async function getWeeklyRecapForAdmin(startDateStr, endDateStr) {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute(`
        SELECT e.employee_id, e.name, e.role,
               COUNT(a.id) as total_days_present,
               COALESCE(SUM(a.total_minutes), 0) as total_minutes,
               COALESCE(SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END), 0) as total_late
        FROM employees e
        LEFT JOIN attendances a ON UPPER(e.employee_id) = UPPER(a.employee_id) 
             AND a.date >= ? AND a.date <= ? AND a.status = 'COMPLETED'
        WHERE e.is_active = 1
        GROUP BY e.employee_id, e.name, e.role
        ORDER BY total_minutes DESC
      `, [startDateStr, endDateStr]);
      return (res.rows || []).map(r => ({
        ...r,
        total_days_present: Number(r.total_days_present) || 0,
        total_minutes: Number(r.total_minutes) || 0,
        total_late: Number(r.total_late) || 0,
        formatted_duration: formatMinutesToHours(Number(r.total_minutes) || 0)
      }));
    } catch (e) {}
  }

  if (db) {
    const rows = db.prepare(`
      SELECT e.employee_id, e.name, e.role,
             COUNT(a.id) as total_days_present,
             COALESCE(SUM(a.total_minutes), 0) as total_minutes,
             COALESCE(SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END), 0) as total_late
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
    const totalLate = atts.reduce((sum, a) => sum + (a.is_late ? 1 : 0), 0);
    return {
      employee_id: e.employee_id,
      name: e.name,
      role: e.role,
      total_days_present: totalDays,
      total_minutes: totalMinutes,
      total_late: totalLate,
      formatted_duration: formatMinutesToHours(totalMinutes)
    };
  }).sort((a, b) => b.total_minutes - a.total_minutes);
}

// Rekapan Bulanan (Dengan Jumlah Terlambat)
async function getMonthlyRecapForAdmin(yearMonthStr) {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute(`
        SELECT e.employee_id, e.name, e.role,
               COUNT(a.id) as total_days_present,
               COALESCE(SUM(a.total_minutes), 0) as total_minutes,
               COALESCE(SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END), 0) as total_late
        FROM employees e
        LEFT JOIN attendances a ON UPPER(e.employee_id) = UPPER(a.employee_id) 
             AND a.date LIKE ? AND a.status = 'COMPLETED'
        WHERE e.is_active = 1
        GROUP BY e.employee_id, e.name, e.role
        ORDER BY total_minutes DESC
      `, [`${yearMonthStr}%`]);
      return (res.rows || []).map(r => ({
        ...r,
        total_days_present: Number(r.total_days_present) || 0,
        total_minutes: Number(r.total_minutes) || 0,
        total_late: Number(r.total_late) || 0,
        formatted_duration: formatMinutesToHours(Number(r.total_minutes) || 0)
      }));
    } catch (e) {}
  }

  if (db) {
    const rows = db.prepare(`
      SELECT e.employee_id, e.name, e.role,
             COUNT(a.id) as total_days_present,
             COALESCE(SUM(a.total_minutes), 0) as total_minutes,
             COALESCE(SUM(CASE WHEN a.is_late = 1 THEN 1 ELSE 0 END), 0) as total_late
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
    const totalLate = atts.reduce((sum, a) => sum + (a.is_late ? 1 : 0), 0);
    return {
      employee_id: e.employee_id,
      name: e.name,
      role: e.role,
      total_days_present: totalDays,
      total_minutes: totalMinutes,
      total_late: totalLate,
      formatted_duration: formatMinutesToHours(totalMinutes)
    };
  }).sort((a, b) => b.total_minutes - a.total_minutes);
}

// Master Log Seluruh Riwayat Absensi untuk Ekspor
async function getAllAttendanceLogs() {
  if (TURSO_URL && TURSO_TOKEN) {
    try {
      const res = await tursoExecute(`
        SELECT a.id, a.employee_id, COALESCE(e.name, a.employee_id) as name, 
               COALESCE(e.role, 'Crew') as role, a.date, 
               a.check_in_time, a.check_in_lat, a.check_in_lng, a.check_in_distance,
               a.check_out_time, a.check_out_lat, a.check_out_lng, a.check_out_distance,
               a.total_minutes, a.status, a.scheduled_in, a.scheduled_out, a.is_late,
               a.first_checkout_time, a.notes
        FROM attendances a
        LEFT JOIN employees e ON UPPER(a.employee_id) = UPPER(e.employee_id)
        ORDER BY a.date DESC, a.id DESC
      `);
      return (res.rows || []).map(r => ({
        ...r,
        total_minutes: Number(r.total_minutes) || 0,
        formatted_duration: formatMinutesToHours(Number(r.total_minutes) || 0)
      }));
    } catch (e) {}
  }

  if (db) {
    const rows = db.prepare(`
      SELECT a.id, a.employee_id, COALESCE(e.name, a.employee_id) as name, 
             COALESCE(e.role, 'Crew') as role, a.date, 
             a.check_in_time, a.check_in_lat, a.check_in_lng, a.check_in_distance,
             a.check_out_time, a.check_out_lat, a.check_out_lng, a.check_out_distance,
             a.total_minutes, a.status, a.scheduled_in, a.scheduled_out, a.is_late,
             a.first_checkout_time, a.notes
      FROM attendances a
      LEFT JOIN employees e ON UPPER(a.employee_id) = UPPER(e.employee_id)
      ORDER BY a.date DESC, a.id DESC
    `).all();

    return rows.map(r => ({
      ...r,
      formatted_duration: formatMinutesToHours(r.total_minutes || 0)
    }));
  }

  const store = loadJsonStore();
  const empMap = new Map(store.employees.map(e => [e.employee_id.toUpperCase(), e]));
  return store.attendances.slice().sort((a, b) => b.id - a.id).map(a => {
    const emp = empMap.get(a.employee_id.toUpperCase()) || {};
    return {
      id: a.id,
      employee_id: a.employee_id,
      name: emp.name || a.employee_id,
      role: emp.role || 'Crew',
      date: a.date,
      check_in_time: a.check_in_time,
      check_in_lat: a.check_in_lat,
      check_in_lng: a.check_in_lng,
      check_in_distance: a.check_in_distance,
      check_out_time: a.check_out_time,
      check_out_lat: a.check_out_lat,
      check_out_lng: a.check_out_lng,
      check_out_distance: a.check_out_distance,
      total_minutes: a.total_minutes || 0,
      status: a.status,
      scheduled_in: a.scheduled_in || null,
      scheduled_out: a.scheduled_out || null,
      is_late: a.is_late || 0,
      first_checkout_time: a.first_checkout_time || null,
      notes: a.notes || null,
      formatted_duration: formatMinutesToHours(a.total_minutes || 0)
    };
  });
}

// ==================== CADANGAN & PEMULIHAN (BACKUP & RESTORE) ====================
async function exportAllData() {
  const settings = await getAllSettings();
  const employees = await getAllEmployees(true);
  const attendances = await getAllAttendanceLogs();

  return {
    system: 'KAPEBOONSEEN',
    version: '2.1.0',
    exported_at: new Date().toISOString(),
    settings,
    employees,
    attendances
  };
}

async function importAllData(backupData) {
  if (!backupData || typeof backupData !== 'object') {
    throw new Error('Format file backup tidak valid');
  }

  // 1. Pulihkan Pengaturan jika ada
  if (backupData.settings && typeof backupData.settings === 'object') {
    for (const [key, value] of Object.entries(backupData.settings)) {
      if (value !== undefined && value !== null) {
        await updateSetting(key, String(value));
      }
    }
  }

  // 2. Pulihkan Pegawai jika ada
  if (Array.isArray(backupData.employees) && backupData.employees.length > 0) {
    if (TURSO_URL && TURSO_TOKEN) {
      await tursoExecute('DELETE FROM employees');
      for (const e of backupData.employees) {
        await tursoExecute(`
          INSERT INTO employees (employee_id, name, pin, role, is_active, can_access_reports, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          e.employee_id.toUpperCase(),
          e.name,
          e.pin || '1234',
          e.role || 'Crew',
          e.is_active !== undefined ? (e.is_active ? 1 : 0) : 1,
          e.can_access_reports ? 1 : 0,
          e.created_at || new Date().toISOString()
        ]);
      }
    } else if (db) {
      db.exec('DELETE FROM employees');
      const insertEmp = db.prepare(`
        INSERT INTO employees (employee_id, name, pin, role, is_active, can_access_reports, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const e of backupData.employees) {
        insertEmp.run(
          e.employee_id.toUpperCase(),
          e.name,
          e.pin || '1234',
          e.role || 'Crew',
          e.is_active !== undefined ? (e.is_active ? 1 : 0) : 1,
          e.can_access_reports ? 1 : 0,
          e.created_at || new Date().toISOString()
        );
      }
    } else {
      const store = loadJsonStore();
      store.employees = backupData.employees.map((e, idx) => ({
        id: idx + 1,
        employee_id: e.employee_id.toUpperCase(),
        name: e.name,
        pin: e.pin || '1234',
        role: e.role || 'Crew',
        is_active: e.is_active !== undefined ? (e.is_active ? 1 : 0) : 1,
        can_access_reports: e.can_access_reports ? 1 : 0,
        created_at: e.created_at || new Date().toISOString()
      }));
      saveJsonStore();
    }
  }

  // 3. Pulihkan Data Absensi jika ada
  if (Array.isArray(backupData.attendances)) {
    if (TURSO_URL && TURSO_TOKEN) {
      await tursoExecute('DELETE FROM attendances');
      for (const a of backupData.attendances) {
        await tursoExecute(`
          INSERT INTO attendances 
            (employee_id, date, check_in_time, check_out_time, 
             check_in_lat, check_in_lng, check_in_distance,
             check_out_lat, check_out_lng, check_out_distance,
             total_minutes, status, scheduled_in, scheduled_out, is_late,
             first_checkout_time, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          a.employee_id.toUpperCase(),
          a.date,
          a.check_in_time,
          a.check_out_time || null,
          a.check_in_lat || null,
          a.check_in_lng || null,
          a.check_in_distance || 0,
          a.check_out_lat || null,
          a.check_out_lng || null,
          a.check_out_distance || null,
          a.total_minutes || 0,
          a.status || 'COMPLETED',
          a.scheduled_in || null,
          a.scheduled_out || null,
          a.is_late || 0,
          a.first_checkout_time || null,
          a.notes || null
        ]);
      }
    } else if (db) {
      db.exec('DELETE FROM attendances');
      const insertAtt = db.prepare(`
        INSERT INTO attendances 
          (employee_id, date, check_in_time, check_out_time, 
           check_in_lat, check_in_lng, check_in_distance,
           check_out_lat, check_out_lng, check_out_distance,
           total_minutes, status, scheduled_in, scheduled_out, is_late,
           first_checkout_time, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of backupData.attendances) {
        insertAtt.run(
          a.employee_id.toUpperCase(),
          a.date,
          a.check_in_time,
          a.check_out_time || null,
          a.check_in_lat || null,
          a.check_in_lng || null,
          a.check_in_distance || 0,
          a.check_out_lat || null,
          a.check_out_lng || null,
          a.check_out_distance || null,
          a.total_minutes || 0,
          a.status || 'COMPLETED',
          a.scheduled_in || null,
          a.scheduled_out || null,
          a.is_late || 0,
          a.first_checkout_time || null,
          a.notes || null
        );
      }
    } else {
      const store = loadJsonStore();
      store.attendances = backupData.attendances.map((a, idx) => ({
        id: idx + 1,
        employee_id: a.employee_id.toUpperCase(),
        date: a.date,
        check_in_time: a.check_in_time,
        check_out_time: a.check_out_time || null,
        check_in_lat: a.check_in_lat || null,
        check_in_lng: a.check_in_lng || null,
        check_in_distance: a.check_in_distance || 0,
        check_out_lat: a.check_out_lat || null,
        check_out_lng: a.check_out_lng || null,
        check_out_distance: a.check_out_distance || null,
        total_minutes: a.total_minutes || 0,
        status: a.status || 'COMPLETED',
        scheduled_in: a.scheduled_in || null,
        scheduled_out: a.scheduled_out || null,
        is_late: a.is_late || 0,
        first_checkout_time: a.first_checkout_time || null,
        notes: a.notes || null
      }));
      saveJsonStore();
    }
  }

  return { success: true, message: 'Data berhasil dipulihkan!' };
}

// Hapus Riwayat Absensi (HANYA BISA DIJALANKAN OLEH OWNER)
async function clearAllAttendances() {
  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute('DELETE FROM attendances');
  }
  if (db) {
    return db.exec('DELETE FROM attendances');
  }
  const store = loadJsonStore();
  store.attendances = [];
  saveJsonStore();
  return { success: true };
}

async function deleteAttendanceRecord(attendanceId) {
  const idNum = Number(attendanceId);
  if (TURSO_URL && TURSO_TOKEN) {
    return tursoExecute('DELETE FROM attendances WHERE id = ?', [idNum]);
  }
  if (db) {
    const stmt = db.prepare('DELETE FROM attendances WHERE id = ?');
    return stmt.run(idNum);
  }
  const store = loadJsonStore();
  store.attendances = store.attendances.filter(a => a.id !== idNum);
  saveJsonStore();
  return { success: true };
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
  ensureDatabaseReady,
  calculateDistanceMeters,
  getDatabaseStatus,
  getAllSettings,
  updateSetting,
  findEmployeeByCredentials,
  findEmployeeWithReportAccess,
  getAllEmployees,
  addEmployee,
  updateEmployee,
  updateEmployeePin,
  deleteEmployee,
  getTodayAttendance,
  createCheckIn,
  performCheckOut,
  requestCheckoutCorrection,
  approveCheckoutCorrection,
  rejectCheckoutCorrection,
  getPendingCorrections,
  getEmployeeSummary,
  getDailyRecapForAdmin,
  getWeeklyRecapForAdmin,
  getMonthlyRecapForAdmin,
  getAllAttendanceLogs,
  exportAllData,
  importAllData,
  clearAllAttendances,
  deleteAttendanceRecord,
  formatMinutesToHours
};
