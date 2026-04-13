// =====================================================================
// TG-SHI v6.0 -- js/exports.js
// Excel export module using SheetJS (XLSX)
// =====================================================================

var Exports = (function() {

  // Load SheetJS from CDN on first use
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
  function openExportModal() {
    var now = new Date();
    var y = now.getFullYear();
    var m = App.pad2(now.getMonth() + 1);
    var defaultFrom = y + '-01-01';
    var defaultTo = y + '-' + m + '-' + App.pad2(now.getDate());

    document.getElementById('book-modal-title').textContent = 'Exportar a Excel';
    document.getElementById('book-form').innerHTML =
      '<div class="fs"><label class="fl">Desde</label><input type="date" id="exp-from" value="' + defaultFrom + '"></div>'
      + '<div class="fs"><label class="fl">Hasta</label><input type="date" id="exp-to" value="' + defaultTo + '"></div>'
      + '<div class="fs"><label class="fl">Que exportar</label>'
      + '<div id="exp-checks" style="display:flex;flex-direction:column;gap:8px;margin-top:6px">'
      + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-flights" checked> Logbook (vuelos)</label>'
      + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-fuel" checked> Combustible</label>'
      + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-schedule" checked> Agenda (reservas)</label>'
      + '<label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="exp-maintenance" checked> Mantenimiento</label>'
      + '</div></div>'
      + '<button class="btn" onclick="Exports.doExport()">Descargar Excel</button>'
      + '<div class="hint" style="text-align:center;margin-top:8px">Se genera un archivo .xlsx con las pestanas seleccionadas</div>';
    document.getElementById('book-modal').style.display = 'flex';
  }

  // ---- Main export function ----
  function doExport() {
    var from = document.getElementById('exp-from').value;
    var to = document.getElementById('exp-to').value;
    if (!from || !to) { alert('Selecciona rango de fechas'); return; }

    var incFlights = document.getElementById('exp-flights').checked;
    var incFuel = document.getElementById('exp-fuel').checked;
    var incSchedule = document.getElementById('exp-schedule').checked;
    var incMaint = document.getElementById('exp-maintenance').checked;

    if (!incFlights && !incFuel && !incSchedule && !incMaint) {
      alert('Selecciona al menos una seccion para exportar');
      return;
    }

    loadSheetJS(function() {
      var wb = XLSX.utils.book_new();

      if (incFlights) addFlightsSheet(wb, from, to);
      if (incFuel) addFuelSheet(wb, from, to);
      if (incSchedule) addScheduleSheet(wb, from, to);
      if (incMaint) addMaintenanceSheet(wb, from, to);

      var filename = 'TG-SHI_' + from + '_' + to + '.xlsx';
      XLSX.writeFile(wb, filename);

      // Close modal
      document.getElementById('book-modal').style.display = 'none';
      API.showNotifyToast('Excel descargado: ' + filename);
    });
  }

  // ---- Flights / Logbook sheet ----
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

  // ---- Fuel sheet ----
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

    // Add totals row
    var totalRow = rows.length + 1;
    ws['A' + totalRow] = { v: 'TOTALES', t: 's' };
    ws['B' + totalRow] = { f: 'SUM(B2:B' + rows.length + ')' };
    ws['D' + totalRow] = { f: 'SUM(D2:D' + rows.length + ')' };
    ws['E' + totalRow] = { f: 'SUM(E2:E' + rows.length + ')' };
    ws['F' + totalRow] = { f: 'SUM(F2:F' + rows.length + ')' };
    ws['!ref'] = 'A1:G' + totalRow;

    XLSX.utils.book_append_sheet(wb, ws, 'Combustible');
  }

  // ---- Schedule sheet ----
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

  // ---- Maintenance sheet ----
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

  // ---- Format sheet: column widths + header style ----
  function formatSheet(ws, numCols, numRows) {
    // Auto-size columns based on content
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
