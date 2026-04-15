// =====================================================================
// TG-SHI v6.0 — js/maintenance.js
// Maintenance expense tracking and cost allocation by tach-hour periods
// =====================================================================

const Maintenance = (() => {

  // --- Helpers ---
  const fQ = v => `Q${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fD = v => `$${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fAmt = (v, cur) => cur === 'USD' ? fD(v) : fQ(v);

  /**
   * Get all maintenance events sorted by tach ascending.
   * Each event: { id, date, description, vendor, amount, currency, tach, plane_id, notes }
   */
  function getEvents(planeId) {
    return (DB.maintenance || [])
      .filter(m => (!planeId || m.plane_id === planeId))
      .sort((a, b) => a.tach - b.tach);
  }

  /**
   * For a given maintenance event, compute each owner's proportional share
   * based on flight hours between the previous maintenance event's tach and this one's tach.
   *
   * Returns: { COCO: { hrs, pct, amount }, CUCO: {...}, SENSHI: {...}, totalHrs }
   */
  function allocateEvent(event, allEvents, flights) {
    const planeFlights = flights.filter(f => (!f.plane_id || f.plane_id === (event.plane_id || 'TG-SHI')));
    const sorted = allEvents.filter(e => e.plane_id === event.plane_id).sort((a, b) => a.tach - b.tach);
    const idx = sorted.findIndex(e => e.id === event.id);
    const prevTach = idx > 0 ? sorted[idx - 1].tach : 0;
    const curTach = event.tach;

    // Find flights in this tach window
    const windowFlights = planeFlights.filter(f => {
      if (!f.hi || !f.hf) return false;
      // Flight overlaps the window if its tach range intersects [prevTach, curTach]
      return f.hf > prevTach && f.hi < curTach;
    });

    const hrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
    windowFlights.forEach(f => {
      var r = f.r;
      if (hrs[r] === undefined) return;
      // FF flights: hours count as Charter/SENSHI for maintenance allocation
      if (f.t === 'FF' && r !== 'SENSHI') {
        r = 'SENSHI';
      }
      // Count full flight hours — no clamping. If a flight overlaps the window,
      // the entire flight belongs to this maintenance period (the shop tach may
      // not exactly match flight boundaries, but the flight was complete).
      const h = f.h || (f.hf - f.hi);
      hrs[r] += h;
    });

    const totalHrs = hrs.COCO + hrs.CUCO + hrs.SENSHI;
    const result = {};
    ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
      const pct = totalHrs > 0 ? hrs[owner] / totalHrs : 1 / 3;
      result[owner] = {
        hrs: hrs[owner],
        pct,
        amount: parseFloat((event.amount * pct).toFixed(2))
      };
    });
    result.totalHrs = totalHrs;
    result.prevTach = prevTach;
    result.curTach = curTach;
    return result;
  }

  /**
   * Compute full allocation table for all maintenance events.
   * Returns array of { event, allocation } objects.
   */
  function computeAll(planeId) {
    const events = getEvents(planeId || selPlane);
    const allEvents = DB.maintenance || [];
    return events.map(event => ({
      event,
      allocation: allocateEvent(event, allEvents, DB.flights)
    }));
  }

  // ===== UI: Maintenance Log Page =====

  function buildMaintenancePage() {
    const container = document.getElementById('maint-content');
    if (!container) return;

    const rows = computeAll(selPlane);

    if (rows.length === 0) {
      container.innerHTML = `<div class="card"><div class="empty"><div class="big">🔧</div>Sin registros de mantenimiento<br><br>${App.isAdmin() ? '<button class="btn sm" onclick="Maintenance.openAddMaint()">+ Agregar primer registro</button>' : 'El admin puede agregar registros.'}</div></div>`;
      return;
    }

    // Summary totals
    const totals = { COCO: { USD: 0, QTZ: 0 }, CUCO: { USD: 0, QTZ: 0 }, SENSHI: { USD: 0, QTZ: 0 } };
    rows.forEach(({ event, allocation }) => {
      ['COCO', 'CUCO', 'SENSHI'].forEach(o => {
        totals[o][event.currency || 'USD'] += allocation[o].amount;
      });
    });

    let h = '';

    // Totals card
    h += `<div class="card"><div class="ch"><div class="ct">Resumen mantenimiento — ${selPlane}</div></div><div class="cb">`;
    ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      const dc = owner === 'COCO' ? 'c1' : owner === 'CUCO' ? 'c2' : 'c3';
      h += `<div class="qr"><div class="ql">${label}</div><div class="qv ${dc}">`;
      if (totals[owner].USD > 0) h += `${fD(totals[owner].USD)}`;
      if (totals[owner].USD > 0 && totals[owner].QTZ > 0) h += ` + `;
      if (totals[owner].QTZ > 0) h += `${fQ(totals[owner].QTZ)}`;
      if (totals[owner].USD === 0 && totals[owner].QTZ === 0) h += '$0.00';
      h += `</div></div>`;
    });
    const grandUSD = totals.COCO.USD + totals.CUCO.USD + totals.SENSHI.USD;
    const grandQTZ = totals.COCO.QTZ + totals.CUCO.QTZ + totals.SENSHI.QTZ;
    h += `<div class="qr"><div class="ql"><b>Total</b></div><div class="qv"><b>`;
    if (grandUSD > 0) h += fD(grandUSD);
    if (grandUSD > 0 && grandQTZ > 0) h += ` + `;
    if (grandQTZ > 0) h += fQ(grandQTZ);
    h += `</b></div></div>`;
    h += `</div></div>`;

    // Event list
    h += `<div class="stitle">Eventos de mantenimiento</div>`;
    rows.reverse().forEach(({ event, allocation }) => {
      const cur = event.currency || 'USD';
      h += `<div class="card" style="margin-bottom:8px">
        <div class="ch"><div class="ct">${event.description || 'Mantenimiento'}${typeof Attachments !== 'undefined' ? Attachments.renderBadge(event.attachments) : ''}</div><div style="font-size:10px;color:#8892A4">${event.date}</div></div>
        <div class="cb">
          ${typeof Attachments !== 'undefined' ? Attachments.renderThumbs(event.attachments) : ''}
          <div class="bil-row"><div class="bil-lbl">Proveedor</div><div class="bil-val" style="font-weight:400">${event.vendor || '—'}</div></div>
          <div class="bil-row"><div class="bil-lbl">Monto total</div><div class="bil-val">${fAmt(event.amount, cur)}</div></div>
          <div class="bil-row"><div class="bil-lbl">TACH al servicio</div><div class="bil-val" style="font-weight:400">${event.tach.toFixed(1)}</div></div>
          <div class="bil-row"><div class="bil-lbl">Período TACH</div><div class="bil-val" style="font-weight:400">${allocation.prevTach.toFixed(1)} → ${allocation.curTach.toFixed(1)} (${allocation.totalHrs.toFixed(1)} hrs)</div></div>
          <div style="border-top:1px solid #E2E6EE;margin-top:4px;padding-top:6px">
            <div style="font-size:9px;font-weight:700;color:#8892A4;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Asignación proporcional</div>`;

      ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
        const a = allocation[owner];
        const label = owner === 'SENSHI' ? 'CHARTER' : owner;
        h += `<div class="bil-row"><div class="bil-lbl">${label} <span style="color:#8892A4;font-size:9px">(${a.hrs.toFixed(1)} hrs · ${(a.pct * 100).toFixed(0)}%)</span></div><div class="bil-val">${fAmt(a.amount, cur)}</div></div>`;
      });

      h += `</div>`;
      if (App.isAdmin()) {
        h += `<div style="display:flex;gap:5px;margin-top:6px">
          <button class="ubtn edit" onclick="Maintenance.openEditMaint(${event.id})">Editar</button>
          <button class="ubtn del" onclick="Maintenance.deleteMaint(${event.id})">Eliminar</button>
        </div>`;
      }
      h += `</div></div>`;
    });

    container.innerHTML = h;
  }

  // ===== Add / Edit maintenance event =====

  function openAddMaint() {
    const lastTach = Math.max(...DB.flights.map(f => f.hf || 0), 0);
    document.getElementById('edit-modal-title').textContent = 'Agregar mantenimiento';
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Fecha</label><input type="date" id="mt-date" value="${App.todayStr()}"></div>
      <div class="fs"><label class="fl">Descripción</label><input type="text" id="mt-desc" placeholder="ej. Inspección 100 hrs"></div>
      <div class="fs"><label class="fl">Proveedor</label><input type="text" id="mt-vendor" placeholder="ej. AEROSERVICIOS"></div>
      <div class="row2">
        <div class="fs"><label class="fl">Monto</label><input type="number" id="mt-amount" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        <div class="fs"><label class="fl">Moneda</label><select id="mt-currency"><option value="USD">USD ($)</option><option value="QTZ">QTZ (Q)</option></select></div>
      </div>
      <div class="fs"><label class="fl">TACH al servicio</label><input type="number" id="mt-tach" step="0.1" inputmode="decimal" value="${lastTach > 0 ? lastTach.toFixed(1) : ''}" placeholder="ej. 850.0"></div>
      <div class="fs"><label class="fl">Avión</label><div style="font-size:14px;font-weight:700;color:#1B2A4A">${selPlane}</div></div>
      <div class="fs"><label class="fl">Notas</label><input type="text" id="mt-notes" placeholder="opcional"></div>
      <div id="mt-att-section"></div>
      <button class="btn" onclick="Maintenance.saveMaint()">Guardar</button>`;
    document.getElementById('edit-modal').style.display = 'flex';
    if (typeof Attachments !== 'undefined') {
      Attachments.renderEditSection('mt-att-section', [], 'mt_att');
    }
  }

  async function saveMaint() {
    const date = document.getElementById('mt-date').value;
    const desc = document.getElementById('mt-desc').value.trim();
    const vendor = document.getElementById('mt-vendor').value.trim();
    const amount = parseFloat(document.getElementById('mt-amount').value);
    const currency = document.getElementById('mt-currency').value;
    const tach = parseFloat(document.getElementById('mt-tach').value);
    const notes = document.getElementById('mt-notes').value.trim();

    if (!date || !desc || isNaN(amount) || amount <= 0 || isNaN(tach) || tach <= 0) {
      alert('Completa fecha, descripción, monto y TACH'); return;
    }

    if (!DB.maintenance) DB.maintenance = [];
    if (!DB.meta) DB.meta = {};
    const id = (DB.meta.last_maint_id || 0) + 1;
    DB.meta.last_maint_id = id;

    DB.maintenance.push({
      id, date, description: desc, vendor, amount, currency, tach,
      plane_id: selPlane, notes,
      logged_by: App.currentUser(), logged_at: new Date().toISOString(),
      attachments: (typeof Attachments !== 'undefined' && Attachments.getEditAttachments('mt_att').length > 0) ? Attachments.getEditAttachments('mt_att').slice() : undefined
    });

    Admin.closeEdit();
    const ok = await API.saveData();
    if (ok) { buildMaintenancePage(); alert('✓ Mantenimiento registrado'); }
    else { alert('Error guardando'); }
  }

  function openEditMaint(id) {
    const m = (DB.maintenance || []).find(x => x.id === id);
    if (!m) return;
    document.getElementById('edit-modal-title').textContent = 'Editar mantenimiento #' + id;
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Fecha</label><input type="date" id="mt-date" value="${m.date}"></div>
      <div class="fs"><label class="fl">Descripción</label><input type="text" id="mt-desc" value="${m.description || ''}"></div>
      <div class="fs"><label class="fl">Proveedor</label><input type="text" id="mt-vendor" value="${m.vendor || ''}"></div>
      <div class="row2">
        <div class="fs"><label class="fl">Monto</label><input type="number" id="mt-amount" step="0.01" inputmode="decimal" value="${m.amount}"></div>
        <div class="fs"><label class="fl">Moneda</label><select id="mt-currency"><option value="USD" ${m.currency === 'USD' ? 'selected' : ''}>USD ($)</option><option value="QTZ" ${m.currency === 'QTZ' ? 'selected' : ''}>QTZ (Q)</option></select></div>
      </div>
      <div class="fs"><label class="fl">TACH al servicio</label><input type="number" id="mt-tach" step="0.1" inputmode="decimal" value="${m.tach}"></div>
      <div class="fs"><label class="fl">Notas</label><input type="text" id="mt-notes" value="${m.notes || ''}"></div>
      <div id="mt-att-section"></div>
      <div style="display:flex;gap:8px;margin-top:3px">
        <button class="btn" onclick="Maintenance.updateMaint(${id})">Guardar</button>
        <button class="btn" style="background:#8B1A1A" onclick="Maintenance.deleteMaint(${id})">Eliminar</button>
      </div>`;
    document.getElementById('edit-modal').style.display = 'flex';
    if (typeof Attachments !== 'undefined') {
      Attachments.renderEditSection('mt-att-section', m.attachments || [], 'mt_att');
    }
  }

  async function updateMaint(id) {
    const m = (DB.maintenance || []).find(x => x.id === id);
    if (!m) return;
    API.logAction('edit', 'maintenance', id, m.description + ' ' + m.date + ' TACH ' + m.tach);
    m.date = document.getElementById('mt-date').value;
    m.description = document.getElementById('mt-desc').value.trim();
    m.vendor = document.getElementById('mt-vendor').value.trim();
    m.amount = parseFloat(document.getElementById('mt-amount').value);
    m.currency = document.getElementById('mt-currency').value;
    m.tach = parseFloat(document.getElementById('mt-tach').value);
    m.notes = document.getElementById('mt-notes').value.trim();
    m.attachments = (typeof Attachments !== 'undefined' && Attachments.getEditAttachments('mt_att').length > 0) ? Attachments.getEditAttachments('mt_att').slice() : undefined;

    Admin.closeEdit();
    const ok = await API.saveData();
    if (ok) buildMaintenancePage();
    else alert('Error guardando');
  }

  async function deleteMaint(id) {
    if (!confirm('¿Eliminar este registro de mantenimiento?')) return;
    var m = (DB.maintenance || []).find(x => x.id === id);
    API.logAction('delete', 'maintenance', id, m ? (m.description + ' ' + m.date + ' ' + m.currency + m.amount) : '');
    DB.maintenance = (DB.maintenance || []).filter(x => x.id !== id);
    Admin.closeEdit();
    const ok = await API.saveData();
    if (ok) buildMaintenancePage();
    else alert('Error eliminando');
  }

  // ===== Billing integration =====

  /**
   * Compute maintenance costs per owner for a billing period.
   * Includes all maintenance events whose date falls within the period.
   * Returns: { COCO: { USD: n, QTZ: n }, CUCO: {...}, SENSHI: {...}, events: [...] }
   */
  function billingForPeriod(fromYM, toYM, planeId) {
    // Clamp to 2026-01 — pre-2026 maintenance is considered settled
    var effectiveFrom = fromYM < '2026-01' ? '2026-01' : fromYM;
    const fd = effectiveFrom + '-01';
    const td = toYM + '-31';

    // Find the tach at the start of 2026 flying — any maintenance with tach
    // window entirely below this is pre-2026 and considered settled
    const flights2026 = DB.flights.filter(f => f.d >= '2026-01-01' && f.hi);
    const minTach2026 = flights2026.length > 0 ? Math.min(...flights2026.map(f => f.hi)) : 0;

    const events = (DB.maintenance || [])
      .filter(m => m.date >= fd && m.date <= td && (!planeId || m.plane_id === planeId) && m.tach >= minTach2026)
      .sort((a, b) => a.tach - b.tach);

    const result = {
      COCO: { USD: 0, QTZ: 0 },
      CUCO: { USD: 0, QTZ: 0 },
      SENSHI: { USD: 0, QTZ: 0 },
      events: []
    };

    const allEvents = DB.maintenance || [];
    events.forEach(event => {
      const allocation = allocateEvent(event, allEvents, DB.flights);
      const cur = event.currency || 'USD';
      ['COCO', 'CUCO', 'SENSHI'].forEach(o => {
        result[o][cur] += allocation[o].amount;
      });
      result.events.push({ event, allocation });
    });

    return result;
  }

  /**
   * Build Section D HTML for billing report.
   */
  function buildBillingSectionD(from, to) {
    const maint = billingForPeriod(from, to);

    if (maint.events.length === 0) {
      return `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">D — Mantenimiento (costos reales asignados por TACH)</div></div><div class="bil-bd">
        <div class="empty" style="padding:14px">Sin eventos de mantenimiento en este período</div>
      </div></div>`;
    }

    let h = `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">D — Mantenimiento (costos reales asignados por TACH)</div></div><div class="bil-bd">`;

    // Event-by-event breakdown
    maint.events.forEach(({ event, allocation }) => {
      const cur = event.currency || 'USD';
      h += `<div style="border-bottom:1px solid #E2E6EE;padding:6px 0">
        <div class="bil-row"><div class="bil-lbl" style="font-weight:600;font-size:10px">${event.description} <span style="color:#8892A4;font-size:9px">(${event.date} · TACH ${event.tach.toFixed(1)})</span></div><div class="bil-val">${fAmt(event.amount, cur)}</div></div>
        <div class="bil-row" style="border:none;padding:2px 0"><div class="bil-lbl" style="font-size:9px;color:#8892A4">Período: TACH ${allocation.prevTach.toFixed(1)} → ${allocation.curTach.toFixed(1)} (${allocation.totalHrs.toFixed(1)} hrs) · ${event.vendor || '—'}</div></div>`;

      ['COCO', 'CUCO', 'SENSHI'].forEach(o => {
        const label = o === 'SENSHI' ? 'Charter' : o;
        const a = allocation[o];
        h += `<div class="bil-row" style="border:none;padding:2px 0"><div class="bil-lbl" style="padding-left:12px;font-size:10px">↳ ${label} (${(a.pct * 100).toFixed(0)}%)</div><div class="bil-val" style="font-size:11px">${fAmt(a.amount, cur)}</div></div>`;
      });
      h += `</div>`;
    });

    // Totals
    h += `<div style="border-top:2px solid #E2E6EE;margin-top:4px;padding-top:6px">`;
    ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      let ownerStr = '';
      if (maint[owner].USD > 0) ownerStr += fD(maint[owner].USD);
      if (maint[owner].USD > 0 && maint[owner].QTZ > 0) ownerStr += ' + ';
      if (maint[owner].QTZ > 0) ownerStr += fQ(maint[owner].QTZ);
      if (!ownerStr) ownerStr = '$0.00';
      h += `<div class="bil-row"><div class="bil-lbl"><b>${label} total mante</b></div><div class="bil-val"><b>${ownerStr}</b></div></div>`;
    });
    h += `</div></div></div>`;

    return h;
  }

  /**
   * Build maintenance invoice lines for a specific owner.
   * Returns: { usdLines: [...], qtzLines: [...] }
   */
  function invoiceLinesForOwner(from, to, owner) {
    const maint = billingForPeriod(from, to);
    const usdLines = [];
    const qtzLines = [];

    maint.events.forEach(({ event, allocation }) => {
      const a = allocation[owner];
      const cur = event.currency || 'USD';
      const line = {
        desc: `Mante: ${event.description} (TACH ${event.tach.toFixed(1)} · ${(a.pct * 100).toFixed(0)}% de ${fAmt(event.amount, cur)})`,
        amt: a.amount
      };
      if (cur === 'USD') usdLines.push(line);
      else qtzLines.push(line);
    });

    return { usdLines, qtzLines, totals: maint[owner] };
  }

  return {
    getEvents, allocateEvent, computeAll,
    buildMaintenancePage,
    openAddMaint, saveMaint, openEditMaint, updateMaint, deleteMaint,
    billingForPeriod, buildBillingSectionD, invoiceLinesForOwner
  };
})();
