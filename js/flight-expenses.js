// =====================================================================
// TG-SHI v6.0 -- js/flight-expenses.js
// Flight-related expense tracking: landing fees, transport, food, etc.
// Each expense is linked to a flight and allocated to the flight owner.
// =====================================================================

var FlightExpenses = (function() {

  var yearFilter = 'ALL';

  var CATEGORIES = [
    'Aterrizaje',
    'Transporte terrestre',
    'Alimentacion',
    'Hospedaje',
    'Pernocta piloto',
    'Handling',
    'Parqueo',
    'Otros'
  ];

  // --- Helpers ---
  function fQ(v) {
    return 'Q' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fD(v) {
    return '$' + Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fAmt(v, cur) {
    return cur === 'USD' ? fD(v) : fQ(v);
  }

  function getFlightOwner(flightId) {
    var f = DB.flights.find(function(x) { return x.id === flightId; });
    return f ? f.r : null;
  }

  function getFlightLabel(f) {
    var displayR = f.r === 'SENSHI' ? 'Charter' : (f.r || '?');
    var route = (f.rt || '--').replace(/</g, '').replace(/>/g, '');
    var hrs = (f.h || 0).toFixed(1);
    return f.d.slice(5) + ' ' + route + ' ' + hrs + 'hr ' + displayR;
  }

  function getExpenses() {
    return DB.flight_expenses || [];
  }

  // ===== Expense Log Page =====

  function buildExpensePage() {
    var container = document.getElementById('fexp-content');
    if (!container) return;

    var isPilotView = App.isPilotAdmin() && !App.isAdmin();
    var exps = getExpenses().slice().reverse();

    // Pilot users only see expenses they logged
    if (isPilotView) {
      exps = exps.filter(function(e) { return e.logged_by === App.currentUser(); });
    }

    // Year filter
    if (/^\d{4}$/.test(yearFilter)) {
      exps = exps.filter(function(e) { return e.date.startsWith(yearFilter); });
    }

    if (exps.length === 0) {
      container.innerHTML = '<div class="card"><div class="empty"><div class="big">$</div>Sin gastos de vuelo registrados</div></div>';
      return;
    }

    var h = '';

    // Summary card - only for admin/owner
    if (!isPilotView) {
      // Compute totals per owner and currency
      var totals = {};
      exps.forEach(function(e) {
        var owner = getFlightOwner(e.flight_id);
        if (!owner) return;
        if (!totals[owner]) totals[owner] = { USD: 0, QTZ: 0 };
        totals[owner][e.currency] += e.amount;
      });

      h += '<div class="card"><div class="ch"><div class="ct">Resumen gastos de vuelo</div></div><div class="cb">';
      var owners = ['COCO', 'CUCO', 'SENSHI'];
      owners.forEach(function(owner) {
        var t = totals[owner] || { USD: 0, QTZ: 0 };
        var label = owner === 'SENSHI' ? 'CHARTER' : owner;
        var dc = owner === 'COCO' ? 'c1' : owner === 'CUCO' ? 'c2' : 'c3';
        var valStr = '';
        if (t.USD > 0) valStr += fD(t.USD);
        if (t.USD > 0 && t.QTZ > 0) valStr += ' + ';
        if (t.QTZ > 0) valStr += fQ(t.QTZ);
        if (!valStr) valStr = '$0.00';
        h += '<div class="qr"><div class="ql">' + label + '</div><div class="qv ' + dc + '">' + valStr + '</div></div>';
      });
      h += '</div></div>';
    }

    // Expense list
    h += '<div class="stitle">' + (isPilotView ? 'Mis gastos registrados' : 'Gastos registrados') + '</div>';
    exps.forEach(function(e) {
      var flight = DB.flights.find(function(x) { return x.id === e.flight_id; });
      var owner = flight ? flight.r : '?';
      var ownerLabel = owner === 'SENSHI' ? 'Charter' : owner;
      var flightRoute = flight ? (flight.rt || '--') : 'Vuelo #' + e.flight_id;
      var flightDate = flight ? flight.d : e.date;
      var canEdit = App.isAdmin() || (e.logged_by === App.currentUser());
      var actions = '';
      if (canEdit) {
        actions = '<div style="display:flex;gap:5px;margin-top:4px">' +
          '<button class="ubtn edit" onclick="FlightExpenses.openEdit(' + e.id + ')">Editar</button>' +
          '<button class="ubtn del" onclick="FlightExpenses.deleteExpense(' + e.id + ')">Eliminar</button>' +
          '</div>';
      }
      h += '<div class="card" style="margin-bottom:6px"><div class="cb">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
          '<div>' +
            '<div style="font-size:12px;font-weight:600;color:#1A1F2E">' + e.category + '</div>' +
            '<div style="font-size:10px;color:#8892A4;margin-top:1px">' + flightDate.slice(5) + ' ' + flightRoute + ' -- ' + ownerLabel + '</div>' +
            '<div style="font-size:10px;color:#8892A4;margin-top:1px">Pago: ' + e.paid_by + (e.notes ? ' -- ' + e.notes : '') + '</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:14px;font-weight:700;font-variant-numeric:tabular-nums">' + fAmt(e.amount, e.currency) + '</div>' +
            '<div style="font-size:9px;color:#8892A4">' + e.date + '</div>' +
          '</div>' +
        '</div>' +
        actions +
        '</div></div>';
    });

    container.innerHTML = h;
  }

  function filtExpYr(yr, el) {
    yearFilter = yr;
    var pills = document.querySelectorAll('#fexp-yr-row .fp');
    for (var i = 0; i < pills.length; i++) pills[i].classList.remove('on');
    el.classList.add('on');
    buildExpensePage();
  }

  // ===== Add Expense =====

  function openAddExpense() {
    try {
    // Build flight options from recent flights (last 50)
    var recent = DB.flights.slice().reverse().slice(0, 50);
    var flightOpts = '';
    recent.forEach(function(f) {
      flightOpts += '<option value="' + f.id + '">' + getFlightLabel(f) + '</option>';
    });
    if (!flightOpts) {
      alert('No hay vuelos registrados'); return;
    }

    // Category options
    var catOpts = '';
    CATEGORIES.forEach(function(c) {
      catOpts += '<option value="' + c + '">' + c + '</option>';
    });

    // Paid by options
    var paidByOpts = '';
    Object.keys(DB.users).forEach(function(k) {
      paidByOpts += '<option value="' + k + '"' + (k === App.currentUser() ? ' selected' : '') + '>' + k + '</option>';
    });

    document.getElementById('edit-modal-title').textContent = 'Agregar gasto de vuelo';
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Vuelo</label>' +
        '<select id="fexp-flight" onchange="FlightExpenses.onFlightChange()">' + flightOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Categoria</label>' +
        '<select id="fexp-cat">' + catOpts + '</select></div>' +
      '<div class="row2">' +
        '<div class="fs"><label class="fl">Monto</label><input type="number" id="fexp-amt" step="0.01" inputmode="decimal" placeholder="0.00"></div>' +
        '<div class="fs"><label class="fl">Moneda</label><select id="fexp-cur"><option value="QTZ">QTZ (Q)</option><option value="USD">USD ($)</option></select></div>' +
      '</div>' +
      '<div class="fs"><label class="fl">Pagado por</label><select id="fexp-paid">' + paidByOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="fexp-date" value="' + App.todayStr() + '"></div>' +
      '<div class="fs"><label class="fl">Notas</label><input type="text" id="fexp-notes" placeholder="opcional"></div>' +
      '<button class="btn" onclick="FlightExpenses.saveExpense()">Guardar gasto</button>';
    document.getElementById('edit-modal').style.display = 'flex';

    // Set date from selected flight
    FlightExpenses.onFlightChange();
    } catch(e) { console.error('openAddExpense error:', e); alert('Error: ' + e.message); }
  }

  function onFlightChange() {
    var fid = parseInt(document.getElementById('fexp-flight').value);
    var f = DB.flights.find(function(x) { return x.id === fid; });
    if (f) {
      var dateEl = document.getElementById('fexp-date');
      if (dateEl) dateEl.value = f.d;
    }
  }

  function saveExpense() {
    var flightId = parseInt(document.getElementById('fexp-flight').value);
    var category = document.getElementById('fexp-cat').value;
    var amount = parseFloat(document.getElementById('fexp-amt').value);
    var currency = document.getElementById('fexp-cur').value;
    var paidBy = document.getElementById('fexp-paid').value;
    var date = document.getElementById('fexp-date').value;
    var notes = document.getElementById('fexp-notes').value.trim();

    if (!flightId || !category || isNaN(amount) || amount <= 0 || !date) {
      alert('Completa vuelo, categoria, monto y fecha'); return;
    }

    if (!DB.flight_expenses) DB.flight_expenses = [];
    if (!DB.meta) DB.meta = {};
    var id = (DB.meta.last_fexp_id || 0) + 1;
    DB.meta.last_fexp_id = id;

    DB.flight_expenses.push({
      id: id,
      flight_id: flightId,
      category: category,
      amount: amount,
      currency: currency,
      paid_by: paidBy,
      date: date,
      notes: notes,
      logged_by: App.currentUser(),
      logged_at: new Date().toISOString()
    });

    Admin.closeEdit();
    API.saveData().then(function(ok) {
      if (ok) { buildExpensePage(); Flights.buildVL(); Dashboard.render(); }
      else { alert('Error guardando'); }
    });
  }

  // ===== Edit Expense =====

  function openEdit(id) {
    var e = (DB.flight_expenses || []).find(function(x) { return x.id === id; });
    if (!e) return;
    var canEdit = App.isAdmin() || (e.logged_by === App.currentUser());
    if (!canEdit) { alert('Sin permisos para editar'); return; }

    // Flight options
    var recent = DB.flights.slice().reverse().slice(0, 80);
    var flightOpts = '';
    recent.forEach(function(f) {
      flightOpts += '<option value="' + f.id + '"' + (f.id === e.flight_id ? ' selected' : '') + '>' + getFlightLabel(f) + '</option>';
    });

    // Category options
    var catOpts = '';
    CATEGORIES.forEach(function(c) {
      catOpts += '<option value="' + c + '"' + (c === e.category ? ' selected' : '') + '>' + c + '</option>';
    });

    // Paid by options
    var paidByOpts = '';
    Object.keys(DB.users).forEach(function(k) {
      paidByOpts += '<option value="' + k + '"' + (k === e.paid_by ? ' selected' : '') + '>' + k + '</option>';
    });

    document.getElementById('edit-modal-title').textContent = 'Editar gasto #' + id;
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Vuelo</label>' +
        '<select id="fexp-flight">' + flightOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Categoria</label>' +
        '<select id="fexp-cat">' + catOpts + '</select></div>' +
      '<div class="row2">' +
        '<div class="fs"><label class="fl">Monto</label><input type="number" id="fexp-amt" step="0.01" inputmode="decimal" value="' + e.amount + '"></div>' +
        '<div class="fs"><label class="fl">Moneda</label><select id="fexp-cur">' +
          '<option value="QTZ"' + (e.currency === 'QTZ' ? ' selected' : '') + '>QTZ (Q)</option>' +
          '<option value="USD"' + (e.currency === 'USD' ? ' selected' : '') + '>USD ($)</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="fs"><label class="fl">Pagado por</label><select id="fexp-paid">' + paidByOpts + '</select></div>' +
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="fexp-date" value="' + e.date + '"></div>' +
      '<div class="fs"><label class="fl">Notas</label><input type="text" id="fexp-notes" value="' + (e.notes || '') + '"></div>' +
      '<div style="display:flex;gap:8px;margin-top:3px">' +
        '<button class="btn" onclick="FlightExpenses.updateExpense(' + id + ')">Guardar</button>' +
        '<button class="btn" style="background:#8B1A1A" onclick="FlightExpenses.deleteExpense(' + id + ')">Eliminar</button>' +
      '</div>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  function updateExpense(id) {
    var e = (DB.flight_expenses || []).find(function(x) { return x.id === id; });
    if (!e) return;
    e.flight_id = parseInt(document.getElementById('fexp-flight').value);
    e.category = document.getElementById('fexp-cat').value;
    e.amount = parseFloat(document.getElementById('fexp-amt').value);
    e.currency = document.getElementById('fexp-cur').value;
    e.paid_by = document.getElementById('fexp-paid').value;
    e.date = document.getElementById('fexp-date').value;
    e.notes = document.getElementById('fexp-notes').value.trim();

    Admin.closeEdit();
    API.saveData().then(function(ok) {
      if (ok) { buildExpensePage(); Flights.buildVL(); Dashboard.render(); }
      else alert('Error guardando');
    });
  }

  function deleteExpense(id) {
    var e = (DB.flight_expenses || []).find(function(x) { return x.id === id; });
    if (!e) return;
    var canDel = App.isAdmin() || (e.logged_by === App.currentUser());
    if (!canDel) { alert('Sin permisos'); return; }
    if (!confirm('Eliminar este gasto?')) return;
    DB.flight_expenses = (DB.flight_expenses || []).filter(function(x) { return x.id !== id; });
    Admin.closeEdit();
    API.saveData().then(function(ok) {
      if (ok) { buildExpensePage(); Flights.buildVL(); Dashboard.render(); }
      else alert('Error eliminando');
    });
  }

  // ===== Billing integration =====

  /**
   * Compute flight expense costs per owner for a billing period.
   * Expenses are allocated to the flight's responsable (owner).
   * Returns: {
   *   COCO: { USD: n, QTZ: n, details: [...] },
   *   CUCO: { USD: n, QTZ: n, details: [...] },
   *   SENSHI: { USD: n, QTZ: n, details: [...] },
   *   expenses: [all matching expenses]
   * }
   */
  function billingForPeriod(fromYM, toYM) {
    var fd = fromYM + '-01';
    var td = toYM + '-31';
    var exps = (DB.flight_expenses || []).filter(function(e) {
      return e.date >= fd && e.date <= td;
    });

    var result = {
      COCO: { USD: 0, QTZ: 0, details: [] },
      CUCO: { USD: 0, QTZ: 0, details: [] },
      SENSHI: { USD: 0, QTZ: 0, details: [] },
      // Credits for payers who paid out of pocket for someone else's flight
      payer_credits: {
        COCO: { USD: 0, QTZ: 0, details: [] },
        CUCO: { USD: 0, QTZ: 0, details: [] },
        SENSHI: { USD: 0, QTZ: 0, details: [] }
      },
      expenses: exps
    };

    exps.forEach(function(e) {
      var owner = getFlightOwner(e.flight_id);
      if (!owner || !result[owner]) return;
      // Charge goes to flight owner
      result[owner][e.currency] += e.amount;
      result[owner].details.push(e);

      // If someone else paid, they get a credit
      var payer = e.paid_by;
      if (payer && payer !== owner && result.payer_credits[payer]) {
        result.payer_credits[payer][e.currency] += e.amount;
        result.payer_credits[payer].details.push(e);
      }
    });

    return result;
  }

  /**
   * Build billing Section E - Gastos de Vuelo HTML.
   */
  function buildBillingSectionE(from, to) {
    var data = billingForPeriod(from, to);

    if (data.expenses.length === 0) {
      return '<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">E -- Gastos de Vuelo</div></div><div class="bil-bd">' +
        '<div class="empty" style="padding:14px">Sin gastos de vuelo en este periodo</div>' +
        '</div></div>';
    }

    var h = '<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">E -- Gastos de Vuelo</div></div><div class="bil-bd">';

    // Group by owner
    var owners = ['COCO', 'CUCO', 'SENSHI'];
    owners.forEach(function(owner, idx) {
      var label = owner === 'SENSHI' ? 'CHARTER' : owner;
      var details = data[owner].details;
      if (details.length === 0 && data[owner].USD === 0 && data[owner].QTZ === 0) return;

      var border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:4px;padding-top:4px' : '';
      h += '<div class="bil-row" style="' + border + '"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">' + label + '</div><div class="bil-val" style="font-size:9px;color:#8892A4">' + details.length + ' gasto(s)</div></div>';

      details.forEach(function(e) {
        var flight = DB.flights.find(function(x) { return x.id === e.flight_id; });
        var route = flight ? (flight.rt || '--') : '#' + e.flight_id;
        h += '<div class="bil-row" style="border:none;padding:2px 0"><div class="bil-lbl" style="padding-left:12px;font-size:10px">' +
          e.category + ' <span style="color:#8892A4;font-size:9px">(' + e.date.slice(5) + ' ' + route + ' -- pago ' + e.paid_by + ')</span></div>' +
          '<div class="bil-val" style="font-size:11px">' + fAmt(e.amount, e.currency) + '</div></div>';
      });

      // Owner subtotal
      var subStr = '';
      if (data[owner].USD > 0) subStr += fD(data[owner].USD);
      if (data[owner].USD > 0 && data[owner].QTZ > 0) subStr += ' + ';
      if (data[owner].QTZ > 0) subStr += fQ(data[owner].QTZ);
      if (!subStr) subStr = '$0.00';
      h += '<div class="bil-row"><div class="bil-lbl"><b>' + label + ' total gastos</b></div><div class="bil-val"><b>' + subStr + '</b></div></div>';
    });

    // Show payer credits if any
    var hasCredits = false;
    ['COCO', 'CUCO', 'SENSHI'].forEach(function(payer) {
      var c = data.payer_credits[payer];
      if (c.USD > 0 || c.QTZ > 0) hasCredits = true;
    });
    if (hasCredits) {
      h += '<div style="border-top:2px solid #E2E6EE;margin-top:6px;padding-top:6px">';
      h += '<div class="bil-row"><div class="bil-lbl" style="font-weight:600;color:#1A6B3A;font-size:9px;text-transform:uppercase;letter-spacing:.06em">Creditos por pago de bolsillo</div></div>';
      ['COCO', 'CUCO', 'SENSHI'].forEach(function(payer) {
        var c = data.payer_credits[payer];
        if (c.USD === 0 && c.QTZ === 0) return;
        var payerLabel = payer === 'SENSHI' ? 'CHARTER' : payer;
        var creditStr = '';
        if (c.QTZ > 0) creditStr += fQ(c.QTZ);
        if (c.QTZ > 0 && c.USD > 0) creditStr += ' + ';
        if (c.USD > 0) creditStr += fD(c.USD);
        h += '<div class="bil-row"><div class="bil-lbl" style="color:#1A6B3A;font-size:10px">Credito a ' + payerLabel + ' (pago de bolsillo)</div><div class="bil-val" style="color:#1A6B3A;font-size:11px">(' + creditStr + ')</div></div>';
        c.details.forEach(function(e) {
          var flight = DB.flights.find(function(x) { return x.id === e.flight_id; });
          var route = flight ? (flight.rt || '--') : '#' + e.flight_id;
          var flightOwner = getFlightOwner(e.flight_id);
          var ownerLabel = flightOwner === 'SENSHI' ? 'Charter' : (flightOwner || '?');
          h += '<div class="bil-row" style="border:none;padding:2px 0"><div class="bil-lbl" style="padding-left:12px;font-size:9px;color:#8892A4">' + e.category + ' (' + route + ' ' + ownerLabel + ')</div><div class="bil-val" style="font-size:9px;color:#8892A4">' + fAmt(e.amount, e.currency) + '</div></div>';
        });
      });
      h += '</div>';
    }

    h += '</div></div>';
    return h;
  }

  /**
   * Build invoice lines for a specific owner.
   * Returns: { usdLines: [...], qtzLines: [...] }
   */
  function invoiceLinesForOwner(from, to, owner) {
    var data = billingForPeriod(from, to);
    var usdLines = [];
    var qtzLines = [];

    data[owner].details.forEach(function(e) {
      var flight = DB.flights.find(function(x) { return x.id === e.flight_id; });
      var route = flight ? (flight.rt || '--') : '#' + e.flight_id;
      var line = {
        desc: 'Gasto: ' + e.category + ' (' + e.date.slice(5) + ' ' + route + ', pago ' + e.paid_by + ')',
        amt: e.amount
      };
      if (e.currency === 'USD') usdLines.push(line);
      else qtzLines.push(line);
    });

    return { usdLines: usdLines, qtzLines: qtzLines, totals: { USD: data[owner].USD, QTZ: data[owner].QTZ } };
  }

  return {
    buildExpensePage: buildExpensePage,
    filtExpYr: filtExpYr,
    openAddExpense: openAddExpense,
    onFlightChange: onFlightChange,
    saveExpense: saveExpense,
    openEdit: openEdit,
    updateExpense: updateExpense,
    deleteExpense: deleteExpense,
    billingForPeriod: billingForPeriod,
    buildBillingSectionE: buildBillingSectionE,
    invoiceLinesForOwner: invoiceLinesForOwner
  };
})();
