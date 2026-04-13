// =====================================================================
// TG-SHI v6.0 — js/api.js
// Cloudflare Worker communication layer
// =====================================================================

const API = (() => {
  let WORKER_URL = localStorage.getItem('tgshi_worker_url') || '';
  let WORKER_SECRET = localStorage.getItem('tgshi_worker_secret') || '';
  let API_OK = false;
  let SHA = '';

  function getWorkerUrl() { return WORKER_URL; }
  function getWorkerSecret() { return WORKER_SECRET; }
  function isConnected() { return API_OK; }

  function setWorkerConfig(url, secret) {
    WORKER_URL = url;
    WORKER_SECRET = secret;
    localStorage.setItem('tgshi_worker_url', url);
    localStorage.setItem('tgshi_worker_secret', secret);
  }

  function setDot(s) {
    const d = document.getElementById('dot');
    if (!d) return;
    d.className = 'dot' + (s === 'sync' ? ' sync' : s === 'err' ? ' err' : '');
  }

  // Pre-load passwords from server so login works against server data
  async function preloadPasswords() {
    if (!WORKER_URL || !WORKER_SECRET) return;
    try {
      const r = await fetch(WORKER_URL + '/data', {
        headers: { 'Authorization': 'Bearer ' + WORKER_SECRET },
        cache: 'no-store'
      });
      if (!r.ok) return;
      const res = await r.json();
      if (res.data) {
        if (res.data.passwords) DB.passwords = res.data.passwords;
        if (res.data.users) DB.users = { ...DB.users, ...res.data.users };
        SHA = res.sha;
      }
    } catch (e) { console.warn('[preloadPasswords]', e); }
  }

  async function loadData() {
    if (!WORKER_URL || !WORKER_SECRET) {
      setDot('err');
      Admin.showSetupNeeded();
      return;
    }
    try {
      const r = await fetch(WORKER_URL + '/data', {
        headers: { 'Authorization': 'Bearer ' + WORKER_SECRET },
        cache: 'no-store'
      });
      if (!r.ok) {
        if (r.status === 401) { setDot('err'); Admin.showSetupNeeded('Secret incorrecto'); return; }
        throw new Error('HTTP ' + r.status);
      }
      const res = await r.json();
      if (res.data && res.data.flights) {
        Object.assign(DB, res.data);
        // Ensure all required keys exist
        if (!DB.users) DB.users = { CUCO: { role: 'admin', icon: '👨‍✈️', name: 'Eduardo' }, COCO: { role: 'owner', icon: '👩‍✈️', name: 'Coco' }, FERNANDO: { role: 'pilot_admin', icon: '🧑‍✈️', name: 'Fernando' } };
        if (!DB.passwords) DB.passwords = {};
        if (!DB.planes) DB.planes = [{ id: 'TG-SHI', name: 'Senshi', type: 'Cessna 206', active: true }];
        if (!DB.schedule) DB.schedule = [];
        if (!DB.pilots) DB.pilots = [];
        if (!DB.exchange_partners) DB.exchange_partners = [];
        if (!DB.exchange_log) DB.exchange_log = [];
        if (!DB.meta) DB.meta = {};
        SHA = res.sha;
        API_OK = true;
        // Update role from server (source of truth)
        if (DB.users[App.currentUser()]) {
          App.setRole(DB.users[App.currentUser()].role);
        }
      }
      setDot('ok');
      Admin.hideSetupNeeded();
    } catch (e) {
      console.error('[loadData]', e);
      setDot('err');
      if (DB.flights.length === 0) {
        const bars = document.getElementById('d-bars');
        if (bars) bars.innerHTML = `<div class="empty">⚠️ ${e.message}<br><br><button class="btn sm" onclick="API.loadData().then(App.buildAll)">🔄 Reintentar</button></div>`;
      }
    }
  }

  async function saveData() {
    if (!API_OK) { alert('Sin conexión al servidor. Configura en Admin > Worker.'); return false; }
    setDot('sync');
    try {
      const r = await fetch(WORKER_URL + '/data', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + WORKER_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: DB, sha: SHA, user: App.currentUser() })
      });
      const res = await r.json();
      if (!r.ok) {
        if (r.status === 409) {
          alert('Conflicto: alguien más guardó. Recargando…');
          await loadData();
          App.buildAll();
          return false;
        }
        throw new Error(res.error || 'HTTP ' + r.status);
      }
      SHA = res.sha;
      setDot('ok');
      return true;
    } catch (e) {
      console.error('[saveData]', e);
      setDot('err');
      return false;
    }
  }

  async function testWorker() {
    const msg = document.getElementById('cfg-msg');
    if (!WORKER_URL) { msg.textContent = 'Configura URL primero'; return; }
    msg.textContent = 'Probando…';
    try {
      const r = await fetch(WORKER_URL + '/health');
      if (r.ok) { msg.textContent = '✓ Worker respondió OK'; msg.style.color = '#1A6B3A'; }
      else msg.textContent = 'Error: HTTP ' + r.status;
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  }

  async function quickSetup() {
    const url = document.getElementById('setup-url').value.trim().replace(/\/+$/, '');
    const sec = document.getElementById('setup-secret').value.trim();
    const msg = document.getElementById('setup-msg');
    if (!url || !sec) { msg.textContent = 'Completa ambos campos'; return; }
    msg.textContent = 'Verificando…';
    try {
      const r = await fetch(url + '/data', { headers: { 'Authorization': 'Bearer ' + sec }, cache: 'no-store' });
      if (r.status === 401) { msg.textContent = 'Secret incorrecto'; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const res = await r.json();
      setWorkerConfig(url, sec);
      Object.assign(DB, res.data);
      SHA = res.sha;
      API_OK = true;
      if (!DB.users) DB.users = {};
      if (!DB.passwords) DB.passwords = {};
      if (!DB.planes) DB.planes = [];
      if (!DB.schedule) DB.schedule = [];
      if (!DB.pilots) DB.pilots = [];
      if (!DB.exchange_partners) DB.exchange_partners = [];
      if (!DB.exchange_log) DB.exchange_log = [];
      msg.textContent = '✓ Conectado';
      setDot('ok');
      App.buildAll();
      setTimeout(Admin.hideSetupNeeded, 1000);
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  }

  return {
    getWorkerUrl, getWorkerSecret, isConnected,
    setWorkerConfig, setDot,
    preloadPasswords, loadData, saveData,
    testWorker, quickSetup
  };
})();
