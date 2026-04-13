// =====================================================================
// TG-SHI v6.0 — js/flights.js
// Flight log, new flight form, edit/delete, search, duplicate
// =====================================================================

const Flights = (() => {
  let formType = 'PERSONAL';
  let currentFilter = 'ALL';
  let searchQuery = '';

  function fRow(f) {
    const dc = f.r === 'COCO' ? 'c1' : f.r === 'CUCO' ? 'c2' : 'c3';
    const bx = f.t === 'STD' ? '<span class="bx s">STD</span>' : f.t === 'FF' ? '<span class="bx f">FF</span>' : f.t === 'MANTE' ? '<span class="bx m">MANTE</span>' : '<span class="bx p">Personal</span>';
    // Display "Charter" instead of "Shenshi" for SENSHI responsable
    const displayR = f.r === 'SENSHI' ? 'Charter' : f.r;
    const rv = (f.rv || 0) > 0 ? `<span>$${f.rv.toLocaleString()}</span>` : '';
    const pendTag = f.verified === false ? '<span class="pend-badge">⏳</span>' : '';
    let pilotDisplay = f.p || '';
    if (f.pilot_roster_id) {
      const rp = App.getPilot(f.pilot_roster_id);
      if (rp) pilotDisplay = rp.name;
    }
    const editBtn = App.isAdmin() ? `<button class="edit-btn" onclick="Flights.openEdit(${f.id})">editar</button>` : '';
    const dupBtn = App.isAdmin() ? `<button class="dup-btn" onclick="Flights.duplicateFlight(${f.id})">duplicar</button>` : '';
    const tachDisplay = f.hf ? `<div class="tach-sm">TACH ${f.hf.toFixed(1)}</div>` : '';
    return `<div class="fi"><div class="fdot ${dc}"></div><div class="fm"><div class="fr">${f.rt || '—'} ${bx}${pendTag}</div><div class="fme"><span>${displayR}</span>${pilotDisplay ? `<span>🧑‍✈️ ${pilotDisplay}</span>` : ''}${rv}${editBtn}${dupBtn}</div></div><div class="frt"><div class="fh">${f.h.toFixed(1)}<small>hr</small></div><div class="fdt">${f.d.slice(5)}</div>${tachDisplay}</div></div>`;
  }

  function getFilteredFlights() {
    let out = [...DB.flights].reverse();
    if (currentFilter === 'COCO') out = out.filter(f => f.r === 'COCO');
    else if (currentFilter === 'CUCO') out = out.filter(f => f.r === 'CUCO');
    else if (currentFilter === 'SENSHI') out = out.filter(f => f.r === 'SENSHI');
    else if (/^\d{4}$/.test(currentFilter)) out = out.filter(f => f.d.startsWith(currentFilter));
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      out = out.filter(f => (f.rt || '').toUpperCase().includes(q));
    }
    return out;
  }

  function buildVL(fil) {
    if (fil !== undefined) currentFilter = fil;
    const out = getFilteredFlights();
    document.getElementById('vl-list').innerHTML = out.length ? out.slice(0, 100).map(fRow).join('') : '<div class="empty"><div class="big">✈️</div>Sin vuelos</div>';
  }

  function searchVL() {
    searchQuery = (document.getElementById('vl-search').value || '').trim();
    buildVL();
  }

  function filtV(f, el) {
    document.querySelectorAll('#flt-row .fp').forEach(p => p.classList.remove('on'));
    el.classList.add('on');
    currentFilter = f;
    buildVL(f);
  }

  // --- Pilot / Resp / User selects ---
  function buildPilotSelect() {
    const sel = document.getElementById('ff-pilot'); if (!sel) return;
    const rosterPilots = (DB.pilots || []).filter(p => p.active !== false);
    const userPilots = Object.entries(DB.users).filter(([k, v]) => v.role === 'pilot_admin' || v.role === 'pilot')
      .map(([k, v]) => `<option value="${k}">${v.name || k}</option>`);
    let opts = userPilots.join('');
    rosterPilots.forEach(rp => {
      if (!rp.user_id || !DB.users[rp.user_id]) {
        opts += `<option value="ROSTER_${rp.id}">${rp.name}</option>`;
      }
    });
    sel.innerHTML = opts;
  }

  function buildRespSelect() {
    const sel = document.getElementById('ff-resp'); if (!sel) return;
    sel.innerHTML = Object.entries(DB.users).filter(([k, v]) => v.role === 'admin' || v.role === 'owner')
      .map(([k, v]) => `<option value="${k}">${k}</option>`).join('');
  }

  function buildUserOptions() {
    // Flight form user/client select
    const ffU = document.getElementById('ff-u');
    if (ffU) ffU.innerHTML = Object.keys(DB.users).map(k => `<option>${k}</option>`).join('');
    // Fuel form paid-by
    const fuPy = document.getElementById('fu-py');
    if (fuPy) fuPy.innerHTML = Object.keys(DB.users).map(k => `<option>${k}</option>`).join('');
    // Fuel advances
    const adv = document.getElementById('fu-advances');
    if (adv) {
      const owners = Object.entries(DB.users).filter(([k, v]) => v.role === 'admin' || v.role === 'owner');
      adv.innerHTML = `<div class="row2">${owners.map(([k]) => `<div><label class="fl">Anticipo ${k}</label><input type="number" id="fu-adv-${k}" value="0" step="0.01" inputmode="decimal"></div>`).join('')}</div>`;
    }
  }

  function tipo(v, el) {
    formType = v;
    document.querySelectorAll('#form-flight .tc').forEach(c => c.classList.remove('on'));
    el.classList.add('on');
    document.getElementById('rev-sec').style.display = (v === 'STD' || v === 'FF') ? 'block' : 'none';
    updRevH();
  }

  function setDates() {
    const ds = App.todayStr();
    ['ff-d', 'fu-d'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ds; });
    const lt = Math.max(...DB.flights.map(f => f.hf || 0), 0);
    const e = document.getElementById('ff-hi');
    if (e && lt > 0) { e.value = lt.toFixed(1); }
  }

  function calcH() {
    const a = parseFloat(document.getElementById('ff-hi').value), b = parseFloat(document.getElementById('ff-hf').value);
    const div = document.getElementById('hcalc');
    if (!isNaN(a) && !isNaN(b) && b > a) {
      const h = (b - a).toFixed(1);
      div.textContent = `${h}hrs · fact: ${parseFloat(h) < 1 ? '1.0 (roundup)' : h}`;
      div.style.display = 'block';
      updRevH();
    } else div.style.display = 'none';
  }

  function updRevH() {
    const a = parseFloat(document.getElementById('ff-hi').value) || 0, b = parseFloat(document.getElementById('ff-hf').value) || 0;
    const h = Math.max(0, b - a), rate = formType === 'FF' ? 650 : 750;
    const el = document.getElementById('rev-hint');
    if (el && h > 0) el.textContent = `Auto: ${h.toFixed(1)}hr × $${rate} = $${(h * rate).toFixed(2)}`;
  }

  async function saveF() {
    const d = document.getElementById('ff-d').value;
    const hi = parseFloat(document.getElementById('ff-hi').value), hf = parseFloat(document.getElementById('ff-hf').value);
    const rt = document.getElementById('ff-rt').value.toUpperCase().trim();
    if (!d || !rt || isNaN(hi) || isNaN(hf) || hf <= hi) { alert('Completa campos requeridos'); return; }
    const h = parseFloat((hf - hi).toFixed(1));
    const pilot = document.getElementById('ff-pilot').value;
    const resp = document.getElementById('ff-resp').value;
    const u = document.getElementById('ff-u').value;
    const cb = parseFloat(document.getElementById('ff-cb').value) || 0;
    const es = parseFloat(document.getElementById('ff-es').value) || 0;
    const rate = formType === 'FF' ? 650 : formType === 'STD' ? 750 : 0;
    const rv = document.getElementById('ff-rv').value ? parseFloat(document.getElementById('ff-rv').value) : (rate > 0 ? parseFloat((h * rate).toFixed(2)) : 0);
    const mid = (DB.meta.last_flight_id || 0) + 1;
    DB.meta.last_flight_id = mid;
    const needsVerify = !App.isAdmin() && (formType === 'STD' || formType === 'FF');

    let pilotUserId = pilot;
    let pilotRosterId = null;
    if (pilot && pilot.startsWith('ROSTER_')) {
      pilotRosterId = parseInt(pilot.replace('ROSTER_', ''));
      pilotUserId = null;
    }

    DB.flights.push({
      id: mid, d, r: resp, u: u || resp, rt, p: pilotUserId, pilot_roster_id: pilotRosterId,
      hi, hf, h, t: formType, rv, eh: es, no: document.getElementById('ff-no').value,
      plane_id: selPlane, logged_by: App.currentUser(), verified: !needsVerify, verified_by: needsVerify ? null : App.currentUser()
    });
    DB.meta.last_tach = hf;
    if (cb > 0) {
      const fid = (DB.meta.last_fuel_id || 0) + 1; DB.meta.last_fuel_id = fid;
      DB.fuel.push({ id: fid, d, py: resp, m: cb, ac: resp === 'COCO' ? cb : 0, au: resp === 'CUCO' ? cb : 0, as: 0, no: '' });
    }
    const ok = await API.saveData();
    document.getElementById('ok-f').style.display = ok ? 'flex' : 'none';
    document.getElementById('err-f').textContent = ok ? '' : 'Error guardando';
    document.getElementById('err-f').style.display = ok ? 'none' : 'block';
    if (ok) { setTimeout(() => document.getElementById('ok-f').style.display = 'none', 3000); App.buildAll(); }
    document.getElementById('ff-hf').value = '';
    document.getElementById('ff-rt').value = '';
    document.getElementById('ff-cb').value = '';
    document.getElementById('ff-es').value = '0';
    document.getElementById('ff-rv').value = '';
    document.getElementById('ff-no').value = '';
    document.getElementById('hcalc').style.display = 'none';
    document.getElementById('ff-hi').value = hf;
  }

  // --- Duplicate flight ---
  function duplicateFlight(id) {
    if (!App.isAdmin()) return;
    const f = DB.flights.find(x => x.id === id);
    if (!f) return;
    // Navigate to the new flight form
    App.nav('new', 8);
    // Switch to flight tab
    const flightTabBtn = document.querySelector('#new-tabs .sb');
    if (flightTabBtn) Fuel.fTab('flight', flightTabBtn);
    // Pre-fill fields
    setTimeout(() => {
      document.getElementById('ff-d').value = App.todayStr();
      document.getElementById('ff-rt').value = f.rt || '';
      // Set responsable
      const respSel = document.getElementById('ff-resp');
      if (respSel) respSel.value = f.r;
      // Set pilot
      const pilotSel = document.getElementById('ff-pilot');
      if (pilotSel) {
        if (f.pilot_roster_id) pilotSel.value = 'ROSTER_' + f.pilot_roster_id;
        else if (f.p) pilotSel.value = f.p;
      }
      // Set type
      const typeCard = document.querySelector(`#form-flight .tc[data-t="${f.t}"]`);
      if (typeCard) tipo(f.t, typeCard);
      // Clear HRM values but set HRM inicio to last known tach
      const lt = Math.max(...DB.flights.map(fl => fl.hf || 0), 0);
      document.getElementById('ff-hi').value = lt > 0 ? lt.toFixed(1) : '';
      document.getElementById('ff-hf').value = '';
      document.getElementById('hcalc').style.display = 'none';
    }, 100);
  }

  // --- Edit flight ---
  let editId = null;

  function openEdit(id) {
    if (!App.isAdmin()) return;
    const f = DB.flights.find(x => x.id === id); if (!f) return;
    editId = id;
    const tipos = ['PERSONAL', 'STD', 'FF', 'MANTE'];
    const respOpts = Object.keys(DB.users).map(k => `<option ${f.r === k ? 'selected' : ''}>${k}</option>`).join('');
    document.getElementById('edit-modal-title').textContent = 'Editar vuelo #' + id;
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Fecha</label><input type="date" id="ed-d" value="${f.d}"></div>
      <div class="fs"><label class="fl">Ruta</label><input type="text" id="ed-rt" value="${f.rt || ''}" style="text-transform:uppercase"></div>
      <div class="fs"><label class="fl">Responsable</label><select id="ed-r">${respOpts}</select></div>
      <div class="fs"><label class="fl">Tipo</label><select id="ed-t">${tipos.map(t => `<option ${f.t === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="row2"><div><label class="fl">HRM Ini</label><input type="number" id="ed-hi" value="${f.hi}" step="0.1"></div><div><label class="fl">HRM Fin</label><input type="number" id="ed-hf" value="${f.hf}" step="0.1"></div></div>
      <div class="row2"><div><label class="fl">Espera</label><input type="number" id="ed-eh" value="${f.eh || 0}" step="0.5"></div><div><label class="fl">Ingreso $</label><input type="number" id="ed-rv" value="${f.rv || 0}" step="0.01"></div></div>
      <div style="display:flex;gap:8px;margin-top:3px"><button class="btn" onclick="Flights.saveEdit()">Guardar</button><button class="btn" style="background:#8B1A1A" onclick="Flights.deleteFlight(${id})">Eliminar</button></div>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function saveEdit() {
    const f = DB.flights.find(x => x.id === editId); if (!f) return;
    f.d = document.getElementById('ed-d').value;
    f.rt = document.getElementById('ed-rt').value;
    f.r = document.getElementById('ed-r').value;
    f.t = document.getElementById('ed-t').value;
    const hi = parseFloat(document.getElementById('ed-hi').value), hf = parseFloat(document.getElementById('ed-hf').value);
    f.hi = hi; f.hf = hf; f.h = parseFloat((hf - hi).toFixed(1));
    f.eh = parseFloat(document.getElementById('ed-eh').value) || 0;
    f.rv = parseFloat(document.getElementById('ed-rv').value) || 0;
    f.verified = true; f.verified_by = App.currentUser();
    Admin.closeEdit();
    await API.saveData();
    App.buildAll();
  }

  async function deleteFlight(id) {
    if (!confirm('¿Eliminar vuelo?')) return;
    DB.flights = DB.flights.filter(x => x.id !== id);
    Admin.closeEdit();
    await API.saveData();
    App.buildAll();
  }

  return {
    fRow, buildVL, filtV, searchVL,
    buildPilotSelect, buildRespSelect, buildUserOptions,
    tipo, setDates, calcH, updRevH, saveF,
    duplicateFlight,
    openEdit, saveEdit, deleteFlight
  };
})();
