@echo off
title SISTEM ABSENSI KEDAI KOPI BOONSEEN
color 0E

echo ================================================================
echo        SELAMAT DATANG DI SISTEM ABSENSI KEDAI KOPI BOONSEEN
echo ================================================================
echo.
echo Sedang menyiapkan dan menyalakan server absensi kedai...
echo Mohon tunggu sebentar...
echo.

:: Pindah ke direktori tempat file bat ini berada
cd /d "%~dp0"

:: Cek keberadaan Node.js runtime
set NODE_EXEC=node
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Users\ASUS\AppData\Roaming\Antigravity\bin\agy-node.cmd" (
        set "NODE_EXEC=C:\Users\ASUS\AppData\Roaming\Antigravity\bin\agy-node.cmd"
    ) else if exist "C:\Users\ASUS\AppData\Local\Programs\antigravity\Antigravity.exe" (
        set ELECTRON_RUN_AS_NODE=1
        set "NODE_EXEC=C:\Users\ASUS\AppData\Local\Programs\antigravity\Antigravity.exe"
    ) else (
        echo [ERROR] Program Node.js / Antigravity tidak ditemukan!
        echo Silakan hubungi admin atau pastikan aplikasi terpasang.
        pause
        exit /b 1
    )
)

:: Buka browser secara otomatis ke halaman absensi setelah 2 detik
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

echo ================================================================
echo  SERVER ABSENSI BERHASIL DINYALAKAN!
echo.
echo  * Halaman Crew (Absensi): http://localhost:3000
echo  * Dashboard Owner       : http://localhost:3000/owner.html
echo  * Cetak Barcode Kedai   : http://localhost:3000/print-qr.html
echo.
echo  PENTING UNTUK PEMILIK KEDAI:
echo  1. Jangan tutup jendela hitam (CMD) ini selama jam operasional kedai.
echo  2. Jika ingin mematikan sistem saat kedai tutup, cukup tutup jendela ini.
echo ================================================================
echo.

:: Jalankan server
"%NODE_EXEC%" server.js

pause
