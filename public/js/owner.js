// State Dashboard Owner
let ownerPin = localStorage.getItem('owner_auth_pin') || '';
let currentTab = 'tab-daily';
let cachedSettings = {};

// Toast Notifikasi
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl shadow-2xl text-xs font-semibold z-50 transition-all max-w-[90%] text-center';

  if (type === 'success') {
    toast.classList.add('bg-emerald-600', 'text-white');
  } else if (type === 'error') {
    toast.classList.add('bg-rose-600', 'text-white');
  } else {
    toast.classList.add('bg-[#3A2010]', 'text-white');
  }

  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

// Format Tanggal Hari Ini
function getTodayDateStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

// Format Bulan Ini (YYYY-MM)
function getCurrentMonthStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// Header Autentikasi Owner
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-owner-pin': ownerPin
  };
}

// Verifikasi PIN Owner
async function verifyOwnerAccess() {
  if (!ownerPin) {
    document.getElementById('ownerLoginModal').classList.remove('hidden');
    return false;
  }

  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: ownerPin })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('ownerLoginModal').classList.add('hidden');
      loadTabContent(currentTab);
      return true;
    } else {
      localStorage.removeItem('owner_auth_pin');
      ownerPin = '';
      document.getElementById('ownerLoginModal').classList.remove('hidden');
      return false;
    }
  } catch (err) {
    showToast('Koneksi ke server gagal: ' + err.message, 'error');
    return false;
  }
}

// Tab Switching
function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => {
        b.classList.remove('bg-[#5E391C]', 'text-white');
        b.classList.add('bg-white', 'text-gray-700');
      });
      btn.classList.remove('bg-white', 'text-gray-700');
      btn.classList.add('bg-[#5E391C]', 'text-white');

      const targetTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
      });
      document.getElementById(targetTab).classList.remove('hidden');
      currentTab = targetTab;
      loadTabContent(targetTab);
    });
  });
}

function loadTabContent(tabId) {
  if (tabId === 'tab-daily') loadDailyRecap();
  if (tabId === 'tab-weekly') loadWeeklyRecap();
  if (tabId === 'tab-monthly') loadMonthlyRecap();
  if (tabId === 'tab-employees') loadEmployees();
  if (tabId === 'tab-settings') loadSettings();
}

// ==================== 1. TAB REKAPAN HARIAN ====================
async function loadDailyRecap() {
  const picker = document.getElementById('dailyDatePicker');
  const dateStr = picker.value || getTodayDateStr();
  picker.value = dateStr;

  document.getElementById('dailyDateTitle').textContent = `Tanggal: ${dateStr}`;

  try {
    const res = await fetch(`/api/admin/recap/daily?date=${dateStr}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message, 'error');
      return;
    }

    const rows = data.recap;
    const tbody = document.getElementById('dailyTableBody');

    let totalPresent = 0;
    let totalActive = 0;
    let totalCompleted = 0;

    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-gray-400">Belum ada pegawai terdaftar.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r => {
      let statusBadge = '<span class="badge-status badge-absent">Belum Hadir</span>';
      let inTime = '-';
      let outTime = '-';
      let distanceText = '-';
      let durationText = '-';

      if (r.attendance_id) {
        totalPresent++;
        inTime = `<span class="font-mono font-semibold">${r.check_in_time}</span>`;
        distanceText = `${r.check_in_distance || 0} meter`;

        if (r.status === 'CHECKED_IN') {
          totalActive++;
          statusBadge = '<span class="badge-status badge-present"><span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>Sedang Bertugas</span>';
          durationText = '<span class="text-emerald-700 font-medium italic">Sedang Berjalan</span>';
        } else if (r.status === 'COMPLETED') {
          totalCompleted++;
          outTime = `<span class="font-mono font-semibold">${r.check_out_time}</span>`;
          statusBadge = '<span class="badge-status badge-completed">✓ Selesai Shift</span>';
          durationText = `<strong class="text-[#5E391C]">${r.formatted_duration.textShort}</strong> <span class="text-[10px] text-gray-400 block">(${r.total_minutes} mnt)</span>`;
        }
      }

      return `
        <tr class="hover:bg-amber-50/40 transition">
          <td class="p-3 font-mono font-semibold text-gray-700">${r.employee_id}</td>
          <td class="p-3 font-medium text-gray-900">${r.name}</td>
          <td class="p-3 text-gray-500">${r.role}</td>
          <td class="p-3">${inTime}</td>
          <td class="p-3">${outTime}</td>
          <td class="p-3 text-gray-500">${distanceText}</td>
          <td class="p-3">${durationText}</td>
          <td class="p-3 text-center">${statusBadge}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('statDailyTotalPresent').textContent = `${totalPresent} Pegawai`;
    document.getElementById('statDailyActive').textContent = `${totalActive} Pegawai`;
    document.getElementById('statDailyCompleted').textContent = `${totalCompleted} Pegawai`;

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast('Gagal memuat rekapan harian: ' + err.message, 'error');
  }
}

// Ekspor Harian ke CSV
function exportDailyCsv() {
  const dateStr = document.getElementById('dailyDatePicker').value || getTodayDateStr();
  fetch(`/api/admin/recap/daily?date=${dateStr}`, { headers: getAuthHeaders() })
    .then(res => res.json())
    .then(data => {
      if (!data.success || !data.recap) return showToast('Data kosong', 'error');
      let csv = 'ID Pegawai,Nama,Jabatan,Tanggal,Jam Masuk,Jam Pulang,Jarak GPS (m),Total Menit,Total Jam Kerja,Status\n';
      data.recap.forEach(r => {
        csv += `"${r.employee_id}","${r.name}","${r.role}","${dateStr}","${r.check_in_time || ''}","${r.check_out_time || ''}","${r.check_in_distance || ''}","${r.total_minutes || 0}","${r.formatted_duration?.textShort || ''}","${r.status || 'TIDAK_HADIR'}"\n`;
      });
      downloadCsv(csv, `Rekapan_Absensi_${dateStr}.csv`);
    });
}

// ==================== 2. TAB REKAPAN MINGGUAN ====================
async function loadWeeklyRecap() {
  const startInput = document.getElementById('weeklyStartDate');
  const endInput = document.getElementById('weeklyEndDate');

  if (!startInput.value || !endInput.value) {
    // Default: Senin sampai Minggu minggu ini
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    startInput.value = monday.toISOString().split('T')[0];
    endInput.value = sunday.toISOString().split('T')[0];
  }

  const start = startInput.value;
  const end = endInput.value;

  try {
    const res = await fetch(`/api/admin/recap/weekly?start=${start}&end=${end}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return showToast(data.message, 'error');

    const tbody = document.getElementById('weeklyTableBody');
    if (!data.recap || data.recap.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">Tidak ada data presensi pada rentang ini.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.recap.map(r => `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="p-3 font-mono font-semibold text-gray-700">${r.employee_id}</td>
        <td class="p-3 font-medium text-gray-900">${r.name}</td>
        <td class="p-3 text-gray-500">${r.role}</td>
        <td class="p-3 text-center font-bold text-gray-800">${r.total_days_present} Hari</td>
        <td class="p-3 text-right font-mono text-gray-600">${r.total_minutes.toLocaleString('id-ID')} mnt</td>
        <td class="p-3 text-right font-bold text-[#5E391C]">${r.formatted_duration.textShort}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Gagal memuat rekapan mingguan: ' + err.message, 'error');
  }
}

function exportWeeklyCsv() {
  const start = document.getElementById('weeklyStartDate').value;
  const end = document.getElementById('weeklyEndDate').value;
  fetch(`/api/admin/recap/weekly?start=${start}&end=${end}`, { headers: getAuthHeaders() })
    .then(res => res.json())
    .then(data => {
      if (!data.success || !data.recap) return showToast('Data kosong', 'error');
      let csv = 'ID Pegawai,Nama,Jabatan,Hari Hadir,Total Menit,Total Jam Kerja\n';
      data.recap.forEach(r => {
        csv += `"${r.employee_id}","${r.name}","${r.role}","${r.total_days_present}","${r.total_minutes}","${r.formatted_duration?.textShort || ''}"\n`;
      });
      downloadCsv(csv, `Rekapan_Mingguan_${start}_sd_${end}.csv`);
    });
}

// ==================== 3. TAB REKAPAN BULANAN (PAYROLL) ====================
async function loadMonthlyRecap() {
  const picker = document.getElementById('monthlyPicker');
  if (!picker.value) {
    picker.value = getCurrentMonthStr();
  }
  const monthStr = picker.value;

  try {
    const res = await fetch(`/api/admin/recap/monthly?month=${monthStr}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return showToast(data.message, 'error');

    const tbody = document.getElementById('monthlyTableBody');
    if (!data.recap || data.recap.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">Tidak ada rekapan pada bulan ini.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.recap.map(r => `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="p-3 font-mono font-semibold text-gray-700">${r.employee_id}</td>
        <td class="p-3 font-medium text-gray-900">${r.name}</td>
        <td class="p-3 text-gray-500">${r.role}</td>
        <td class="p-3 text-center font-bold text-gray-800">${r.total_days_present} Hari</td>
        <td class="p-3 text-right font-mono text-gray-600">${r.total_minutes.toLocaleString('id-ID')} mnt</td>
        <td class="p-3 text-right font-bold text-emerald-800">${r.formatted_duration.textShort}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Gagal memuat rekapan bulanan: ' + err.message, 'error');
  }
}

function exportMonthlyCsv() {
  const monthStr = document.getElementById('monthlyPicker').value || getCurrentMonthStr();
  fetch(`/api/admin/recap/monthly?month=${monthStr}`, { headers: getAuthHeaders() })
    .then(res => res.json())
    .then(data => {
      if (!data.success || !data.recap) return showToast('Data kosong', 'error');
      let csv = 'ID Pegawai,Nama,Jabatan,Bulan,Total Hari Hadir,Total Menit Kerja,Total Jam Kerja\n';
      data.recap.forEach(r => {
        csv += `"${r.employee_id}","${r.name}","${r.role}","${monthStr}","${r.total_days_present}","${r.total_minutes}","${r.formatted_duration?.textShort || ''}"\n`;
      });
      downloadCsv(csv, `Rekapan_Bulanan_Payroll_${monthStr}.csv`);
    });
}

// Download Helper CSV
function downloadCsv(content, fileName) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`File ${fileName} berhasil diunduh!`, 'success');
}

// ==================== 4. TAB KELOLA PEGAWAI ====================
let allEmployeesList = [];

async function loadEmployees() {
  try {
    const res = await fetch('/api/admin/employees?all=1', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return showToast(data.message, 'error');

    allEmployeesList = data.employees;
    const tbody = document.getElementById('employeesTableBody');

    if (!allEmployeesList || allEmployeesList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400">Belum ada pegawai. Klik "Tambah Pegawai Baru".</td></tr>`;
      return;
    }

    tbody.innerHTML = allEmployeesList.map(e => `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="p-3 font-mono font-semibold text-gray-800">${e.employee_id}</td>
        <td class="p-3 font-medium text-gray-900">${e.name}</td>
        <td class="p-3 text-gray-600">${e.role}</td>
        <td class="p-3 font-mono text-gray-500">${e.pin}</td>
        <td class="p-3">
          ${e.is_active 
            ? '<span class="badge-status badge-present">Aktif</span>' 
            : '<span class="badge-status badge-absent">Nonaktif</span>'}
        </td>
        <td class="p-3 text-center space-x-1.5 whitespace-nowrap">
          <button onclick="editEmployeeModal(${e.id})" class="text-amber-950 hover:text-black px-2.5 py-1 bg-amber-200 hover:bg-amber-300 rounded-lg font-bold text-[11px] inline-flex items-center gap-1 shadow-sm transition">
            <span>✏️ Ubah Data & PIN</span>
          </button>
          ${e.is_active ? `
            <button onclick="deleteEmployeeConfirm(${e.id}, '${e.name}')" class="text-rose-700 hover:text-rose-900 px-2 py-1 bg-rose-100 hover:bg-rose-200 rounded-lg font-semibold text-[11px] transition">
              Nonaktifkan
            </button>
          ` : ''}
        </td>
      </tr>
    `).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast('Gagal memuat data pegawai: ' + err.message, 'error');
  }
}

// Buka Modal Tambah Pegawai
function openAddEmployeeModal() {
  document.getElementById('empModalTitle').textContent = 'Tambah Pegawai Baru';
  document.getElementById('empIdInputHidden').value = '';
  document.getElementById('empIdCode').value = '';
  document.getElementById('empIdCode').disabled = false;
  document.getElementById('empName').value = '';
  document.getElementById('empRole').value = 'Barista';
  document.getElementById('empPin').value = '';
  document.getElementById('empModal').classList.remove('hidden');
}

// Buka Modal Edit Pegawai
window.editEmployeeModal = function(id) {
  const emp = allEmployeesList.find(e => e.id === id);
  if (!emp) return;

  document.getElementById('empModalTitle').textContent = `Ubah Data & PIN Pegawai: ${emp.name}`;
  document.getElementById('empIdInputHidden').value = emp.id;
  document.getElementById('empIdCode').value = emp.employee_id;
  document.getElementById('empIdCode').disabled = false;
  document.getElementById('empName').value = emp.name;
  document.getElementById('empRole').value = emp.role;
  document.getElementById('empPin').value = emp.pin;
  document.getElementById('empModal').classList.remove('hidden');
};

// Simpan Data Pegawai (Add / Update)
async function handleSaveEmployee(e) {
  e.preventDefault();
  const id = document.getElementById('empIdInputHidden').value;
  const empIdCode = document.getElementById('empIdCode').value.trim();
  const name = document.getElementById('empName').value.trim();
  const role = document.getElementById('empRole').value;
  const pin = document.getElementById('empPin').value.trim();

  if (!empIdCode || !name || !pin) {
    return showToast('Semua kolom wajib diisi!', 'error');
  }

  try {
    let res;
    if (id) {
      // Update
      res = await fetch(`/api/admin/employees/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ employee_id: empIdCode, name, role, pin, is_active: true })
      });
    } else {
      // Tambah Baru
      res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ employee_id: empIdCode, name, role, pin })
      });
    }

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('empModal').classList.add('hidden');
      loadEmployees();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Gagal menyimpan pegawai: ' + err.message, 'error');
  }
}

// Konfirmasi Hapus/Nonaktifkan Pegawai
window.deleteEmployeeConfirm = async function(id, name) {
  if (!confirm(`Apakah Anda yakin ingin menonaktifkan akun pegawai "${name}"?`)) {
    return;
  }
  try {
    const res = await fetch(`/api/admin/employees/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadEmployees();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Gagal menonaktifkan: ' + err.message, 'error');
  }
};

// ==================== 5. TAB PENGATURAN KEDAI & GPS ====================
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) return showToast(data.message, 'error');

    cachedSettings = data.settings;
    document.getElementById('setShopName').value = cachedSettings.shop_name || 'Kedai Kopi Boonseen';
    document.getElementById('setLatitude').value = cachedSettings.latitude || '-6.2088';
    document.getElementById('setLongitude').value = cachedSettings.longitude || '106.8456';
    document.getElementById('setRadius').value = cachedSettings.radius_meters || '50';
    document.getElementById('setGpsEnforced').value = cachedSettings.gps_enforced || '1';
    document.getElementById('setOwnerPin').value = cachedSettings.owner_pin || '123456';

    document.getElementById('ownerShopTitle').textContent = cachedSettings.shop_name;
  } catch (err) {
    showToast('Gagal memuat pengaturan: ' + err.message, 'error');
  }
}

// Ambil Koordinat Otomatis dari Browser
function detectCurrentLocation() {
  const btn = document.getElementById('btnDetectCurrentCoords');
  btn.disabled = true;
  btn.innerHTML = 'Mendeteksi GPS...';

  if (!navigator.geolocation) {
    btn.disabled = false;
    btn.innerHTML = 'Gunakan Lokasi Saya Saat Ini';
    return alert('Browser Anda tidak mendukung Geolocation.');
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('setLatitude').value = pos.coords.latitude.toFixed(7);
      document.getElementById('setLongitude').value = pos.coords.longitude.toFixed(7);
      btn.disabled = false;
      btn.innerHTML = '✓ Lokasi Terisi!';
      showToast(`Lokasi kedai berhasil dideteksi! (Akurasi: ±${Math.round(pos.coords.accuracy)}m)`, 'success');
      setTimeout(() => {
        btn.innerHTML = 'Gunakan Lokasi Saya Saat Ini';
      }, 3000);
    },
    (err) => {
      btn.disabled = false;
      btn.innerHTML = 'Gunakan Lokasi Saya Saat Ini';
      showToast('Gagal membaca GPS: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// Simpan Pengaturan
async function handleSaveSettings(e) {
  e.preventDefault();
  const shop_name = document.getElementById('setShopName').value.trim();
  const latitude = document.getElementById('setLatitude').value.trim();
  const longitude = document.getElementById('setLongitude').value.trim();
  const radius_meters = document.getElementById('setRadius').value.trim();
  const gps_enforced = document.getElementById('setGpsEnforced').value;
  const owner_pin = document.getElementById('setOwnerPin').value.trim();

  if (!shop_name || !latitude || !longitude || !radius_meters || !owner_pin) {
    return showToast('Semua kolom wajib diisi!', 'error');
  }

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        shop_name,
        latitude,
        longitude,
        radius_meters,
        gps_enforced,
        owner_pin
      })
    });

    const data = await res.json();
    if (data.success) {
      ownerPin = owner_pin;
      localStorage.setItem('owner_auth_pin', owner_pin);
      document.getElementById('ownerShopTitle').textContent = shop_name;
      showToast('Pengaturan kedai berhasil disimpan!', 'success');
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  }
}

// Buka Modal QR Code Dashboard untuk HP
let ownerQrInstance = null;
async function openMobileOwnerQrModal() {
  const container = document.getElementById('ownerMobileQrCanvas');
  const urlText = document.getElementById('ownerMobileQrUrlText');
  urlText.textContent = 'Menghubungkan ke server...';
  container.innerHTML = 'Membuat barcode...';
  document.getElementById('mobileOwnerQrModal').classList.remove('hidden');

  let targetUrl = window.location.origin + '/owner.html';
  try {
    const res = await fetch('/api/server-info');
    const d = await res.json();
    if (d.active_url && !d.active_url.includes('localhost')) {
      targetUrl = d.active_url + '/owner.html';
    } else if (d.local_url && !d.local_url.includes('localhost')) {
      targetUrl = d.local_url + '/owner.html';
    }
  } catch (e) {}

  container.innerHTML = '';
  ownerQrInstance = new QRCode(container, {
    text: targetUrl,
    width: 180,
    height: 180,
    colorDark: "#1F1610",
    colorLight: "#FFFFFF",
    correctLevel: QRCode.CorrectLevel.M
  });
  urlText.textContent = targetUrl;
}

function closeMobileOwnerQrModal() {
  document.getElementById('mobileOwnerQrModal').classList.add('hidden');
}

// ==================== EVENT LISTENERS & INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  initTabs();

  // Login Owner Modal
  const ownerLoginForm = document.getElementById('ownerLoginForm');
  if (ownerLoginForm) {
    ownerLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = document.getElementById('ownerPinInput').value.trim();
      ownerPin = pin;
      localStorage.setItem('owner_auth_pin', pin);
      verifyOwnerAccess();
    });
  }

  // Logout Owner
  const btnLogout = document.getElementById('btnOwnerLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('owner_auth_pin');
      ownerPin = '';
      window.location.reload();
    });
  }

  // Tombol Buka di HP (QR Modal)
  document.getElementById('btnOpenMobileOwnerQr')?.addEventListener('click', openMobileOwnerQrModal);
  document.getElementById('btnCloseMobileOwnerQrModal')?.addEventListener('click', closeMobileOwnerQrModal);
  document.getElementById('btnDoneMobileOwnerQr')?.addEventListener('click', closeMobileOwnerQrModal);

  // Button Refreshes
  document.getElementById('btnRefreshDaily')?.addEventListener('click', loadDailyRecap);
  document.getElementById('btnRefreshWeekly')?.addEventListener('click', loadWeeklyRecap);
  document.getElementById('btnRefreshMonthly')?.addEventListener('click', loadMonthlyRecap);

  // Button Exports
  document.getElementById('btnExportDailyCsv')?.addEventListener('click', exportDailyCsv);
  document.getElementById('btnExportWeeklyCsv')?.addEventListener('click', exportWeeklyCsv);
  document.getElementById('btnExportMonthlyCsv')?.addEventListener('click', exportMonthlyCsv);

  // Modal Pegawai
  document.getElementById('btnOpenAddEmpModal')?.addEventListener('click', openAddEmployeeModal);
  document.getElementById('btnCloseEmpModal')?.addEventListener('click', () => {
    document.getElementById('empModal').classList.add('hidden');
  });
  document.getElementById('btnCancelEmpModal')?.addEventListener('click', () => {
    document.getElementById('empModal').classList.add('hidden');
  });
  document.getElementById('empForm')?.addEventListener('submit', handleSaveEmployee);

  // Pengaturan Kedai
  document.getElementById('btnDetectCurrentCoords')?.addEventListener('click', detectCurrentLocation);
  document.getElementById('settingsForm')?.addEventListener('submit', handleSaveSettings);

  // Cek otentikasi awal
  verifyOwnerAccess();

  if (window.lucide) lucide.createIcons();
});
