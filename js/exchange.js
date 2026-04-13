// =====================================================================
// TG-SHI v6.0 -- js/exchange.js
// Exchange hours tracking -- multi-partner, multi-plane, per-owner
//
// Data model:
//   DB.exchange_partners[] = { id, name, planes, exchange_rate, notes }
//   DB.exchange_log[] = { id, partner_id, date, direction, our_plane,
//                         their_plane, hours, paid_by, route,
//                         fuel_cost, pilot_cost, notes, linked_flight_id }
// =====================================================================

var Exchange = (function() {

  var xchYearFilter = 'ALL';

  function getPartner(id) { return (DB.exchange_partners || []).find(function(p) { return p.id === id; }); }

  function migratePartner(p) {
    if (!p.planes) { p.planes = p.partner_plane ? [p.partner_plane] : []; }
    return p;
  }
  function ensureMigrated() { (DB.exchange_partners || []).forEach(migratePartner); }
  function planesStr(p) { ensureMigrated(); return (p.planes || []).join(', ') || '--'; }

  function calcBalance(entries, owner, rate) {
    var balance = 0;
    entries.filter(function(e) { return e.paid_by === owner; }).forEach(function(e) {
      if (e.direction === 'given') balance += e.hours * rate;
      else if (e.direction === 'received') balance -= e.hours;
    });
    return Math.round(balance * 100) / 100;
  }

  function calcGiven(entries, owner) {
    return entries.filter(function(e) { return e.direction === 'given' && e.paid_by === owner; })
      .reduce(function(s, e) { return s + e.hours; }, 0);
  }
  function calcReceived(entries, owner) {
    return entries.filter(function(e) { return e.direction === 'received' && e.paid_by === owner; })
      .reduce(function(s, e) { return s + e.hours; }, 0);
  }

  function calcPlaneBreakdown(entries, owner, rate) {
    var planes = {};
    entries.filter(function(e) { return e.paid_by === owner; }).forEach(function(e) {
      var plane = e.direction === 'given' ? (e.our_plane || 'TG-SHI') : (e.their_plane || '???');
      if (!planes[plane]) planes[plane] = 0;
      if (e.direction === 'given') planes[plane] += e.hours * rate;
      else planes[plane] -= e.hours;
    });
    return planes;
  }

  function planeBreakdownStr(entries, owner, rate) {
    var planes = calcPlaneBreakdown(entries, owner, rate);
    var parts = [];
    Object.keys(planes).forEach(function(plane) {
      var bal = planes[plane];
      if (bal === 0) return;
      var abs = Math.abs(bal).toFixed(1);
      parts.push(plane + ': ' + (bal > 0 ? '+' : '-') + abs + 'h');
    });
    return parts.join(', ');
  }

  // --- Dashboard widget ---
  function renderDashboardWidget() {
    var card = document.getElementById('d-xch-card');
    var container = document.getElementById('d-xch');
    if (!card || !container) return;

    var partners = DB.exchange_partners || [];
    var log = DB.exchange_log || [];
    if (partners.length === 0 || log.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    var html = '';
    partners.forEach(function(p) {
      var entries = log.filter(function(e) { return e.partner_id === p.id; });
      if (entries.length === 0) return;
      html += '<div style="margin-bottom:6px"><div style="font-size:11px;font-weight:700;color:#1A1F2E;margin-bottom:2px">' + p.name + '</div>';
      ['COCO', 'CUCO'].forEach(function(owner) {
        var bal = calcBalance(entries, owner, p.exchange_rate);
        html += balanceWidget(bal, owner, p.name);
      });
      html += '</div>';
    });

    container.innerHTML = html || '<div class="empty" style="padding:8px;font-size:10px">Sin intercambios registrados</div>';
  }

  function balanceWidget(bal, owner, partnerName) {
    if (bal === 0) return '';
    var abs = Math.abs(bal).toFixed(1);
    var ownerColor = owner === 'COCO' ? '#1B4E8A' : '#1A6B3A';
    if (bal > 0) {
      return '<div style="font-size:10px"><b style="color:' + ownerColor + '">' + owner + '</b> <span style="color:#1A6B3A">+ ' + abs + 'h</span> <span style="color:#8892A4">' + partnerName + ' nos debe</span></div>';
    } else {
      return '<div style="font-size:10px"><b style="color:' + ownerColor + '">' + owner + '</b> <span style="color:#8B1A1A">- ' + abs + 'h</span> <span style="color:#8892A4">debemos a ' + partnerName + '</span></div>';
    }
  }

  // --- Exchange page ---
  function buildExchangePage() {
    ensureMigrated();
    var partners = DB.exchange_partners || [];
    var log = DB.exchange_log || [];

    var filterHtml = '<div class="frow" id="xch-flt-row"><div class="fp on" onclick="Exchange.filtXch(\'ALL\',this)">Todos</div>';
    partners.forEach(function(p) {
      filterHtml += '<div class="fp" onclick="Exchange.filtXch(' + p.id + ',this)">' + p.name + '</div>';
    });
    filterHtml += '</div>';

    var balanceHtml = '';
    if (partners.length > 0) {
      partners.forEach(function(p) {
        var entries = log.filter(function(e) { return e.partner_id === p.id; });
        var gCO = calcGiven(entries, 'COCO'), gCU = calcGiven(entries, 'CUCO');
        var rCO = calcReceived(entries, 'COCO'), rCU = calcReceived(entries, 'CUCO');
        var balCO = calcBalance(entries, 'COCO', p.exchange_rate);
        var balCU = calcBalance(entries, 'CUCO', p.exchange_rate);
        var breakdownCO = planeBreakdownStr(entries, 'COCO', p.exchange_rate);
        var breakdownCU = planeBreakdownStr(entries, 'CUCO', p.exchange_rate);

        balanceHtml += '<div class="card"><div class="ch"><div class="ct">' + p.name + '</div><div style="font-size:9px;color:#8892A4">' + planesStr(p) + ' | Rate ' + p.exchange_rate + ':1</div></div><div class="cb">' +
          '<div class="stitle" style="margin:0 0 5px">Resumen global</div>' +
          '<div class="qr"><div class="ql">Hrs dadas (' + p.name + ' volo en nuestras aeronaves)</div><div class="qv">' + (gCO + gCU).toFixed(1) + '</div></div>' +
          '<div class="qr"><div class="ql">Hrs recibidas (nosotros en aeronaves de ' + p.name + ')</div><div class="qv">' + (rCO + rCU).toFixed(1) + '</div></div>' +
          '<div class="stitle" style="margin:10px 0 5px">Balance COCO</div>' +
          '<div class="qr"><div class="ql">Pago por ' + p.name + ' en TG-SHI</div><div class="qv">' + gCO.toFixed(1) + ' hrs</div></div>' +
          '<div class="qr"><div class="ql">Uso en aeronaves de ' + p.name + '</div><div class="qv">' + rCO.toFixed(1) + ' hrs</div></div>' +
          '<div class="qr"><div class="ql"><b>Saldo COCO</b></div><div class="qv ' + (balCO > 0 ? 'c2' : balCO < 0 ? 'c3' : '') + '" style="font-size:13px"><b>' + formatBal(balCO, p.name) + '</b></div></div>' +
          (breakdownCO ? '<div style="font-size:9px;color:#8892A4;margin-top:2px;padding-left:2px">Por aeronave: ' + breakdownCO + '</div>' : '') +
          '<div class="stitle" style="margin:10px 0 5px">Balance CUCO</div>' +
          '<div class="qr"><div class="ql">Pago por ' + p.name + ' en TG-SHI</div><div class="qv">' + gCU.toFixed(1) + ' hrs</div></div>' +
          '<div class="qr"><div class="ql">Uso en aeronaves de ' + p.name + '</div><div class="qv">' + rCU.toFixed(1) + ' hrs</div></div>' +
          '<div class="qr"><div class="ql"><b>Saldo CUCO</b></div><div class="qv ' + (balCU > 0 ? 'c2' : balCU < 0 ? 'c3' : '') + '" style="font-size:13px"><b>' + formatBal(balCU, p.name) + '</b></div></div>' +
          (breakdownCU ? '<div style="font-size:9px;color:#8892A4;margin-top:2px;padding-left:2px">Por aeronave: ' + breakdownCU + '</div>' : '') +
        '</div></div>';
      });
    } else {
      balanceHtml = '<div class="card"><div class="empty"><div class="big">Sin socios</div>Agregalos en Admin > Socios</div></div>';
    }

    var yearFilterHtml = '<div class="frow" id="xch-yr-row" style="margin-top:4px">' +
      '<div class="fp' + (xchYearFilter === 'ALL' ? ' on' : '') + '" onclick="Exchange.filtXchYr(\'ALL\',this)">Todos</div>' +
      '<div class="fp' + (xchYearFilter === '2026' ? ' on' : '') + '" onclick="Exchange.filtXchYr(\'2026\',this)">2026</div>' +
      '<div class="fp' + (xchYearFilter === '2025' ? ' on' : '') + '" onclick="Exchange.filtXchYr(\'2025\',this)">2025</div>' +
      '<div class="fp' + (xchYearFilter === '2024' ? ' on' : '') + '" onclick="Exchange.filtXchYr(\'2024\',this)">2024</div>' +
    '</div>';

    document.getElementById('xch-content').innerHTML = filterHtml + balanceHtml +
      '<div class="stitle">Registro de intercambios</div>' + yearFilterHtml + '<div class="card" id="xch-log-list"></div>';

    buildXchLog('ALL');
  }

  function formatBal(bal, partnerName) {
    var abs = Math.abs(bal).toFixed(1);
    if (bal === 0) return 'A mano';
    if (bal > 0) return '+ ' + abs + 'h | ' + partnerName + ' nos debe';
    return '- ' + abs + 'h | le debemos a ' + partnerName;
  }

  function buildXchLog(filter) {
    var log = (DB.exchange_log || []).slice().reverse();
    if (/^\d{4}$/.test(xchYearFilter)) {
      log = log.filter(function(e) { return e.date.startsWith(xchYearFilter); });
    }
    var filtered = log;
    if (filter !== 'ALL') {
      filtered = log.filter(function(e) { return e.partner_id === filter; });
    }

    var container = document.getElementById('xch-log-list');
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty">Sin registros de intercambio</div>';
      return;
    }

    container.innerHTML = filtered.slice(0, 60).map(function(e) {
      var p = getPartner(e.partner_id);
      var pName = p ? p.name : '???';
      var dirLabel = e.direction === 'given' ? 'Dado' : 'Recibido';
      var dirColor = e.direction === 'given' ? '#B8600A' : '#1A6B3A';
      var dirArrow = e.direction === 'given' ? '>' : '<';
      var ourP = e.our_plane || '--';
      var theirP = e.their_plane || (p ? planesStr(p) : '--');
      var planeInfo = e.direction === 'given' ? ('en ' + ourP) : ('en ' + theirP);
      var linkedTag = e.linked_flight_id ? ' <span style="font-size:8px;background:#E8F0FD;color:#1B4E8A;padding:1px 4px;border-radius:3px;font-weight:700">LINK #' + e.linked_flight_id + '</span>' : '';
      var adminBtns = App.isAdmin() ? '<div style="display:flex;gap:3px;margin-top:3px;justify-content:flex-end"><button class="edit-btn" onclick="Exchange.openEditExchange(' + e.id + ')">editar</button><button class="dup-btn" style="color:#8B1A1A;border-color:#8B1A1A" onclick="Exchange.deleteExchange(' + e.id + ')">x</button></div>' : '';
      return '<div class="fi">' +
        '<div class="fdot" style="background:' + dirColor + '"></div>' +
        '<div class="fm">' +
          '<div class="fr">' + (e.route || '--') + ' <span style="font-size:9px;font-weight:700;color:' + dirColor + '">' + dirArrow + ' ' + dirLabel + '</span>' + linkedTag + '</div>' +
          '<div class="fme"><span>' + pName + '</span><span>' + planeInfo + '</span><span>' + e.paid_by + '</span>' + (e.fuel_cost ? '<span>Q' + e.fuel_cost + '</span>' : '') + (e.pilot_cost ? '<span>$' + e.pilot_cost + '</span>' : '') + (e.notes ? '<span>' + e.notes + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="frt"><div class="fh">' + e.hours.toFixed(1) + '<small>hr</small></div><div class="fdt">' + e.date.slice(5) + '</div>' + adminBtns + '</div>' +
      '</div>';
    }).join('');
  }

  function filtXch(filter, el) {
    document.querySelectorAll('#xch-flt-row .fp').forEach(function(p) { p.classList.remove('on'); });
    el.classList.add('on');
    buildXchLog(filter);
  }

  function filtXchYr(yr, el) {
    xchYearFilter = yr;
    document.querySelectorAll('#xch-yr-row .fp').forEach(function(p) { p.classList.remove('on'); });
    el.classList.add('on');
    var activePartnerPill = document.querySelector('#xch-flt-row .fp.on');
    var currentPartnerFilter = 'ALL';
    if (activePartnerPill) {
      var onclick = activePartnerPill.getAttribute('onclick') || '';
      var m = onclick.match(/filtXch\((\d+)/);
      if (m) currentPartnerFilter = parseInt(m[1]);
    }
    buildXchLog(currentPartnerFilter);
  }

  // --- Export ---
  function exportExchangeSummary() {
    ensureMigrated();
    var partners = DB.exchange_partners || [];
    var log = DB.exchange_log || [];
    if (partners.length === 0) { alert('Sin socios de intercambio'); return; }

    var lines = ['TG-SHI Exchange Summary', 'Generated: ' + new Date().toLocaleDateString('es-GT'), ''];
    partners.forEach(function(p) {
      var entries = log.filter(function(e) { return e.partner_id === p.id; });
      lines.push('=== ' + p.name + ' (Rate ' + p.exchange_rate + ':1) ===');
      lines.push('Planes: ' + planesStr(p));
      ['COCO', 'CUCO'].forEach(function(owner) {
        var g = calcGiven(entries, owner);
        var r = calcReceived(entries, owner);
        var b = calcBalance(entries, owner, p.exchange_rate);
        lines.push(owner + ': Given=' + g.toFixed(1) + ' Recv=' + r.toFixed(1) + ' Balance=' + b.toFixed(1));
      });
      lines.push('');
      lines.push('Log:');
      entries.forEach(function(e) {
        lines.push('  ' + e.date + ' ' + e.direction + ' ' + e.hours.toFixed(1) + 'hr ' + (e.route || '') + ' paid:' + e.paid_by + (e.fuel_cost ? ' fuel:Q' + e.fuel_cost : '') + (e.pilot_cost ? ' pilot:$' + e.pilot_cost : ''));
      });
      lines.push('');
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'tgshi-exchange-' + App.todayStr() + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- New exchange with flight linking ---
  var xfDirection = 'given';

  function openNewExchange() {
    ensureMigrated();
    var partners = DB.exchange_partners || [];
    if (partners.length === 0) { alert('Primero agrega un socio de intercambio en Admin'); return; }

    document.getElementById('book-modal-title').textContent = 'Registrar intercambio';
    var partnerOpts = partners.map(function(p) { return '<option value="' + p.id + '">' + p.name + ' (' + planesStr(p) + ')</option>'; }).join('');
    var ourPlanes = DB.planes.filter(function(p) { return p.active !== false; });
    var ourPlaneOpts = ourPlanes.map(function(p) { return '<option value="' + p.id + '">' + p.id + (p.name ? ' - ' + p.name : '') + '</option>'; }).join('');
    var ownerOpts = Object.entries(DB.users).filter(function(arr) { return arr[1].role === 'admin' || arr[1].role === 'owner'; })
      .map(function(arr) { return '<option>' + arr[0] + '</option>'; }).join('');

    // Build flight picker (last 30 flights)
    var recentFlights = DB.flights.slice(-30).reverse();
    var flightOpts = '<option value="">-- Ingreso manual --</option>';
    recentFlights.forEach(function(f) {
      flightOpts += '<option value="' + f.id + '">' + f.d + ' | ' + (f.rt || '--') + ' | ' + f.h.toFixed(1) + 'hr | ' + f.r + '</option>';
    });

    document.getElementById('book-form').innerHTML =
      '<div class="fs"><label class="fl">Socio</label><select id="xf-partner" onchange="Exchange.onPartnerChange()">' + partnerOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Direccion</label>' +
        '<div class="tg">' +
          '<div class="tc on" data-t="given" onclick="Exchange.xfDir(\'given\',this)"><div class="ti">&rarr;</div><div class="tn">Dado</div><div class="td">Ellos volaron en nuestra aeronave</div></div>' +
          '<div class="tc" data-t="received" onclick="Exchange.xfDir(\'received\',this)"><div class="ti">&larr;</div><div class="tn">Recibido</div><div class="td">Nosotros volamos en su aeronave</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="fs" id="xf-link-section"><label class="fl">Vincular a vuelo en TG-SHI</label><select id="xf-link-flight" onchange="Exchange.onFlightLink()">' + flightOpts + '</select><div class="hint">Selecciona un vuelo para auto-llenar fecha, horas, ruta y responsable</div></div>' +
      '<div class="row2">' +
        '<div class="fs"><label class="fl">Nuestra aeronave</label><select id="xf-our-plane">' + ourPlaneOpts + '</select></div>' +
        '<div class="fs"><label class="fl">Aeronave del socio</label><select id="xf-their-plane"></select></div>' +
      '</div>' +
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="xf-date" value="' + App.todayStr() + '"></div>' +
      '<div class="fs"><label class="fl">Horas</label><input type="number" id="xf-hours" step="0.1" inputmode="decimal" placeholder="ej. 1.5"></div>' +
      '<div class="fs"><label class="fl">Pagado por</label><select id="xf-paid">' + ownerOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Ruta</label><input type="text" id="xf-route" placeholder="AUR-MGPB" oninput="this.value=this.value.toUpperCase()"></div>' +
      '<div class="row2">' +
        '<div><label class="fl">Combustible (QTZ)</label><input type="number" id="xf-fuel" step="0.01" inputmode="decimal" placeholder="0"></div>' +
        '<div><label class="fl">Pilotaje (USD)</label><input type="number" id="xf-pilot" step="0.01" inputmode="decimal" placeholder="0"></div>' +
      '</div>' +
      '<div class="fs"><label class="fl">Notas</label><input type="text" id="xf-notes" placeholder="opcional"></div>' +
      '<button class="btn gr" onclick="Exchange.saveExchange()">Guardar intercambio</button>';

    xfDirection = 'given';
    onPartnerChange();
    document.getElementById('book-modal').style.display = 'flex';
  }

  function onFlightLink() {
    var sel = document.getElementById('xf-link-flight');
    if (!sel) return;
    var fid = parseInt(sel.value);
    if (!fid) return;
    var f = DB.flights.find(function(x) { return x.id === fid; });
    if (!f) return;

    var d = document.getElementById('xf-date'); if (d) d.value = f.d;
    var h = document.getElementById('xf-hours'); if (h) h.value = f.h.toFixed(1);
    var r = document.getElementById('xf-route'); if (r) r.value = f.rt || '';
    var op = document.getElementById('xf-our-plane'); if (op && f.plane_id) op.value = f.plane_id;
    var py = document.getElementById('xf-paid'); if (py) py.value = f.r;
    var n = document.getElementById('xf-notes'); if (n) n.value = 'Vuelo #' + f.id + (f.rt ? ' ' + f.rt : '');
  }

  function onPartnerChange() {
    var partnerId = parseInt(document.getElementById('xf-partner').value);
    var p = getPartner(partnerId);
    var sel = document.getElementById('xf-their-plane');
    if (!sel) return;
    if (p && p.planes && p.planes.length > 0) {
      sel.innerHTML = p.planes.map(function(pl) { return '<option value="' + pl + '">' + pl + '</option>'; }).join('');
    } else {
      sel.innerHTML = '<option value="">--</option>';
    }
  }

  function xfDir(v, el) {
    xfDirection = v;
    document.querySelectorAll('#book-form .tc').forEach(function(c) { c.classList.remove('on'); });
    el.classList.add('on');
    var linkSec = document.getElementById('xf-link-section');
    if (linkSec) linkSec.style.display = (v === 'given') ? 'block' : 'none';
  }

  function saveExchange() {
    var partnerId = parseInt(document.getElementById('xf-partner').value);
    var ourPlane = document.getElementById('xf-our-plane').value;
    var theirPlane = document.getElementById('xf-their-plane').value;
    var date = document.getElementById('xf-date').value;
    var hours = parseFloat(document.getElementById('xf-hours').value);
    var paidBy = document.getElementById('xf-paid').value;
    var route = (document.getElementById('xf-route').value || '').toUpperCase().trim();
    var fuelCost = parseFloat(document.getElementById('xf-fuel').value) || 0;
    var pilotCost = parseFloat(document.getElementById('xf-pilot').value) || 0;
    var notes = document.getElementById('xf-notes').value;
    var linkEl = document.getElementById('xf-link-flight');
    var linkedFlightId = linkEl ? (parseInt(linkEl.value) || null) : null;

    if (!date || isNaN(hours) || hours <= 0) { alert('Completa fecha y horas'); return; }

    if (!DB.exchange_log) DB.exchange_log = [];
    if (!DB.meta) DB.meta = {};
    var id = (DB.meta.last_xl_id || 0) + 1;
    DB.meta.last_xl_id = id;

    DB.exchange_log.push({
      id: id, partner_id: partnerId, date: date, direction: xfDirection,
      our_plane: ourPlane, their_plane: theirPlane,
      hours: hours, paid_by: paidBy, route: route,
      fuel_cost: fuelCost, pilot_cost: pilotCost, notes: notes,
      linked_flight_id: linkedFlightId
    });

    Calendar.closeBooking();
    API.saveData().then(function(ok) {
      if (ok) { buildExchangePage(); renderDashboardWidget(); }
      else { alert('Error guardando intercambio'); }
    });
  }

  // --- Edit/Delete exchange log entries ---
  function openEditExchange(id) {
    if (!App.isAdmin()) return;
    ensureMigrated();
    var e = (DB.exchange_log || []).find(function(x) { return x.id === id; });
    if (!e) return;

    var partners = DB.exchange_partners || [];
    var partnerOpts = partners.map(function(p) { return '<option value="' + p.id + '"' + (e.partner_id === p.id ? ' selected' : '') + '>' + p.name + '</option>'; }).join('');
    var ourPlanes = DB.planes.filter(function(p) { return p.active !== false; });
    var ourPlaneOpts = ourPlanes.map(function(p) { return '<option value="' + p.id + '"' + (e.our_plane === p.id ? ' selected' : '') + '>' + p.id + '</option>'; }).join('');
    var ownerOpts = Object.entries(DB.users).filter(function(arr) { return arr[1].role === 'admin' || arr[1].role === 'owner'; })
      .map(function(arr) { return '<option' + (e.paid_by === arr[0] ? ' selected' : '') + '>' + arr[0] + '</option>'; }).join('');

    document.getElementById('edit-modal-title').textContent = 'Editar intercambio #' + id;
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Socio</label><select id="xe-partner">' + partnerOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Direccion</label><select id="xe-dir"><option value="given"' + (e.direction === 'given' ? ' selected' : '') + '>Dado (ellos en nuestra aeronave)</option><option value="received"' + (e.direction === 'received' ? ' selected' : '') + '>Recibido (nosotros en su aeronave)</option></select></div>' +
      '<div class="row2">' +
        '<div class="fs"><label class="fl">Nuestra aeronave</label><select id="xe-our-plane">' + ourPlaneOpts + '</select></div>' +
        '<div class="fs"><label class="fl">Aeronave socio</label><input type="text" id="xe-their-plane" value="' + (e.their_plane || '') + '" style="text-transform:uppercase"></div>' +
      '</div>' +
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="xe-date" value="' + e.date + '"></div>' +
      '<div class="fs"><label class="fl">Horas</label><input type="number" id="xe-hours" step="0.1" inputmode="decimal" value="' + e.hours + '"></div>' +
      '<div class="fs"><label class="fl">Pagado por</label><select id="xe-paid">' + ownerOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Ruta</label><input type="text" id="xe-route" value="' + (e.route || '') + '" oninput="this.value=this.value.toUpperCase()"></div>' +
      '<div class="row2">' +
        '<div><label class="fl">Combustible (QTZ)</label><input type="number" id="xe-fuel" step="0.01" inputmode="decimal" value="' + (e.fuel_cost || 0) + '"></div>' +
        '<div><label class="fl">Pilotaje (USD)</label><input type="number" id="xe-pilot" step="0.01" inputmode="decimal" value="' + (e.pilot_cost || 0) + '"></div>' +
      '</div>' +
      '<div class="fs"><label class="fl">Notas</label><input type="text" id="xe-notes" value="' + (e.notes || '') + '"></div>' +
      '<div style="display:flex;gap:8px"><button class="btn" onclick="Exchange.updateExchange(' + id + ')">Guardar</button><button class="btn" style="background:#8B1A1A" onclick="Exchange.deleteExchange(' + id + ')">Eliminar</button></div>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  function updateExchange(id) {
    var e = (DB.exchange_log || []).find(function(x) { return x.id === id; });
    if (!e) return;
    e.partner_id = parseInt(document.getElementById('xe-partner').value);
    e.direction = document.getElementById('xe-dir').value;
    e.our_plane = document.getElementById('xe-our-plane').value;
    e.their_plane = (document.getElementById('xe-their-plane').value || '').toUpperCase().trim();
    e.date = document.getElementById('xe-date').value;
    e.hours = parseFloat(document.getElementById('xe-hours').value) || 0;
    e.paid_by = document.getElementById('xe-paid').value;
    e.route = (document.getElementById('xe-route').value || '').toUpperCase().trim();
    e.fuel_cost = parseFloat(document.getElementById('xe-fuel').value) || 0;
    e.pilot_cost = parseFloat(document.getElementById('xe-pilot').value) || 0;
    e.notes = document.getElementById('xe-notes').value;
    Admin.closeEdit();
    API.saveData().then(function(ok) {
      if (ok) { buildExchangePage(); renderDashboardWidget(); }
      else { alert('Error guardando'); }
    });
  }

  function deleteExchange(id) {
    if (!confirm('Eliminar este registro de intercambio?')) return;
    DB.exchange_log = (DB.exchange_log || []).filter(function(x) { return x.id !== id; });
    Admin.closeEdit();
    API.saveData().then(function(ok) {
      if (ok) { buildExchangePage(); renderDashboardWidget(); }
      else { alert('Error eliminando'); }
    });
  }

  // --- Partner management ---
  function openAddPartner() {
    document.getElementById('edit-modal-title').textContent = 'Agregar socio de intercambio';
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Nombre del socio</label><input type="text" id="xp-name" placeholder="ej. Juan Perez"></div>' +
      '<div class="fs"><label class="fl">Aeronaves del socio (una por linea)</label><textarea id="xp-planes" placeholder="TG-ABC" style="text-transform:uppercase;min-height:70px"></textarea><div class="hint">Una matricula por linea</div></div>' +
      '<div class="fs"><label class="fl">Tasa de intercambio</label><input type="number" id="xp-rate" value="1" step="0.1" inputmode="decimal"><div class="hint">1.0 = paridad</div></div>' +
      '<div class="fs"><label class="fl">Notas</label><input type="text" id="xp-notes" placeholder="opcional"></div>' +
      '<button class="btn" onclick="Exchange.addPartner()">Crear socio</button>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  function parsePlanes(text) {
    return text.split('\n').map(function(s) { return s.trim().toUpperCase(); }).filter(function(s) { return s.length > 0; });
  }

  function addPartner() {
    var name = document.getElementById('xp-name').value.trim();
    var planes = parsePlanes(document.getElementById('xp-planes').value);
    var rate = parseFloat(document.getElementById('xp-rate').value) || 1;
    var notes = document.getElementById('xp-notes').value.trim();
    if (!name) { alert('Completa el nombre del socio'); return; }
    if (planes.length === 0) { alert('Agrega al menos una aeronave'); return; }
    if (!DB.exchange_partners) DB.exchange_partners = [];
    if (!DB.meta) DB.meta = {};
    var id = (DB.meta.last_xp_id || 0) + 1;
    DB.meta.last_xp_id = id;
    DB.exchange_partners.push({ id: id, name: name, planes: planes, exchange_rate: rate, notes: notes });
    Admin.closeEdit();
    API.saveData().then(function(ok) {
      if (ok) { Admin.buildAdminPanel(); alert('Socio ' + name + ' creado'); }
    });
  }

  function editPartner(id) {
    ensureMigrated();
    var p = (DB.exchange_partners || []).find(function(x) { return x.id === id; }); if (!p) return;
    document.getElementById('edit-modal-title').textContent = 'Editar socio';
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Nombre</label><input type="text" id="xpe-name" value="' + p.name + '"></div>' +
      '<div class="fs"><label class="fl">Aeronaves (una por linea)</label><textarea id="xpe-planes" style="text-transform:uppercase;min-height:70px">' + (p.planes || []).join('\n') + '</textarea></div>' +
      '<div class="fs"><label class="fl">Tasa de intercambio</label><input type="number" id="xpe-rate" value="' + p.exchange_rate + '" step="0.1" inputmode="decimal"></div>' +
      '<div class="fs"><label class="fl">Notas</label><input type="text" id="xpe-notes" value="' + (p.notes || '') + '"></div>' +
      '<div style="display:flex;gap:8px"><button class="btn" onclick="Exchange.savePartner(' + id + ')">Guardar</button><button class="btn" style="background:#8B1A1A" onclick="Exchange.deletePartner(' + id + ')">Eliminar</button></div>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  function savePartner(id) {
    var p = (DB.exchange_partners || []).find(function(x) { return x.id === id; }); if (!p) return;
    p.name = document.getElementById('xpe-name').value.trim();
    p.planes = parsePlanes(document.getElementById('xpe-planes').value);
    p.exchange_rate = parseFloat(document.getElementById('xpe-rate').value) || 1;
    p.notes = document.getElementById('xpe-notes').value.trim();
    delete p.partner_plane;
    Admin.closeEdit();
    API.saveData().then(function() { Admin.buildAdminPanel(); });
  }

  function deletePartner(id) {
    if (!confirm('Eliminar socio?')) return;
    DB.exchange_partners = (DB.exchange_partners || []).filter(function(x) { return x.id !== id; });
    Admin.closeEdit();
    API.saveData().then(function() { Admin.buildAdminPanel(); });
  }

  return {
    renderDashboardWidget: renderDashboardWidget,
    buildExchangePage: buildExchangePage,
    buildXchLog: buildXchLog,
    filtXch: filtXch,
    filtXchYr: filtXchYr,
    exportExchangeSummary: exportExchangeSummary,
    openNewExchange: openNewExchange,
    onPartnerChange: onPartnerChange,
    onFlightLink: onFlightLink,
    xfDir: xfDir,
    saveExchange: saveExchange,
    openEditExchange: openEditExchange,
    updateExchange: updateExchange,
    deleteExchange: deleteExchange,
    openAddPartner: openAddPartner,
    addPartner: addPartner,
    editPartner: editPartner,
    savePartner: savePartner,
    deletePartner: deletePartner
  };
})();
