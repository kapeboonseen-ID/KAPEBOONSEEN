' ====================================================================
' SISTEM ABSENSI KEDAI KOPI BOONSEEN - LAUNCHER LATAR BELAKANG
' Menjalankan server absensi 100% senyap tanpa jendela CMD / Terminal
' ====================================================================

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strAppDir = FSO.GetParentFolderName(WScript.ScriptFullName)
strBatFile = strAppDir & "\core_launcher.bat"

' Jalankan file core_launcher.bat dalam mode tersembunyi (WindowStyle 0 = Hidden)
WshShell.Run Chr(34) & strBatFile & Chr(34), 0, False

' Tampilkan popup notifikasi ramah bagi pengguna
WshShell.Popup "Sistem Absensi Kedai Kopi Boonseen berhasil dijalankan di latar belakang!" & vbCrLf & vbCrLf & "- Browser akan segera terbuka otomatis." & vbCrLf & "- Tidak ada jendela hitam (CMD) yang mengganggu." & vbCrLf & "- Untuk mematikan sistem saat kedai tutup, klik 'HENTIKAN_APLIKASI.bat'.", 5, "Sistem Absensi Aktif (Latar Belakang)", 64
