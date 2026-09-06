const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLOUDFLARED_PATH = path.join(__dirname, 'cloudflared.exe');
const TUNNEL_FILE = path.join(__dirname, 'tunnel.url');

let tunnelProcess = null;

function startTunnel(port = 3000, onUrlReady) {
  if (!fs.existsSync(CLOUDFLARED_PATH)) {
    console.log('[TUNNEL] cloudflared.exe tidak ditemukan, menggunakan IP lokal.');
    return null;
  }

  console.log('[TUNNEL] Memulai Cloudflare Tunnel gratis untuk akses HP (HTTPS & GPS)...');

  // Bersihkan file lama jika ada
  if (fs.existsSync(TUNNEL_FILE)) {
    try { fs.unlinkSync(TUNNEL_FILE); } catch (e) {}
  }

  tunnelProcess = spawn(CLOUDFLARED_PATH, ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let urlDetected = false;

  function checkOutput(data) {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !urlDetected) {
      urlDetected = true;
      const url = match[0];
      console.log('====================================================');
      console.log('  LINK ONLINE CLOUD SUDAH AKTIF UNTUK HP CREW!');
      console.log('  URL HTTPS:', url);
      console.log('  (Barcode kasir akan otomatis menggunakan link ini)');
      console.log('====================================================');
      try {
        fs.writeFileSync(TUNNEL_FILE, url, 'utf8');
      } catch (e) {}
      if (onUrlReady) onUrlReady(url);
    }
  }

  tunnelProcess.stdout.on('data', checkOutput);
  tunnelProcess.stderr.on('data', checkOutput);

  tunnelProcess.on('close', (code) => {
    console.log(`[TUNNEL] Cloudflare tunnel berhenti (code ${code}).`);
    if (fs.existsSync(TUNNEL_FILE)) {
      try { fs.unlinkSync(TUNNEL_FILE); } catch (e) {}
    }
  });

  return tunnelProcess;
}

function stopTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch (e) {}
  }
}

module.exports = {
  startTunnel,
  stopTunnel
};
