// =====================================================================
// TG-SHI v5.2.1 — js/exchange.js
// Exchange hours tracking — multi-partner, multi-plane, per-owner balances
//
// Data model:
//   DB.exchange_partners[] = { id, name, planes:['TG-ABC','TG-DEF'], exchange_rate, notes }
//   DB.exchange_log[] = { id, partner_id, date, direction:'given'|'received',
//                         our_plane, their_plane, hours, paid_by, route,
//                         fuel_cost, pilot_cost, notes }
//
// Backward compat: old partners with partner_plane (string) are migrated
// on read to planes[] array. Old log entries without our_plane/their_plane
// still display correctly.
// =====================================================================

const Exchange = (() => {

  function getPartner(id) { return (DB.exchange_partners || []).find(p => p.id === id); }

  // Migrate old single-plane partner format → planes[] array
  function migratePartner(p) {
    if (!p.planes) {
      p.planes = p.partner_plane ? [p.partner_plane] : [];
    }
    return p;
  }
  function ensureMigrated() {
    (DB.exchange_partners || []).forEach(migratePartner);
  }

  // Helper: get display string for partner planes
  function planesStr(p) {
    ensureMigrated();
    return (p.planes || []).join(', ') || '—';
  }

  // --- Dashboard widget ---
  function renderDashboardWidget() {
    const container = document.getElementById('d-xch');
    const card = document.getElementById('d-xch-card');
    if (!container) return;
    ensureMigrated();
    const partners = DB.exchange_partners || [];
    const log = DB.exchange_log || [];
    if (partners.length === 0) {
      container.innerHTML = '';
      if (card) card.style.display = 'none';
      return;
    }
    if (card) card.style.display = 'block';

    let html = '';
    partners.forEach(p => {
      const entries = log.filter(e => e.partner_id === p.id);
      const balCOCO = calcBalance(entries, 'COCO', p.exchange_rate);
      const balCUCO = calcBalance(entries, 'CUCO', p.exchange_rate);

      html += `<div class="qr"><div class="ql">${p.name} <span style="font-size:9px;color:#8892A4">(${planesStr(p)})</span></div><div class="qv" style="font-size:10px">
        <span class="c1" title="COCO">${balCOCO >= 0 ? '+' : ''}${balCOCO.toFixed(1)}h</span> · <span class="c2" title="CUCO">${balCUCO >= 0 ? '+' : ''}${balCUCO.toFixed(1)}h</span>
      </div></div>`;
    });

    container.innerHTML = html;
  }

  // Calculate net balance for an owner with a partner
  // Positive = we have credits ON their planes, negative = we owe them hours on ours
  function calcBalance(entries, owner, rate) {
    let balance = 0;
    entries.filter(e => e.paid_by === owner).forEach(e => {
      if (e.direction === 'given') {
        // They flew on OUR plane → we earn credits on THEIR planes
        balance += e.hours * rate;
      } else if (e.direction === 'received') {
        // We flew on THEIR plane → spend our credits
        balance -= e.hours;
      }
    });
    return balance;
  }

  // --- Exchange page ---
  function buildExchangePage() {
    ensureMigrated();
    const partners = DB.exchange_partners || [];
    const log = DB.exchange_log || [];

    // Partner filter
    let filterHtml = '<div class="frow" id="xch-flt-row"><div class="fp on" onclick="Exchange.filtXch(\'ALL\',this)">Todos</div>';
    partners.forEach(p => {
      filterHtml += `<div class="fp" onclick="Exchange.filtXch(${p.id},this)">${p.name}</div>`;
    });
    filterHtml += '</div>';

    // Balance cards
    let balanceHtml = '';
    if (partners.length > 0) {
      balanceHtml = '<div class="sg" style="grid-template-columns:1fr">';
      partners.forEach(p => {
        const entries = log.filter(e => e.partner_id === p.id);
        const balCOCO = calcBalance(entries, 'COCO', p.exchange_rate);
        const balCUCO = calcBalance(entries, 'CUCO', p.exchange_rate);
        const givenH = entries.filter(e => e.direction === 'given').reduce((s, e) => s + e.hours, 0);
        const recvH = entries.filter(e => e.direction === 'received').reduce((s, e) => s + e.hours, 0);
        balanceHtml += `<div class="card"><div class="ch"><div class="ct">✈ ${p.name} — ${planesStr(p)}</div><div style="font-size:9px;color:#8892A4">Rate ${p.exchange_rate}:1</div></div><div class="cb">
          <div class="qr"><div class="ql">Hrs dadas (en nuestras aeronaves)</div><div class="qv">${givenH.toFixed(1)}</div></div>
          <div class="qr"><div class="ql">Hrs recibidas (en aeronaves de ${p.name})</div><div class="qv">${recvH.toFixed(1)}</div></div>
          <div class="qr"><div class="ql">Balance COCO</div><div class="qv ${balCOCO >= 0 ? 'c2' : 'c3'}">${balCOCO >= 0 ? '+' : ''}${balCOCO.toFixed(1)} hrs crédito</div></div>
          <div class="qr"><div class="ql">Balance CUCO</div><div class="qv ${balCUCO >= 0 ? 'c2' : 'c3'}">${balCUCO >= 0 ? '+' : ''}${balCUCO.toFixed(1)} hrs crédito</div></div>
        </div></div>`;
      });
      balanceHtml += '</div>';
    } else {
      balanceHtml = '<div class="card"><div class="empty"><div class="big">🤝</div>Sin socios de intercambio<br><span style="font-size:10px">Agrégalos en Admin > Socios</span></div></div>';
    }

    document.getElementById('xch-content').innerHTML = filterHtml + balanceHtml +
      '<div class="stitle">Registro de intercambios</div><div class="card" id="xch-log-list"></div>';

    buildXchLog('ALL');
  }

  function buildXchLog(filter) {
    const log = [...(DB.exchange_log || [])].reverse();
    let filtered = log;
    if (filter !== 'ALL') {
      filtered = log.filter(e => e.partner_id === filter);
    }

    const container = document.getElementById('xch-log-list');
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty">Sin registros de intercambio</div>';
      return;
    }

    container.innerHTML = filtered.slice(0, 50).map(e => {
      const p = getPartner(e.partner_id);
      const pName = p ? p.name : '???';
      const arrow = e.direction === 'given' ? '→' : '←';
      const dirLabel = e.direction === 'given' ? 'Dado' : 'Recibido';
      const dirColor = e.direction === 'given' ? '#B8600A' : '#1A6B3A';
      // Show which planes were involved
      const ourP = e.our_plane || '—';
      const theirP = e.their_plane || (p ? (p.partner_plane || planesStr(p)) : '—');
      const planeInfo = e.direction === 'given'
        ? `en ${ourP}`
        : `en ${theirP}`;
      return `<div class="fi">
        <div class="fdot" style="background:${dirColor}"></div>
        <div class="fm">
          <div class="fr">${e.route || '—'} <span style="font-size:9px;font-weight:700;color:${dirColor}">${arrow} ${dirLabel}</span></div>
          <div class="fme"><span>${pName}</span><span>✈ ${planeInfo}</span><span>💳 ${e.paid_by}</span>${e.fuel_cost ? `<span>⛽ Q${e.fuel_cost}</span>` : ''}${e.pilot_cost ? `<span>🧑‍✈️ $${e.pilot_cost}</span>` : ''}${e.notes ? `<span>${e.notes}</span>` : ''}</div>
        </div>
        <div class="frt"><div class="fh">${e.hours.toFixed(1)}<small>hr</small></div><div class="fdt">${e.date.slice(5)}</div></div>
      </div>`;
    }).join('');
  }

  function filtXch(filter, el) {
    document.querySelectorAll('#xch-flt-row .fp').forEach(p => p.classList.remove('on'));
    el.classList.add('on');
    buildXchLog(filter);
  }

  // --- New exchange flight form ---
  function openNewExchange() {
    ensureMigrated();
    const partners = DB.exchange_partners || [];
    if (partners.length === 0) { alert('Primero agrega un socio de intercambio en Admin'); return; }

    document.getElementById('book-modal-title').textContent = 'Registrar intercambio';
    let partnerOpts = partners.map(p => `<option value="${p.id}">${p.name} (${planesStr(p)})</option>`).join('');

    // Our planes
    const ourPlanes = DB.planes.filter(p => p.active !== false);
    const ourPlaneOpts = ourPlanes.map(p => `<option value="${p.id}">${p.id}${p.name ? ' — ' + p.name : ''}</option>`).join('');

    const ownerOpts = Object.entries(DB.users).filter(([k, v]) => v.role === 'admin' || v.role === 'owner')
      .map(([k]) => `<option>${k}</option>`).join('');

    document.getElementById('book-form').innerHTML = `
      <div class="fs"><label class="fl">Socio</label><select id="xf-partner" onchange="Exchange.onPartnerChange()">${partnerOpts}</select></div>
      <div class="fs"><label class="fl">Dirección</label>
        <div class="tg">
          <div class="tc on" data-t="given" onclick="Exchange.xfDir('given',this)"><div class="ti">→</div><div class="tn">Dado</div><div class="td">Ellos volaron en nuestra aeronave</div></div>
          <div class="tc" data-t="received" onclick="Exchange.xfDir('received',this)"><div class="ti">←</div><div class="tn">Recibido</div><div class="td">Nosotros volamos en su aeronave</div></div>
        </div>
      </div>
      <div class="row2">
        <div class="fs"><label class="fl">Nuestra aeronave</label><select id="xf-our-plane">${ourPlaneOpts}</select></div>
        <div class="fs"><label class="fl">Aeronave del socio</label><select id="xf-their-plane"></select></div>
      </div>
      <div class="fs"><label class="fl">Fecha</label><input type="date" id="xf-date" value="${App.todayStr()}"></div>
      <div class="fs"><label class="fl">Horas</label><input type="number" id="xf-hours" step="0.1" inputmode="decimal" placeholder="ej. 1.5"></div>
      <div class="fs"><label class="fl">Pagado por</label><select id="xf-paid">${ownerOpts}</select></div>
      <div class="fs"><label class="fl">Ruta</label><input type="text" id="xf-route" placeholder="AUR-MGPB" oninput="this.value=this.value.toUpperCase()"></div>
      <div class="row2">
        <div><label class="fl">Combustible (QTZ)</label><input type="number" id="xf-fuel" step="0.01" inputmode="decimal" placeholder="0"></div>
        <div><label class="fl">Pilotaje (USD)</label><input type="number" id="xf-pilot" step="0.01" inputmode="decimal" placeholder="0"></div>
      </div>
      <div class="fs"><label class="fl">Notas</label><input type="text" id="xf-notes" placeholder="opcional"></div>
      <button class="btn gr" onclick="Exchange.saveExchange()">Guardar intercambio</button>`;

    // Populate their planes for first partner
    onPartnerChange();

    document.getElementById('book-modal').style.display = 'flex';
  }

  // When partner changes, update their plane dropdown
  function onPartnerChange() {
    const partnerId = parseInt(document.getElementById('xf-partner').value);
    const p = getPartner(partnerId);
    const sel = document.getElementById('xf-their-plane');
    if (!sel) return;
    if (p && p.planes && p.planes.length > 0) {
      sel.innerHTML = p.planes.map(pl => `<option value="${pl}">${pl}</option>`).join('');
    } else {
      sel.innerHTML = '<option value="">—</option>';
    }
  }

  let xfDirection = 'given';
  function xfDir(v, el) {
    xfDirection = v;
    document.querySelectorAll('#book-form .tc').forEach(c => c.classList.remove('on'));
    el.classList.add('on');
  }

  async function saveExchange() {
    const partnerId = parseInt(document.getElementById('xf-partner').value);
    const ourPlane = document.getElementById('xf-our-plane').value;
    const theirPlane = document.getElementById('xf-their-plane').value;
    const date = document.getElementById('xf-date').value;
    const hours = parseFloat(document.getElementById('xf-hours').value);
    const paidBy = document.getElementById('xf-paid').value;
    const route = document.getElementById('xf-route').value.toUpperCase().trim();
    const fuelCost = parseFloat(document.getElementById('xf-fuel').value) || 0;
    const pilotCost = parseFloat(document.getElementById('xf-pilot').value) || 0;
    const notes = document.getElementById('xf-notes').value;

    if (!date || isNaN(hours) || hours <= 0) { alert('Completa fecha y horas'); return; }

    if (!DB.exchange_log) DB.exchange_log = [];
    if (!DB.meta) DB.meta = {};
    const id = (DB.meta.last_xl_id || 0) + 1;
    DB.meta.last_xl_id = id;

    DB.exchange_log.push({
      id, partner_id: partnerId, date, direction: xfDirection,
      our_plane: ourPlane, their_plane: theirPlane,
      hours, paid_by: paidBy, route, fuel_cost: fuelCost, pilot_cost: pilotCost, notes
    });

    Calendar.closeBooking();
    const ok = await API.saveData();
    if (ok) { buildExchangePage(); renderDashboardWidget(); }
    else { alert('Error guardando intercambio'); }
  }

  // --- Partner management (Admin) ---
  function openAddPartner() {
    document.getElementById('edit-modal-title').textContent = 'Agregar socio de intercambio';
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Nombre del socio</label><input type="text" id="xp-name" placeholder="ej. Juan Pérez"></div>
      <div class="fs"><label class="fl">Aeronaves del socio (una por línea)</label>
        <textarea id="xp-planes" placeholder="TG-ABC&#10;TG-DEF" style="text-transform:uppercase;min-height:70px"></textarea>
        <div class="hint">Ingresa cada matrícula en una línea separada</div>
      </div>
      <div class="fs"><label class="fl">Tasa de intercambio (hrs suyas por 1 hr nuestra)</label><input type="number" id="xp-rate" value="1" step="0.1" inputmode="decimal"><div class="hint">1.0 = paridad, 1.5 = 1.5 hrs suyas por cada 1 hr nuestra</div></div>
      <div class="fs"><label class="fl">Notas</label><input type="text" id="xp-notes" placeholder="opcional"></div>
      <button class="btn" onclick="Exchange.addPartner()">Crear socio</button>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  function parsePlanes(text) {
    return text.split('\n').map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
  }

  async function addPartner() {
    const name = document.getElementById('xp-name').value.trim();
    const planes = parsePlanes(document.getElementById('xp-planes').value);
    const rate = parseFloat(document.getElementById('xp-rate').value) || 1;
    const notes = document.getElementById('xp-notes').value.trim();
    if (!name) { alert('Completa el nombre del socio'); return; }
    if (planes.length === 0) { alert('Agrega al menos una aeronave'); return; }
    if (!DB.exchange_partners) DB.exchange_partners = [];
    if (!DB.meta) DB.meta = {};
    const id = (DB.meta.last_xp_id || 0) + 1;
    DB.meta.last_xp_id = id;
    DB.exchange_partners.push({ id, name, planes, exchange_rate: rate, notes });
    Admin.closeEdit();
    const ok = await API.saveData();
    if (ok) { Admin.buildAdminPanel(); alert('✓ Socio ' + name + ' creado'); }
  }

  function editPartner(id) {
    ensureMigrated();
    const p = (DB.exchange_partners || []).find(x => x.id === id); if (!p) return;
    document.getElementById('edit-modal-title').textContent = 'Editar socio';
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Nombre</label><input type="text" id="xpe-name" value="${p.name}"></div>
      <div class="fs"><label class="fl">Aeronaves (una por línea)</label>
        <textarea id="xpe-planes" style="text-transform:uppercase;min-height:70px">${(p.planes || []).join('\n')}</textarea>
        <div class="hint">Ingresa cada matrícula en una línea separada</div>
      </div>
      <div class="fs"><label class="fl">Tasa de intercambio</label><input type="number" id="xpe-rate" value="${p.exchange_rate}" step="0.1" inputmode="decimal"></div>
      <div class="fs"><label class="fl">Notas</label><input type="text" id="xpe-notes" value="${p.notes || ''}"></div>
      <div style="display:flex;gap:8px"><button class="btn" onclick="Exchange.savePartner(${id})">Guardar</button><button class="btn" style="background:#8B1A1A" onclick="Exchange.deletePartner(${id})">Eliminar</button></div>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function savePartner(id) {
    const p = (DB.exchange_partners || []).find(x => x.id === id); if (!p) return;
    p.name = document.getElementById('xpe-name').value.trim();
    p.planes = parsePlanes(document.getElementById('xpe-planes').value);
    p.exchange_rate = parseFloat(document.getElementById('xpe-rate').value) || 1;
    p.notes = document.getElementById('xpe-notes').value.trim();
    delete p.partner_plane; // clean up old format
    Admin.closeEdit(); await API.saveData(); Admin.buildAdminPanel();
  }

  async function deletePartner(id) {
    if (!confirm('¿Eliminar socio? Se mantendrán los registros de intercambio.')) return;
    DB.exchange_partners = (DB.exchange_partners || []).filter(x => x.id !== id);
    Admin.closeEdit(); await API.saveData(); Admin.buildAdminPanel();
  }

  return {
    renderDashboardWidget, buildExchangePage, buildXchLog, filtXch,
    openNewExchange, onPartnerChange, xfDir, saveExchange,
    openAddPartner, addPartner, editPartner, savePartner, deletePartner
  };
})();
