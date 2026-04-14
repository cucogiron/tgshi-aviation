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
  // Charges and payments before this date are ignored — billing starts here.
  var TRACKING_START = '2026-01';

  // QuickBooks opening balances as of Dec 31, 2025 (QTZ).
  // Positive = owner owes Senshi, Negative = Senshi owes owner.
  // USD balances start at $0 (pilot fees tracked separately from QB).
  var OPENING_BALANCES = {
    COCO:   { qtz:  7133.71, usd: 0 },
    CUCO:   { qtz: -22129.57, usd: 0 },
    SENSHI: { qtz: 0, usd: 0 }
  };

  // --- Ensure DB collections exist ---
  function ensureData() {
    if (!DB.payments) DB.payments = [];
    if (!DB.misc_charges) DB.misc_charges = [];
    if (!DB.meta.last_payment_id) DB.meta.last_payment_id = 0;
    if (!DB.meta.last_misc_charge_id) DB.meta.last_misc_charge_id = 0;
  }

  // --- Payment sign: how a payment affects an owner's balance ---
  // Returns -1 if payment reduces owner's balance (they paid or got reimbursed)
  // Returns +1 if payment increases owner's balance (rare: another owner paid on their behalf)
  function paymentSign(p, owner) {
    if (p.from === owner) return -1;                          // owner paid
    if (p.from === 'SENSHI' && p.to === owner) return -1;    // Senshi reimbursed owner
    return 1;                                                  // owner-to-owner transfer, recipient
  }

  // ========== STATEMENT VIEW ==========

  function buildPaymentsPage() {
    ensureData();
    if (!App.isAdmin()) {
      var el = document.getElementById('pay-content');
      if (el) el.innerHTML = '<div class="empty">Solo administradores pueden ver esta seccion</div>';
      return;
    }

    try {

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
    } catch(e) {
      console.error('[Payments] buildPaymentsPage error:', e);
      var el2 = document.getElementById('pay-content');
      if (el2) el2.innerHTML = '<div class="empty" style="color:#8B1A1A">Error: ' + e.message + '</div>';
    }
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


    var fQ = function(v) { return 'Q' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fD = function(v) { return '$' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fSQ = function(v) { return v < 0 ? '-' + fQ(v) : fQ(v); };
    var fSD = function(v) { return v < 0 ? '-' + fD(v) : fD(v); };

    // --- Opening balance ---
    // Start from QB opening balances (Dec 31 2025),
    // then accumulate charges + payments from TRACKING_START up to this year.
    var ob = OPENING_BALANCES[owner] || { qtz: 0, usd: 0 };
    var openQTZ = ob.qtz;
    var openUSD = ob.usd;
    var cutoff = year + '-01-01';

    // If viewing a year after TRACKING_START year, accumulate prior year charges + payments
    if (year + '-01' > TRACKING_START) {
      var allMonths = getChargeMonths(owner, TRACKING_START, year + '-01');
      allMonths.forEach(function(mc) {
        openQTZ += mc.chargeQTZ;
        openUSD += mc.chargeUSD;
      });
    }

    // All payments for this owner (used for opening balance + monthly rows)
    var ownerPayments = DB.payments.filter(function(p) {
      return (p.from === owner || p.to === owner);
    });

    // Historical payments before this year but from tracking start onwards
    ownerPayments.forEach(function(p) {
      if (p.date < cutoff && p.date >= TRACKING_START + '-01') {
        var sign = paymentSign(p, owner);
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
    var trackingStartYear = TRACKING_START.slice(0, 4);
    var openLabel = (year === trackingStartYear) ? 'Saldo QB Dic ' + (+trackingStartYear - 1) : 'Saldo inicial ' + year;
    h += '<div class="bil-row" style="background:#F5F6F8;border-radius:6px;margin-bottom:4px">'
      + '<div class="bil-lbl" style="font-weight:700">' + openLabel + '</div>'
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
          var sign = paymentSign(p, owner);
          monthPayQTZ += sign * (p.amount_qtz || 0);
          monthPayUSD += sign * (p.amount_usd || 0);
          monthPayments.push(p);
        }
      });

      // Skip months with zero activity
      if (mc.chargeQTZ === 0 && mc.chargeUSD === 0 && monthPayments.length === 0) return;

      runQTZ += mc.chargeQTZ + monthPayQTZ;
      runUSD += mc.chargeUSD + monthPayUSD;


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
        var dir;
        if (p.type === 'credit') {
          dir = 'Credito';
        } else if (p.from === owner) {
          dir = 'Pago';
        } else {
          dir = 'Reembolso';
        }
        var counterpart = (p.from === owner) ? p.to : p.from;
        var parts = [];
        if ((p.amount_qtz || 0) > 0) parts.push(fQ(p.amount_qtz));
        if ((p.amount_usd || 0) > 0) parts.push(fD(p.amount_usd));
        var xr = (p.exchange_rate && p.exchange_rate > 0) ? ' (TC ' + p.exchange_rate + ')' : '';
        h += '<div class="bil-row"><div class="bil-lbl" style="color:#1A6B3A;font-size:10px">- ' + dir + ' ' + (p.from === owner ? 'a' : 'de') + ' ' + counterpart + xr + (p.notes ? ' · ' + p.notes : '') + '</div><div class="bil-val" style="font-size:10px;color:#1A6B3A">' + parts.join(' + ') + '</div></div>';
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

    // Clamp start to TRACKING_START — pre-2026 is settled
    var effectiveFrom = fromMonth < TRACKING_START ? TRACKING_START : fromMonth;

    // Determine month range
    var startParts = effectiveFrom.split('-');
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
      var fexpCreditUSD = 0, fexpCreditQTZ = 0;
      if (typeof FlightExpenses !== 'undefined' && FlightExpenses.billingForPeriod) {
        var fxd = FlightExpenses.billingForPeriod(mm, mm);
        if (fxd && fxd[owner]) {
          fexpUSD = fxd[owner].USD || 0;
          fexpQTZ = fxd[owner].QTZ || 0;
        }
        // Credit for expenses this owner paid out of pocket for other owners' flights
        if (fxd && fxd.payer_credits && fxd.payer_credits[owner]) {
          fexpCreditUSD = fxd.payer_credits[owner].USD || 0;
          fexpCreditQTZ = fxd.payer_credits[owner].QTZ || 0;
        }
      }

      // Misc charges (otros cargos)
      var miscUSD = 0, miscQTZ = 0;
      var miscDetails = [];
      (DB.misc_charges || []).forEach(function(c) {
        if (c.owner === owner && c.date >= fd && c.date <= td) {
          if (c.currency === 'USD') miscUSD += c.amount;
          else miscQTZ += c.amount;
          miscDetails.push(c);
        }
      });

      var totalQTZ = fuelNet + maintQTZ + fexpQTZ - fexpCreditQTZ + miscQTZ;
      var totalUSD = pilFee + espFee + adminFee + maintUSD + fexpUSD - fexpCreditUSD + miscUSD;

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
      if (fexpCreditQTZ > 0) details.push({ label: 'Credito gasto pagado de bolsillo', amt: -fexpCreditQTZ, currency: 'QTZ', isCredit: true });
      if (fexpCreditUSD > 0) details.push({ label: 'Credito gasto pagado de bolsillo', amt: -fexpCreditUSD, currency: 'USD', isCredit: true });
      miscDetails.forEach(function(c) {
        details.push({ label: c.description || 'Otro cargo', amt: c.amount, currency: c.currency });
      });

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

    // Build unified list of payments + misc charges
    var items = [];

    DB.payments.forEach(function(p) {
      if ((p.from === owner || p.to === owner) && p.date.startsWith(year)) {
        items.push({ kind: 'payment', date: p.date, data: p });
      }
    });

    (DB.misc_charges || []).forEach(function(c) {
      if (c.owner === owner && c.date.startsWith(year)) {
        items.push({ kind: 'charge', date: c.date, data: c });
      }
    });

    items.sort(function(a, b) { return b.date.localeCompare(a.date); });

    var container = document.getElementById('pay-list');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = '<div class="card"><div class="empty"><div class="big">💳</div>Sin movimientos para ' + (owner === 'SENSHI' ? 'Charter' : owner) + ' en ' + year + '</div></div>';
      return;
    }

    var fQ = function(v) { return 'Q' + v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fD = function(v) { return '$' + v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

    var h = '<div class="card">';
    items.forEach(function(item) {
      if (item.kind === 'payment') {
        var p = item.data;
        var dirIcon = (p.from === owner) ? '↗' : '↙';
        var dirLabel = (p.from === owner) ? (owner === 'SENSHI' ? 'Charter' : owner) + ' → ' + p.to : p.from + ' → ' + (owner === 'SENSHI' ? 'Charter' : owner);
        var amounts = [];
        if ((p.amount_qtz || 0) > 0) amounts.push(fQ(p.amount_qtz));
        if ((p.amount_usd || 0) > 0) amounts.push(fD(p.amount_usd));
        var xr = (p.exchange_rate && p.exchange_rate > 0) ? ' TC ' + p.exchange_rate : '';
        var typeBadge = (p.type === 'credit')
          ? '<span style="background:#D1FAE5;color:#065F46;padding:1px 5px;border-radius:4px;font-size:8px;font-weight:700;margin-left:4px">CREDITO</span>'
          : '';

        h += '<div class="fue" style="cursor:pointer" onclick="Payments.editPayment(' + p.id + ')">'
          + '<div>'
          + '<div class="fue-l">' + dirIcon + ' ' + amounts.join(' + ') + typeBadge + '</div>'
          + '<div class="fue-s">' + dirLabel + xr + (p.notes ? ' · ' + p.notes : '') + '</div>'
          + '</div>'
          + '<div class="fue-r">'
          + '<div class="fue-d">' + p.date.slice(5) + '</div>'
          + '<div style="font-size:8px;color:#8892A4">' + p.date.slice(0, 4) + '</div>'
          + '</div></div>';
      } else {
        var c = item.data;
        var amtStr = c.currency === 'USD' ? fD(c.amount) : fQ(c.amount);

        h += '<div class="fue" style="cursor:pointer;border-left:3px solid #8B1A1A" onclick="Payments.editCharge(' + c.id + ')">'
          + '<div>'
          + '<div class="fue-l" style="color:#8B1A1A">+ ' + amtStr + ' <span style="background:#FEE2E2;color:#991B1B;padding:1px 5px;border-radius:4px;font-size:8px;font-weight:700;margin-left:4px">CARGO</span></div>'
          + '<div class="fue-s">' + (c.description || 'Otro cargo') + '</div>'
          + '</div>'
          + '<div class="fue-r">'
          + '<div class="fue-d">' + c.date.slice(5) + '</div>'
          + '<div style="font-size:8px;color:#8892A4">' + c.date.slice(0, 4) + '</div>'
          + '</div></div>';
      }
    });
    h += '</div>';
    container.innerHTML = h;
  }

  // ========== UNIFIED TRANSACTION FORM ==========

  function openTransaction(defaultType) {
    if (!App.isAdmin()) return;
    ensureData();

    var today = App.todayStr();
    var ownerOpts = '<option value="COCO">COCO</option><option value="CUCO">CUCO</option><option value="SENSHI">Charter (Senshi)</option>';

    document.getElementById('book-modal-title').textContent = 'Registrar movimiento';

    var typeChecked = function(t) { return t === (defaultType || 'payment') ? ' checked' : ''; };

    document.getElementById('book-form').innerHTML =
      // Type selector
      '<div class="fs"><label class="fl">Tipo</label>'
      + '<div style="display:flex;gap:6px;margin-top:4px">'
      + '<label style="flex:1;text-align:center;padding:10px 6px;border:2px solid #E2E6EE;border-radius:9px;cursor:pointer;font-size:11px;font-weight:700" id="txn-lbl-payment"><input type="radio" name="txn-type" value="payment" style="display:none"' + typeChecked('payment') + ' onchange="Payments.onTxnTypeChange()"> Pago</label>'
      + '<label style="flex:1;text-align:center;padding:10px 6px;border:2px solid #E2E6EE;border-radius:9px;cursor:pointer;font-size:11px;font-weight:700" id="txn-lbl-credit"><input type="radio" name="txn-type" value="credit" style="display:none"' + typeChecked('credit') + ' onchange="Payments.onTxnTypeChange()"> Credito</label>'
      + '<label style="flex:1;text-align:center;padding:10px 6px;border:2px solid #E2E6EE;border-radius:9px;cursor:pointer;font-size:11px;font-weight:700" id="txn-lbl-charge"><input type="radio" name="txn-type" value="charge" style="display:none"' + typeChecked('charge') + ' onchange="Payments.onTxnTypeChange()"> Cargo</label>'
      + '</div></div>'
      // Date
      + '<div class="fs"><label class="fl">Fecha</label><input type="date" id="txn-date" value="' + today + '"></div>'
      // Owner (for charge) / From-To (for payment/credit)
      + '<div id="txn-party-section">'
      + '<div class="row2" id="txn-fromto">'
      + '<div class="fs"><label class="fl" id="txn-from-lbl">De</label><select id="txn-from"><option value="SENSHI">Senshi</option>' + ownerOpts + '</select></div>'
      + '<div class="fs"><label class="fl" id="txn-to-lbl">A</label><select id="txn-to"><option value="SENSHI">Senshi</option>' + ownerOpts + '</select></div>'
      + '</div>'
      + '<div class="fs" id="txn-owner-row" style="display:none"><label class="fl">Cobrar a</label><select id="txn-owner">' + ownerOpts + '</select></div>'
      + '</div>'
      // Amounts
      + '<div class="row2">'
      + '<div class="fs"><label class="fl">Monto QTZ</label><input type="number" id="txn-qtz" placeholder="0.00" step="0.01" inputmode="decimal" value="0"></div>'
      + '<div class="fs"><label class="fl">Monto USD</label><input type="number" id="txn-usd" placeholder="0.00" step="0.01" inputmode="decimal" value="0"></div>'
      + '</div>'
      // Exchange rate (payment/credit only)
      + '<div class="fs" id="txn-xr-row"><label class="fl">Tipo de cambio (opcional)</label><input type="number" id="txn-xr" placeholder="ej. 7.65" step="0.01" inputmode="decimal" value="0"></div>'
      // Description (charge) / Notes (payment/credit)
      + '<div class="fs"><label class="fl" id="txn-notes-lbl">Notas</label><input type="text" id="txn-notes" placeholder=""></div>'
      // Save
      + '<button class="btn" id="txn-save-btn" onclick="Payments.saveTransaction()">Guardar</button>';

    document.getElementById('book-modal').style.display = 'flex';
    onTxnTypeChange();
  }

  function onTxnTypeChange() {
    var radios = document.querySelectorAll('input[name="txn-type"]');
    var type = 'payment';
    radios.forEach(function(r) { if (r.checked) type = r.value; });

    // Style the selected radio label
    ['payment', 'credit', 'charge'].forEach(function(t) {
      var lbl = document.getElementById('txn-lbl-' + t);
      if (!lbl) return;
      if (t === type) {
        var colors = { payment: '#1B2A4A', credit: '#1A6B3A', charge: '#8B1A1A' };
        lbl.style.borderColor = colors[t];
        lbl.style.background = t === 'payment' ? '#EAF0FD' : t === 'credit' ? '#D1FAE5' : '#FEE2E2';
        lbl.style.color = colors[t];
      } else {
        lbl.style.borderColor = '#E2E6EE';
        lbl.style.background = '#fff';
        lbl.style.color = '#8892A4';
      }
    });

    var fromTo = document.getElementById('txn-fromto');
    var ownerRow = document.getElementById('txn-owner-row');
    var xrRow = document.getElementById('txn-xr-row');
    var fromLbl = document.getElementById('txn-from-lbl');
    var toLbl = document.getElementById('txn-to-lbl');
    var notesLbl = document.getElementById('txn-notes-lbl');
    var notesInput = document.getElementById('txn-notes');
    var saveBtn = document.getElementById('txn-save-btn');
    var fromEl = document.getElementById('txn-from');
    var toEl = document.getElementById('txn-to');
    var ownerEl = document.getElementById('txn-owner');

    if (type === 'charge') {
      fromTo.style.display = 'none';
      ownerRow.style.display = 'block';
      xrRow.style.display = 'none';
      notesLbl.textContent = 'Descripcion';
      notesInput.placeholder = 'ej. 50% tarjeta TG-SHI 2026';
      saveBtn.textContent = 'Guardar cargo';
      saveBtn.className = 'btn';
      saveBtn.style.background = '#8B1A1A';
      if (ownerEl) ownerEl.value = stmtOwner;
    } else if (type === 'credit') {
      fromTo.style.display = 'grid';
      ownerRow.style.display = 'none';
      xrRow.style.display = 'block';
      fromLbl.textContent = 'De (quien otorga)';
      toLbl.textContent = 'A (quien recibe)';
      notesLbl.textContent = 'Notas';
      notesInput.placeholder = 'ej. Reintegro viaticos';
      saveBtn.textContent = 'Guardar credito';
      saveBtn.className = 'btn gr';
      saveBtn.style.background = '';
      if (fromEl) fromEl.value = 'SENSHI';
      if (toEl) toEl.value = stmtOwner;
    } else {
      fromTo.style.display = 'grid';
      ownerRow.style.display = 'none';
      xrRow.style.display = 'block';
      fromLbl.textContent = 'De (quien paga)';
      toLbl.textContent = 'A (quien recibe)';
      notesLbl.textContent = 'Notas';
      notesInput.placeholder = 'ej. Pago parcial marzo';
      saveBtn.textContent = 'Guardar pago';
      saveBtn.className = 'btn';
      saveBtn.style.background = '';
      if (fromEl) fromEl.value = stmtOwner;
      if (toEl) toEl.value = 'SENSHI';
    }
  }

  async function saveTransaction() {
    ensureData();
    var radios = document.querySelectorAll('input[name="txn-type"]');
    var type = 'payment';
    radios.forEach(function(r) { if (r.checked) type = r.value; });

    var date = document.getElementById('txn-date').value;
    if (!date) { alert('Selecciona fecha'); return; }

    if (type === 'charge') {
      // Save as misc charge
      var owner = document.getElementById('txn-owner').value;
      var qtz = parseFloat(document.getElementById('txn-qtz').value) || 0;
      var usd = parseFloat(document.getElementById('txn-usd').value) || 0;
      var desc = document.getElementById('txn-notes').value.trim();
      if (qtz <= 0 && usd <= 0) { alert('Ingresa al menos un monto'); return; }
      if (!desc) { alert('Ingresa descripcion'); return; }

      // Support dual-currency charges as two separate entries
      if (qtz > 0) {
        var idQ = (DB.meta.last_misc_charge_id || 0) + 1;
        DB.meta.last_misc_charge_id = idQ;
        DB.misc_charges.push({ id: idQ, date: date, owner: owner, amount: qtz, currency: 'QTZ', description: desc, recorded_by: App.currentUser(), recorded_at: new Date().toISOString() });
      }
      if (usd > 0) {
        var idU = (DB.meta.last_misc_charge_id || 0) + 1;
        DB.meta.last_misc_charge_id = idU;
        DB.misc_charges.push({ id: idU, date: date, owner: owner, amount: usd, currency: 'USD', description: desc, recorded_by: App.currentUser(), recorded_at: new Date().toISOString() });
      }
    } else {
      // Save as payment or credit
      var from = document.getElementById('txn-from').value;
      var to = document.getElementById('txn-to').value;
      var qtz = parseFloat(document.getElementById('txn-qtz').value) || 0;
      var usd = parseFloat(document.getElementById('txn-usd').value) || 0;
      var xr = parseFloat(document.getElementById('txn-xr').value) || 0;
      var notes = document.getElementById('txn-notes').value.trim();
      if (from === to) { alert('Origen y destino no pueden ser iguales'); return; }
      if (qtz <= 0 && usd <= 0) { alert('Ingresa al menos un monto'); return; }

      var id = (DB.meta.last_payment_id || 0) + 1;
      DB.meta.last_payment_id = id;
      DB.payments.push({ id: id, type: type, date: date, from: from, to: to, amount_qtz: qtz, amount_usd: usd, exchange_rate: xr, notes: notes, recorded_by: App.currentUser(), recorded_at: new Date().toISOString() });
    }

    var ok = await API.saveData();
    if (ok) {
      document.getElementById('book-modal').style.display = 'none';
      var labels = { payment: 'Pago', credit: 'Credito', charge: 'Cargo' };
      API.showNotifyToast((labels[type] || 'Movimiento') + ' registrado');
      buildStatement();
      buildPaymentsList();
    } else {
      alert('Error al guardar');
    }
  }

  function editPayment(id) { editTransaction('payment', id); }
  function editCharge(id) { editTransaction('charge', id); }

  function editTransaction(kind, id) {
    if (!App.isAdmin()) return;
    ensureData();

    var ownerOpts = function(sel) {
      return '<option value="COCO"' + (sel === 'COCO' ? ' selected' : '') + '>COCO</option>'
        + '<option value="CUCO"' + (sel === 'CUCO' ? ' selected' : '') + '>CUCO</option>'
        + '<option value="SENSHI"' + (sel === 'SENSHI' ? ' selected' : '') + '>Charter (Senshi)</option>';
    };

    // Load data from the right source
    var date = '', from = '', to = '', qtz = 0, usd = 0, xr = 0, notes = '', ptype = 'payment', chargeOwner = '', chargeCurrency = 'QTZ', recordedBy = '?', recordedAt = '?';

    if (kind === 'charge') {
      var c = DB.misc_charges.find(function(x) { return x.id === id; });
      if (!c) return;
      date = c.date; qtz = (c.currency === 'QTZ') ? c.amount : 0; usd = (c.currency === 'USD') ? c.amount : 0;
      notes = c.description || ''; ptype = 'charge'; chargeOwner = c.owner; chargeCurrency = c.currency;
      recordedBy = c.recorded_by || '?'; recordedAt = c.recorded_at ? c.recorded_at.slice(0, 10) : '?';
    } else {
      var p = DB.payments.find(function(x) { return x.id === id; });
      if (!p) return;
      date = p.date; from = p.from; to = p.to; qtz = p.amount_qtz || 0; usd = p.amount_usd || 0;
      xr = p.exchange_rate || 0; notes = p.notes || ''; ptype = p.type || 'payment'; chargeOwner = from || 'COCO';
      recordedBy = p.recorded_by || '?'; recordedAt = p.recorded_at ? p.recorded_at.slice(0, 10) : '?';
    }

    document.getElementById('edit-modal-title').textContent = 'Editar movimiento';
    document.getElementById('edit-form-content').innerHTML =
      // Type selector
      '<div class="fs"><label class="fl">Tipo</label><select id="et-type" onchange="Payments.onEditTypeChange()">'
      + '<option value="payment"' + (ptype === 'payment' ? ' selected' : '') + '>Pago</option>'
      + '<option value="credit"' + (ptype === 'credit' ? ' selected' : '') + '>Credito</option>'
      + '<option value="charge"' + (ptype === 'charge' ? ' selected' : '') + '>Cargo</option>'
      + '</select></div>'
      // Date
      + '<div class="fs"><label class="fl">Fecha</label><input type="date" id="et-date" value="' + date + '"></div>'
      // From/To (payment/credit)
      + '<div class="row2" id="et-fromto">'
      + '<div class="fs"><label class="fl" id="et-from-lbl">De</label><select id="et-from"><option value="SENSHI"' + (from === 'SENSHI' ? ' selected' : '') + '>Senshi</option>' + ownerOpts(from) + '</select></div>'
      + '<div class="fs"><label class="fl" id="et-to-lbl">A</label><select id="et-to"><option value="SENSHI"' + (to === 'SENSHI' ? ' selected' : '') + '>Senshi</option>' + ownerOpts(to) + '</select></div>'
      + '</div>'
      // Owner (charge)
      + '<div class="fs" id="et-owner-row" style="display:none"><label class="fl">Cobrar a</label><select id="et-owner">' + ownerOpts(chargeOwner) + '</select></div>'
      // Amounts
      + '<div class="row2">'
      + '<div class="fs"><label class="fl">Monto QTZ</label><input type="number" id="et-qtz" value="' + qtz + '" step="0.01" inputmode="decimal"></div>'
      + '<div class="fs"><label class="fl">Monto USD</label><input type="number" id="et-usd" value="' + usd + '" step="0.01" inputmode="decimal"></div>'
      + '</div>'
      // Exchange rate
      + '<div class="fs" id="et-xr-row"><label class="fl">Tipo de cambio</label><input type="number" id="et-xr" value="' + xr + '" step="0.01" inputmode="decimal"></div>'
      // Notes
      + '<div class="fs"><label class="fl" id="et-notes-lbl">Notas</label><input type="text" id="et-notes" value="' + notes.replace(/"/g, '&quot;') + '"></div>'
      // Meta
      + '<div style="font-size:9px;color:#8892A4;margin-bottom:10px">Registrado por ' + recordedBy + ' el ' + recordedAt + '</div>'
      // Buttons — store original kind and id as data attributes
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn" onclick="Payments.saveEditTransaction(\'' + kind + '\',' + id + ')">Guardar</button>'
      + '<button class="btn" style="background:#8B1A1A" onclick="Payments.deleteTransaction(\'' + kind + '\',' + id + ')">Eliminar</button>'
      + '</div>';

    document.getElementById('edit-modal').style.display = 'flex';
    onEditTypeChange();
  }

  function onEditTypeChange() {
    var type = document.getElementById('et-type').value;
    var fromTo = document.getElementById('et-fromto');
    var ownerRow = document.getElementById('et-owner-row');
    var xrRow = document.getElementById('et-xr-row');
    var notesLbl = document.getElementById('et-notes-lbl');

    if (type === 'charge') {
      fromTo.style.display = 'none';
      ownerRow.style.display = 'block';
      xrRow.style.display = 'none';
      notesLbl.textContent = 'Descripcion';
    } else {
      fromTo.style.display = 'grid';
      ownerRow.style.display = 'none';
      xrRow.style.display = 'block';
      notesLbl.textContent = 'Notas';
    }
  }

  async function saveEditTransaction(origKind, id) {
    ensureData();
    var newType = document.getElementById('et-type').value;
    var date = document.getElementById('et-date').value;
    var notes = document.getElementById('et-notes').value.trim();
    var qtz = parseFloat(document.getElementById('et-qtz').value) || 0;
    var usd = parseFloat(document.getElementById('et-usd').value) || 0;

    if (!date) { alert('Selecciona fecha'); return; }

    // If type changed between payment/credit <-> charge, move between collections
    var wasCharge = (origKind === 'charge');
    var isCharge = (newType === 'charge');

    if (wasCharge && !isCharge) {
      // Convert charge -> payment/credit: remove from misc_charges, add to payments
      DB.misc_charges = DB.misc_charges.filter(function(c) { return c.id !== id; });
      var from = document.getElementById('et-from').value;
      var to = document.getElementById('et-to').value;
      if (from === to) { alert('Origen y destino no pueden ser iguales'); return; }
      var newId = (DB.meta.last_payment_id || 0) + 1;
      DB.meta.last_payment_id = newId;
      DB.payments.push({
        id: newId, type: newType, date: date, from: from, to: to,
        amount_qtz: qtz, amount_usd: usd,
        exchange_rate: parseFloat(document.getElementById('et-xr').value) || 0,
        notes: notes, recorded_by: App.currentUser(), recorded_at: new Date().toISOString()
      });
    } else if (!wasCharge && isCharge) {
      // Convert payment/credit -> charge: remove from payments, add to misc_charges
      DB.payments = DB.payments.filter(function(p) { return p.id !== id; });
      var owner = document.getElementById('et-owner').value;
      // Create one or two charge records depending on currencies
      if (qtz > 0) {
        var cid = (DB.meta.last_misc_charge_id || 0) + 1;
        DB.meta.last_misc_charge_id = cid;
        DB.misc_charges.push({ id: cid, date: date, owner: owner, amount: qtz, currency: 'QTZ', description: notes, recorded_by: App.currentUser(), recorded_at: new Date().toISOString() });
      }
      if (usd > 0) {
        var cid2 = (DB.meta.last_misc_charge_id || 0) + 1;
        DB.meta.last_misc_charge_id = cid2;
        DB.misc_charges.push({ id: cid2, date: date, owner: owner, amount: usd, currency: 'USD', description: notes, recorded_by: App.currentUser(), recorded_at: new Date().toISOString() });
      }
    } else if (isCharge) {
      // Update existing charge
      var c = DB.misc_charges.find(function(x) { return x.id === id; });
      if (!c) return;
      c.date = date;
      c.owner = document.getElementById('et-owner').value;
      c.description = notes;
      // If both QTZ and USD, keep the original currency and update amount
      c.amount = (c.currency === 'USD') ? usd : qtz;
      if (qtz > 0 && usd > 0 && c.currency === 'QTZ') c.amount = qtz;
    } else {
      // Update existing payment/credit
      var p = DB.payments.find(function(x) { return x.id === id; });
      if (!p) return;
      var from = document.getElementById('et-from').value;
      var to = document.getElementById('et-to').value;
      if (from === to) { alert('Origen y destino no pueden ser iguales'); return; }
      p.type = newType;
      p.date = date;
      p.from = from;
      p.to = to;
      p.amount_qtz = qtz;
      p.amount_usd = usd;
      p.exchange_rate = parseFloat(document.getElementById('et-xr').value) || 0;
      p.notes = notes;
    }

    Admin.closeEdit();
    var ok = await API.saveData();
    if (ok) {
      API.showNotifyToast('Movimiento actualizado');
      buildStatement();
      buildPaymentsList();
    }
  }

  async function deleteTransaction(origKind, id) {
    if (!confirm('Eliminar este movimiento?')) return;
    if (origKind === 'charge') {
      DB.misc_charges = DB.misc_charges.filter(function(c) { return c.id !== id; });
    } else {
      DB.payments = DB.payments.filter(function(p) { return p.id !== id; });
    }
    Admin.closeEdit();
    var ok = await API.saveData();
    if (ok) {
      API.showNotifyToast('Movimiento eliminado');
      buildStatement();
      buildPaymentsList();
    }
  }

  // ========== MISC CHARGES (Otros cargos) ==========

  function openAddCharge() {
    if (!App.isAdmin()) return;
    ensureData();
    var today = App.todayStr();
    var ownerOpts = '<option value="COCO">COCO</option><option value="CUCO">CUCO</option><option value="SENSHI">Charter (Senshi)</option>';

    document.getElementById('book-modal-title').textContent = 'Otro cargo';
    document.getElementById('book-form').innerHTML =
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="mc-date" value="' + today + '"></div>'
      + '<div class="fs"><label class="fl">Cobrar a</label><select id="mc-owner">' + ownerOpts + '</select></div>'
      + '<div class="row2">'
      + '<div class="fs"><label class="fl">Monto</label><input type="number" id="mc-amount" placeholder="0.00" step="0.01" inputmode="decimal"></div>'
      + '<div class="fs"><label class="fl">Moneda</label><select id="mc-currency"><option value="QTZ">QTZ</option><option value="USD">USD</option></select></div>'
      + '</div>'
      + '<div class="fs"><label class="fl">Descripcion</label><input type="text" id="mc-desc" placeholder="ej. 50% tarjeta TG-SHI 2026"></div>'
      + '<button class="btn" onclick="Payments.saveCharge()">Guardar cargo</button>';
    document.getElementById('book-modal').style.display = 'flex';

    var ownerEl = document.getElementById('mc-owner');
    if (ownerEl) ownerEl.value = stmtOwner;
  }

  async function saveCharge() {
    ensureData();
    var date = document.getElementById('mc-date').value;
    var owner = document.getElementById('mc-owner').value;
    var amount = parseFloat(document.getElementById('mc-amount').value) || 0;
    var currency = document.getElementById('mc-currency').value;
    var desc = document.getElementById('mc-desc').value.trim();

    if (!date) { alert('Selecciona fecha'); return; }
    if (amount <= 0) { alert('Ingresa un monto'); return; }
    if (!desc) { alert('Ingresa descripcion'); return; }

    var id = (DB.meta.last_misc_charge_id || 0) + 1;
    DB.meta.last_misc_charge_id = id;

    DB.misc_charges.push({
      id: id,
      date: date,
      owner: owner,
      amount: amount,
      currency: currency,
      description: desc,
      recorded_by: App.currentUser(),
      recorded_at: new Date().toISOString()
    });

    var ok = await API.saveData();
    if (ok) {
      document.getElementById('book-modal').style.display = 'none';
      API.showNotifyToast('Cargo registrado');
      buildStatement();
      buildPaymentsList();
    } else {
      alert('Error al guardar');
      DB.misc_charges = DB.misc_charges.filter(function(c) { return c.id !== id; });
    }
  }

  // ========== BALANCE SUMMARY (for dashboard widget) ==========

  function getOwnerBalances() {
    ensureData();
    var balances = {};

    var now = new Date();
    var nextMonth = (function() {
      var ny = now.getFullYear(), nm = now.getMonth() + 2;
      if (nm > 12) { nm = 1; ny++; }
      return ny + '-' + App.pad2(nm);
    })();

    ['COCO', 'CUCO', 'SENSHI'].forEach(function(owner) {
      // Start from QB opening balance
      var ob = OPENING_BALANCES[owner] || { qtz: 0, usd: 0 };
      balances[owner] = { qtz: ob.qtz, usd: ob.usd };

      // Add all charges from tracking start to now
      var charges = getChargeMonths(owner, TRACKING_START, nextMonth);
      charges.forEach(function(mc) {
        balances[owner].qtz += mc.chargeQTZ;
        balances[owner].usd += mc.chargeUSD;
      });

      // Subtract all payments for this owner
      DB.payments.forEach(function(p) {
        if (p.from === owner || p.to === owner) {
          var sign = paymentSign(p, owner);
          balances[owner].qtz += sign * (p.amount_qtz || 0);
          balances[owner].usd += sign * (p.amount_usd || 0);
        }
      });
    });

    return balances;
  }

  // ========== BILLING INTEGRATION ==========
  // Section H in billing report: beginning balance, period charges/payments, ending balance

  function buildBillingSectionH(bilFrom, bilTo) {
    if (!App.isAdmin()) return '';
    ensureData();

    var fQ = function(v) { return 'Q' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fD = function(v) { return '$' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fSQ = function(v) { return v < 0 ? '-' + fQ(v) : fQ(v); };
    var fSD = function(v) { return v < 0 ? '-' + fD(v) : fD(v); };
    var sg = function(v) { return v < 0 ? 'neg' : ''; };

    // Determine period boundaries
    // bilFrom/bilTo are YYYY-MM strings from the billing period selector
    var periodFrom = (bilFrom || TRACKING_START) + '-01';
    var periodTo = (bilTo || bilFrom || TRACKING_START) + '-31';
    var periodFromMonth = bilFrom || TRACKING_START;
    var periodToMonth = bilTo || bilFrom || TRACKING_START;

    // Next month after period end (for getChargeMonths exclusive end)
    var toParts = periodToMonth.split('-');
    var nextY = +toParts[0], nextM = +toParts[1] + 1;
    if (nextM > 12) { nextM = 1; nextY++; }
    var periodEndExcl = nextY + '-' + App.pad2(nextM);

    // Clamp period to TRACKING_START — anything before is settled
    var effectiveFrom = periodFromMonth < TRACKING_START ? TRACKING_START : periodFromMonth;
    var effectiveFromDate = effectiveFrom + '-01';

    var h = '<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">H — Saldos (' + effectiveFrom + ' → ' + periodToMonth + ')</div></div><div class="bil-bd">';

    ['COCO', 'CUCO', 'SENSHI'].forEach(function(owner, idx) {
      var label = owner === 'SENSHI' ? 'CHARTER' : owner;
      var border = idx > 0 ? 'border-top:2px solid #E2E6EE;margin-top:8px;padding-top:8px' : '';

      // --- Beginning balance: QB opening + all charges + payments BEFORE this period ---
      var ob = OPENING_BALANCES[owner] || { qtz: 0, usd: 0 };
      var begQTZ = ob.qtz, begUSD = ob.usd;

      // Charges from tracking start up to (but not including) this period
      if (effectiveFrom > TRACKING_START) {
        var priorCharges = getChargeMonths(owner, TRACKING_START, effectiveFrom);
        priorCharges.forEach(function(mc) {
          begQTZ += mc.chargeQTZ;
          begUSD += mc.chargeUSD;
        });
      }

      // Payments before this period (from tracking start)
      DB.payments.forEach(function(p) {
        if ((p.from === owner || p.to === owner) && p.date < effectiveFromDate && p.date >= TRACKING_START + '-01') {
          var sign = paymentSign(p, owner);
          begQTZ += sign * (p.amount_qtz || 0);
          begUSD += sign * (p.amount_usd || 0);
        }
      });

      // --- Period charges ---
      var periodCharges = getChargeMonths(owner, effectiveFrom, periodEndExcl);
      var chgQTZ = 0, chgUSD = 0;
      periodCharges.forEach(function(mc) {
        chgQTZ += mc.chargeQTZ;
        chgUSD += mc.chargeUSD;
      });

      // --- Period payments (clamped to tracking start) ---
      var payQTZ = 0, payUSD = 0;
      DB.payments.forEach(function(p) {
        if ((p.from === owner || p.to === owner) && p.date >= effectiveFromDate && p.date <= periodTo) {
          var sign = paymentSign(p, owner);
          payQTZ += sign * (p.amount_qtz || 0);
          payUSD += sign * (p.amount_usd || 0);
        }
      });

      // --- Ending balance ---
      var endQTZ = begQTZ + chgQTZ + payQTZ;
      var endUSD = begUSD + chgUSD + payUSD;

      // Compute label for saldo inicial date
      var prevMonthParts = effectiveFrom.split('-');
      var pY = +prevMonthParts[0], pM = +prevMonthParts[1] - 1;
      if (pM < 1) { pM = 12; pY--; }
      var begLabel = (effectiveFrom === TRACKING_START) ? 'Saldo QB Dic ' + (pY) : 'Saldo al ' + App.pad2(pM) + '/' + pY;

      h += '<div style="' + border + '">';
      h += '<div class="bil-row"><div class="bil-lbl" style="font-weight:700;font-size:11px">' + label + '</div><div class="bil-val"></div></div>';

      // Beginning balance
      h += '<div class="bil-row"><div class="bil-lbl" style="color:#8892A4;font-size:10px">' + begLabel + '</div>'
        + '<div class="bil-val" style="display:flex;gap:8px;font-size:10px">'
        + '<span class="' + sg(begQTZ) + '">' + fSQ(begQTZ) + '</span>'
        + '<span class="' + sg(begUSD) + '">' + fSD(begUSD) + '</span>'
        + '</div></div>';

      // Period charges
      if (chgQTZ !== 0 || chgUSD !== 0) {
        h += '<div class="bil-row"><div class="bil-lbl" style="color:#8B1A1A;font-size:10px">+ Cargos ' + effectiveFrom + ' → ' + periodToMonth + '</div>'
          + '<div class="bil-val" style="display:flex;gap:8px;font-size:10px;color:#8B1A1A">'
          + (chgQTZ !== 0 ? '<span>' + fSQ(chgQTZ) + '</span>' : '')
          + (chgUSD !== 0 ? '<span>' + fSD(chgUSD) + '</span>' : '')
          + '</div></div>';
      }

      // Period payments
      if (payQTZ !== 0 || payUSD !== 0) {
        h += '<div class="bil-row"><div class="bil-lbl" style="color:#1A6B3A;font-size:10px">- Pagos ' + effectiveFrom + ' → ' + periodToMonth + '</div>'
          + '<div class="bil-val" style="display:flex;gap:8px;font-size:10px;color:#1A6B3A">'
          + (payQTZ !== 0 ? '<span>' + fSQ(payQTZ) + '</span>' : '')
          + (payUSD !== 0 ? '<span>' + fSD(payUSD) + '</span>' : '')
          + '</div></div>';
      }

      // Ending balance
      h += '<div class="bil-row" style="background:#F5F6F8;border-radius:4px;margin-top:2px">'
        + '<div class="bil-lbl" style="font-weight:700;font-size:11px">Saldo al ' + periodToMonth + '</div>'
        + '<div class="bil-val" style="display:flex;gap:8px;font-size:11px">'
        + '<span class="' + sg(endQTZ) + '" style="font-weight:700">' + fSQ(endQTZ) + '</span>'
        + '<span class="' + sg(endUSD) + '" style="font-weight:700">' + fSD(endUSD) + '</span>'
        + '</div></div>';

      h += '</div>';
    });

    h += '<div style="font-size:9px;color:#8892A4;text-align:center;margin-top:6px;padding-bottom:4px">Positivo = debe a Senshi &middot; Negativo = Senshi debe &middot; <a href="#" onclick="App.nav(\'pay\',9);return false" style="color:#4A9EE8">Ver detalle</a></div>';
    h += '</div></div>';

    return h;
  }

  return {
    buildPaymentsPage: buildPaymentsPage,
    setOwner: setOwner,
    setYear: setYear,
    openTransaction: openTransaction,
    onTxnTypeChange: onTxnTypeChange,
    saveTransaction: saveTransaction,
    editPayment: editPayment,
    editCharge: editCharge,
    onEditTypeChange: onEditTypeChange,
    saveEditTransaction: saveEditTransaction,
    deleteTransaction: deleteTransaction,
    openAddCharge: openAddCharge,
    saveCharge: saveCharge,
    getOwnerBalances: getOwnerBalances,
    buildBillingSectionH: buildBillingSectionH
  };
})();
