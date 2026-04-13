// =====================================================================
// TG-SHI v6.0 -- js/exports.js
// Excel export module using SheetJS (XLSX)
// =====================================================================

var Exports = (function() {

  var sheetJSLoaded = false;
  function loadSheetJS(callback) {
    if (sheetJSLoaded) { callback(); return; }
    var script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
    script.onload = function() { sheetJSLoaded = true; callback(); };
    script.onerror = function() { alert('Error cargando libreria de Excel. Verifica tu conexion.'); };
    document.head.appendChild(script);
  }

  // ---- Open export modal ----
  // section: 'flights', 'fuel', 'schedule', 'maintenance', 'all'
  function openExportModal(section) {
    var now = new Date();
    var y = now.getFullYear();
    var m = App.pad2(now.getMonth() + 1);
    var defaultFrom = y + '-01-01';
    var defaultTo = y + '-' + m + '-' + App.pad2(now.getDate());

    var titles = {
      flights: 'Exportar Logbook',
      fuel: 'Exportar Combustible',
      schedule: 'Exportar Agenda',
      maintenance: 'Exportar Mantenimiento',
      all: 'Exportar Datos'
    };

    var checkboxes = '';
    if (section === 'all') {
      checkboxes = '<div class="fs"><label class="fl">Incluir</label>'
        + '<div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">'
        + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-flights" checked> Logbook (vuelos)</label>'
        + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-fuel" checked> Combustible</label>'
        + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-schedule" checked> Agenda (reservas)</label>'
        + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-maintenance" checked> Mantenimiento</label>'
        + '</div></div>';
    }

    document.getElementById('book-modal-title').textContent = titles[section] || 'Exportar';
    document.getElementById('book-form').innerHTML =
      '<div class="row2">'
      + '<div class="fs"><label class="fl">Desde</label><input type="date" id="exp-from" value="' + defaultFrom + '"></div>'
      + '<div class="fs"><label class="fl">Hasta</label><input type="date" id="exp-to" value="' + defaultTo + '"></div>'
      + '</div>'
      + checkboxes
      + '<button class="btn" onclick="Exports.doExport(\'' + section + '\')">Descargar Excel</button>';
    document.getElementById('book-modal').style.display = 'flex';
  }

  // ---- Main export ----
  function doExport(section) {
    var from = document.getElementById('exp-from').value;
    var to = document.getElementById('exp-to').value;
    if (!from || !to) { alert('Selecciona rango de fechas'); return; }

    loadSheetJS(function() {
      var wb = XLSX.utils.book_new();

      if (section === 'flights') {
        addFlightsSheet(wb, from, to);
      } else if (section === 'fuel') {
        addFuelSheet(wb, from, to);
      } else if (section === 'schedule') {
        addScheduleSheet(wb, from, to);
      } else if (section === 'maintenance') {
        addMaintenanceSheet(wb, from, to);
      } else {
        var el;
        el = document.getElementById('exp-flights');
        if (!el || el.checked) addFlightsSheet(wb, from, to);
        el = document.getElementById('exp-fuel');
        if (!el || el.checked) addFuelSheet(wb, from, to);
        el = document.getElementById('exp-schedule');
        if (!el || el.checked) addScheduleSheet(wb, from, to);
        el = document.getElementById('exp-maintenance');
        if (!el || el.checked) addMaintenanceSheet(wb, from, to);
      }

      var labels = { flights: 'Logbook', fuel: 'Combustible', schedule: 'Agenda', maintenance: 'Mantenimiento', all: 'TG-SHI' };
      var filename = (labels[section] || 'TG-SHI') + '_' + from + '_' + to + '.xlsx';
      XLSX.writeFile(wb, filename);

      document.getElementById('book-modal').style.display = 'none';
      API.showNotifyToast('Excel descargado');
    });
  }

  // ---- Flights / Logbook ----
  function addFlightsSheet(wb, from, to) {
    var flights = DB.flights.filter(function(f) { return f.d >= from && f.d <= to; });
    flights.sort(function(a, b) { return a.d.localeCompare(b.d); });

    var rows = [];
    rows.push(['Fecha', 'Ruta', 'Responsable', 'Tipo', 'Piloto', 'HRM Inicio', 'HRM Final', 'Horas', 'Espera (hrs)', 'Ingreso USD', 'Avion', 'Verificado', 'Notas']);

    flights.forEach(function(f) {
      var pilotName = '';
      if (f.pilot_roster_id) {
        var rp = App.getPilot(f.pilot_roster_id);
        if (rp) pilotName = rp.name;
      } else if (f.p) {
        var pu = App.getUser(f.p);
        pilotName = pu.name || f.p;
      }
      var typeLabels = { PERSONAL: 'Personal', STD: 'Charter STD', FF: 'Charter FF', MANTE: 'Mantenimiento' };
      rows.push([
        f.d,
        f.rt || '',
        f.r === 'SENSHI' ? 'Charter' : f.r,
        typeLabels[f.t] || f.t,
        pilotName,
        f.hi,
        f.hf,
        f.h,
        f.eh || 0,
        f.rv || 0,
        f.plane_id || 'TG-SHI',
        f.verified !== false ? 'Si' : 'Pendiente',
        f.no || ''
      ]);
    });

    var ws = XLSX.utils.aoa_to_sheet(rows);
    formatSheet(ws, rows[0].length, rows.length);
    XLSX.utils.book_append_sheet(wb, ws, 'Logbook');
  }

  // ---- Fuel ----
  function addFuelSheet(wb, from, to) {
    var fuels = DB.fuel.filter(function(f) { return f.d >= from && f.d <= to; });
    fuels.sort(function(a, b) { return a.d.localeCompare(b.d); });

    var rows = [];
    rows.push(['Fecha', 'Monto QTZ', 'Pagado por', 'Anticipo COCO', 'Anticipo CUCO', 'Anticipo Charter', 'Notas']);

    fuels.forEach(function(f) {
      rows.push([
        f.d,
        f.m,
        f.py,
        f.ac || 0,
        f.au || 0,
        f.as || 0,
        f.no || ''
      ]);
    });

    var ws = XLSX.utils.aoa_to_sheet(rows);
    formatSheet(ws, rows[0].length, rows.length);

    if (rows.length > 1) {
      var totalRow = rows.length + 1;
      ws['A' + totalRow] = { v: 'TOTALES', t: 's' };
      ws['B' + totalRow] = { f: 'SUM(B2:B' + rows.length + ')' };
      ws['D' + totalRow] = { f: 'SUM(D2:D' + rows.length + ')' };
      ws['E' + totalRow] = { f: 'SUM(E2:E' + rows.length + ')' };
      ws['F' + totalRow] = { f: 'SUM(F2:F' + rows.length + ')' };
      ws['!ref'] = 'A1:G' + totalRow;
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Combustible');
  }

  // ---- Schedule ----
  function addScheduleSheet(wb, from, to) {
    var scheds = (DB.schedule || []).filter(function(s) { return s.date >= from && s.date <= to; });
    scheds.sort(function(a, b) { return a.date.localeCompare(b.date) || a.start.localeCompare(b.start); });

    var rows = [];
    rows.push(['Fecha', 'Inicio', 'Fin', 'Ruta', 'Solicitado por', 'Piloto', 'Tipo de vuelo', 'Estado', 'Avion', 'Notas']);

    scheds.forEach(function(s) {
      var pilotName = '';
      if (s.pilot_roster_id) {
        var rp = App.getPilot(s.pilot_roster_id);
        if (rp) pilotName = rp.name;
      } else if (s.pilot) {
        var pu = App.getUser(s.pilot);
        pilotName = pu.name || s.pilot;
      }
      var typeLabels = { PERSONAL: 'Personal', STD: 'Charter STD', FF: 'Charter FF', MANTE: 'Mantenimiento' };
      var statusLabels = { requested: 'Solicitado', confirmed: 'Confirmado', completed: 'Completado', cancelled: 'Cancelado' };
      rows.push([
        s.date,
        s.start,
        s.end,
        s.route || '',
        s.booked_by,
        pilotName,
        typeLabels[s.flight_type] || s.flight_type || '',
        statusLabels[s.status] || s.status,
        s.plane_id || 'TG-SHI',
        s.notes || ''
      ]);
    });

    var ws = XLSX.utils.aoa_to_sheet(rows);
    formatSheet(ws, rows[0].length, rows.length);
    XLSX.utils.book_append_sheet(wb, ws, 'Agenda');
  }

  // ---- Maintenance ----
  function addMaintenanceSheet(wb, from, to) {
    var maints = (DB.maintenance || []).filter(function(m) { return m.date >= from && m.date <= to; });
    maints.sort(function(a, b) { return a.date.localeCompare(b.date); });

    var rows = [];
    rows.push(['Fecha', 'Descripcion', 'Categoria', 'Monto', 'Moneda', 'Pagado por', 'Avion', 'Tach', 'Notas']);

    maints.forEach(function(m) {
      rows.push([
        m.date,
        m.description || m.desc || '',
        m.category || '',
        m.amount || m.cost || 0,
        m.currency || 'USD',
        m.paid_by || '',
        m.plane_id || 'TG-SHI',
        m.tach || '',
        m.notes || ''
      ]);
    });

    var ws = XLSX.utils.aoa_to_sheet(rows);
    formatSheet(ws, rows[0].length, rows.length);
    XLSX.utils.book_append_sheet(wb, ws, 'Mantenimiento');
  }

  // ---- Column auto-width ----
  function formatSheet(ws, numCols, numRows) {
    var colWidths = [];
    for (var c = 0; c < numCols; c++) {
      var maxLen = 10;
      for (var r = 0; r <= numRows; r++) {
        var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
        if (cell && cell.v != null) {
          var len = String(cell.v).length;
          if (len > maxLen) maxLen = len;
        }
      }
      colWidths.push({ wch: Math.min(maxLen + 2, 40) });
    }
    ws['!cols'] = colWidths;
  }

  return {
    openExportModal: openExportModal,
    doExport: doExport
  };
})();
