@echo off
:: Script internal untuk menjalankan server secara senyap
cd /d "%~dp0"

:: Cek apakah port 3000 sudah berjalan sebelumnya, jika ya matikan dulu agar bersih
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Cari Node runtime
set "NODE_EXEC=node"
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Users\ASUS\AppData\Roaming\Antigravity\bin\agy-node.cmd" (
        set "NODE_EXEC=C:\Users\ASUS\AppData\Roaming\Antigravity\bin\agy-node.cmd"
    ) else if exist "C:\Users\ASUS\AppData\Local\Programs\antigravity\Antigravity.exe" (
        set ELECTRON_RUN_AS_NODE=1
        set "NODE_EXEC=C:\Users\ASUS\AppData\Local\Programs\antigravity\Antigravity.exe"
    )
)

:: Buka browser ke halaman absensi setelah 1.5 detik
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1500; Start-Process 'http://localhost:3000'"

:: Jalankan server
"%NODE_EXEC%" server.js
