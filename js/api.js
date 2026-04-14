// =====================================================================
// TG-SHI v6.0 -- js/api.js
// Cloudflare Worker communication layer
// =====================================================================

const API = (() => {
  var DEFAULT_URL = 'https://tgshi-api.senshi-aviation.workers.dev';
  var DEFAULT_SECRET = '2725f096717a5b648fb23bfa42d75eee26bb2dd11ae4fe23d392972330a6e7b1';
  let WORKER_URL = localStorage.getItem('tgshi_worker_url') || DEFAULT_URL;
  let WORKER_SECRET = localStorage.getItem('tgshi_worker_secret') || DEFAULT_SECRET;
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
        if (!DB.maintenance) DB.maintenance = [];
        if (!DB.flight_expenses) DB.flight_expenses = [];
        if (!DB.payments) DB.payments = [];
        if (!DB.misc_charges) DB.misc_charges = [];
        if (!DB.rates || DB.rates.length === 0) DB.rates = [
          { d: '2023-03-01', pilot: 110, gw: 15, std: 750, ff: 650, admin: 300, res: 2 },
          { d: '2026-01-01', pilot: 110, gw: 15, std: 750, ff: 650, admin: 350, res: 2 }
        ];
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
        if (bars) bars.innerHTML = '<div class="empty">Warning: ' + e.message + '<br><br><button class="btn sm" onclick="API.loadData().then(App.buildAll)">Reintentar</button></div>';
      }
    }
  }

  async function saveData() {
    if (!API_OK) { alert('Sin conexion al servidor. Configura en Admin > Worker.'); return false; }
    // Safety: if we previously loaded data with flights, refuse to save an empty flights array
    // This prevents accidental data wipes from stale tabs or race conditions
    if (SHA && (!DB.flights || DB.flights.length === 0)) {
      const proceed = confirm('La base de datos de vuelos esta vacia. Guardar de todos modos? (Cancelar = recargar datos del servidor)');
      if (!proceed) {
        await loadData();
        App.buildAll();
        return false;
      }
    }
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
          alert('Conflicto: alguien mas guardo. Recargando...');
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
    msg.textContent = 'Probando...';
    try {
      const r = await fetch(WORKER_URL + '/health');
      if (r.ok) { msg.textContent = 'Worker respondio OK'; msg.style.color = '#1A6B3A'; }
      else msg.textContent = 'Error: HTTP ' + r.status;
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  }

  async function quickSetup() {
    const url = document.getElementById('setup-url').value.trim().replace(/\/+$/, '');
    const sec = document.getElementById('setup-secret').value.trim();
    const msg = document.getElementById('setup-msg');
    if (!url || !sec) { msg.textContent = 'Completa ambos campos'; return; }
    msg.textContent = 'Verificando...';
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
      if (!DB.maintenance) DB.maintenance = [];
      setDot('ok');
      App.buildAll();
      setTimeout(Admin.hideSetupNeeded, 1000);
    } catch (e) { msg.textContent = 'Error: ' + e.message; }
  }

  // --- Password reset ---
  async function requestPasswordReset(uid, email) {
    if (!WORKER_URL) return { ok: false, error: 'Worker no configurado' };
    try {
      const r = await fetch(WORKER_URL + '/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: uid, email: email })
      });
      const data = await r.json();
      return data;
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async function confirmPasswordReset(token, newPassword) {
    if (!WORKER_URL) return { ok: false, error: 'Worker no configurado' };
    try {
      const r = await fetch(WORKER_URL + '/reset-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, password: newPassword })
      });
      const data = await r.json();
      return data;
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // --- Flight notifications ---
  async function notify(type, scheduleId) {
    if (!WORKER_URL || !WORKER_SECRET) {
      console.warn('[notify] Worker not configured, skipping notification');
      return { ok: false, error: 'Worker not configured' };
    }
    try {
      var r = await fetch(WORKER_URL + '/notify', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + WORKER_SECRET,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ type: type, schedule_id: scheduleId })
      });
      var data = await r.json();
      if (data.ok && data.sent) {
        var emailCount = (data.sent.email || []).length;
        if (emailCount > 0) {
          showNotifyToast('Notificacion enviada (' + emailCount + ' email' + (emailCount > 1 ? 's' : '') + ')');
        }
      }
      return data;
    } catch (e) {
      console.warn('[notify] Error:', e.message);
      return { ok: false, error: e.message };
    }
  }

  function showNotifyToast(msg) {
    var existing = document.getElementById('notify-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'notify-toast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#065F46;color:#fff;padding:10px 20px;border-radius:10px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.15);opacity:0;transition:opacity .3s';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.style.opacity = '1'; }, 10);
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  return {
    getWorkerUrl, getWorkerSecret, isConnected,
    setWorkerConfig, setDot,
    preloadPasswords, loadData, saveData,
    requestPasswordReset, confirmPasswordReset,
    notify, showNotifyToast,
    testWorker, quickSetup
  };
})();
