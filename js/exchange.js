// =====================================================================
// TG-SHI v5.2.2 — js/exchange.js
// Exchange hours tracking — multi-partner, multi-plane, per-owner
//
// Data model:
//   DB.exchange_partners[] = { id, name, planes:['TG-ABC','TG-DEF'], exchange_rate, notes }
//   DB.exchange_log[] = { id, partner_id, date, direction:'given'|'received',
//                         our_plane, their_plane, hours, paid_by, route,
//                         fuel_cost, pilot_cost, notes }
//
// Balance logic (rate 1:1 example):
//   "given"    = partner flew on OUR plane, owner X paid costs → X earns credit
//   "received" = we flew on THEIR plane, owner X benefits     → X spends credit
//   balance = Σ(given * rate) - Σ(received)
//   positive = partner owes US hours on their planes
//   negative = WE owe partner hours on our planes
// =====================================================================

const Exchange = (() => {

  function getPartner(id) { return (DB.exchange_partners || []).find(p => p.id === id); }

  // Migrate old single-plane format → planes[] array
  function migratePartner(p) {
    if (!p.planes) {
      p.planes = p.partner_plane ? [p.partner_plane] : [];
    }
    return p;
  }
  function ensureMigrated() { (DB.exchange_partners || []).forEach(migratePartner); }
  function planesStr(p) { ensureMigrated(); return (p.planes || []).join(', ') || '—'; }

  // --- Balance calculation ---
  // Returns positive = partner owes us, negative = we owe partner
  function calcBalance(entries, owner, rate) {
    let balance = 0;
    entries.filter(e => e.paid_by === owner).forEach(e => {
      if (e.direction === 'given') balance += e.hours * rate;
      else if (e.direction === 'received') balance -= e.hours;
    });
    return Math.round(balance * 100) / 100; // avoid float noise
  }

  function calcGiven(entries, owner) {
    return entries.filter(e => e.direction === 'given' && e.paid_by === owner)
      .reduce((s, e) => s + e.hours, 0);
  }
  function calcReceived(entries, owner) {
    return entries.filter(e => e.direction === 'received' && e.paid_by === owner)
      .reduce((s, e) => s + e.hours, 0);
  }

  // --- Dashboard widget (clear "who owes whom") ---
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

      html += `<div style="padding:6px 0;border-bottom:1px solid #F5F6F8">
        <div style="font-size:12px;font-weight:700;margin-bottom:4px">${p.name} <span style="font-size:9px;font-weight:400;color:#8892A4">${planesStr(p)} · ${p.exchange_rate}:1</span></div>
        <div style="display:flex;gap:12px">
          ${balanceChip('COCO', balCOCO, p.name)}
          ${balanceChip('CUCO', balCUCO, p.name)}
        </div>
      </div>`;
    });

    container.innerHTML = html;
  }

  function balanceChip(owner, bal, partnerName) {
    if (bal === 0) {
      return `<div style="font-size:10px;color:#8892A4"><b>${owner}</b> · A mano</div>`;
    }
    const abs = Math.abs(bal).toFixed(1);
    if (bal > 0) {
      // Partner owes us
      return `<div style="font-size:10px"><b style="color:${owner === 'COCO' ? '#1B4E8A' : '#1A6B3A'}">${owner}</b> <span style="color:#1A6B3A">▲ ${abs}h</span> <span style="color:#8892A4">${partnerName} nos debe</span></div>`;
    } else {
      // We owe partner
      return `<div style="font-size:10px"><b style="color:${owner === 'COCO' ? '#1B4E8A' : '#1A6B3A'}">${owner}</b> <span style="color:#8B1A1A">▼ ${abs}h</span> <span style="color:#8892A4">debemos a ${partnerName}</span></div>`;
    }
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
      partners.forEach(p => {
        const entries = log.filter(e => e.partner_id === p.id);
        const gCO = calcGiven(entries, 'COCO'), gCU = calcGiven(entries, 'CUCO');
        const rCO = calcReceived(entries, 'COCO'), rCU = calcReceived(entries, 'CUCO');
        const balCO = calcBalance(entries, 'COCO', p.exchange_rate);
        const balCU = calcBalance(entries, 'CUCO', p.exchange_rate);
        const totalGiven = gCO + gCU;
        const totalRecv = rCO + rCU;

        balanceHtml += `<div class="card"><div class="ch"><div class="ct">🤝 ${p.name}</div><div style="font-size:9px;color:#8892A4">${planesStr(p)} · Rate ${p.exchange_rate}:1</div></div><div class="cb">
          <div class="stitle" style="margin:0 0 5px">Resumen global</div>
          <div class="qr"><div class="ql">Hrs dadas (${p.name} voló en nuestras aeronaves)</div><div class="qv">${totalGiven.toFixed(1)}</div></div>
          <div class="qr"><div class="ql">Hrs recibidas (nosotros en aeronaves de ${p.name})</div><div class="qv">${totalRecv.toFixed(1)}</div></div>

          <div class="stitle" style="margin:10px 0 5px">Balance COCO</div>
          <div class="qr"><div class="ql">Pagó por ${p.name} en TG-SHI</div><div class="qv">${gCO.toFixed(1)} hrs</div></div>
          <div class="qr"><div class="ql">Usó en aeronaves de ${p.name}</div><div class="qv">${rCO.toFixed(1)} hrs</div></div>
          <div class="qr"><div class="ql"><b>Saldo COCO</b></div><div class="qv ${balCO > 0 ? 'c2' : balCO < 0 ? 'c3' : ''}" style="font-size:13px"><b>${formatBal(balCO, p.name)}</b></div></div>

          <div class="stitle" style="margin:10px 0 5px">Balance CUCO</div>
          <div class="qr"><div class="ql">Pagó por ${p.name} en TG-SHI</div><div class="qv">${gCU.toFixed(1)} hrs</div></div>
          <div class="qr"><div class="ql">Usó en aeronaves de ${p.name}</div><div class="qv">${rCU.toFixed(1)} hrs</div></div>
          <div class="qr"><div class="ql"><b>Saldo CUCO</b></div><div class="qv ${balCU > 0 ? 'c2' : balCU < 0 ? 'c3' : ''}" style="font-size:13px"><b>${formatBal(balCU, p.name)}</b></div></div>
        </div></div>`;
      });
    } else {
      balanceHtml = '<div class="card"><div class="empty"><div class="big">🤝</div>Sin socios de intercambio<br><span style="font-size:10px">Agrégalos en Admin > Socios</span></div></div>';
    }

    document.getElementById('xch-content').innerHTML = filterHtml + balanceHtml +
      '<div class="stitle">Registro de intercambios</div><div class="card" id="xch-log-list"></div>';

    buildXchLog('ALL');
  }

  function formatBal(bal, partnerName) {
    const abs = Math.abs(bal).toFixed(1);
    if (bal === 0) return 'A mano';
    if (bal > 0) return `▲ ${abs}h — ${partnerName} nos debe`;
    return `▼ ${abs}h — le debemos a ${partnerName}`;
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

    container.innerHTML = filtered.slice(0, 60).map(e => {
      const p = getPartner(e.partner_id);
      const pName = p ? p.name : '???';
      const arrow = e.direction === 'given' ? '→' : '←';
      const dirLabel = e.direction === 'given' ? 'Dado' : 'Recibido';
      const dirColor = e.direction === 'given' ? '#B8600A' : '#1A6B3A';
      const ourP = e.our_plane || '—';
      const theirP = e.their_plane || (p ? planesStr(p) : '—');
      const planeInfo = e.direction === 'given' ? `en ${ourP}` : `en ${theirP}`;
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

    onPartnerChange();
    document.getElementById('book-modal').style.display = 'flex';
  }

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
    delete p.partner_plane;
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
