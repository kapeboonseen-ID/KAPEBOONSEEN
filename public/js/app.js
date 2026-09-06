// State Aplikasi Absensi Crew
let currentUser = null;
let currentPin = '';
let shopSettings = {
  shop_name: 'Kedai Kopi Boonseen',
  latitude: -6.2088,
  longitude: 106.8456,
  radius_meters: 50,
  gps_enforced: true
};
let userGps = null;
let gpsDistance = null;
let isWithinArea = false;
let attendanceRecord = null;

// Rumus Haversine di Sisi Klien
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return 999999;
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Format Tanggal & Jam Lokal Indonesia
function getTodayDateStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

function getCurrentTimeStr() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function updateClock() {
  const clockEl = document.getElementById('liveClock');
  if (clockEl) {
    clockEl.textContent = getCurrentTimeStr();
  }
}

// Inisialisasi Tampilan Tanggal
function initDateDisplay() {
  const dateEl = document.getElementById('todayDateDisplay');
  if (dateEl) {
    const options = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
    dateEl.textContent = new Date().toLocaleDateString('id-ID', options);
  }
}

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

// Ambil Pengaturan Kedai dari Server
async function fetchShopSettings() {
  try {
    const res = await fetch('/api/settings/public');
    const data = await res.json();
    if (data.shop_name) {
      shopSettings = data;
      document.getElementById('headerShopName').textContent = data.shop_name;
      document.title = `Absensi Crew - ${data.shop_name}`;
    }
  } catch (err) {
    console.warn('Gagal memuat pengaturan kedai:', err);
  }
}

// Dapatkan Lokasi GPS Pengguna
function requestGpsLocation() {
  const statusText = document.getElementById('gpsStatusText');
  const distanceInfo = document.getElementById('gpsDistanceInfo');
  const badge = document.getElementById('gpsBadge');
  const banner = document.getElementById('gpsBanner');

  if (!navigator.geolocation) {
    statusText.textContent = 'Browser ini tidak mendukung GPS.';
    distanceInfo.textContent = 'Fitur GPS tidak tersedia di browser Anda.';
    badge.className = 'badge-status bg-rose-100 text-rose-800';
    badge.textContent = 'GPS Error';
    return;
  }

  statusText.textContent = 'Mendeteksi posisi GPS...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userGps = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy)
      };

      // Hitung jarak ke kedai
      gpsDistance = calculateDistance(
        userGps.lat,
        userGps.lng,
        shopSettings.latitude,
        shopSettings.longitude
      );

      isWithinArea = gpsDistance <= shopSettings.radius_meters;

      if (isWithinArea || !shopSettings.gps_enforced) {
        statusText.textContent = `Posisi akurat (Akurasi ~${userGps.accuracy}m)`;
        distanceInfo.innerHTML = `Jarak: <strong>${gpsDistance} meter</strong> (Dalam area kedai)`;
        badge.className = 'badge-status badge-present';
        badge.textContent = 'Di Area Kedai ✓';
        banner.className = 'p-2.5 rounded-xl text-xs flex items-center justify-between bg-emerald-50 text-emerald-900 border border-emerald-200';
      } else {
        statusText.textContent = `Terlalu jauh dari kedai`;
        distanceInfo.innerHTML = `Jarak: <strong>${gpsDistance} meter</strong> (Maks. ${shopSettings.radius_meters}m)`;
        badge.className = 'badge-status bg-rose-100 text-rose-800';
        badge.textContent = 'Di Luar Kedai ✕';
        banner.className = 'p-2.5 rounded-xl text-xs flex items-center justify-between bg-rose-50 text-rose-900 border border-rose-200';
      }

      renderAttendanceState();
      if (window.lucide) lucide.createIcons();
    },
    (err) => {
      console.warn('GPS Error:', err.message);
      statusText.textContent = 'Izin lokasi GPS belum diaktifkan';
      distanceInfo.textContent = 'Izinkan akses lokasi/GPS pada browser HP Anda agar bisa absensi.';
      badge.className = 'badge-status bg-amber-100 text-amber-800';
      badge.textContent = 'Perlu Izin GPS';
      banner.className = 'p-2.5 rounded-xl text-xs flex items-center justify-between bg-amber-50 text-amber-900 border border-amber-200';
      renderAttendanceState();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

// Cek Status Absensi & Ringkasan Pegawai
async function checkAttendanceStatus() {
  if (!currentUser) return;

  try {
    const res = await fetch('/api/attendance/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: currentUser.employee_id,
        date: getTodayDateStr()
      })
    });
    const data = await res.json();
    if (data.success) {
      attendanceRecord = data.record;
      updateSummaryUI(data.summary);
      renderAttendanceState();
    }
  } catch (err) {
    console.error('Gagal mengambil status absensi:', err);
  }
}

// Render Tampilan Aksi Absensi
function renderAttendanceState() {
  const container = document.getElementById('attendanceStateView');
  if (!container) return;

  // Kasus 1: Belum Check-in
  if (!attendanceRecord) {
    const disabledClass = (shopSettings.gps_enforced && !isWithinArea) ? 'opacity-50 cursor-not-allowed' : '';
    container.innerHTML = `
      <div class="space-y-3">
        <div class="inline-flex p-3 rounded-full bg-emerald-100 text-emerald-800">
          <i data-lucide="sun" class="w-8 h-8"></i>
        </div>
        <div>
          <h3 class="text-base font-bold text-gray-800">Mulai Shift Hari Ini</h3>
          <p class="text-xs text-gray-500">Pastikan Anda sudah berada di kedai dan siap bertugas</p>
        </div>
        <button id="btnDoCheckIn" ${disabledClass ? 'disabled' : ''}
          class="w-full btn-checkin py-4 rounded-xl text-base font-bold flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.99] ${disabledClass}">
          <i data-lucide="log-in" class="w-5 h-5"></i>
          <span>CHECK IN SEKARANG</span>
        </button>
        ${(shopSettings.gps_enforced && !isWithinArea) 
          ? '<p class="text-[11px] text-rose-600 font-medium">⚠️ Tombol Check-In akan aktif saat Anda berada di area kedai (&le; ' + shopSettings.radius_meters + 'm).</p>'
          : '<p class="text-[11px] text-gray-400">Catatan: Check-in hanya dapat dilakukan 1x sehari.</p>'}
      </div>
    `;

    const btnIn = document.getElementById('btnDoCheckIn');
    if (btnIn && (!shopSettings.gps_enforced || isWithinArea)) {
      btnIn.onclick = handleCheckIn;
    }
  }
  // Kasus 2: Sedang Bertugas (Sudah Check-in, Belum Check-out)
  else if (attendanceRecord.status === 'CHECKED_IN') {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="inline-flex p-3 rounded-full bg-amber-100 text-amber-900">
          <i data-lucide="coffee" class="w-8 h-8 text-[#5E391C]"></i>
        </div>
        <div>
          <div class="badge-status badge-present text-xs py-1 px-3 mb-1">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Sedang Bertugas
          </div>
          <h3 class="text-base font-bold text-gray-800">Shift Sedang Berlangsung</h3>
          <p class="text-xs text-gray-500">
            Jam Masuk: <strong class="text-[#3A2010] font-mono text-sm">${attendanceRecord.check_in_time}</strong>
          </p>
        </div>

        <button id="btnDoCheckOut"
          class="w-full btn-checkout py-4 rounded-xl text-base font-bold flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.99]">
          <i data-lucide="log-out" class="w-5 h-5"></i>
          <span>CHECK OUT (PULANG)</span>
        </button>
        <p class="text-[11px] text-gray-400">Tekan tombol di atas saat jam kerja Anda selesai.</p>
      </div>
    `;

    const btnOut = document.getElementById('btnDoCheckOut');
    if (btnOut) {
      btnOut.onclick = handleCheckOut;
    }
  }
  // Kasus 3: Selesai Shift (Sudah Check-out)
  else if (attendanceRecord.status === 'COMPLETED') {
    container.innerHTML = `
      <div class="space-y-3">
        <div class="inline-flex p-3 rounded-full bg-blue-100 text-blue-800">
          <i data-lucide="check-circle-2" class="w-8 h-8"></i>
        </div>
        <div>
          <div class="badge-status badge-completed text-xs py-1 px-3 mb-1">
            ✓ Shift Selesai
          </div>
          <h3 class="text-base font-bold text-gray-800">Absensi Hari Ini Selesai</h3>
          <p class="text-xs text-gray-500">Terima kasih atas kerja keras Anda hari ini!</p>
        </div>

        <div class="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs grid grid-cols-3 gap-1">
          <div>
            <span class="text-gray-400 block text-[10px]">Masuk</span>
            <span class="font-mono font-bold text-gray-700">${attendanceRecord.check_in_time}</span>
          </div>
          <div>
            <span class="text-gray-400 block text-[10px]">Pulang</span>
            <span class="font-mono font-bold text-gray-700">${attendanceRecord.check_out_time}</span>
          </div>
          <div>
            <span class="text-gray-400 block text-[10px]">Total Kerja</span>
            <span class="font-bold text-[#5E391C]">${Math.floor((attendanceRecord.total_minutes || 0) / 60)}j ${(attendanceRecord.total_minutes || 0) % 60}m</span>
          </div>
        </div>

        <div class="p-2.5 rounded-lg bg-gray-100 text-gray-500 text-[11px]">
          Anda sudah menyelesaikan absensi hari ini. Check-in berikutnya dapat dilakukan besok.
        </div>
      </div>
    `;
  }

  if (window.lucide) lucide.createIcons();
}

// Update UI Ringkasan Jam Kerja
function updateSummaryUI(summary) {
  if (!summary) return;

  // Hari Ini
  document.getElementById('sumTodayHours').textContent = summary.today.hoursText.textShort;
  document.getElementById('sumTodayMinutes').textContent = `Total ${summary.today.minutes} Menit`;

  // Minggu Ini
  document.getElementById('sumWeekHours').textContent = summary.thisWeek.hoursText.textShort;
  document.getElementById('sumWeekMinutes').textContent = `Total ${summary.thisWeek.minutes} Menit`;

  // Bulan Ini
  document.getElementById('sumMonthHours').textContent = summary.thisMonth.hoursText.textShort;
  document.getElementById('sumMonthMinutes').textContent = `Total ${summary.thisMonth.minutes} Menit`;

  // Tabel Riwayat
  const tbody = document.getElementById('historyTableBody');
  if (tbody && summary.history && summary.history.length > 0) {
    tbody.innerHTML = summary.history.map(row => {
      const durHours = Math.floor(row.total_minutes / 60);
      const durMins = row.total_minutes % 60;
      const durText = row.status === 'COMPLETED' ? `${durHours}j ${durMins}m` : 'Aktif';
      return `
        <tr class="hover:bg-amber-50/50 transition">
          <td class="py-2 text-gray-600 font-medium">${row.date}</td>
          <td class="py-2 font-mono text-gray-700">${row.check_in_time}</td>
          <td class="py-2 font-mono text-gray-700">${row.check_out_time || '-'}</td>
          <td class="py-2 text-right font-semibold ${row.status === 'COMPLETED' ? 'text-[#5E391C]' : 'text-emerald-600'}">
            ${durText}
          </td>
        </tr>
      `;
    }).join('');
  }
}

// Proses Check-in
async function handleCheckIn() {
  const btn = document.getElementById('btnDoCheckIn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Menyimpan Check-In...
    `;
  }

  try {
    const res = await fetch('/api/attendance/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: currentUser.employee_id,
        pin: currentPin,
        lat: userGps ? userGps.lat : null,
        lng: userGps ? userGps.lng : null,
        date: getTodayDateStr(),
        time: getCurrentTimeStr()
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await checkAttendanceStatus();
    } else {
      showToast(data.message, 'error');
      renderAttendanceState();
    }
  } catch (err) {
    showToast('Terjadi kesalahan jaringan: ' + err.message, 'error');
    renderAttendanceState();
  }
}

// Proses Check-out
async function handleCheckOut() {
  if (!confirm('Apakah Anda yakin ingin melakukan Check-Out (pulang) sekarang?')) {
    return;
  }

  const btn = document.getElementById('btnDoCheckOut');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Menyimpan Check-Out...
    `;
  }

  try {
    const res = await fetch('/api/attendance/check-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: currentUser.employee_id,
        pin: currentPin,
        lat: userGps ? userGps.lat : null,
        lng: userGps ? userGps.lng : null,
        date: getTodayDateStr(),
        time: getCurrentTimeStr()
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await checkAttendanceStatus();
    } else {
      showToast(data.message, 'error');
      renderAttendanceState();
    }
  } catch (err) {
    showToast('Terjadi kesalahan jaringan: ' + err.message, 'error');
    renderAttendanceState();
  }
}

// Proses Login
async function handleLogin(e) {
  e.preventDefault();
  const empId = document.getElementById('loginEmployeeId').value.trim();
  const pin = document.getElementById('loginPin').value.trim();

  if (!empId || !pin) {
    showToast('Harap isi ID dan PIN Pegawai', 'error');
    return;
  }

  const btn = document.getElementById('btnLoginSubmit');
  btn.disabled = true;
  btn.innerHTML = 'Memeriksa Data...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: empId, pin: pin })
    });

    const data = await res.json();
    if (data.success) {
      if (data.role === 'owner') {
        // Jika login sebagai owner, redirect ke halaman owner
        localStorage.setItem('owner_auth_pin', pin);
        window.location.href = '/owner.html';
        return;
      }

      currentUser = data.user;
      currentPin = pin;

      // Simpan session lokal
      localStorage.setItem('crew_session', JSON.stringify({ user: currentUser, pin: currentPin }));

      showToast(`Selamat datang, ${currentUser.name}!`, 'success');
      showAttendanceUI();
    } else {
      showToast(data.message || 'Login gagal!', 'error');
      btn.disabled = false;
      btn.innerHTML = `
        <i data-lucide="log-in" class="w-4 h-4"></i>
        <span>Masuk & Lakukan Absensi</span>
      `;
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    showToast('Gagal menghubungi server: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = 'Masuk & Lakukan Absensi';
  }
}

// Tampilkan UI Absensi setelah Login
function showAttendanceUI() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('attendanceSection').classList.remove('hidden');
  document.getElementById('userBadgeArea').classList.remove('hidden');

  document.getElementById('crewName').textContent = currentUser.name;
  document.getElementById('crewRole').textContent = currentUser.role || 'Crew';
  document.getElementById('crewIdTag').textContent = `ID: ${currentUser.employee_id}`;

  requestGpsLocation();
  checkAttendanceStatus();
}

// Proses Logout
function handleLogout() {
  currentUser = null;
  currentPin = '';
  attendanceRecord = null;
  localStorage.removeItem('crew_session');

  document.getElementById('attendanceSection').classList.add('hidden');
  document.getElementById('userBadgeArea').classList.add('hidden');
  document.getElementById('loginSection').classList.remove('hidden');

  document.getElementById('loginPin').value = '';
  const btn = document.getElementById('btnLoginSubmit');
  btn.disabled = false;
  btn.innerHTML = `
    <i data-lucide="log-in" class="w-4 h-4"></i>
    <span>Masuk & Lakukan Absensi</span>
  `;
  if (window.lucide) lucide.createIcons();
  showToast('Anda telah keluar.', 'info');
}

// Pulihkan Session yang Tersimpan (Jika Ada)
function restoreSession() {
  const saved = localStorage.getItem('crew_session');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.user && parsed.pin) {
        currentUser = parsed.user;
        currentPin = parsed.pin;
        showAttendanceUI();
        return;
      }
    } catch (e) {
      localStorage.removeItem('crew_session');
    }
  }
}

// Buka Modal Ganti PIN
function openChangePinModal() {
  document.getElementById('oldPinInput').value = '';
  document.getElementById('newPinInput').value = '';
  document.getElementById('confirmPinInput').value = '';
  document.getElementById('changePinModal').classList.remove('hidden');
}

// Tutup Modal Ganti PIN
function closeChangePinModal() {
  document.getElementById('changePinModal').classList.add('hidden');
}

// Proses Simpan PIN Baru Pegawai
async function handleChangePin(e) {
  e.preventDefault();
  const oldPin = document.getElementById('oldPinInput').value.trim();
  const newPin = document.getElementById('newPinInput').value.trim();
  const confirmPin = document.getElementById('confirmPinInput').value.trim();

  if (!oldPin || !newPin || !confirmPin) {
    showToast('Semua kolom PIN wajib diisi!', 'error');
    return;
  }

  if (newPin.length < 4) {
    showToast('PIN baru minimal harus 4 digit!', 'error');
    return;
  }

  if (newPin !== confirmPin) {
    showToast('Konfirmasi PIN baru tidak sama/cocok!', 'error');
    return;
  }

  const btn = document.getElementById('btnSaveNewPin');
  btn.disabled = true;
  btn.innerHTML = 'Menyimpan...';

  try {
    const res = await fetch('/api/attendance/change-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: currentUser.employee_id,
        old_pin: oldPin,
        new_pin: newPin
      })
    });

    const data = await res.json();
    if (data.success) {
      currentPin = newPin;
      localStorage.setItem('crew_session', JSON.stringify({ user: currentUser, pin: currentPin }));
      closeChangePinModal();
      showToast(data.message, 'success');
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <i data-lucide="check" class="w-3.5 h-3.5"></i>
      <span>Simpan PIN Baru</span>
    `;
    if (window.lucide) lucide.createIcons();
  }
}

// Inisialisasi Saat Halaman Dimuat
document.addEventListener('DOMContentLoaded', () => {
  initDateDisplay();
  updateClock();
  setInterval(updateClock, 1000);

  fetchShopSettings();

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);

  const btnRefreshGps = document.getElementById('btnRefreshGps');
  if (btnRefreshGps) btnRefreshGps.addEventListener('click', requestGpsLocation);

  const btnOpenPin = document.getElementById('btnOpenChangePin');
  if (btnOpenPin) btnOpenPin.addEventListener('click', openChangePinModal);

  const btnClosePin = document.getElementById('btnCloseChangePinModal');
  if (btnClosePin) btnClosePin.addEventListener('click', closeChangePinModal);

  const btnCancelPin = document.getElementById('btnCancelChangePin');
  if (btnCancelPin) btnCancelPin.addEventListener('click', closeChangePinModal);

  const changePinForm = document.getElementById('changePinForm');
  if (changePinForm) changePinForm.addEventListener('submit', handleChangePin);

  restoreSession();

  if (window.lucide) lucide.createIcons();
});
