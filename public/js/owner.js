// State Dashboard Owner & Supervisor - KAPEBOONSEEN
let ownerPin = localStorage.getItem('owner_auth_pin') || '';
let authEmpId = localStorage.getItem('auth_emp_id') || '';
let authEmpPin = localStorage.getItem('auth_emp_pin') || '';
let authRole = localStorage.getItem('auth_role') || 'owner'; // 'owner' | 'supervisor'
let authUserName = localStorage.getItem('auth_user_name') || 'Owner Kedai';

let currentTab = 'tab-daily';
let cachedSettings = {};
let currentDailyData = [];
let currentWeeklyData = [];
let currentMonthlyData = [];
let pendingCorrectionsPollTimer = null;

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

// Header Autentikasi (Mendukung Owner PIN atau Supervisor ID+PIN)
function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authRole === 'supervisor' && authEmpId && authEmpPin) {
    headers['x-employee-id'] = authEmpId;
    headers['x-employee-pin'] = authEmpPin;
  } else if (ownerPin) {
    headers['x-owner-pin'] = ownerPin;
  }
  return headers;
}

// ==================== SHEETJS EXCEL & CSV GENERATOR ====================

// Mengunduh File Excel (.xlsx Asli)
function downloadExcelFile(aoaData, fileName, sheetName = 'Data Rekap') {
  if (typeof XLSX === 'undefined') {
    showToast('Library Excel sedang dimuat, silakan coba 2 detik lagi.', 'error');
    return;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoaData);

  // Kalkulasi lebar kolom otomatis agar rapi saat dibuka di Microsoft Excel / Google Sheets
  const colWidths = [];
  aoaData.forEach(row => {
    row.forEach((cell, idx) => {
      const len = cell ? String(cell).length : 5;
      colWidths[idx] = Math.max(colWidths[idx] || 8, len + 3);
    });
  });
  ws['!cols'] = colWidths.map(w => ({ wch: Math.min(w, 40) }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : fileName + '.xlsx');
  showToast(`File Excel "${fileName}" berhasil diunduh!`, 'success');
}

// Mengunduh File CSV (dengan UTF-8 BOM untuk Excel & Google Sheets)
function downloadCsvFile(rows, fileName) {
  const csvContent = '\uFEFF' + rows.map(r => 
    r.map(c => {
      const str = c === null || c === undefined ? '' : String(c);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName.endsWith('.csv') ? fileName : fileName + '.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`File CSV "${fileName}" berhasil diunduh!`, 'success');
}

// ==================== AUTENTIKASI & KONTROL HAK AKSES ====================

async function verifyOwnerAccess(isManualSubmit = false) {
  const errBoxOwner = document.getElementById('ownerLoginError');
  const errBoxSup = document.getElementById('supervisorLoginError');
  if (errBoxOwner) errBoxOwner.classList.add('hidden');
  if (errBoxSup) errBoxSup.classList.add('hidden');

  if (!ownerPin && (!authEmpId || !authEmpPin)) {
    document.getElementById('ownerLoginModal').classList.remove('hidden');
    return false;
  }

  const payload = {};
  if (authRole === 'supervisor' && authEmpId) {
    payload.employee_id = authEmpId;
    payload.pin = authEmpPin;
  } else {
    payload.pin = ownerPin;
  }

  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      if (isManualSubmit) {
        const targetErr = (authRole === 'supervisor') ? errBoxSup : errBoxOwner;
        if (targetErr) {
          targetErr.textContent = 'Gagal membaca respon server. Periksa koneksi internet Anda.';
          targetErr.classList.remove('hidden');
        }
      }
      return false;
    }

    if (data.success) {
      document.getElementById('ownerLoginModal').classList.add('hidden');
      authRole = data.role || 'owner';
      authUserName = (data.user && data.user.name) ? data.user.name : (authRole === 'owner' ? 'Owner Kedai' : authEmpId);

      localStorage.setItem('auth_role', authRole);
      localStorage.setItem('auth_user_name', authUserName);

      applyRolePermissions(authRole, authUserName);

      if (isManualSubmit) {
        showToast(`Selamat datang, ${authUserName}! (${authRole === 'owner' ? 'Owner' : 'Supervisor Laporan'})`, 'success');
      }

      loadTabContent(currentTab);
      checkPendingCorrections();

      // Mulai polling notifikasi koreksi setiap 20 detik
      if (!pendingCorrectionsPollTimer) {
        pendingCorrectionsPollTimer = setInterval(checkPendingCorrections, 20000);
      }

      return true;
    } else {
      if (authRole === 'supervisor') {
        localStorage.removeItem('auth_emp_id');
        localStorage.removeItem('auth_emp_pin');
        authEmpId = '';
        authEmpPin = '';
        if (errBoxSup && isManualSubmit) {
          errBoxSup.textContent = data.message || 'ID Pegawai atau PIN salah, atau tidak memiliki izin akses.';
          errBoxSup.classList.remove('hidden');
        }
      } else {
        localStorage.removeItem('owner_auth_pin');
        ownerPin = '';
        if (errBoxOwner && isManualSubmit) {
          errBoxOwner.textContent = data.message || 'PIN Master Owner salah! Silakan periksa kembali.';
          errBoxOwner.classList.remove('hidden');
        }
      }
      document.getElementById('ownerLoginModal').classList.remove('hidden');
      return false;
    }
  } catch (err) {
    if (isManualSubmit) {
      showToast('Koneksi ke server gagal: ' + err.message, 'error');
    }
    return false;
  }
}

function applyRolePermissions(role, userName) {
  const roleBadge = document.getElementById('ownerRoleBadge');
  const userSubtext = document.getElementById('ownerUserSubtext');
  const navEmployees = document.getElementById('navTabEmployees');
  const navSettings = document.getElementById('navTabSettings');

  if (role === 'supervisor') {
    if (roleBadge) {
      roleBadge.textContent = 'Supervisor';
      roleBadge.className = 'bg-blue-600 text-white font-bold px-1.5 py-0.5 rounded text-[10px] tracking-wider uppercase';
    }
    if (userSubtext) {
      userSubtext.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block"></span> ${userName} (Akses Laporan)`;
    }
    if (navEmployees) navEmployees.classList.add('hidden');
    if (navSettings) navSettings.classList.add('hidden');

    if (currentTab === 'tab-employees' || currentTab === 'tab-settings') {
      switchTab('tab-daily');
    }
  } else {
    if (roleBadge) {
      roleBadge.textContent = 'Owner';
      roleBadge.className = 'bg-amber-400 text-amber-950 font-bold px-1.5 py-0.5 rounded text-[10px] tracking-wider uppercase';
    }
    if (userSubtext) {
      userSubtext.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span> Panel Pemilik Kedai`;
    }
    if (navEmployees) navEmployees.classList.remove('hidden');
    if (navSettings) navSettings.classList.remove('hidden');
  }
}

function switchTab(targetTab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('bg-[#5E391C]', 'text-white');
    b.classList.add('bg-white', 'text-gray-700');
  });

  const activeBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
  if (activeBtn) {
    activeBtn.classList.remove('bg-white', 'text-gray-700');
    activeBtn.classList.add('bg-[#5E391C]', 'text-white');
  }

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.add('hidden');
  });
  const targetElem = document.getElementById(targetTab);
  if (targetElem) targetElem.classList.remove('hidden');

  currentTab = targetTab;
  loadTabContent(targetTab);
}

function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
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

// ==================== ALERTI & PERSETUJUAN KOREKSI CHECK-OUT & SHIFT ====================
async function checkPendingCorrections() {
  try {
    const res = await fetch('/api/admin/corrections/pending', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    const alertEl = document.getElementById('pendingCorrectionsAlert');
    const badgeEl = document.getElementById('pendingCorrectionsBadge');
    const subtextEl = document.getElementById('pendingCorrectionsSubtext');

    if (data.success && data.count > 0) {
      if (alertEl) alertEl.classList.remove('hidden');
      if (badgeEl) badgeEl.textContent = `${data.count} Baru`;
      if (subtextEl) {
        subtextEl.textContent = `Ada ${data.count} pengajuan koreksi (salah klik / perbaikan shift) menunggu persetujuan.`;
      }
    } else {
      if (alertEl) alertEl.classList.add('hidden');
    }
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.warn('Gagal cek koreksi:', e);
  }
}

async function openCorrectionsReviewModal() {
  const modal = document.getElementById('correctionsReviewModal');
  const listEl = document.getElementById('correctionsReviewList');
  if (!modal || !listEl) return;

  listEl.innerHTML = '<div class="p-6 text-center text-gray-400 text-xs">Memuat pengajuan koreksi...</div>';
  modal.classList.remove('hidden');

  try {
    const res = await fetch('/api/admin/corrections/pending', {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (!data.success || !data.corrections || data.corrections.length === 0) {
      listEl.innerHTML = `
        <div class="p-8 text-center text-gray-400 text-xs space-y-2">
          <i data-lucide="check-circle" class="w-8 h-8 text-emerald-500 mx-auto"></i>
          <p class="font-bold text-gray-600">Tidak ada pengajuan koreksi yang menunggu persetujuan.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    listEl.innerHTML = data.corrections.map(c => {
      // Kasus 1: Koreksi Jam Shift Masuk
      if (c.correction_status === 'PENDING_SHIFT') {
        return `
          <div class="p-4 bg-purple-50/70 border border-purple-300 rounded-2xl space-y-3">
            <div class="flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-mono font-bold text-xs bg-purple-200 text-purple-950 px-2 py-0.5 rounded">${c.employee_id}</span>
                  <h4 class="font-bold text-sm text-[#3A2010]">${c.name}</h4>
                  <span class="text-[11px] text-gray-500">(${c.role})</span>
                  <span class="px-2 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-bold rounded border border-purple-200">Koreksi Shift</span>
                </div>
                <p class="text-[11px] text-gray-600 mt-1.5">
                  Tanggal: <strong>${c.date}</strong> | Jam Masuk Riil: <strong>${c.check_in_time}</strong>
                </p>
                <p class="text-xs text-purple-950 mt-1">
                  Shift Sebelumnya: <span class="line-through text-gray-500 font-mono font-semibold">${c.scheduled_in || '-'}</span> 
                  &rarr; Diajukan: <strong class="bg-purple-200 text-purple-950 px-2 py-0.5 rounded font-mono font-bold">${c.requested_shift_in}</strong>
                </p>
              </div>
            </div>

            <div class="p-2.5 bg-white rounded-xl border border-gray-200 text-xs">
              <span class="text-[10px] text-gray-400 block font-bold uppercase">Alasan Pegawai:</span>
              <p class="text-gray-800 font-medium italic mt-0.5">"${c.correction_reason || 'Salah pilih jam masuk saat presensi'}"</p>
            </div>

            <div class="p-2 rounded-lg bg-purple-100/60 text-[11px] text-purple-900 flex items-center gap-1.5">
              <i data-lucide="info" class="w-3.5 h-3.5 flex-shrink-0 text-purple-700"></i>
              <span>Jika disetujui, shift masuk akan diubah menjadi ${c.requested_shift_in} dan status keterlambatan (+30 menit) otomatis dihitung ulang.</span>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <button onclick="handleRejectShiftCorrection(${c.id})"
                class="flex-1 px-3 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition">
                Tolak
              </button>
              <button onclick="handleApproveShiftCorrection(${c.id})"
                class="flex-1 bg-purple-700 hover:bg-purple-800 text-white py-2 rounded-xl text-xs font-bold shadow flex items-center justify-center gap-1.5 transition">
                <i data-lucide="check" class="w-3.5 h-3.5"></i>
                <span>Setujui Perubahan Shift</span>
              </button>
            </div>
          </div>
        `;
      }

      // Kasus 2: Koreksi Check-Out Salah Klik (PENDING)
      return `
        <div class="p-4 bg-amber-50/70 border border-amber-300 rounded-2xl space-y-3">
          <div class="flex items-start justify-between">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-mono font-bold text-xs bg-amber-200 text-amber-950 px-2 py-0.5 rounded">${c.employee_id}</span>
                <h4 class="font-bold text-sm text-[#3A2010]">${c.name}</h4>
                <span class="text-[11px] text-gray-500">(${c.role})</span>
                <span class="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded border border-amber-200">Koreksi Check-Out</span>
              </div>
              <p class="text-[11px] text-gray-600 mt-1">
                Tanggal: <strong>${c.date}</strong> | Masuk: <strong>${c.check_in_time}</strong> | Check-Out Salah: <strong class="text-rose-700">${c.check_out_time}</strong>
              </p>
            </div>
          </div>

          <div class="p-2.5 bg-white rounded-xl border border-gray-200 text-xs">
            <span class="text-[10px] text-gray-400 block font-bold uppercase">Alasan Pegawai:</span>
            <p class="text-gray-800 font-medium italic mt-0.5">"${c.correction_reason || 'Salah klik tombol check-out'}"</p>
          </div>

          <div class="p-2 rounded-lg bg-amber-100/60 text-[11px] text-amber-900 flex items-center gap-1.5">
            <i data-lucide="info" class="w-3.5 h-3.5 flex-shrink-0 text-amber-700"></i>
            <span>Jika disetujui, status kembali bertugas dan pegawai dapat Check-Out ulang nanti saat jam pulang sebenarnya.</span>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button onclick="handleRejectCorrection(${c.id})"
              class="flex-1 px-3 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold transition">
              Tolak
            </button>
            <button onclick="handleApproveCorrection(${c.id})"
              class="flex-1 btn-coffee py-2 rounded-xl text-xs font-bold shadow flex items-center justify-center gap-1.5">
              <i data-lucide="check" class="w-3.5 h-3.5"></i>
              <span>Setujui (Izinkan Check-Out Ulang)</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    listEl.innerHTML = `<div class="p-6 text-center text-rose-500 text-xs">Gagal: ${err.message}</div>`;
  }
}

window.handleApproveCorrection = async function(attendanceId) {
  if (!confirm('Setujui koreksi check-out ini? Pegawai akan dapat melakukan check-out ulang pada jam kepulangan sebenarnya.')) {
    return;
  }
  try {
    const res = await fetch('/api/admin/corrections/approve', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ attendance_id: attendanceId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Koreksi check-out telah disetujui!', 'success');
      openCorrectionsReviewModal();
      checkPendingCorrections();
      loadDailyRecap();
    } else {
      showToast(data.message || 'Gagal menyetujui koreksi.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
};

window.handleRejectCorrection = async function(attendanceId) {
  if (!confirm('Tolak pengajuan koreksi check-out ini?')) return;
  try {
    const res = await fetch('/api/admin/corrections/reject', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ attendance_id: attendanceId })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Pengajuan koreksi telah ditolak.', 'info');
      openCorrectionsReviewModal();
      checkPendingCorrections();
    } else {
      showToast(data.message || 'Gagal menolak.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
};

window.handleApproveShiftCorrection = async function(attendanceId) {
  if (!confirm('Setujui koreksi jam shift ini? Jam shift masuk dan status keterlambatan (+30 menit) akan otomatis dihitung ulang.')) {
    return;
  }
  try {
    const res = await fetch('/api/admin/corrections/approve-shift', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ attendance_id: attendanceId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Koreksi jam shift berhasil disetujui!', 'success');
      openCorrectionsReviewModal();
      checkPendingCorrections();
      loadDailyRecap();
    } else {
      showToast(data.message || 'Gagal menyetujui koreksi jam shift.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
};

window.handleRejectShiftCorrection = async function(attendanceId) {
  if (!confirm('Tolak pengajuan koreksi jam shift ini?')) return;
  try {
    const res = await fetch('/api/admin/corrections/reject-shift', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ attendance_id: attendanceId })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Pengajuan koreksi jam shift telah ditolak.', 'info');
      openCorrectionsReviewModal();
      checkPendingCorrections();
    } else {
      showToast(data.message || 'Gagal menolak.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
};

// ==================== 1. TAB REKAPAN HARIAN ====================
async function loadDailyRecap() {
  const picker = document.getElementById('dailyDatePicker');
  if (!picker.value) picker.value = getTodayDateStr();
  const dateStr = picker.value;

  document.getElementById('dailyDateTitle').textContent = `Tanggal: ${dateStr}`;
  const tbody = document.getElementById('dailyTableBody');
  tbody.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-gray-400">Memuat data presensi harian...</td></tr>';

  try {
    const res = await fetch(`/api/admin/recap/daily?date=${dateStr}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-rose-500">${data.message || 'Gagal memuat rekap.'}</td></tr>`;
      return;
    }

    currentDailyData = data.recap || [];
    renderDailyTable(currentDailyData);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-rose-500">Koneksi gagal: ${err.message}</td></tr>`;
  }
}

function renderDailyTable(list) {
  const tbody = document.getElementById('dailyTableBody');
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="p-6 text-center text-gray-400">Tidak ada pegawai terdaftar.</td></tr>';
    updateDailyStats(0, 0, 0);
    return;
  }

  let totalPresent = 0;
  let totalActive = 0;
  let totalCompleted = 0;

  let html = '';
  list.forEach(r => {
    let statusBadge = '<span class="px-2 py-1 bg-gray-100 text-gray-500 rounded-lg text-[11px] font-semibold">BELUM HADIR</span>';
    if (r.status === 'CHECKED_IN') {
      totalPresent++;
      totalActive++;
      statusBadge = '<span class="px-2 py-1 bg-amber-100 text-amber-800 rounded-lg text-[11px] font-bold animate-pulse">SEDANG TUGAS</span>';
    } else if (r.status === 'COMPLETED') {
      totalPresent++;
      totalCompleted++;
      statusBadge = '<span class="px-2 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-[11px] font-bold">SELESAI (PULANG)</span>';
    }

    const distText = r.check_in_distance !== null ? `${r.check_in_distance} m` : '-';
    const durText = r.formatted_duration ? r.formatted_duration.textShort : '-';

    // Tag Keterlambatan (+30 Menit)
    const lateBadge = r.is_late === 1
      ? '<span class="px-1.5 py-0.5 bg-rose-100 text-rose-800 font-bold rounded text-[10px] border border-rose-300 ml-1">Terlambat (+30m)</span>'
      : '';

    // Shift info
    const shiftInfo = r.scheduled_in
      ? `<span class="text-[10px] text-gray-500 font-mono block">Shift Masuk: ${r.scheduled_in}</span>`
      : '';

    // Catatan Audit Kesalahan Check-Out (HANYA MUNCUL DI DASHBOARD OWNER)
    let auditNoteHtml = '';
    if (r.first_checkout_time || r.notes) {
      const noteText = r.notes || `⚠️ Koreksi: Salah klik checkout pertama jam ${r.first_checkout_time}`;
      auditNoteHtml = `
        <div class="text-[10px] text-amber-900 font-bold bg-amber-100/90 border border-amber-300 px-2 py-1 rounded-md mt-1 leading-tight inline-block">
          ${noteText}
        </div>
      `;
    }

    // Kolom Aksi Edit & Hapus Catatan Presensi (Khusus Owner)
    let aksiHtml = '<span class="text-gray-400 font-mono text-xs">-</span>';
    if (authRole !== 'supervisor' && r.attendance_id) {
      aksiHtml = `
        <div class="flex items-center justify-center gap-1.5">
          <button type="button" onclick="openEditAttendanceModal(${r.attendance_id})" title="Edit Data & Jam Presensi"
            class="p-1.5 bg-amber-100 hover:bg-amber-200 text-amber-950 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm">
            <i data-lucide="edit-2" class="w-3.5 h-3.5 text-amber-800"></i>
            <span class="hidden sm:inline">Edit</span>
          </button>
          <button type="button" onclick="handleDeleteAttendance(${r.attendance_id}, '${(r.name || '').replace(/'/g, "\\'")}', '${r.date || ''}')" title="Hapus Catatan Presensi Ini"
            class="p-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm">
            <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-600"></i>
            <span class="hidden sm:inline">Hapus</span>
          </button>
        </div>
      `;
    }

    html += `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="p-2.5 sm:p-3 font-mono font-bold text-gray-800">${r.employee_id}</td>
        <td class="p-2.5 sm:p-3">
          <div class="font-semibold text-gray-900 flex items-center flex-wrap gap-1">
            <span>${r.name}</span>
            ${lateBadge}
          </div>
          ${shiftInfo}
          ${auditNoteHtml}
        </td>
        <td class="p-2.5 sm:p-3 text-gray-600">${r.role}</td>
        <td class="p-2.5 sm:p-3 font-mono text-gray-800">${r.check_in_time || '-'}</td>
        <td class="p-2.5 sm:p-3 font-mono text-gray-800">${r.check_out_time || '-'}</td>
        <td class="p-2.5 sm:p-3 font-mono text-gray-600">${distText}</td>
        <td class="p-2.5 sm:p-3 font-bold text-amber-950">${durText}</td>
        <td class="p-2.5 sm:p-3 text-center">${statusBadge}</td>
        <td class="p-2.5 sm:p-3 text-center whitespace-nowrap">${aksiHtml}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  updateDailyStats(totalPresent, totalActive, totalCompleted);
  if (window.lucide) lucide.createIcons();
}

// ==================== EDIT & HAPUS CATATAN ABSENSI (KHUSUS OWNER) ====================
window.openEditAttendanceModal = function(attendanceId) {
  if (authRole === 'supervisor') {
    showToast('Hanya Owner yang berwenang mengedit catatan presensi.', 'error');
    return;
  }
  const record = (currentDailyData || []).find(r => r.attendance_id === attendanceId);
  if (!record) {
    showToast('Data presensi tidak ditemukan.', 'error');
    return;
  }

  document.getElementById('editAttId').value = record.attendance_id;
  document.getElementById('editAttSubtext').textContent = `Pegawai: ${record.employee_id} - ${record.name} | Tanggal: ${record.date || getTodayDateStr()}`;
  document.getElementById('editAttCheckIn').value = record.check_in_time || '';
  document.getElementById('editAttScheduledIn').value = record.scheduled_in || '';
  document.getElementById('editAttCheckOut').value = record.check_out_time || '';
  document.getElementById('editAttScheduledOut').value = record.scheduled_out || '';
  document.getElementById('editAttStatus').value = record.status || 'COMPLETED';
  document.getElementById('editAttIsLate').value = (record.is_late === 1) ? '1' : '0';
  document.getElementById('editAttNotes').value = record.notes || '';

  const modal = document.getElementById('editAttendanceModal');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
};

window.closeEditAttendanceModal = function() {
  const modal = document.getElementById('editAttendanceModal');
  if (modal) modal.classList.add('hidden');
};

window.handleSaveAttendanceEdit = async function(e) {
  if (e) e.preventDefault();
  const attId = document.getElementById('editAttId').value;
  if (!attId) return;

  const btn = document.getElementById('btnSubmitEditAtt');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Menyimpan...';
  }

  const payload = {
    attendance_id: parseInt(attId, 10),
    check_in_time: document.getElementById('editAttCheckIn').value.trim(),
    scheduled_in: document.getElementById('editAttScheduledIn').value || null,
    check_out_time: document.getElementById('editAttCheckOut').value.trim() || null,
    scheduled_out: document.getElementById('editAttScheduledOut').value || null,
    status: document.getElementById('editAttStatus').value,
    is_late: parseInt(document.getElementById('editAttIsLate').value, 10),
    notes: document.getElementById('editAttNotes').value.trim()
  };

  try {
    const res = await fetch('/api/admin/attendance/update', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Catatan presensi berhasil diperbarui!', 'success');
      closeEditAttendanceModal();
      loadDailyRecap();
    } else {
      showToast(data.message || 'Gagal menyimpan perubahan.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> <span>Simpan Perubahan</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
};

window.handleDeleteAttendance = function(attendanceId, empName, date) {
  if (authRole === 'supervisor') {
    showToast('Hanya Owner yang berwenang menghapus catatan presensi.', 'error');
    return;
  }
  document.getElementById('deleteSingleAttIdHidden').value = attendanceId;
  const textEl = document.getElementById('deleteSingleAttText');
  if (textEl) {
    textEl.innerHTML = `Yakin ingin menghapus catatan presensi <strong>${empName || 'Pegawai'}</strong> pada tanggal <strong>${date || ''}</strong>?<br><span class="text-rose-600 font-semibold mt-1 inline-block">Data jam masuk & jam pulang presensi ini akan dihapus permanen.</span>`;
  }
  const modal = document.getElementById('deleteSingleAttendanceModal');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
};

window.closeDeleteSingleAttendanceModal = function() {
  const modal = document.getElementById('deleteSingleAttendanceModal');
  if (modal) modal.classList.add('hidden');
};

window.confirmDeleteAttendance = async function() {
  const attId = document.getElementById('deleteSingleAttIdHidden').value;
  if (!attId) return;

  const btn = document.getElementById('btnConfirmDeleteSingleAtt');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menghapus...';
  }

  try {
    const res = await fetch('/api/admin/attendance/delete', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ attendance_id: parseInt(attId, 10) })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Catatan presensi berhasil dihapus.', 'success');
      closeDeleteSingleAttendanceModal();
      loadDailyRecap();
    } else {
      showToast(data.message || 'Gagal menghapus catatan presensi.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Hapus Presensi';
    }
  }
};
}

function updateDailyStats(present, active, completed) {
  document.getElementById('statDailyTotalPresent').textContent = `${present} Pegawai`;
  document.getElementById('statDailyActive').textContent = `${active} Pegawai`;
  document.getElementById('statDailyCompleted').textContent = `${completed} Pegawai`;
}

// Ekspor Harian ke Excel (.xlsx Asli)
function exportDailyExcel() {
  const dateStr = document.getElementById('dailyDatePicker').value || getTodayDateStr();
  if (!currentDailyData || currentDailyData.length === 0) {
    showToast('Tidak ada data presensi untuk diekspor pada tanggal ini.', 'error');
    return;
  }

  const aoa = [
    ['KAPEBOONSEEN - REKAPITULASI PRESENSI HARIAN'],
    [`Tanggal: ${dateStr}`, '', '', '', '', '', '', '', '', '', '', `Diekspor oleh: ${authUserName}`],
    [],
    ['No', 'ID Pegawai', 'Nama Lengkap', 'Jabatan', 'Shift Terjadwal', 'Jam Masuk', 'Keterlambatan', 'Jam Pulang', 'Jarak GPS (m)', 'Total Menit', 'Durasi Kerja', 'Status', 'Catatan Koreksi (Owner Audit)']
  ];

  currentDailyData.forEach((r, idx) => {
    aoa.push([
      idx + 1,
      r.employee_id,
      r.name,
      r.role,
      r.scheduled_in || '-',
      r.check_in_time || '-',
      r.is_late === 1 ? 'Terlambat (+30m)' : (r.check_in_time ? 'Tepat Waktu' : '-'),
      r.check_out_time || '-',
      r.check_in_distance !== null ? r.check_in_distance : '-',
      r.total_minutes || 0,
      r.formatted_duration ? r.formatted_duration.textShort : '0 Jam 0 Menit',
      r.status === 'COMPLETED' ? 'Selesai Pulang' : (r.status === 'CHECKED_IN' ? 'Sedang Tugas' : 'Belum Hadir'),
      r.notes || (r.first_checkout_time ? (`Salah checkout awal jam ${r.first_checkout_time}`) : '-')
    ]);
  });

  downloadExcelFile(aoa, `Rekap_Harian_${dateStr}.xlsx`, 'Presensi Harian');
}

// Ekspor Harian ke CSV
function exportDailyCsv() {
  const dateStr = document.getElementById('dailyDatePicker').value || getTodayDateStr();
  if (!currentDailyData || currentDailyData.length === 0) {
    showToast('Tidak ada data presensi untuk diekspor.', 'error');
    return;
  }

  const rows = [
    ['No', 'ID Pegawai', 'Nama Lengkap', 'Jabatan', 'Shift Terjadwal', 'Jam Masuk', 'Keterlambatan', 'Jam Pulang', 'Jarak GPS (m)', 'Total Menit', 'Durasi Kerja', 'Status', 'Catatan Koreksi (Owner Audit)']
  ];

  currentDailyData.forEach((r, idx) => {
    rows.push([
      idx + 1,
      r.employee_id,
      r.name,
      r.role,
      r.scheduled_in || '-',
      r.check_in_time || '-',
      r.is_late === 1 ? 'Terlambat (+30m)' : (r.check_in_time ? 'Tepat Waktu' : '-'),
      r.check_out_time || '-',
      r.check_in_distance !== null ? r.check_in_distance : '-',
      r.total_minutes || 0,
      r.formatted_duration ? r.formatted_duration.textShort : '0 Jam 0 Menit',
      r.status === 'COMPLETED' ? 'Selesai Pulang' : (r.status === 'CHECKED_IN' ? 'Sedang Tugas' : 'Belum Hadir'),
      r.notes || (r.first_checkout_time ? (`Salah checkout awal jam ${r.first_checkout_time}`) : '-')
    ]);
  });

  downloadCsvFile(rows, `Rekap_Harian_${dateStr}.csv`);
}

// ==================== 2. TAB REKAPAN MINGGUAN ====================
async function loadWeeklyRecap() {
  const startInput = document.getElementById('weeklyStartDate');
  const endInput = document.getElementById('weeklyEndDate');

  if (!startInput.value || !endInput.value) {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    startInput.value = monday.toISOString().split('T')[0];
    endInput.value = sunday.toISOString().split('T')[0];
  }

  const start = startInput.value;
  const end = endInput.value;
  const tbody = document.getElementById('weeklyTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">Memuat rekap mingguan...</td></tr>';

  try {
    const res = await fetch(`/api/admin/recap/weekly?start=${start}&end=${end}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-rose-500">${data.message || 'Gagal.'}</td></tr>`;
      return;
    }

    currentWeeklyData = data.recap || [];
    renderWeeklyTable(currentWeeklyData);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-rose-500">Koneksi gagal: ${err.message}</td></tr>`;
  }
}

function renderWeeklyTable(list) {
  const tbody = document.getElementById('weeklyTableBody');
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">Tidak ada data mingguan.</td></tr>';
    return;
  }

  let html = '';
  list.forEach(r => {
    const durText = r.formatted_duration ? r.formatted_duration.textShort : '-';
    const lateDisplay = (r.total_late > 0)
      ? `<span class="text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">${r.total_late}x</span>`
      : '<span class="text-gray-400">0x</span>';

    html += `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="p-2.5 sm:p-3 font-mono font-bold text-gray-800">${r.employee_id}</td>
        <td class="p-2.5 sm:p-3 font-semibold text-gray-900">${r.name}</td>
        <td class="p-2.5 sm:p-3 text-gray-600">${r.role}</td>
        <td class="p-2.5 sm:p-3 text-center font-bold text-emerald-700">${r.total_days_present} Hari</td>
        <td class="p-2.5 sm:p-3 text-center">${lateDisplay}</td>
        <td class="p-2.5 sm:p-3 font-mono text-gray-700">${r.total_minutes} mnt</td>
        <td class="p-2.5 sm:p-3 font-bold text-amber-950">${durText}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function exportWeeklyExcel() {
  const start = document.getElementById('weeklyStartDate').value;
  const end = document.getElementById('weeklyEndDate').value;
  if (!currentWeeklyData || currentWeeklyData.length === 0) {
    showToast('Tidak ada data mingguan untuk diekspor.', 'error');
    return;
  }

  const aoa = [
    ['KAPEBOONSEEN - REKAPITULASI JAM KERJA MINGGUAN'],
    [`Periode: ${start} s/d ${end}`, '', '', '', '', '', `Diekspor oleh: ${authUserName}`],
    [],
    ['No', 'ID Pegawai', 'Nama Lengkap', 'Jabatan', 'Hari Hadir', 'Jumlah Terlambat', 'Total Menit', 'Total Jam Kerja']
  ];

  currentWeeklyData.forEach((r, idx) => {
    aoa.push([
      idx + 1,
      r.employee_id,
      r.name,
      r.role,
      r.total_days_present,
      `${r.total_late || 0}x`,
      r.total_minutes,
      r.formatted_duration ? r.formatted_duration.textShort : '0 Jam 0 Menit'
    ]);
  });

  downloadExcelFile(aoa, `Rekap_Mingguan_${start}_sd_${end}.xlsx`, 'Rekap Mingguan');
}

function exportWeeklyCsv() {
  const start = document.getElementById('weeklyStartDate').value;
  const end = document.getElementById('weeklyEndDate').value;
  if (!currentWeeklyData || currentWeeklyData.length === 0) {
    showToast('Tidak ada data mingguan untuk diekspor.', 'error');
    return;
  }

  const rows = [
    ['No', 'ID Pegawai', 'Nama Lengkap', 'Jabatan', 'Hari Hadir', 'Jumlah Terlambat', 'Total Menit', 'Total Jam Kerja']
  ];

  currentWeeklyData.forEach((r, idx) => {
    rows.push([
      idx + 1,
      r.employee_id,
      r.name,
      r.role,
      r.total_days_present,
      `${r.total_late || 0}x`,
      r.total_minutes,
      r.formatted_duration ? r.formatted_duration.textShort : '0 Jam 0 Menit'
    ]);
  });

  downloadCsvFile(rows, `Rekap_Mingguan_${start}_sd_${end}.csv`);
}

// ==================== 3. TAB REKAPAN BULANAN (PAYROLL) ====================
async function loadMonthlyRecap() {
  const picker = document.getElementById('monthlyPicker');
  if (!picker.value) picker.value = getCurrentMonthStr();
  const monthStr = picker.value;

  document.getElementById('monthlyTitle').textContent = `Bulan: ${monthStr}`;
  const tbody = document.getElementById('monthlyTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">Memuat rekap bulanan...</td></tr>';

  try {
    const res = await fetch(`/api/admin/recap/monthly?month=${monthStr}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-rose-500">${data.message || 'Gagal.'}</td></tr>`;
      return;
    }

    currentMonthlyData = data.recap || [];
    renderMonthlyTable(currentMonthlyData);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-rose-500">Koneksi gagal: ${err.message}</td></tr>`;
  }
}

function renderMonthlyTable(list) {
  const tbody = document.getElementById('monthlyTableBody');
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">Tidak ada data bulanan.</td></tr>';
    return;
  }

  let html = '';
  list.forEach(r => {
    const durText = r.formatted_duration ? r.formatted_duration.textShort : '-';
    const lateDisplay = (r.total_late > 0)
      ? `<span class="text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">${r.total_late}x</span>`
      : '<span class="text-gray-400">0x</span>';

    html += `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="p-2.5 sm:p-3 font-mono font-bold text-gray-800">${r.employee_id}</td>
        <td class="p-2.5 sm:p-3 font-semibold text-gray-900">${r.name}</td>
        <td class="p-2.5 sm:p-3 text-gray-600">${r.role}</td>
        <td class="p-2.5 sm:p-3 text-center font-bold text-emerald-700">${r.total_days_present} Hari</td>
        <td class="p-2.5 sm:p-3 text-center">${lateDisplay}</td>
        <td class="p-2.5 sm:p-3 font-mono text-gray-700">${r.total_minutes} mnt</td>
        <td class="p-2.5 sm:p-3 font-bold text-amber-950">${durText}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function exportMonthlyExcel() {
  const monthStr = document.getElementById('monthlyPicker').value || getCurrentMonthStr();
  if (!currentMonthlyData || currentMonthlyData.length === 0) {
    showToast('Tidak ada data bulanan untuk diekspor.', 'error');
    return;
  }

  const aoa = [
    ['KAPEBOONSEEN - REKAPITULASI BULANAN (DASAR GAJI & PAYROLL)'],
    [`Bulan: ${monthStr}`, '', '', '', '', '', `Diekspor oleh: ${authUserName}`],
    [],
    ['No', 'ID Pegawai', 'Nama Lengkap', 'Jabatan', 'Total Hari Hadir', 'Jumlah Terlambat', 'Total Menit', 'Total Jam Kerja']
  ];

  currentMonthlyData.forEach((r, idx) => {
    aoa.push([
      idx + 1,
      r.employee_id,
      r.name,
      r.role,
      r.total_days_present,
      `${r.total_late || 0}x`,
      r.total_minutes,
      r.formatted_duration ? r.formatted_duration.textShort : '0 Jam 0 Menit'
    ]);
  });

  downloadExcelFile(aoa, `Rekap_Bulanan_Payroll_${monthStr}.xlsx`, 'Payroll Bulanan');
}

function exportMonthlyCsv() {
  const monthStr = document.getElementById('monthlyPicker').value || getCurrentMonthStr();
  if (!currentMonthlyData || currentMonthlyData.length === 0) {
    showToast('Tidak ada data bulanan untuk diekspor.', 'error');
    return;
  }

  const rows = [
    ['No', 'ID Pegawai', 'Nama Lengkap', 'Jabatan', 'Total Hari Hadir', 'Jumlah Terlambat', 'Total Menit', 'Total Jam Kerja']
  ];

  currentMonthlyData.forEach((r, idx) => {
    rows.push([
      idx + 1,
      r.employee_id,
      r.name,
      r.role,
      r.total_days_present,
      `${r.total_late || 0}x`,
      r.total_minutes,
      r.formatted_duration ? r.formatted_duration.textShort : '0 Jam 0 Menit'
    ]);
  });

  downloadCsvFile(rows, `Rekap_Bulanan_Payroll_${monthStr}.csv`);
}

// Ekspor Seluruh Riwayat Absensi (Semua Tanggal dari Awal s/d Sekarang)
async function exportAllLogsExcel() {
  showToast('Sedang menyiapkan seluruh riwayat data absensi...', 'info');
  try {
    const res = await fetch('/api/admin/recap/all', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success || !data.logs || data.logs.length === 0) {
      showToast('Belum ada riwayat absensi yang tercatat.', 'info');
      return;
    }

    const aoa = [
      ['KAPEBOONSEEN - MASTER LOG SELURUH RIWAYAT ABSENSI'],
      [`Total Data: ${data.logs.length} catatan`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', `Dicetak: ${new Date().toLocaleString('id-ID')}`],
      [],
      ['No', 'ID Presensi', 'Tanggal', 'ID Pegawai', 'Nama Lengkap', 'Jabatan', 'Shift Masuk', 'Jam Masuk', 'Keterlambatan', 'Jarak Masuk (m)', 'Jam Keluar', 'Total Menit', 'Durasi Kerja', 'Status', 'Jam Checkout Pertama (Salah)', 'Catatan Koreksi']
    ];

    data.logs.forEach((a, idx) => {
      aoa.push([
        idx + 1,
        a.id,
        a.date,
        a.employee_id,
        a.name,
        a.role,
        a.scheduled_in || '-',
        a.check_in_time || '-',
        a.is_late === 1 ? 'Terlambat' : (a.check_in_time ? 'Tepat Waktu' : '-'),
        a.check_in_distance !== null ? a.check_in_distance : '-',
        a.check_out_time || '-',
        a.total_minutes || 0,
        a.formatted_duration ? a.formatted_duration.textShort : '0 Jam 0 Menit',
        a.status === 'COMPLETED' ? 'Selesai Pulang' : 'Sedang Bertugas',
        a.first_checkout_time || '-',
        a.notes || '-'
      ]);
    });

    const nowStr = new Date().toISOString().split('T')[0];
    downloadExcelFile(aoa, `Master_Riwayat_Absensi_${nowStr}.xlsx`, 'Master Log Absensi');
  } catch (err) {
    showToast('Gagal mengunduh seluruh riwayat: ' + err.message, 'error');
  }
}

// ==================== 4. TAB KELOLA PEGAWAI (KHUSUS OWNER) ====================
async function loadEmployees() {
  if (authRole !== 'owner') return;

  const tbody = document.getElementById('employeesTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">Memuat data pegawai...</td></tr>';

  try {
    const res = await fetch('/api/admin/employees?all=1', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-rose-500">${data.message || 'Gagal.'}</td></tr>`;
      return;
    }

    renderEmployeesTable(data.employees || []);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-rose-500">Koneksi gagal: ${err.message}</td></tr>`;
  }
}

function renderEmployeesTable(employees) {
  const tbody = document.getElementById('employeesTableBody');
  if (!employees || employees.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">Belum ada pegawai. Klik "Tambah Pegawai Baru".</td></tr>';
    return;
  }

  let html = '';
  employees.forEach(e => {
    const isActive = e.is_active === 1 || e.is_active === '1';
    const statusBadge = isActive
      ? '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">Aktif</span>'
      : '<span class="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-medium">Nonaktif</span>';

    const reportBadge = (e.can_access_reports === 1 || e.can_access_reports === '1')
      ? '<span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold flex items-center gap-1 inline-flex"><i data-lucide="file-check" class="w-3 h-3"></i> Akses Laporan</span>'
      : '<span class="text-gray-400 text-[11px]">-</span>';

    html += `
      <tr class="hover:bg-amber-50/40 transition">
        <td class="p-2.5 sm:p-3 font-mono font-bold text-gray-800">${e.employee_id}</td>
        <td class="p-2.5 sm:p-3 font-semibold text-gray-900">${e.name}</td>
        <td class="p-2.5 sm:p-3 text-gray-600">${e.role}</td>
        <td class="p-2.5 sm:p-3 font-mono text-gray-700">${e.pin}</td>
        <td class="p-2.5 sm:p-3">${reportBadge}</td>
        <td class="p-2.5 sm:p-3">${statusBadge}</td>
        <td class="p-2.5 sm:p-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditEmployeeModal(${e.id}, '${e.employee_id}', '${encodeURIComponent(e.name)}', '${e.pin}', '${e.role}', ${isActive}, ${e.can_access_reports || 0})" 
              class="p-1.5 hover:bg-amber-100 text-amber-900 rounded-lg transition" title="Edit Pegawai">
              <i data-lucide="edit" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="handleDeleteEmployee(${e.id}, '${e.employee_id}')" 
              class="p-1.5 hover:bg-rose-100 text-rose-700 rounded-lg transition" title="Nonaktifkan">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function openAddEmployeeModal() {
  document.getElementById('empModalTitle').textContent = 'Tambah Pegawai Baru';
  document.getElementById('empIdInputHidden').value = '';
  document.getElementById('empIdCode').value = '';
  document.getElementById('empIdCode').readOnly = false;
  document.getElementById('empName').value = '';
  document.getElementById('empPin').value = '';
  document.getElementById('empRole').value = 'Barista';
  document.getElementById('empCanAccessReports').checked = false;
  document.getElementById('empModal').classList.remove('hidden');
}

window.openEditEmployeeModal = function(id, code, nameEncoded, pin, role, isActive, canAccess) {
  document.getElementById('empModalTitle').textContent = 'Edit Data Pegawai';
  document.getElementById('empIdInputHidden').value = id;
  document.getElementById('empIdCode').value = code;
  document.getElementById('empIdCode').readOnly = false;
  document.getElementById('empName').value = decodeURIComponent(nameEncoded);
  document.getElementById('empPin').value = pin;
  document.getElementById('empRole').value = role;
  document.getElementById('empCanAccessReports').checked = (canAccess === 1 || canAccess === '1' || canAccess === true);
  document.getElementById('empModal').classList.remove('hidden');
};

async function handleSaveEmployee(e) {
  e.preventDefault();
  const idVal = document.getElementById('empIdInputHidden').value;
  const employee_id = document.getElementById('empIdCode').value.trim().toUpperCase();
  const name = document.getElementById('empName').value.trim();
  const pin = document.getElementById('empPin').value.trim();
  const role = document.getElementById('empRole').value;
  const can_access_reports = document.getElementById('empCanAccessReports').checked ? 1 : 0;

  if (!employee_id || !name || !pin) {
    showToast('Semua kolom wajib diisi!', 'error');
    return;
  }

  const payload = {
    id: idVal ? parseInt(idVal, 10) : undefined,
    employee_id,
    name,
    pin,
    role,
    can_access_reports,
    is_active: true
  };

  try {
    const res = await fetch('/api/admin/employees', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Data pegawai dan hak akses berhasil disimpan!', 'success');
      document.getElementById('empModal').classList.add('hidden');
      loadEmployees();
    } else {
      showToast(data.message || 'Gagal menyimpan pegawai.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
}

window.handleDeleteEmployee = async function(id, code) {
  if (!confirm(`Yakin ingin menonaktifkan pegawai ${code}?`)) return;
  try {
    const res = await fetch('/api/admin/employees', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ id: parseInt(id, 10), action: 'delete' })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Pegawai berhasil dinonaktifkan.', 'success');
      loadEmployees();
    } else {
      showToast(data.message || 'Gagal menonaktifkan.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
};

// ==================== 5. TAB PENGATURAN KEDAI, CADANGAN & CLOUD ====================
async function loadSettings() {
  if (authRole !== 'owner') return;

  try {
    const res = await fetch('/api/admin/settings', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success && data.settings) {
      cachedSettings = data.settings;
      document.getElementById('setShopName').value = data.settings.shop_name || 'KAPEBOONSEEN';
      document.getElementById('setLatitude').value = data.settings.latitude || '';
      document.getElementById('setLongitude').value = data.settings.longitude || '';
      document.getElementById('setRadius').value = data.settings.radius_meters || '25';
      document.getElementById('setGpsEnforced').value = data.settings.gps_enforced !== undefined ? data.settings.gps_enforced : '1';
      document.getElementById('setOwnerPin').value = data.settings.owner_pin || '';
      if (document.getElementById('setShiftTimeEnabled')) {
        document.getElementById('setShiftTimeEnabled').value = data.settings.shift_time_enabled !== '0' ? '1' : '0';
      }
    }
  } catch (err) {
    showToast('Gagal memuat pengaturan: ' + err.message, 'error');
  }

  try {
    const statusRes = await fetch('/api/admin/data/status', {
      headers: getAuthHeaders()
    });
    const statusData = await statusRes.json();
    if (statusData.success && statusData.status) {
      const s = statusData.status;
      const badge = document.getElementById('dbModeBadge');
      const title = document.getElementById('dbStatusTitle');
      const desc = document.getElementById('dbStatusDesc');

      if (badge && s.is_persistent_cloud) {
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 flex items-center gap-1 inline-flex';
        badge.innerHTML = '🟢 Cloud SQLite Aktif (Permanen)';
      } else if (badge) {
        badge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900';
        badge.textContent = s.mode_name;
      }

      if (title) title.innerHTML = `<i data-lucide="database" class="w-4 h-4 text-amber-800"></i> Mode: ${s.mode_name}`;
      if (desc) desc.textContent = s.description;
      if (window.lucide) lucide.createIcons();
    }
  } catch (e) {}
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const shop_name = document.getElementById('setShopName').value.trim();
  const latitude = document.getElementById('setLatitude').value.trim();
  const longitude = document.getElementById('setLongitude').value.trim();
  const radius_meters = document.getElementById('setRadius').value.trim();
  const gps_enforced = document.getElementById('setGpsEnforced').value;
  const owner_pin = document.getElementById('setOwnerPin').value.trim();
  const shift_time_enabled = document.getElementById('setShiftTimeEnabled')
    ? document.getElementById('setShiftTimeEnabled').value
    : '1';

  if (!shop_name || !latitude || !longitude || !radius_meters || !owner_pin) {
    showToast('Semua kolom pengaturan wajib diisi!', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ shop_name, latitude, longitude, radius_meters, gps_enforced, owner_pin, shift_time_enabled })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Pengaturan kedai berhasil disimpan!', 'success');
      ownerPin = owner_pin;
      localStorage.setItem('owner_auth_pin', owner_pin);
      document.getElementById('ownerShopTitle').textContent = shop_name;
    } else {
      showToast(data.message || 'Gagal menyimpan.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
}

function detectCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('Browser Anda tidak mendukung GPS / Geolocation.', 'error');
    return;
  }
  showToast('Mendeteksi titik koordinat kedai...', 'info');
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('setLatitude').value = pos.coords.latitude;
      document.getElementById('setLongitude').value = pos.coords.longitude;
      showToast('Koordinat GPS berhasil terisi!', 'success');
    },
    err => {
      showToast('Gagal mendeteksi lokasi: ' + err.message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ==================== CADANGAN & PEMULIHAN (BACKUP & RESTORE) ====================

async function downloadBackupData() {
  showToast('Menyiapkan file cadangan...', 'info');
  try {
    const res = await fetch('/api/admin/data/backup', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success || !data.data) {
      showToast('Gagal membuat file cadangan.', 'error');
      return;
    }

    const jsonStr = JSON.stringify(data.data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const nowStr = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `Cadangan_Data_KAPEBOONSEEN_${nowStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('File cadangan data berhasil diunduh ke perangkat Anda!', 'success');
  } catch (err) {
    showToast('Gagal mengunduh cadangan: ' + err.message, 'error');
  }
}

async function handleRestoreFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const backupJson = JSON.parse(e.target.result);
      if (!backupJson || (!backupJson.settings && !backupJson.employees && !backupJson.attendances)) {
        showToast('Format file cadangan tidak sesuai.', 'error');
        return;
      }

      if (!confirm('Yakin ingin memulihkan data dari file ini? Data sistem saat ini akan diperbarui.')) {
        return;
      }

      showToast('Memulihkan data sistem...', 'info');
      const res = await fetch('/api/admin/data/restore', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: backupJson })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Data berhasil dipulihkan secara menyeluruh!', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast(data.message || 'Gagal memulihkan data.', 'error');
      }
    } catch (err) {
      showToast('Gagal membaca file JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

async function handleClearAttendancesAction() {
  const input = document.getElementById('inputConfirmClearText');
  if (!input || input.value.trim().toUpperCase() !== 'HAPUS') {
    showToast('Ketik kata HAPUS dengan benar untuk mengonfirmasi!', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/attendance/clear', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) {
      showToast('Seluruh data riwayat absensi telah dibersihkan!', 'success');
      document.getElementById('clearAttendancesModal').classList.add('hidden');
      input.value = '';
      loadDailyRecap();
    } else {
      showToast(data.message || 'Gagal membersihkan data.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  }
}

// ==================== BARCODE DASHBOARD HP ====================
let ownerQrInstance = null;

async function openMobileOwnerQrModal() {
  const container = document.getElementById('ownerMobileQrCanvas');
  const urlText = document.getElementById('ownerMobileQrUrlText');
  urlText.textContent = 'Menghubungkan ke server...';
  container.innerHTML = 'Membuat barcode...';
  document.getElementById('mobileOwnerQrModal').classList.remove('hidden');

  let targetUrl = window.location.origin + '/owner.html';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    try {
      const res = await fetch('/api/server-info');
      const d = await res.json();
      if (d.tunnel_url && d.tunnel_url.startsWith('https://')) {
        targetUrl = d.tunnel_url + '/owner.html';
      }
    } catch (e) {}
  }

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

function downloadOwnerQrImage() {
  const container = document.getElementById('ownerMobileQrCanvas');
  const canvas = container.querySelector('canvas');
  if (!canvas) {
    showToast('Gambar barcode belum siap.', 'error');
    return;
  }
  const link = document.createElement('a');
  link.download = 'Barcode_Dashboard_Owner_Kapeboonseen.jpg';
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
  showToast('Gambar barcode berhasil diunduh!', 'success');
}

function closeMobileOwnerQrModal() {
  document.getElementById('mobileOwnerQrModal').classList.add('hidden');
}

// ==================== EVENT LISTENERS & INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  initTabs();

  // Tab Switcher pada Modal Login
  const tabOwner = document.getElementById('tabBtnLoginOwner');
  const tabSup = document.getElementById('tabBtnLoginSupervisor');
  const formOwner = document.getElementById('ownerLoginForm');
  const formSup = document.getElementById('supervisorLoginForm');

  if (tabOwner && tabSup) {
    tabOwner.addEventListener('click', () => {
      tabOwner.className = 'flex-1 py-1.5 rounded-lg bg-[#5E391C] text-white shadow-sm transition';
      tabSup.className = 'flex-1 py-1.5 rounded-lg text-gray-700 hover:text-amber-950 transition';
      formOwner.classList.remove('hidden');
      formSup.classList.add('hidden');
    });

    tabSup.addEventListener('click', () => {
      tabSup.className = 'flex-1 py-1.5 rounded-lg bg-[#5E391C] text-white shadow-sm transition';
      tabOwner.className = 'flex-1 py-1.5 rounded-lg text-gray-700 hover:text-amber-950 transition';
      formSup.classList.remove('hidden');
      formOwner.classList.add('hidden');
    });
  }

  // Form Submit Login Owner
  if (formOwner) {
    formOwner.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('ownerPinInput').value.trim();
      if (!pin) return;

      const btnSubmit = document.getElementById('btnOwnerLoginSubmit');
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1"></span> Memverifikasi...';
      }

      ownerPin = pin;
      authRole = 'owner';
      localStorage.setItem('owner_auth_pin', pin);
      localStorage.setItem('auth_role', 'owner');

      try {
        await verifyOwnerAccess(true);
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '<i data-lucide="unlock" class="w-4 h-4"></i> <span>Buka Dashboard Owner</span>';
          if (window.lucide) lucide.createIcons();
        }
      }
    });
  }

  // Form Submit Login Supervisor
  if (formSup) {
    formSup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const empId = document.getElementById('supervisorEmpIdInput').value.trim().toUpperCase();
      const pin = document.getElementById('supervisorPinInput').value.trim();
      if (!empId || !pin) return;

      const btnSubmit = document.getElementById('btnSupervisorLoginSubmit');
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1"></span> Memverifikasi...';
      }

      authEmpId = empId;
      authEmpPin = pin;
      authRole = 'supervisor';
      localStorage.setItem('auth_emp_id', empId);
      localStorage.setItem('auth_emp_pin', pin);
      localStorage.setItem('auth_role', 'supervisor');

      try {
        await verifyOwnerAccess(true);
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '<i data-lucide="file-spreadsheet" class="w-4 h-4"></i> <span>Buka Panel Rekap (Supervisor)</span>';
          if (window.lucide) lucide.createIcons();
        }
      }
    });
  }

  // Logout
  const btnLogout = document.getElementById('btnOwnerLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('owner_auth_pin');
      localStorage.removeItem('auth_emp_id');
      localStorage.removeItem('auth_emp_pin');
      localStorage.removeItem('auth_role');
      localStorage.removeItem('auth_user_name');
      if (pendingCorrectionsPollTimer) clearInterval(pendingCorrectionsPollTimer);
      window.location.reload();
    });
  }

  // Tombol Barcode HP
  document.getElementById('btnOpenMobileOwnerQr')?.addEventListener('click', openMobileOwnerQrModal);
  document.getElementById('btnCloseMobileOwnerQrModal')?.addEventListener('click', closeMobileOwnerQrModal);
  document.getElementById('btnDoneMobileOwnerQr')?.addEventListener('click', closeMobileOwnerQrModal);
  document.getElementById('btnDownloadOwnerQrJpeg')?.addEventListener('click', downloadOwnerQrImage);
  document.getElementById('btnCopyOwnerUrl')?.addEventListener('click', () => {
    const urlText = document.getElementById('ownerMobileQrUrlText').textContent.trim();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(urlText).then(() => {
        showToast('Link Dashboard HP berhasil disalin!', 'success');
      }).catch(() => {
        showToast('Tautan: ' + urlText);
      });
    } else {
      showToast('Tautan: ' + urlText);
    }
  });

  // Tombol Review Koreksi Check-Out
  document.getElementById('btnOpenPendingCorrectionsModal')?.addEventListener('click', openCorrectionsReviewModal);
  document.getElementById('btnCloseCorrectionsReviewModal')?.addEventListener('click', () => {
    document.getElementById('correctionsReviewModal').classList.add('hidden');
  });
  document.getElementById('btnDoneCorrectionsReviewModal')?.addEventListener('click', () => {
    document.getElementById('correctionsReviewModal').classList.add('hidden');
  });

  // Tombol Refresh Rekap
  document.getElementById('btnRefreshDaily')?.addEventListener('click', loadDailyRecap);
  document.getElementById('btnRefreshWeekly')?.addEventListener('click', loadWeeklyRecap);
  document.getElementById('btnRefreshMonthly')?.addEventListener('click', loadMonthlyRecap);

  // Tombol Ekspor Harian
  document.getElementById('btnExportDailyXlsx')?.addEventListener('click', exportDailyExcel);
  document.getElementById('btnExportDailyCsv')?.addEventListener('click', exportDailyCsv);

  // Tombol Ekspor Mingguan
  document.getElementById('btnExportWeeklyXlsx')?.addEventListener('click', exportWeeklyExcel);
  document.getElementById('btnExportWeeklyCsv')?.addEventListener('click', exportWeeklyCsv);

  // Tombol Ekspor Bulanan
  document.getElementById('btnExportMonthlyXlsx')?.addEventListener('click', exportMonthlyExcel);
  document.getElementById('btnExportMonthlyCsv')?.addEventListener('click', exportMonthlyCsv);
  document.getElementById('btnExportAllLogsXlsx')?.addEventListener('click', exportAllLogsExcel);

  // Modal Pegawai
  document.getElementById('btnOpenAddEmpModal')?.addEventListener('click', openAddEmployeeModal);
  document.getElementById('btnCloseEmpModal')?.addEventListener('click', () => {
    document.getElementById('empModal').classList.add('hidden');
  });
  document.getElementById('btnCancelEmpModal')?.addEventListener('click', () => {
    document.getElementById('empModal').classList.add('hidden');
  });
  document.getElementById('empForm')?.addEventListener('submit', handleSaveEmployee);

  // Pengaturan Kedai & Cadangan
  document.getElementById('btnDetectCurrentCoords')?.addEventListener('click', detectCurrentLocation);
  document.getElementById('settingsForm')?.addEventListener('submit', handleSaveSettings);

  // Backup & Restore
  document.getElementById('btnDownloadBackup')?.addEventListener('click', downloadBackupData);
  document.getElementById('btnTriggerRestore')?.addEventListener('click', () => {
    document.getElementById('inputRestoreBackup').click();
  });
  document.getElementById('inputRestoreBackup')?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleRestoreFile(e.target.files[0]);
    }
  });

  // Hapus Riwayat Absensi Modal
  document.getElementById('btnOpenClearModal')?.addEventListener('click', () => {
    document.getElementById('inputConfirmClearText').value = '';
    document.getElementById('clearAttendancesModal').classList.remove('hidden');
  });
  document.getElementById('btnCancelClearModal')?.addEventListener('click', () => {
    document.getElementById('clearAttendancesModal').classList.add('hidden');
  });
  document.getElementById('btnConfirmClearAction')?.addEventListener('click', handleClearAttendancesAction);

  // Modal Edit Catatan Presensi
  document.getElementById('btnCloseEditAttModal')?.addEventListener('click', closeEditAttendanceModal);
  document.getElementById('btnCancelEditAttModal')?.addEventListener('click', closeEditAttendanceModal);
  document.getElementById('formEditAttendance')?.addEventListener('submit', handleSaveAttendanceEdit);

  // Modal Hapus 1 Baris Presensi
  document.getElementById('btnCancelDeleteSingleAtt')?.addEventListener('click', closeDeleteSingleAttendanceModal);
  document.getElementById('btnConfirmDeleteSingleAtt')?.addEventListener('click', confirmDeleteAttendance);

  // Cek otentikasi awal saat halaman dibuka
  verifyOwnerAccess();

  // Auto-refresh data harian & notifikasi secara realtime setiap 15 detik
  setInterval(() => {
    if (currentTab === 'tab-daily' && (ownerPin || (authEmpId && authEmpPin))) {
      loadDailyRecap();
      checkPendingCorrections();
    }
  }, 15000);

  if (window.lucide) lucide.createIcons();
});
