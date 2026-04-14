// =====================================================================
// TG-SHI v6.0 — js/app.js
// Init, login, navigation, state management, helpers
// =====================================================================

// --- Global DB ---
const DB = {
  users: {
    CUCO: { role: 'admin', icon: '👨‍✈️', name: 'Eduardo Girón' },
    COCO: { role: 'owner', icon: '👩‍✈️', name: 'Coco' },
    FERNANDO: { role: 'pilot_admin', icon: '🧑‍✈️', name: 'Fernando Méndez' }
  },
  passwords: {},
  planes: [{ id: 'TG-SHI', name: 'Senshi', type: 'Cessna 206', active: true }],
  flights: [], fuel: [], schedule: [],
  pilots: [],
  exchange_partners: [],
  exchange_log: [],
  rates: [
    { d: '2023-03-01', pilot: 110, gw: 15, std: 750, ff: 650, admin: 300, res: 2 },
    { d: '2026-01-01', pilot: 110, gw: 15, std: 750, ff: 650, admin: 350, res: 2 }
  ],
  maintenance: [],
  flight_expenses: [],
  payments: [],
  misc_charges: [],
  meta: { last_tach: 0, last_flight_id: 0, last_fuel_id: 0, last_sched_id: 0, last_pilot_id: 0, last_xp_id: 0, last_xl_id: 0, last_maint_id: 0 }
};

// --- Constants ---
const MO = ['', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const DAYS_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

// --- State ---
let selPlane = 'TG-SHI';

const App = (() => {
  let CU = sessionStorage.getItem('tgshi_user') || null;
  let CR = sessionStorage.getItem('tgshi_role') || null;

  // --- Accessors ---
  function currentUser() { return CU; }
  function currentRole() { return CR; }
  function setRole(r) { CR = r; sessionStorage.setItem('tgshi_role', r); }
  function isAdmin() { return CR === 'admin'; }
  function isPilotAdmin() { return CR === 'pilot_admin'; }
  function canManageSchedule() { return isAdmin() || isPilotAdmin(); }

  // --- Helpers ---
  function getUser(id) { return DB.users[id] || { icon: '👤', name: id, role: 'owner' }; }
  function getPlane(id) { return DB.planes.find(p => p.id === id) || DB.planes[0]; }
  function getPilot(id) { return (DB.pilots || []).find(p => p.id === id); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function fmtDate(ds) { const p = ds.split('-'); return `${+p[2]} ${MO[+p[1]]} ${p[0]}`; }
  function getRateFD(ds) {
    let r = DB.rates[0];
    for (const x of DB.rates) if (new Date(x.d) <= new Date(ds)) r = x;
    return r;
  }

  // --- Init ---
  function initApp() {
    if (CU && CR) {
      document.getElementById('login-screen').style.display = 'none';
      showUserBadge();
      document.getElementById('settings-btn').style.display = 'block';
      if (isAdmin() || isPilotAdmin()) document.getElementById('admin-tab').style.display = 'block';
      onReady();
    } else {
      document.getElementById('login-screen').style.display = 'flex';
      API.preloadPasswords();
    }
  }

  async function onReady() {
    API.setDot('sync');
    await API.loadData();
    buildAll();
  }

  function buildAll() {
    Dashboard.render();
    Dashboard.buildPending();
    Calendar.buildSchedPending();
    Flights.setDates();
    Flights.buildPilotSelect();
    Flights.buildRespSelect();
    Calendar.buildPlaneSelectors();
    Flights.buildUserOptions();
    Calendar.buildCalendar();
    Exchange.renderDashboardWidget();
    if (typeof Maintenance !== 'undefined') Maintenance.buildMaintenancePage();
  }

  // --- Login ---
  function doLogin() {
    const uid = document.getElementById('login-uid').value.trim().toUpperCase();
    const pass = document.getElementById('login-pass').value;
    if (!uid || !pass) { document.getElementById('login-err').textContent = 'Ingresa usuario y contraseña'; return; }
    const pw = DB.passwords[uid];
    if (!pw || pass !== pw) {
      document.getElementById('login-err').textContent = 'Usuario o contraseña incorrectos';
      document.getElementById('login-pass').value = '';
      return;
    }
    const u = DB.users[uid];
    if (!u) { document.getElementById('login-err').textContent = 'Usuario no existe'; return; }
    CU = uid;
    CR = u.role;
    sessionStorage.setItem('tgshi_user', CU);
    sessionStorage.setItem('tgshi_role', CR);
    document.getElementById('login-screen').style.display = 'none';
    showUserBadge();
    document.getElementById('settings-btn').style.display = 'block';
    if (isAdmin() || isPilotAdmin()) document.getElementById('admin-tab').style.display = 'block';
    onReady();
  }

  function showUserBadge() {
    const u = getUser(CU);
    const badge = `badge-${CR}`;
    const existing = document.querySelector('.user-badge');
    if (existing) existing.remove();
    document.querySelector('.tach').insertAdjacentHTML('beforebegin',
      `<span class="user-badge ${badge}">${u.icon} ${CU}</span>`);
  }

  function logout() {
    sessionStorage.removeItem('tgshi_user');
    sessionStorage.removeItem('tgshi_role');
    location.reload();
  }

  // --- Forgot password flow ---
  function showForgotPw() {
    document.getElementById('login-card-main').style.display = 'none';
    document.getElementById('login-card-reset').style.display = 'block';
    document.getElementById('reset-err').textContent = '';
  }

  function showLoginCard() {
    document.getElementById('login-card-reset').style.display = 'none';
    document.getElementById('login-card-main').style.display = 'block';
    document.getElementById('login-err').textContent = '';
  }

  async function requestReset() {
    const uid = document.getElementById('reset-uid').value.trim().toUpperCase();
    const email = document.getElementById('reset-email').value.trim().toLowerCase();
    const errEl = document.getElementById('reset-err');
    if (!uid || !email) { errEl.textContent = 'Ingresa usuario y email'; return; }
    errEl.innerHTML = '<span style="color:rgba(255,255,255,.6)">Enviando…</span>';
    try {
      const result = await API.requestPasswordReset(uid, email);
      if (result.ok) {
        errEl.innerHTML = '<span style="color:#4ADE80">✓ Email enviado. Revisa tu bandeja de entrada.</span>';
      } else {
        errEl.textContent = result.error || 'Error al enviar';
      }
    } catch (e) {
      errEl.textContent = 'Error de conexión';
    }
  }

  // --- Navigation ---
  function nav(id, i) {
    document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
    document.querySelectorAll('.bt').forEach(b => b.classList.remove('on'));
    document.getElementById('pg-' + id).classList.add('on');
    document.querySelectorAll('.bt')[i].classList.add('on');
    if (id === 'vl') Flights.buildVL('ALL');
    if (id === 'fuel') Fuel.buildFuel();
    if (id === 'bil') { Billing.initBil(); setTimeout(Billing.calcBil, 100); }
    if (id === 'sched') Calendar.buildCalendar();
    if (id === 'new' && (isAdmin() || isPilotAdmin())) Admin.buildAdminPanel();
    if (id === 'xch') Exchange.buildExchangePage();
    if (id === 'fexp' && typeof FlightExpenses !== 'undefined') FlightExpenses.buildExpensePage();
    if (id === 'pay' && typeof Payments !== 'undefined') {
      const btns = document.getElementById('pay-admin-btns');
      if (btns) btns.style.display = isAdmin() ? 'flex' : 'none';
      Payments.buildPaymentsPage();
    }
    if (id === 'maint' && typeof Maintenance !== 'undefined') {
      const addBtn = document.getElementById('maint-add-btn');
      if (addBtn) addBtn.style.display = isAdmin() ? 'block' : 'none';
      const lbl = document.getElementById('maint-plane-label');
      if (lbl) lbl.textContent = selPlane;
      Maintenance.buildMaintenancePage();
    }
  }

  // --- Settings (password change) ---
  function openSettings() {
    document.getElementById('pw-modal').style.display = 'flex';
    document.getElementById('pw-err').textContent = '';
    document.getElementById('pw-ok').textContent = '';
    const lbl = document.getElementById('pw-user-label');
    if (lbl) lbl.textContent = CU;
  }
  function closeSettings() { document.getElementById('pw-modal').style.display = 'none'; }

  async function changePw() {
    const old = document.getElementById('pw-old').value;
    const np = document.getElementById('pw-new').value;
    const cp = document.getElementById('pw-confirm').value;
    const err = document.getElementById('pw-err'), ok = document.getElementById('pw-ok');
    err.textContent = ''; ok.textContent = '';
    if (old !== DB.passwords[CU]) { err.textContent = 'Contraseña actual incorrecta'; return; }
    if (np.length < 4) { err.textContent = 'Mínimo 4 caracteres'; return; }
    if (np !== cp) { err.textContent = 'No coinciden'; return; }
    DB.passwords[CU] = np;
    const saved = await API.saveData();
    if (saved) { ok.textContent = '✓ Actualizada'; setTimeout(closeSettings, 1500); }
    else { err.textContent = 'Error guardando'; }
  }

  return {
    currentUser, currentRole, setRole,
    isAdmin, isPilotAdmin, canManageSchedule,
    getUser, getPlane, getPilot, pad2, todayStr, fmtDate, getRateFD,
    initApp, onReady, buildAll,
    doLogin, showUserBadge, logout, showForgotPw, showLoginCard, requestReset,
    nav, openSettings, closeSettings, changePw
  };
})();

// Bootstrap
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.initApp);
else App.initApp();

// Click outside modals
document.addEventListener('click', e => {
  if (e.target === document.getElementById('pw-modal')) App.closeSettings();
  if (e.target === document.getElementById('edit-modal')) Admin.closeEdit();
  if (e.target === document.getElementById('book-modal')) Calendar.closeBooking();
});
