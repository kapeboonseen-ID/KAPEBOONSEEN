// State Aplikasi Absensi Crew - KAPEBOONSEEN
let currentUser = null;
let currentPin = '';
let shopSettings = {
  shop_name: 'Kedai Kopi Boonseen',
  latitude: -6.2088,
  longitude: 106.8456,
  radius_meters: 50,
  gps_enforced: true,
  shift_time_enabled: true
};
let userGps = null;
let gpsDistance = null;
let isWithinArea = false;
let attendanceRecord = null;

// Pilihan Shift Masuk & Pulang
let selectedShiftIn = '15:00';
let selectedShiftOut = '23:00';
const SHIFT_IN_OPTIONS = ['15:00', '18:00', '19:00'];
const SHIFT_OUT_OPTIONS = ['18:00', '19:00', '23:00'];

// Timer & Polling
let checkoutLockInterval = null;
let statusPollInterval = null;
let pendingLateCheckInAction = null;

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
      if (data.shift_time_enabled !== undefined) {
        shopSettings.shift_time_enabled = data.shift_time_enabled;
      }
      updateSummaryUI(data.summary);
      renderAttendanceState();
    }
  } catch (err) {
    console.error('Gagal mengambil status absensi:', err);
  }
}

// ==================== RENDER TAMPILAN AKSI ABSENSI ====================
function renderAttendanceState() {
  const container = document.getElementById('attendanceStateView');
  if (!container) return;

  // Hentikan interval lock sebelumnya jika ada
  if (checkoutLockInterval) {
    clearInterval(checkoutLockInterval);
    checkoutLockInterval = null;
  }

  // KASUS 1: BELUM CHECK-IN (Tampilkan Tombol Check-In & Pilihan Shift Masuk)
  if (!attendanceRecord) {
    const disabledClass = (shopSettings.gps_enforced && !isWithinArea) ? 'opacity-50 cursor-not-allowed' : '';

    // Shift Selector Masuk (Modular: Tampil jika shift_time_enabled aktif)
    let shiftSelectorHtml = '';
    if (shopSettings.shift_time_enabled !== false) {
      const pills = SHIFT_IN_OPTIONS.map(time => {
        const isSelected = selectedShiftIn === time;
        const activeClass = isSelected
          ? 'bg-[#5E391C] text-white border-[#5E391C] font-bold shadow'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-amber-50 font-semibold';
        return `
          <button type="button" onclick="selectShiftIn('${time}')"
            class="flex-1 py-2 px-2 rounded-xl text-xs border transition flex items-center justify-center gap-1.5 ${activeClass}">
            ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-amber-300"></i>' : ''}
            <span>${time}</span>
          </button>
        `;
      }).join('');

      shiftSelectorHtml = `
        <div class="bg-amber-50/70 p-3 rounded-2xl border border-amber-200 text-left space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-bold text-[#3A2010] flex items-center gap-1.5">
              <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-800"></i>
              <span>Pilih Jam Masuk Shift:</span>
            </label>
            <span class="text-[10px] bg-amber-200 text-amber-950 font-bold px-2 py-0.5 rounded-md">Wajib Pilih</span>
          </div>
          <div class="flex gap-2">
            ${pills}
          </div>
          <p class="text-[10px] text-gray-500 italic">
            *Jika check-in terlambat &ge; 30 menit dari jam shift, sistem akan mencatat keterlambatan.
          </p>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="space-y-3.5">
        <div class="inline-flex p-3 rounded-full bg-emerald-100 text-emerald-800">
          <i data-lucide="sun" class="w-8 h-8"></i>
        </div>
        <div>
          <h3 class="text-base font-bold text-gray-800">Mulai Shift Hari Ini</h3>
          <p class="text-xs text-gray-500">Pastikan Anda sudah berada di kedai dan siap bertugas</p>
        </div>

        ${shiftSelectorHtml}

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

  // KASUS 2: SEDANG BERTUGAS (Sudah Check-in, Tombol Check-In HILANG, Check-Out Terkunci 105 Menit)
  else if (attendanceRecord.status === 'CHECKED_IN') {
    let shiftOutHtml = '';
    if (shopSettings.shift_time_enabled !== false) {
      const pills = SHIFT_OUT_OPTIONS.map(time => {
        const isSelected = selectedShiftOut === time;
        const activeClass = isSelected
          ? 'bg-[#5E391C] text-white border-[#5E391C] font-bold shadow'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-amber-50 font-semibold';
        return `
          <button type="button" onclick="selectShiftOut('${time}')"
            class="flex-1 py-1.5 px-2 rounded-xl text-xs border transition flex items-center justify-center gap-1 ${activeClass}">
            ${isSelected ? '<i data-lucide="check" class="w-3 h-3 text-amber-300"></i>' : ''}
            <span>${time}</span>
          </button>
        `;
      }).join('');

      shiftOutHtml = `
        <div class="bg-amber-50/70 p-2.5 rounded-xl border border-amber-200 text-left space-y-1.5">
          <label class="text-[11px] font-bold text-[#3A2010] flex items-center gap-1">
            <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-800"></i>
            <span>Pilih Jadwal Jam Kepulangan:</span>
          </label>
          <div class="flex gap-1.5">
            ${pills}
          </div>
        </div>
      `;
    }

    // Cek apakah pegawai sedang mengajukan koreksi shift masuk
    let shiftCorrAreaHtml = '';
    if (attendanceRecord.correction_status === 'PENDING_SHIFT') {
      shiftCorrAreaHtml = `
        <div class="p-2.5 bg-purple-50 border border-purple-300 rounded-xl text-xs text-purple-950 text-left space-y-1 my-2">
          <div class="flex items-center gap-1.5 font-bold text-purple-900">
            <i data-lucide="clock" class="w-3.5 h-3.5 text-purple-700 animate-spin"></i>
            <span>Koreksi Shift Sedang Ditinjau Owner</span>
          </div>
          <p class="text-[11px] text-purple-800 leading-tight">
            Pengajuan perubahan ke shift <strong>${attendanceRecord.requested_shift_in || ''}</strong> telah dikirim ke Dashboard Owner.
          </p>
        </div>
      `;
    } else if (shopSettings.shift_time_enabled !== false) {
      shiftCorrAreaHtml = `
        <div class="pt-1.5">
          <button id="btnOpenShiftCorrectionModal" type="button"
            class="text-[11px] text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 font-semibold px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 transition shadow-sm">
            <i data-lucide="edit-3" class="w-3 h-3 text-amber-700"></i>
            <span>Salah Pilih Jam Masuk? Ajukan Koreksi</span>
          </button>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="space-y-4">
        <div class="inline-flex p-3 rounded-full bg-emerald-100 text-emerald-800">
          <i data-lucide="coffee" class="w-8 h-8"></i>
        </div>
        <div>
          <div class="badge-status badge-present text-xs py-1 px-3 mb-1 inline-flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Sedang Bertugas
          </div>
          <h3 class="text-base font-bold text-gray-800">Shift Sedang Berlangsung</h3>
          <p class="text-xs text-gray-500 mt-1">
            Jam Masuk: <strong class="text-[#3A2010] font-mono text-sm">${attendanceRecord.check_in_time}</strong>
            ${attendanceRecord.scheduled_in ? ` (Shift ${attendanceRecord.scheduled_in})` : ''}
            ${attendanceRecord.is_late === 1 ? '<span class="ml-1 px-1.5 py-0.5 bg-rose-100 text-rose-700 font-bold rounded text-[10px]">Terlambat</span>' : ''}
          </p>
          ${shiftCorrAreaHtml}
        </div>

        ${shiftOutHtml}

        <!-- Banner Countdown Kunci 105 Menit -->
        <div id="checkoutLockBanner" class="p-3 bg-amber-50 rounded-xl border border-amber-300 text-xs text-left hidden">
        </div>

        <!-- Tombol Check-Out (Akan dinonaktifkan jika belum 105 menit) -->
        <button id="btnDoCheckOut" type="button" onclick="handleCheckOut()"
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

    const btnOpenShiftCorr = document.getElementById('btnOpenShiftCorrectionModal');
    if (btnOpenShiftCorr) {
      btnOpenShiftCorr.onclick = openShiftCorrectionModal;
    }

    // Mulai pemantauan kunci 105 menit
    startCheckoutLockCountdown();
  }

  // KASUS 3: SELESAI SHIFT (Sudah Check-Out, Bisa Ajukan Koreksi jika Salah Klik)
  else if (attendanceRecord.status === 'COMPLETED') {
    const isPending = attendanceRecord.correction_status === 'PENDING';

    let correctionAreaHtml = '';
    if (isPending) {
      correctionAreaHtml = `
        <div class="p-3 bg-amber-50 border-2 border-amber-400 rounded-xl text-xs text-amber-950 space-y-1 text-left">
          <div class="flex items-center gap-1.5 font-bold text-amber-900">
            <i data-lucide="clock" class="w-4 h-4 text-amber-700 animate-spin"></i>
            <span>Pengajuan Koreksi Check-Out Sedang Ditinjau</span>
          </div>
          <p class="text-[11px] text-amber-800 leading-relaxed">
            Permintaan pembatalan check-out Anda telah dikirim ke Owner kedai. Mohon tunggu persetujuan Owner di dashboard agar Anda dapat melakukan Check-Out ulang pada jam kepulangan sebenarnya.
          </p>
        </div>
      `;
    } else {
      correctionAreaHtml = `
        <button id="btnOpenCorrectionModal" type="button"
          class="w-full bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-sm">
          <i data-lucide="help-circle" class="w-4 h-4 text-amber-700"></i>
          <span>Salah Klik Pulang? Ajukan Koreksi Check-Out</span>
        </button>
      `;
    }

    container.innerHTML = `
      <div class="space-y-3.5">
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

        ${correctionAreaHtml}

        <div class="p-2.5 rounded-lg bg-gray-100 text-gray-500 text-[11px]">
          Anda sudah menyelesaikan absensi hari ini. Check-in berikutnya dapat dilakukan besok.
        </div>
      </div>
    `;

    const btnCorrection = document.getElementById('btnOpenCorrectionModal');
    if (btnCorrection) {
      btnCorrection.onclick = openCorrectionModal;
    }
  }

  if (window.lucide) lucide.createIcons();
}

// Pemilihan Shift Masuk
window.selectShiftIn = function(time) {
  selectedShiftIn = time;
  renderAttendanceState();
};

// Pemilihan Shift Pulang
window.selectShiftOut = function(time) {
  selectedShiftOut = time;
  renderAttendanceState();
};

// ==================== LOGIKA KUNCI CHECK-OUT 105 MENIT ====================
function startCheckoutLockCountdown() {
  function checkLock() {
    if (!attendanceRecord || attendanceRecord.status !== 'CHECKED_IN') return;

    const [inH, inM, inS] = (attendanceRecord.check_in_time || '00:00:00').split(':').map(Number);
    const inSec = inH * 3600 + inM * 60 + (inS || 0);

    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    let elapsedSec = nowSec - inSec;
    if (elapsedSec < 0) elapsedSec += 24 * 3600; // antisipasi pergantian hari tengah malam

    const lockLimitSec = 105 * 60; // 1 jam 45 menit = 105 menit
    const remainingSec = lockLimitSec - elapsedSec;

    const btnOut = document.getElementById('btnDoCheckOut');
    const lockBanner = document.getElementById('checkoutLockBanner');

    if (remainingSec > 0) {
      const remM = Math.floor(remainingSec / 60);
      const remS = remainingSec % 60;

      if (btnOut) {
        btnOut.disabled = true;
        btnOut.className = 'w-full bg-stone-300 text-stone-500 py-4 rounded-xl text-sm sm:text-base font-bold flex items-center justify-center gap-2 cursor-not-allowed shadow-none border border-stone-400/30';
        btnOut.innerHTML = `
          <i data-lucide="lock" class="w-5 h-5"></i>
          <span>CHECK OUT TERKUNCI (${remM}m ${remS}s)</span>
        `;
      }

      if (lockBanner) {
        lockBanner.classList.remove('hidden');
        lockBanner.innerHTML = `
          <div class="flex items-center gap-2 font-bold text-amber-950">
            <i data-lucide="lock" class="w-4 h-4 text-amber-800 flex-shrink-0"></i>
            <span>Tombol Check-Out Dikunci Sistem</span>
          </div>
          <p class="text-[11px] text-amber-850 mt-1 leading-relaxed">
            Waktu kerja minimal sebelum kepulangan adalah <strong>1 jam 45 menit (105 menit)</strong>.
          </p>
          <div class="mt-2 text-center bg-white/80 py-1.5 px-3 rounded-lg font-mono font-bold text-amber-950 text-xs border border-amber-300 flex items-center justify-between">
            <span>Sisa Waktu Kunci:</span>
            <span class="text-rose-700 font-black">${remM} Menit ${remS} Detik</span>
          </div>
        `;
      }
    } else {
      // Waktu 105 menit telah terpenuhi! Tombol dibuka dan event click dipastikan aktif
      if (btnOut) {
        btnOut.disabled = false;
        btnOut.onclick = handleCheckOut;
        if (!btnOut.classList.contains('btn-checkout')) {
          btnOut.className = 'w-full btn-checkout py-4 rounded-xl text-base font-bold flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.99]';
          btnOut.innerHTML = `
            <i data-lucide="log-out" class="w-5 h-5"></i>
            <span>CHECK OUT (PULANG)</span>
          `;
        }
      }
      if (lockBanner) {
        lockBanner.classList.add('hidden');
      }
    }
    if (window.lucide) lucide.createIcons();
  }

  checkLock();
  checkoutLockInterval = setInterval(checkLock, 1000);
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

// ==================== PROSES CHECK-IN ====================
async function handleCheckIn() {
  const currentTime = getCurrentTimeStr();

  // Validasi Shift & Peringatan Terlambat (+30 Menit)
  if (shopSettings.shift_time_enabled !== false && selectedShiftIn) {
    const [schedH, schedM] = selectedShiftIn.split(':').map(Number);
    const [nowH, nowM] = currentTime.split(':').map(Number);
    const diffMinutes = (nowH * 60 + nowM) - (schedH * 60 + schedM);

    if (diffMinutes >= 30) {
      // Munculkan Pop Up Peringatan Keterlambatan
      document.getElementById('lateWarningDetails').textContent = 
        `Jadwal Shift: ${selectedShiftIn} | Waktu Saat Ini: ${currentTime} (Terlambat ${diffMinutes} menit).`;
      document.getElementById('lateWarningModal').classList.remove('hidden');

      // Simpan aksi untuk dilanjutkan saat tombol konfirmasi ditekan
      pendingLateCheckInAction = () => executeCheckIn(true);
      return;
    }
  }

  // Jika tidak terlambat atau pilihan shift dinonaktifkan
  await executeCheckIn(false);
}

// Eksekusi Simpan Check-In ke Server
async function executeCheckIn(isLate) {
  document.getElementById('lateWarningModal').classList.add('hidden');

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
        time: getCurrentTimeStr(),
        scheduled_in: shopSettings.shift_time_enabled !== false ? selectedShiftIn : null
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, data.is_late ? 'error' : 'success');
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

// ==================== PROSES CHECK-OUT ====================
window.handleCheckOut = function() {
  const btn = document.getElementById('btnDoCheckOut');
  if (btn && btn.disabled) return;

  const modal = document.getElementById('confirmCheckOutModal');
  if (modal) {
    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Fallback jika modal tidak ada di DOM
  if (confirm('Apakah Anda yakin ingin melakukan Check-Out (pulang) sekarang?')) {
    executeCheckOut();
  }
};

window.executeCheckOut = async function() {
  const modal = document.getElementById('confirmCheckOutModal');
  if (modal) modal.classList.add('hidden');

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
        time: getCurrentTimeStr(),
        scheduled_out: shopSettings.shift_time_enabled !== false ? selectedShiftOut : null
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await checkAttendanceStatus();
    } else {
      showToast(data.message || 'Gagal melakukan check-out', 'error');
      renderAttendanceState();
    }
  } catch (err) {
    showToast('Terjadi kesalahan jaringan: ' + err.message, 'error');
    renderAttendanceState();
  }
};

// ==================== MODAL & PROSES PENGAJUAN KOREKSI ====================
function openCorrectionModal() {
  document.getElementById('correctionReasonInput').value = 'Tidak sengaja klik Check-Out sebelum jam kepulangan jadwal shift.';
  document.getElementById('requestCorrectionModal').classList.remove('hidden');
}

function closeCorrectionModal() {
  document.getElementById('requestCorrectionModal').classList.add('hidden');
}

async function handleSubmitCorrection(e) {
  e.preventDefault();
  const reason = document.getElementById('correctionReasonInput').value.trim();
  const btn = document.getElementById('btnSubmitCorrection');
  btn.disabled = true;
  btn.innerHTML = 'Mengirim...';

  try {
    const res = await fetch('/api/attendance/request-correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: currentUser.employee_id,
        pin: currentPin,
        date: getTodayDateStr(),
        reason: reason || 'Salah klik tombol Check-Out'
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeCorrectionModal();
      await checkAttendanceStatus();
    } else {
      showToast(data.message, 'error');
    }
  } catch (err) {
    showToast('Gagal mengirim pengajuan: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Kirim ke Owner</span>';
    if (window.lucide) lucide.createIcons();
  }
}

// ==================== MODAL KOREKSI SHIFT MASUK ====================
window.selectShiftCorrectionVal = function(time) {
  const inputEl = document.getElementById('shiftCorrectionValInput');
  if (inputEl) inputEl.value = time;
  document.querySelectorAll('.shift-corr-btn').forEach(b => {
    if (b.getAttribute('data-shift') === time) {
      b.classList.remove('border-gray-200', 'bg-white', 'text-gray-800');
      b.classList.add('border-[#8B5A2B]', 'bg-[#5E391C]', 'text-white');
    } else {
      b.classList.remove('border-[#8B5A2B]', 'bg-[#5E391C]', 'text-white');
      b.classList.add('border-gray-200', 'bg-white', 'text-gray-800');
    }
  });
};

function openShiftCorrectionModal() {
  const reasonEl = document.getElementById('shiftCorrectionReasonInput');
  if (reasonEl) reasonEl.value = 'Salah pilih jam shift saat check-in.';
  const inputEl = document.getElementById('shiftCorrectionValInput');
  if (inputEl) inputEl.value = '';
  document.querySelectorAll('.shift-corr-btn').forEach(b => {
    b.classList.remove('border-[#8B5A2B]', 'bg-[#5E391C]', 'text-white');
    b.classList.add('border-gray-200', 'bg-white', 'text-gray-800');
  });
  const modal = document.getElementById('shiftCorrectionModal');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeShiftCorrectionModal() {
  const modal = document.getElementById('shiftCorrectionModal');
  if (modal) modal.classList.add('hidden');
}

async function handleSubmitShiftCorrection(e) {
  e.preventDefault();
  const inputEl = document.getElementById('shiftCorrectionValInput');
  const selectedShift = inputEl ? inputEl.value : '';
  if (!selectedShift) {
    showToast('Pilih jam shift masuk yang benar terlebih dahulu!', 'error');
    return;
  }

  const reason = document.getElementById('shiftCorrectionReasonInput').value.trim();
  const btn = document.getElementById('btnSubmitShiftCorrection');
  btn.disabled = true;
  btn.innerHTML = 'Mengirim...';

  try {
    const res = await fetch('/api/attendance/request-shift-correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: currentUser.employee_id,
        pin: currentPin,
        date: getTodayDateStr(),
        new_shift_in: selectedShift,
        reason: reason || 'Salah pilih jam shift masuk'
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeShiftCorrectionModal();
      await checkAttendanceStatus();
    } else {
      showToast(data.message || 'Gagal mengirim koreksi shift.', 'error');
    }
  } catch (err) {
    showToast('Gagal mengirim pengajuan: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Kirim ke Owner</span>';
    if (window.lucide) lucide.createIcons();
  }
}

// ==================== LOGIN & SESI ====================
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
        localStorage.setItem('owner_auth_pin', pin);
        window.location.href = '/owner.html';
        return;
      }

      currentUser = data.user;
      currentPin = pin;

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

function showAttendanceUI() {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('attendanceSection').classList.remove('hidden');
  document.getElementById('userBadgeArea').classList.remove('hidden');

  document.getElementById('crewName').textContent = currentUser.name;
  document.getElementById('crewRole').textContent = currentUser.role || 'Crew';
  document.getElementById('crewIdTag').textContent = `ID: ${currentUser.employee_id}`;

  requestGpsLocation();
  checkAttendanceStatus();

  // Polling otomatis setiap 15 detik (agar persetujuan koreksi dari Owner langsung terupdate)
  if (!statusPollInterval) {
    statusPollInterval = setInterval(checkAttendanceStatus, 15000);
  }
}

function handleLogout() {
  currentUser = null;
  currentPin = '';
  attendanceRecord = null;
  localStorage.removeItem('crew_session');

  if (checkoutLockInterval) {
    clearInterval(checkoutLockInterval);
    checkoutLockInterval = null;
  }
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }

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

// Modal Ganti PIN
function openChangePinModal() {
  document.getElementById('oldPinInput').value = '';
  document.getElementById('newPinInput').value = '';
  document.getElementById('confirmPinInput').value = '';
  document.getElementById('changePinModal').classList.remove('hidden');
}

function closeChangePinModal() {
  document.getElementById('changePinModal').classList.add('hidden');
}

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

  // Modal Peringatan Terlambat
  const btnAckLate = document.getElementById('btnAcknowledgeLate');
  if (btnAckLate) {
    btnAckLate.addEventListener('click', () => {
      if (typeof pendingLateCheckInAction === 'function') {
        const action = pendingLateCheckInAction;
        pendingLateCheckInAction = null;
        action();
      }
    });
  }

  // Modal Pengajuan Koreksi Check-Out
  const btnCloseCorr = document.getElementById('btnCloseCorrectionModal');
  if (btnCloseCorr) btnCloseCorr.addEventListener('click', closeCorrectionModal);

  const btnCancelCorr = document.getElementById('btnCancelCorrection');
  if (btnCancelCorr) btnCancelCorr.addEventListener('click', closeCorrectionModal);

  const formCorrection = document.getElementById('formRequestCorrection');
  if (formCorrection) formCorrection.addEventListener('submit', handleSubmitCorrection);

  // Modal Pengajuan Koreksi Jam Masuk (Shift)
  const btnCloseShiftCorr = document.getElementById('btnCloseShiftCorrectionModal');
  if (btnCloseShiftCorr) btnCloseShiftCorr.addEventListener('click', closeShiftCorrectionModal);

  const btnCancelShiftCorr = document.getElementById('btnCancelShiftCorrection');
  if (btnCancelShiftCorr) btnCancelShiftCorr.addEventListener('click', closeShiftCorrectionModal);

  const formShiftCorr = document.getElementById('formRequestShiftCorrection');
  if (formShiftCorr) formShiftCorr.addEventListener('submit', handleSubmitShiftCorrection);

  // Modal Konfirmasi Check-Out
  const btnCancelCheckOut = document.getElementById('btnCancelCheckOutModal');
  if (btnCancelCheckOut) {
    btnCancelCheckOut.addEventListener('click', () => {
      const modal = document.getElementById('confirmCheckOutModal');
      if (modal) modal.classList.add('hidden');
    });
  }

  const btnConfirmCheckOut = document.getElementById('btnConfirmCheckOutModal');
  if (btnConfirmCheckOut) {
    btnConfirmCheckOut.addEventListener('click', () => {
      executeCheckOut();
    });
  }

  restoreSession();

  if (window.lucide) lucide.createIcons();
});
