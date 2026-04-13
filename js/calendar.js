// =====================================================================
// TG-SHI v6.0 -- js/calendar.js
// Scheduling calendar, booking modal, confirmation flow
// =====================================================================

const Calendar = (() => {
  let calDate = new Date();
  let calSelDate = null;
  let cfmFlightType = null;

  function buildPlaneSelectors() {
    var planes = DB.planes.filter(function(p) { return p.active !== false; });
    var html = planes.map(function(p) {
      return '<div class="plane-chip' + (p.id === selPlane ? ' on' : '') + '" onclick="Calendar.selectPlane(\'' + p.id + '\',this)">' + p.id + '</div>';
    }).join('');
    document.getElementById('plane-sel-sched').innerHTML = html;
  }

  function selectPlane(id, el) {
    selPlane = id;
    document.querySelectorAll('.plane-chip').forEach(function(c) { c.classList.remove('on'); });
    if (el) el.classList.add('on');
    Dashboard.render();
    buildCalendar();
  }

  function buildCalendar() {
    const y = calDate.getFullYear(), m = calDate.getMonth();
    document.getElementById('cal-title').textContent = MO[m + 1] + ' ' + y;

    const first = new Date(y, m, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();

    const monthStr = y + '-' + App.pad2(m + 1);
    const schedMap = {};
    (DB.schedule || []).filter(function(s) { return s.date.startsWith(monthStr) && s.plane_id === selPlane && s.status !== 'cancelled'; }).forEach(function(s) {
      if (!schedMap[s.date]) schedMap[s.date] = [];
      schedMap[s.date].push(s);
    });

    let html = DAYS_ES.map(function(d) { return '<div class="cal-dh">' + d + '</div>'; }).join('');
    const today = App.todayStr();
    const selStr = calSelDate;

    for (let i = startDay - 1; i >= 0; i--) {
      html += '<div class="cal-d other">' + (prevDays - i) + '</div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const ds = y + '-' + App.pad2(m + 1) + '-' + App.pad2(d);
      const isToday = ds === today;
      const isSel = ds === selStr;
      const scheds = schedMap[ds] || [];
      let dots = '';
      if (scheds.length) {
        dots = '<div class="cal-dots">';
        scheds.slice(0, 3).forEach(function(s) {
          const cls = s.booked_by === App.currentUser() ? 'mine' : s.status === 'confirmed' ? 'conf' : 'req';
          dots += '<div class="cd ' + cls + '"></div>';
        });
        dots += '</div>';
      } else {
        dots = '<div class="cal-dots"></div>';
      }
      html += '<div class="cal-d' + (isToday ? ' today' : '') + (isSel ? ' sel' : '') + '" onclick="Calendar.selectDay(\'' + ds + '\')">' + d + dots + '</div>';
    }

    const totalCells = startDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - totalCells % 7;
    for (let i = 1; i <= remaining; i++) {
      html += '<div class="cal-d other">' + i + '</div>';
    }

    document.getElementById('cal-grid').innerHTML = html;
    if (calSelDate) buildDayDetail(calSelDate);
  }

  function calNav(dir) {
    calDate.setMonth(calDate.getMonth() + dir);
    calSelDate = null;
    buildCalendar();
    document.getElementById('day-detail').innerHTML = '';
  }

  function selectDay(ds) {
    calSelDate = ds;
    buildCalendar();
  }

  function buildDayDetail(ds) {
    const scheds = (DB.schedule || []).filter(function(s) { return s.date === ds && s.plane_id === selPlane && s.status !== 'cancelled'; })
      .sort(function(a, b) { return a.start.localeCompare(b.start); });

    let html = '<div class="day-detail">'
      + '<div class="dd-hd">'
      + '<div class="dd-title">' + App.fmtDate(ds) + '</div>'
      + '<button class="dd-add" onclick="Calendar.openBooking(\'' + ds + '\')">+ Reservar</button>'
      + '</div>';

    if (scheds.length === 0) {
      html += '<div class="empty" style="padding:20px">Sin reservas -- disponible todo el dia</div>';
    } else {
      scheds.forEach(function(s) {
        const u = App.getUser(s.booked_by);
        let pilotDisplay = 'Sin asignar';
        if (s.pilot_roster_id) {
          const rp = App.getPilot(s.pilot_roster_id);
          if (rp) pilotDisplay = rp.name + (rp.phone ? ' - ' + rp.phone : '');
        } else if (s.pilot) {
          pilotDisplay = App.getUser(s.pilot).name;
        }
        let typeTag = '';
        if (s.flight_type) {
          const tl = { PERSONAL: 'Personal', STD: 'Charter STD', FF: 'Charter FF', MANTE: 'Mante' };
          const tc = { PERSONAL: 'p', STD: 's', FF: 'f', MANTE: 'm' };
          typeTag = ' <span class="bx ' + (tc[s.flight_type] || 'p') + '">' + (tl[s.flight_type] || s.flight_type) + '</span>';
        }
        const canAct = App.isAdmin() || App.isPilotAdmin() || s.booked_by === App.currentUser();
        let actions = '';
        if (s.status === 'requested' && App.canManageSchedule()) {
          actions += '<button class="slot-confirm" onclick="Calendar.openConfirmModal(' + s.id + ')">Confirmar</button>';
        }
        if (canAct && s.status !== 'completed') {
          actions += '<button class="slot-cancel" onclick="Calendar.cancelSlot(' + s.id + ')">Cancelar</button>';
        }
        html += '<div class="slot">'
          + '<div class="slot-time">' + s.start + '<br><span style="font-weight:400;font-size:9px">' + s.end + '</span></div>'
          + '<div class="slot-body">'
          + '<div class="slot-route">' + (s.route || 'Pendiente ruta') + ' <span class="slot-status ' + s.status + '">' + (s.status === 'requested' ? 'Solicitado' : s.status === 'confirmed' ? 'Confirmado' : s.status === 'completed' ? 'Completado' : 'Cancelado') + '</span>' + typeTag + '</div>'
          + '<div class="slot-meta"><span>' + u.icon + ' ' + s.booked_by + '</span><span>' + pilotDisplay + '</span>' + (s.notes ? '<span>' + s.notes + '</span>' : '') + '</div>'
          + '</div>'
          + '<div class="slot-actions">' + actions + '</div>'
          + '</div>';
      });
    }
    html += '</div>';
    document.getElementById('day-detail').innerHTML = html;
  }

  // --- Booking modal ---
  function openBooking(ds) {
    calSelDate = ds;
    document.getElementById('book-modal-title').textContent = 'Reservar vuelo';
    let timeOpts = '';
    for (let h = 5; h <= 21; h++) {
      for (let m = 0; m < 60; m += 30) {
        const t = App.pad2(h) + ':' + App.pad2(m);
        timeOpts += '<option value="' + t + '">' + t + '</option>';
      }
    }
    document.getElementById('book-form').innerHTML =
      '<div class="fs"><label class="fl">Fecha</label><input type="date" id="bk-date" value="' + ds + '"></div>'
      + '<div class="fs"><label class="fl">Avion</label><div style="font-size:14px;font-weight:700;color:#1B2A4A">' + selPlane + '</div></div>'
      + '<div class="time-pick">'
      + '<div><label class="fl">Inicio</label><select id="bk-start">' + timeOpts + '</select></div>'
      + '<div class="sep">-</div>'
      + '<div><label class="fl">Fin</label><select id="bk-end">' + timeOpts + '</select></div>'
      + '</div>'
      + '<div class="fs"><label class="fl">Ruta</label><input type="text" id="bk-route" placeholder="AUR-MGPB" oninput="this.value=this.value.toUpperCase()"></div>'
      + '<div class="fs"><label class="fl">Pasajeros / Notas</label><input type="text" id="bk-notes" placeholder="opcional"></div>'
      + '<button class="btn" onclick="Calendar.submitBooking()">Solicitar vuelo</button>'
      + '<div class="hint" style="text-align:center;margin-top:8px">Fernando confirmara y asignara piloto</div>';
    document.getElementById('bk-start').value = '08:00';
    document.getElementById('bk-end').value = '10:00';
    document.getElementById('book-modal').style.display = 'flex';
  }

  function closeBooking() { document.getElementById('book-modal').style.display = 'none'; }

  async function submitBooking() {
    const date = document.getElementById('bk-date').value;
    const start = document.getElementById('bk-start').value;
    const end = document.getElementById('bk-end').value;
    const route = document.getElementById('bk-route').value.toUpperCase().trim();
    const notes = document.getElementById('bk-notes').value;

    if (!date || !start || !end) { alert('Selecciona fecha y horario'); return; }
    if (start >= end) { alert('La hora de fin debe ser mayor que el inicio'); return; }

    const existing = (DB.schedule || []).filter(function(s) { return s.date === date && s.plane_id === selPlane && s.status !== 'cancelled'; });
    const conflict = existing.find(function(s) { return start < s.end && end > s.start; });
    if (conflict) { alert('Conflicto con reserva de ' + conflict.booked_by + ' (' + conflict.start + '-' + conflict.end + ')'); return; }

    if (!DB.schedule) DB.schedule = [];
    if (!DB.meta) DB.meta = {};
    const id = (DB.meta.last_sched_id || 0) + 1;
    DB.meta.last_sched_id = id;

    DB.schedule.push({
      id: id, plane_id: selPlane, date: date, start: start, end: end,
      booked_by: App.currentUser(), pilot: null, pilot_roster_id: null,
      status: 'requested', flight_type: null, route: route, notes: notes
    });

    closeBooking();
    const ok = await API.saveData();
    if (ok) {
      buildCalendar();
      buildSchedPending();
      // Fire-and-forget notification
      API.notify('flight_requested', id);
    } else {
      alert('Error guardando reserva');
    }
  }

  // --- Confirmation modal ---
  function openConfirmModal(schedId) {
    const s = (DB.schedule || []).find(function(x) { return x.id === schedId; });
    if (!s) return;
    cfmFlightType = null;

    document.getElementById('book-modal-title').textContent = 'Confirmar vuelo';
    const activePilots = (DB.pilots || []).filter(function(p) { return p.active !== false; });
    let pilotOpts = '<option value="">-- Seleccionar piloto --</option>';
    activePilots.forEach(function(p) {
      pilotOpts += '<option value="' + p.id + '">' + p.name + (p.phone ? ' (' + p.phone + ')' : '') + '</option>';
    });

    const types = [
      { v: 'PERSONAL', icon: 'P', label: 'Personal', desc: 'Sin ingreso' },
      { v: 'STD', icon: 'S', label: 'Charter STD', desc: '$750/hr' },
      { v: 'FF', icon: 'FF', label: 'Charter FF', desc: '$650/hr' },
      { v: 'MANTE', icon: 'M', label: 'Mante', desc: 'Sin ingreso' }
    ];

    document.getElementById('book-form').innerHTML =
      '<div style="background:#F8F9FB;border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12px">'
      + '<div style="font-weight:700;margin-bottom:3px">' + (s.route || 'Sin ruta') + ' - ' + App.fmtDate(s.date) + '</div>'
      + '<div style="color:#8892A4;font-size:10px">' + s.start + ' - ' + s.end + ' - Solicitado por ' + App.getUser(s.booked_by).name + ' (' + s.booked_by + ')</div>'
      + (s.notes ? '<div style="color:#8892A4;font-size:10px;margin-top:2px">' + s.notes + '</div>' : '')
      + '</div>'
      + '<div class="fs"><label class="fl">Piloto asignado</label><select id="cfm-pilot">' + pilotOpts + '</select></div>'
      + '<div class="fs"><label class="fl">Tipo de vuelo</label>'
      + '<div class="confirm-type-grid" id="cfm-type-grid">'
      + types.map(function(t) { return '<div class="confirm-type-card" data-t="' + t.v + '" onclick="Calendar.cfmTipo(\'' + t.v + '\',this)"><div class="ti">' + t.icon + '</div><div class="tn">' + t.label + '</div><div class="td">' + t.desc + '</div></div>'; }).join('')
      + '</div>'
      + '</div>'
      + '<button class="btn gr" onclick="Calendar.submitConfirmation(' + schedId + ')">Confirmar vuelo</button>';
    document.getElementById('book-modal').style.display = 'flex';
  }

  function cfmTipo(v, el) {
    cfmFlightType = v;
    document.querySelectorAll('#cfm-type-grid .confirm-type-card').forEach(function(c) { c.classList.remove('on'); });
    el.classList.add('on');
  }

  async function submitConfirmation(schedId) {
    const s = (DB.schedule || []).find(function(x) { return x.id === schedId; });
    if (!s) return;
    const pilotId = parseInt(document.getElementById('cfm-pilot').value);
    if (!pilotId) { alert('Selecciona un piloto del roster'); return; }
    if (!cfmFlightType) { alert('Selecciona el tipo de vuelo'); return; }

    s.status = 'confirmed';
    s.pilot_roster_id = pilotId;
    s.flight_type = cfmFlightType;
    const rp = App.getPilot(pilotId);
    if (rp && rp.user_id) s.pilot = rp.user_id;

    closeBooking();
    cfmFlightType = null;
    const ok = await API.saveData();
    if (ok) {
      buildCalendar();
      buildSchedPending();
      // Fire-and-forget notification
      API.notify('flight_confirmed', schedId);
    } else {
      alert('Error confirmando vuelo');
    }
  }

  async function cancelSlot(id) {
    if (!confirm('Cancelar esta reserva?')) return;
    var s = DB.schedule.find(function(x) { return x.id === id; });
    if (s) {
      s.status = 'cancelled';
      var ok = await API.saveData();
      if (ok) {
        API.notify('flight_cancelled', id);
      }
      buildDayDetail(s.date);
      buildCalendar();
    }
  }

  function buildSchedPending() {
    const pends = (DB.schedule || []).filter(function(s) { return s.status === 'requested'; });
    const sec = document.getElementById('sched-pend-section');
    if (!App.canManageSchedule() || pends.length === 0) { if (sec) sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    sec.innerHTML = '<div class="pend-section"><div class="pend-hd"><span class="pend-ht">Reservas pendientes</span><span class="pend-count">' + pends.length + '</span></div>'
      + pends.map(function(s) { return '<div class="pend-item"><div><div class="pend-info"><b>' + (s.route || 'Sin ruta') + '</b> - ' + s.plane_id + ' - ' + s.start + '-' + s.end + '</div><div class="pend-meta">' + s.date + ' - ' + App.getUser(s.booked_by).name + '</div></div><div class="pend-actions"><button class="ver-btn" onclick="Calendar.openConfirmModal(' + s.id + ')">C</button><button class="rej-btn" onclick="Calendar.cancelSlot(' + s.id + ')">X</button></div></div>'; }).join('')
      + '</div>';
  }

  return {
    buildPlaneSelectors: buildPlaneSelectors,
    selectPlane: selectPlane,
    buildCalendar: buildCalendar,
    calNav: calNav,
    selectDay: selectDay,
    openBooking: openBooking,
    closeBooking: closeBooking,
    submitBooking: submitBooking,
    openConfirmModal: openConfirmModal,
    cfmTipo: cfmTipo,
    submitConfirmation: submitConfirmation,
    cancelSlot: cancelSlot,
    buildSchedPending: buildSchedPending
  };
})();
