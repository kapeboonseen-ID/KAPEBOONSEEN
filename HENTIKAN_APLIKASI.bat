@echo off
title HENTIKAN SISTEM ABSENSI
color 0C

echo ================================================================
echo             MEMATIKAN SISTEM ABSENSI KEDAI KOPI
echo ================================================================
echo.
echo Sedang menghentikan server absensi di latar belakang...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    set FOUND=1
)

echo.
if "%FOUND%"=="1" (
    echo [SUKSES] Server absensi berhasil dihentikan / dimatikan.
    powershell -NoProfile -Command "[System.Windows.Forms.MessageBox]::Show('Sistem absensi kedai kopi telah berhasil dimatikan.', 'Sistem Absensi Nonaktif', 0, 64)" >nul 2>&1
) else (
    echo [INFO] Tidak ada server absensi yang sedang berjalan di port 3000.
)

echo ================================================================
timeout /t 3 >nul
exit
