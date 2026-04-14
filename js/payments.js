// =====================================================================
// TG-SHI v6.0 -- js/payments.js
// Payments ledger & owner statements
// Admin-only: track actual payments between owners and Senshi
// Currency: QTZ and USD tracked separately, with optional exchange rate
// =====================================================================

var Payments = (function() {

  var stmtOwner = 'COCO';
  var stmtYear = new Date().getFullYear().toString();

  // Everything before this month is considered paid in full (clean slate).
  // Charges and payments before this date are ignored.
  var TRACKING_START = '2026-01';

  // --- Ensure DB.payments exists ---
  function ensureData() {
    if (!DB.payments) DB.payments = [];
    if (!DB.meta.last_payment_id) DB.meta.last_payment_id = 0;
  }

  // ========== STATEMENT VIEW ==========

  function buildPaymentsPage() {
    ensureData();
    if (!App.isAdmin()) {
      var el = document.getElementById('pay-content');
      if (el) el.innerHTML = '<div class="empty">Solo administradores pueden ver esta seccion</div>';
      return;
    }

    var years = {};
    DB.payments.forEach(function(p) { years[p.date.slice(0, 4)] = true; });
    DB.flights.forEach(function(f) { years[f.d.slice(0, 4)] = true; });
    DB.fuel.forEach(function(f) { years[f.d.slice(0, 4)] = true; });
    var yr = new Date().getFullYear().toString();
    if (!years[yr]) years[yr] = true;
    var trackingStartYear = TRACKING_START.slice(0, 4);
    var sortedYears = Object.keys(years).filter(function(y) { return y >= trackingStartYear; }).sort().reverse();

    var h = '';

    // Owner selector
    h += '<div class="frow" id="pay-owner-row">';
    ['COCO', 'CUCO', 'SENSHI'].forEach(function(o) {
      var label = o === 'SENSHI' ? 'CHARTER' : o;
      h += '<div class="fp' + (o === stmtOwner ? ' on' : '') + '" onclick="Payments.setOwner(\'' + o + '\',this)">' + label + '</div>';
    });
    h += '</div>';

    // Year selector
    h += '<div class="frow" id="pay-yr-row">';
    sortedYears.forEach(function(y) {
      h += '<div class="fp' + (y === stmtYear ? ' on' : '') + '" onclick="Payments.setYear(\'' + y + '\',this)">' + y + '</div>';
    });
    h += '</div>';

    // Statement
    h += '<div id="pay-stmt"></div>';

    // Recent payments list
    h += '<div class="stitle" style="margin-top:14px">Pagos registrados</div>';
    h += '<div id="pay-list"></div>';

    var el = document.getElementById('pay-content');
    if (el) el.innerHTML = h;

    buildStatement();
    buildPaymentsList();
  }

  function setOwner(o, el) {
    stmtOwner = o;
    document.querySelectorAll('#pay-owner-row .fp').forEach(function(p) { p.classList.remove('on'); });
    el.classList.add('on');
    buildStatement();
    buildPaymentsList();
  }

  function setYear(y, el) {
    stmtYear = y;
    document.querySelectorAll('#pay-yr-row .fp').forEach(function(p) { p.classList.remove('on'); });
    el.classList.add('on');
    buildStatement();
    buildPaymentsList();
  }

  // ========== STATEMENT BUILDER ==========
  // Build a month-by-month running ledger for the selected owner/year.
  // Charges come from billing logic (fuel QTZ, pilot/admin/maint/expenses USD).
  // Payments come from DB.payments.

  function buildStatement() {
    ensureData();
    var owner = stmtOwner;
    var year = stmtYear;
    var container = document.getElementById('pay-stmt');
    if (!container) return;

    console.log('[Payments] buildStatement owner=' + owner + ' year=' + year + ' DB.payments.length=' + DB.payments.length);
    DB.payments.forEach(function(p) {
      console.log('[Payments]   payment #' + p.id + ': ' + p.date + ' from=' + p.from + ' to=' + p.to + ' qtz=' + p.amount_qtz + ' usd=' + p.amount_usd);
    });

    var fQ = function(v) { return 'Q' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fD = function(v) { return '$' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fSQ = function(v) { return v < 0 ? '-' + fQ(v) : fQ(v); };
    var fSD = function(v) { return v < 0 ? '-' + fD(v) : fD(v); };

    // Compute opening balance: sum all charges and payments BEFORE this year
    // but only from TRACKING_START onwards (everything before is considered settled)
    var openQTZ = 0, openUSD = 0;
    var cutoff = year + '-01-01';
    var effectiveStart = TRACKING_START > year + '-01' ? TRACKING_START : year + '-01';

    // Historical charges (from tracking start up to this year)
    if (year + '-01' > TRACKING_START) {
      var allMonths = getChargeMonths(owner, TRACKING_START, year + '-01');
      allMonths.forEach(function(mc) {
        if (mc.month < year + '-01') {
          openQTZ += mc.chargeQTZ;
          openUSD += mc.chargeUSD;
        }
      });
    }

    // Historical payments before this year but from tracking start onwards
    var ownerPayments = DB.payments.filter(function(p) {
      return (p.from === owner || p.to === owner);
    });
    ownerPayments.forEach(function(p) {
      if (p.date < cutoff && p.date >= TRACKING_START + '-01') {
        var sign;
        if (p.from === owner) {
          sign = -1; // owner paid → reduces balance
        } else if (p.from === 'SENSHI' && p.to === owner) {
          sign = -1; // Senshi reimbursed owner → reduces balance
        } else {
          sign = 1;  // another owner paid on their behalf
        }
        openQTZ += sign * (p.amount_qtz || 0);
        openUSD += sign * (p.amount_usd || 0);
      }
    });

    // Build monthly rows for this year
    var months = [];
    for (var m = 1; m <= 12; m++) {
      var mm = year + '-' + App.pad2(m);
      months.push(mm);
    }

    var runQTZ = openQTZ;
    var runUSD = openUSD;

    var h = '<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">Estado de cuenta — '
      + (owner === 'SENSHI' ? 'Charter' : owner) + ' — ' + year + '</div></div><div class="bil-bd">';

    // Opening balance row
    h += '<div class="bil-row" style="background:#F5F6F8;border-radius:6px;margin-bottom:4px">'
      + '<div class="bil-lbl" style="font-weight:700">Saldo inicial ' + year + '</div>'
      + '<div class="bil-val" style="display:flex;gap:10px">'
      + '<span class="' + (runQTZ > 0 ? '' : 'neg') + '">' + fSQ(runQTZ) + '</span>'
      + '<span class="' + (runUSD > 0 ? '' : 'neg') + '">' + fSD(runUSD) + '</span>'
      + '</div></div>';

    var monthCharges = getChargeMonths(owner, year + '-01', year + '-13');
    var chargeMap = {};
    monthCharges.forEach(function(mc) { chargeMap[mc.month] = mc; });

    var curMonth = new Date().getMonth() + 1;
    var curYear = new Date().getFullYear().toString();

    months.forEach(function(mm, idx) {
      var monthNum = idx + 1;
      // Stop after current month if current year
      if (year === curYear && monthNum > curMonth) return;

      var mc = chargeMap[mm] || { chargeQTZ: 0, chargeUSD: 0, details: [] };

      // Payments this month
      var monthPayQTZ = 0, monthPayUSD = 0;
      var monthPayments = [];
      ownerPayments.forEach(function(p) {
        if (p.date.slice(0, 7) === mm) {
          // Any payment where this owner is the payer (from) or the recipient of a
          // reimbursement (to, from Senshi) reduces their balance.
          // Only owner-to-owner transfers where this owner is the recipient increase balance.
          var sign;
          if (p.from === owner) {
            sign = -1; // owner paid → balance decreases
          } else if (p.from === 'SENSHI' && p.to === owner) {
            sign = -1; // Senshi reimbursed owner → balance decreases
          } else {
            sign = 1;  // another owner paid on their behalf → balance increases (rare)
          }
          monthPayQTZ += sign * (p.amount_qtz || 0);
          monthPayUSD += sign * (p.amount_usd || 0);
          monthPayments.push(p);
        }
      });

      // Skip months with zero activity
      if (mc.chargeQTZ === 0 && mc.chargeUSD === 0 && monthPayments.length === 0) return;

      runQTZ += mc.chargeQTZ + monthPayQTZ;
      runUSD += mc.chargeUSD + monthPayUSD;

      console.log('[Payments] ' + mm + ': chargeQ=' + mc.chargeQTZ.toFixed(2) + ' chargeU=' + mc.chargeUSD.toFixed(2) + ' payQ=' + monthPayQTZ.toFixed(2) + ' payU=' + monthPayUSD.toFixed(2) + ' payments=' + monthPayments.length + ' | runQ=' + runQTZ.toFixed(2) + ' runU=' + runUSD.toFixed(2));

      h += '<div style="border-top:1px solid #E2E6EE;margin-top:6px;padding-top:6px">';
      h += '<div class="bil-row"><div class="bil-lbl" style="font-weight:700;font-size:11px">' + MO[monthNum] + ' ' + year + '</div><div class="bil-val" style="font-size:9px;color:#8892A4"></div></div>';

      // Charge details
      mc.details.forEach(function(d) {
        if (d.amt === 0) return;
        var absAmt = Math.abs(d.amt);
        var cur = d.currency === 'QTZ' ? fQ(absAmt) : fD(absAmt);
        if (d.isCredit || d.amt < 0) {
          // Credit line (anticipo, reimbursement, etc)
          h += '<div class="bil-row"><div class="bil-lbl" style="color:#1A6B3A;font-size:10px">- ' + d.label + '</div><div class="bil-val" style="font-size:10px;color:#1A6B3A">(' + cur + ')</div></div>';
        } else {
          // Charge line
          h += '<div class="bil-row"><div class="bil-lbl" style="color:#8892A4;font-size:10px">+ ' + d.label + '</div><div class="bil-val" style="font-size:10px;color:#8B1A1A">' + cur + '</div></div>';
        }
      });

      // Payment details
      monthPayments.forEach(function(p) {
        var dir = (p.from === owner) ? 'Pago' : 'Reembolso';
        var counterpart = (p.from === owner) ? p.to : p.from;
        var parts = [];
        if ((p.amount_qtz || 0) > 0) parts.push(fQ(p.amount_qtz));
        if ((p.amount_usd || 0) > 0) parts.push(fD(p.amount_usd));
        var xr = (p.exchange_rate && p.exchange_rate > 0) ? ' (TC ' + p.exchange_rate + ')' : '';
        h += '<div class="bil-row"><div class="bil-lbl" style="color:#1A6B3A;font-size:10px">- ' + dir + ' ' + (p.from === owner ? 'a' : 'de') + ' ' + counterpart + xr + '</div><div class="bil-val" style="font-size:10px;color:#1A6B3A">' + parts.join(' + ') + '</div></div>';
      });

      // Running balance
      h += '<div class="bil-row" style="background:#F8F9FB;border-radius:4px;margin-top:2px">'
        + '<div class="bil-lbl" style="font-size:10px;font-weight:600">Saldo</div>'
        + '<div class="bil-val" style="display:flex;gap:10px;font-size:10px">'
        + '<span class="' + (runQTZ > 0 ? '' : 'neg') + '">' + fSQ(runQTZ) + '</span>'
        + '<span class="' + (runUSD > 0 ? '' : 'neg') + '">' + fSD(runUSD) + '</span>'
        + '</div></div>';
      h += '</div>';
    });

    // Final balance
    h += '<div class="bil-row" style="border-top:2px solid #1B2A4A;margin-top:8px;padding-top:8px">'
      + '<div class="bil-lbl" style="font-weight:800;font-size:12px">Saldo actual</div>'
      + '<div class="bil-val" style="display:flex;gap:12px;font-size:12px">'
      + '<span class="' + (runQTZ > 0 ? '' : 'neg') + '">' + fSQ(runQTZ) + '</span>'
      + '<span class="' + (runUSD > 0 ? '' : 'neg') + '">' + fSD(runUSD) + '</span>'
      + '</div></div>';

    // Positive = owner owes Senshi, Negative = Senshi owes owner
    h += '<div style="font-size:9px;color:#8892A4;text-align:center;margin-top:6px;padding-bottom:4px">Positivo = debe a Senshi &middot; Negativo = Senshi debe</div>';

    h += '</div></div>';
    container.innerHTML = h;
  }

  // ========== CHARGE CALCULATION ==========
  // Compute charges per month for an owner, using the same logic as billing.js
  // Returns array of { month: 'YYYY-MM', chargeQTZ, chargeUSD, details: [{label, amt, currency}] }

  function getChargeMonths(owner, fromMonth, toMonth) {
    var results = [];

    // Determine month range
    var startParts = fromMonth.split('-');
    var endParts = toMonth.split('-');
    var startY = +startParts[0], startM = +startParts[1];
    var endY = +endParts[0], endM = +endParts[1];

    var y = startY, m = startM;
    while (y < endY || (y === endY && m < endM)) {
      var mm = y + '-' + App.pad2(m);
      var fd = mm + '-01', td = mm + '-31';

      var fls = DB.flights.filter(function(f) { return f.d >= fd && f.d <= td && (f.verified !== false || (f.t !== 'STD' && f.t !== 'FF')); });
      var fus = DB.fuel.filter(function(f) { return f.d >= fd && f.d <= td; });
      var rt = App.getRateFD(fd);

      // Hours
      var hrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
      var sub = { COCO: { n: 0, a: 0 }, CUCO: { n: 0, a: 0 }, SENSHI: { n: 0, a: 0 } };
      var espHrs = { COCO: 0, CUCO: 0, SENSHI: 0 };

      fls.forEach(function(f) {
        var r = f.r; if (hrs[r] === undefined) return;
        hrs[r] += f.h;
        if (f.h > 0 && f.h < 1) { sub[r].n++; sub[r].a += f.h; }
        espHrs[r] += (f.eh || 0);
      });

      var th = hrs.COCO + hrs.CUCO + hrs.SENSHI;

      // Fuel (QTZ)
      var tfuel = 0;
      var antic = { COCO: 0, CUCO: 0, SENSHI: 0 };
      fus.forEach(function(f) {
        tfuel += f.m;
        if (f.ac) antic.COCO += f.ac;
        if (f.au) antic.CUCO += f.au;
        if (f.as) antic.SENSHI += f.as;
      });
      var qph = th > 0 ? tfuel / th : 0;
      var fuelProp = hrs[owner] * qph;
      var fuelAntic = antic[owner] || 0;
      var fuelNet = fuelProp - fuelAntic;

      // Pilotaje (USD)
      var bilH = hrs[owner] - sub[owner].a + sub[owner].n;
      var pilFee = bilH * rt.pilot;
      var espFee = espHrs[owner] * rt.gw;

      // Admin fee — 100% Senshi
      var adminFee = (owner === 'SENSHI') ? rt.admin : 0;

      // Maintenance
      var maintUSD = 0, maintQTZ = 0;
      if (typeof Maintenance !== 'undefined' && Maintenance.billingForPeriod) {
        var md = Maintenance.billingForPeriod(mm, mm);
        if (md && md[owner]) {
          maintUSD = md[owner].USD || 0;
          maintQTZ = md[owner].QTZ || 0;
        }
      }

      // Flight expenses
      var fexpUSD = 0, fexpQTZ = 0;
      if (typeof FlightExpenses !== 'undefined' && FlightExpenses.billingForPeriod) {
        var fxd = FlightExpenses.billingForPeriod(mm, mm);
        if (fxd && fxd[owner]) {
          fexpUSD = fxd[owner].USD || 0;
          fexpQTZ = fxd[owner].QTZ || 0;
        }
      }

      var totalQTZ = fuelNet + maintQTZ + fexpQTZ;
      var totalUSD = pilFee + espFee + adminFee + maintUSD + fexpUSD;

      var details = [];
      // Show fuel as gross charge + anticipo credit separately
      if (fuelProp > 0) details.push({ label: 'Combustible (' + hrs[owner].toFixed(1) + 'hr x Q' + qph.toFixed(0) + '/hr)', amt: fuelProp, currency: 'QTZ' });
      if (fuelAntic > 0) details.push({ label: 'Anticipo combustible pagado', amt: -fuelAntic, currency: 'QTZ', isCredit: true });
      if (pilFee > 0) details.push({ label: 'Pilotaje (' + bilH.toFixed(1) + 'hr)', amt: pilFee, currency: 'USD' });
      if (espFee > 0) details.push({ label: 'Espera (' + espHrs[owner].toFixed(1) + 'hr)', amt: espFee, currency: 'USD' });
      if (adminFee > 0) details.push({ label: 'Admin fee', amt: adminFee, currency: 'USD' });
      if (maintUSD > 0) details.push({ label: 'Mantenimiento', amt: maintUSD, currency: 'USD' });
      if (maintQTZ > 0) details.push({ label: 'Mantenimiento', amt: maintQTZ, currency: 'QTZ' });
      if (fexpUSD > 0) details.push({ label: 'Gastos vuelo', amt: fexpUSD, currency: 'USD' });
      if (fexpQTZ > 0) details.push({ label: 'Gastos vuelo', amt: fexpQTZ, currency: 'QTZ' });

      results.push({
        month: mm,
        chargeQTZ: totalQTZ,
        chargeUSD: totalUSD,
        details: details
      });

      // Next month
      m++;
      if (m > 12) { m = 1; y++; }
    }

    return results;
  }

  // ========== PAYMENTS LIST ==========

  function buildPaymentsList() {
    ensureData();
    var owner = stmtOwner;
    var year = stmtYear;

    var filtered = DB.payments.filter(function(p) {
      return (p.from === owner || p.to === owner) && p.date.startsWith(year);
    });
    filtered.sort(function(a, b) { return b.date.localeCompare(a.date); });

    var container = document.getElementById('pay-list');
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = '<div class="card"><div class="empty"><div class="big">💳</div>Sin pagos registrados para ' + (owner === 'SENSHI' ? 'Charter' : owner) + ' en ' + year + '</div></div>';
      return;
    }

    var fQ = function(v) { return 'Q' + v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fD = function(v) { return '$' + v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

    var h = '<div class="card">';
    filtered.forEach(function(p) {
      var dir = (p.from === owner) ? 'arrow-out' : 'arrow-in';
      var dirIcon = (p.from === owner) ? '↗' : '↙';
      var dirLabel = (p.from === owner) ? (owner === 'SENSHI' ? 'Charter' : owner) + ' → ' + p.to : p.from + ' → ' + (owner === 'SENSHI' ? 'Charter' : owner);
      var amounts = [];
      if ((p.amount_qtz || 0) > 0) amounts.push(fQ(p.amount_qtz));
      if ((p.amount_usd || 0) > 0) amounts.push(fD(p.amount_usd));
      var xr = (p.exchange_rate && p.exchange_rate > 0) ? ' TC ' + p.exchange_rate : '';

      h += '<div class="fue" style="cursor:pointer" onclick="Payments.editPayment(' + p.id + ')">'
        + '<div>'
        + '<div class="fue-l">' + dirIcon + ' ' + amounts.join(' + ') + '</div>'
        + '<div class="fue-s">' + dirLabel + xr + (p.notes ? ' · ' + p.notes : '') + '</div>'
        + '</div>'
        + '<div class="fue-r">'
        + '<div class="fue-d">' + p.date.slice(5) + '</div>'
        + '<div style="font-size:8px;color:#8892A4">' + p.date.slice(0, 4) + '</div>'
        + '</div></div>';
    });
    h += '</div>';
    container.innerHTML = h;
  }

  // ========== PAYMENT CRUD ==========

  function openAddPayment() {
    if (!App.isAdmin()) return;
    ensureData();

    var today = App.todayStr();
    var ownerOpts = '<option value="COCO">COCO</option><option value="CUCO">CUCO</option><option value="SENSHI">Charter (Senshi)</option>';

    document.getElementById('book-modal-title').textContent = 'Registrar pago';
    document.getElementById('book-form').innerHTML =
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="pay-date" value="' + today + '"></div>'
      + '<div class="row2">'
      + '<div class="fs"><label class="fl">De (quien paga)</label><select id="pay-from">' + ownerOpts + '</select></div>'
      + '<div class="fs"><label class="fl">A (quien recibe)</label><select id="pay-to"><option value="SENSHI">Senshi</option><option value="COCO">COCO</option><option value="CUCO">CUCO</option></select></div>'
      + '</div>'
      + '<div class="row2">'
      + '<div class="fs"><label class="fl">Monto QTZ</label><input type="number" id="pay-qtz" placeholder="0.00" step="0.01" inputmode="decimal" value="0"></div>'
      + '<div class="fs"><label class="fl">Monto USD</label><input type="number" id="pay-usd" placeholder="0.00" step="0.01" inputmode="decimal" value="0"></div>'
      + '</div>'
      + '<div class="fs"><label class="fl">Tipo de cambio (si paga QTZ hacia saldo USD)</label><input type="number" id="pay-xr" placeholder="ej. 7.65" step="0.01" inputmode="decimal" value="0"></div>'
      + '<div class="fs"><label class="fl">Notas</label><input type="text" id="pay-notes" placeholder="ej. Pago parcial marzo"></div>'
      + '<button class="btn" onclick="Payments.savePayment()">Guardar pago</button>';
    document.getElementById('book-modal').style.display = 'flex';

    // Pre-select current statement owner
    var fromEl = document.getElementById('pay-from');
    if (fromEl) fromEl.value = stmtOwner;
  }

  async function savePayment() {
    ensureData();
    var date = document.getElementById('pay-date').value;
    var from = document.getElementById('pay-from').value;
    var to = document.getElementById('pay-to').value;
    var qtz = parseFloat(document.getElementById('pay-qtz').value) || 0;
    var usd = parseFloat(document.getElementById('pay-usd').value) || 0;
    var xr = parseFloat(document.getElementById('pay-xr').value) || 0;
    var notes = document.getElementById('pay-notes').value.trim();

    if (!date) { alert('Selecciona fecha'); return; }
    if (from === to) { alert('Origen y destino no pueden ser iguales'); return; }
    if (qtz <= 0 && usd <= 0) { alert('Ingresa al menos un monto'); return; }

    var id = (DB.meta.last_payment_id || 0) + 1;
    DB.meta.last_payment_id = id;

    var payment = {
      id: id,
      date: date,
      from: from,
      to: to,
      amount_qtz: qtz,
      amount_usd: usd,
      exchange_rate: xr,
      notes: notes,
      recorded_by: App.currentUser(),
      recorded_at: new Date().toISOString()
    };

    DB.payments.push(payment);

    var ok = await API.saveData();
    if (ok) {
      document.getElementById('book-modal').style.display = 'none';
      API.showNotifyToast('Pago registrado');
      buildStatement();
      buildPaymentsList();
    } else {
      alert('Error al guardar pago');
      // Roll back
      DB.payments = DB.payments.filter(function(p) { return p.id !== id; });
    }
  }

  function editPayment(id) {
    if (!App.isAdmin()) return;
    ensureData();
    var p = DB.payments.find(function(x) { return x.id === id; });
    if (!p) return;

    var ownerOpts = function(sel) {
      return '<option value="COCO"' + (sel === 'COCO' ? ' selected' : '') + '>COCO</option>'
        + '<option value="CUCO"' + (sel === 'CUCO' ? ' selected' : '') + '>CUCO</option>'
        + '<option value="SENSHI"' + (sel === 'SENSHI' ? ' selected' : '') + '>Charter (Senshi)</option>';
    };

    document.getElementById('edit-modal-title').textContent = 'Editar pago #' + id;
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="ep-date" value="' + p.date + '"></div>'
      + '<div class="row2">'
      + '<div class="fs"><label class="fl">De</label><select id="ep-from">' + ownerOpts(p.from) + '</select></div>'
      + '<div class="fs"><label class="fl">A</label><select id="ep-to">' + ownerOpts(p.to) + '</select></div>'
      + '</div>'
      + '<div class="row2">'
      + '<div class="fs"><label class="fl">Monto QTZ</label><input type="number" id="ep-qtz" value="' + (p.amount_qtz || 0) + '" step="0.01" inputmode="decimal"></div>'
      + '<div class="fs"><label class="fl">Monto USD</label><input type="number" id="ep-usd" value="' + (p.amount_usd || 0) + '" step="0.01" inputmode="decimal"></div>'
      + '</div>'
      + '<div class="fs"><label class="fl">Tipo de cambio</label><input type="number" id="ep-xr" value="' + (p.exchange_rate || 0) + '" step="0.01" inputmode="decimal"></div>'
      + '<div class="fs"><label class="fl">Notas</label><input type="text" id="ep-notes" value="' + (p.notes || '') + '"></div>'
      + '<div style="font-size:9px;color:#8892A4;margin-bottom:10px">Registrado por ' + (p.recorded_by || '?') + ' el ' + (p.recorded_at ? p.recorded_at.slice(0, 10) : '?') + '</div>'
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn" onclick="Payments.updatePayment(' + id + ')">Guardar</button>'
      + '<button class="btn" style="background:#8B1A1A" onclick="Payments.deletePayment(' + id + ')">Eliminar</button>'
      + '</div>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function updatePayment(id) {
    ensureData();
    var p = DB.payments.find(function(x) { return x.id === id; });
    if (!p) return;

    var from = document.getElementById('ep-from').value;
    var to = document.getElementById('ep-to').value;
    if (from === to) { alert('Origen y destino no pueden ser iguales'); return; }

    p.date = document.getElementById('ep-date').value;
    p.from = from;
    p.to = to;
    p.amount_qtz = parseFloat(document.getElementById('ep-qtz').value) || 0;
    p.amount_usd = parseFloat(document.getElementById('ep-usd').value) || 0;
    p.exchange_rate = parseFloat(document.getElementById('ep-xr').value) || 0;
    p.notes = document.getElementById('ep-notes').value.trim();

    Admin.closeEdit();
    var ok = await API.saveData();
    if (ok) {
      API.showNotifyToast('Pago actualizado');
      buildStatement();
      buildPaymentsList();
    }
  }

  async function deletePayment(id) {
    if (!confirm('Eliminar este pago?')) return;
    DB.payments = DB.payments.filter(function(p) { return p.id !== id; });
    Admin.closeEdit();
    var ok = await API.saveData();
    if (ok) {
      API.showNotifyToast('Pago eliminado');
      buildStatement();
      buildPaymentsList();
    }
  }

  // ========== BALANCE SUMMARY (for dashboard widget) ==========

  function getOwnerBalances() {
    ensureData();
    console.log('[Payments] getOwnerBalances: DB.payments.length=' + DB.payments.length);
    var balances = { COCO: { qtz: 0, usd: 0 }, CUCO: { qtz: 0, usd: 0 }, SENSHI: { qtz: 0, usd: 0 } };

    // All charges up to today
    var now = new Date();
    var toMonth = now.getFullYear() + '-' + App.pad2(now.getMonth() + 1);

    ['COCO', 'CUCO', 'SENSHI'].forEach(function(owner) {
      var charges = getChargeMonths(owner, TRACKING_START, (function() {
        // next month after current
        var ny = now.getFullYear(), nm = now.getMonth() + 2;
        if (nm > 12) { nm = 1; ny++; }
        return ny + '-' + App.pad2(nm);
      })());

      charges.forEach(function(mc) {
        balances[owner].qtz += mc.chargeQTZ;
        balances[owner].usd += mc.chargeUSD;
      });
    });

    // All payments — a payment FROM an owner TO Senshi reduces that owner's balance
    // A reimbursement FROM Senshi TO an owner also reduces that owner's balance (credit)
    DB.payments.forEach(function(p) {
      // Determine which owner this payment affects
      // Case 1: Owner pays Senshi (from=owner, to=SENSHI) → owner's balance decreases
      // Case 2: Senshi reimburses owner (from=SENSHI, to=owner) → owner's balance decreases
      // Case 3: Owner-to-owner transfer → from's balance decreases, to's balance increases
      if (p.from !== 'SENSHI' && p.to === 'SENSHI') {
        // Owner paying Senshi — reduces what they owe
        if (balances[p.from]) {
          balances[p.from].qtz -= (p.amount_qtz || 0);
          balances[p.from].usd -= (p.amount_usd || 0);
        }
      } else if (p.from === 'SENSHI' && p.to !== 'SENSHI') {
        // Senshi reimbursing an owner — also reduces what they owe (credit)
        if (balances[p.to]) {
          balances[p.to].qtz -= (p.amount_qtz || 0);
          balances[p.to].usd -= (p.amount_usd || 0);
        }
      } else if (p.from !== 'SENSHI' && p.to !== 'SENSHI') {
        // Owner-to-owner (rare) — from pays on behalf, gets credit; to owes more
        if (balances[p.from]) {
          balances[p.from].qtz -= (p.amount_qtz || 0);
          balances[p.from].usd -= (p.amount_usd || 0);
        }
        if (balances[p.to]) {
          balances[p.to].qtz += (p.amount_qtz || 0);
          balances[p.to].usd += (p.amount_usd || 0);
        }
      }
    });

    return balances;
  }

  // ========== BILLING INTEGRATION ==========
  // Section H in billing report: current balances

  function buildBillingSectionH() {
    if (!App.isAdmin()) return '';
    ensureData();
    if (!DB.payments || DB.payments.length === 0) {
      return '<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">H — Saldos pendientes</div></div><div class="bil-bd">'
        + '<div class="empty" style="padding:12px">Sin pagos registrados. <a href="#" onclick="App.nav(\'pay\',9);return false" style="color:#4A9EE8">Ir a Pagos</a></div>'
        + '</div></div>';
    }

    var balances = getOwnerBalances();
    var fQ = function(v) { return 'Q' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fD = function(v) { return '$' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fSQ = function(v) { return v < 0 ? '-' + fQ(v) : fQ(v); };
    var fSD = function(v) { return v < 0 ? '-' + fD(v) : fD(v); };
    var sg = function(v) { return v < 0 ? 'neg' : ''; };

    var h = '<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">H — Saldos pendientes</div></div><div class="bil-bd">';

    ['COCO', 'CUCO', 'SENSHI'].forEach(function(owner, idx) {
      var label = owner === 'SENSHI' ? 'CHARTER' : owner;
      var b = balances[owner];
      var border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:4px;padding-top:4px' : '';
      h += '<div class="bil-row" style="' + border + '"><div class="bil-lbl" style="font-weight:700;font-size:11px">' + label + '</div><div class="bil-val" style="display:flex;gap:10px">'
        + '<span class="' + sg(b.qtz) + '">' + fSQ(b.qtz) + '</span>'
        + '<span class="' + sg(b.usd) + '">' + fSD(b.usd) + '</span>'
        + '</div></div>';
    });

    h += '<div style="font-size:9px;color:#8892A4;text-align:center;margin-top:6px;padding-bottom:4px">Positivo = debe a Senshi &middot; Negativo = Senshi debe &middot; <a href="#" onclick="App.nav(\'pay\',9);return false" style="color:#4A9EE8">Ver detalle</a></div>';
    h += '</div></div>';

    return h;
  }

  return {
    buildPaymentsPage: buildPaymentsPage,
    setOwner: setOwner,
    setYear: setYear,
    openAddPayment: openAddPayment,
    savePayment: savePayment,
    editPayment: editPayment,
    updatePayment: updatePayment,
    deletePayment: deletePayment,
    getOwnerBalances: getOwnerBalances,
    buildBillingSectionH: buildBillingSectionH
  };
})();
