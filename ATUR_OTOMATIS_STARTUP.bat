@echo off
title PENGATURAN OTOMATIS NYALA SAAT WINDOWS HIDUP
color 0B

echo ================================================================
echo    ATUR SISTEM ABSENSI OTOMATIS MENYALA SAAT KOMPUTER HIDUP
echo ================================================================
echo.
echo Pilihan Menu:
echo [1] Aktifkan Otomatis Nyala (Setiap komputer dinyalakan, server langsung jalan)
echo [2] Matikan Otomatis Nyala (Harus dinyalakan manual lewat file VBS)
echo [3] Batal / Keluar
echo.
set /p PILIHAN="Pilih nomor (1/2/3): "

set "STARTUP_SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AbsensiKedaiKopi.lnk"
set "TARGET_FILE=%~dp0JALANKAN_TANPA_CMD.vbs"

if "%PILIHAN%"=="1" (
    echo.
    echo Sedang membuat jalan pintas di folder Startup Windows...
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP_SHORTCUT%'); $s.TargetPath = '%TARGET_FILE%'; $s.WorkingDirectory = '%~dp0'; $s.Save()"
    echo [SUKSES] Sistem absensi sekarang akan otomatis menyala di latar belakang setiap komputer dinyalakan!
    pause
    exit
)

if "%PILIHAN%"=="2" (
    echo.
    if exist "%STARTUP_SHORTCUT%" (
        del /f /q "%STARTUP_SHORTCUT%"
        echo [SUKSES] Pengaturan otomatis nyala berhasil dimatikan.
    ) else (
        echo [INFO] Fitur otomatis nyala memang belum aktif sebelumnya.
    )
    pause
    exit
)

exit
