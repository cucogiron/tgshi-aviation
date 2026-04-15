// =====================================================================
// TG-SHI v6.0 — js/billing.js
// Billing calculations (sections A–F) + downloadable invoices
// Currency: Fuel = QTZ, Fernando/Pilotaje = USD, Reserva = USD (Senshi fund)
// Three owners: COCO, CUCO, SENSHI (Charter)
// Payment flow: COCO/CUCO pay Senshi → Senshi pays Fernando
// =====================================================================

const Billing = (() => {

  let lastBilData = null;

  function initBil() {
    try {
      const n = new Date(), y = n.getFullYear(), m = n.getMonth() + 1;
      const pr = m === 1 ? `${y - 1}-12` : `${y}-${App.pad2(m - 1)}`;
      const ef = document.getElementById('b-from');
      const et = document.getElementById('b-to');
      // Only set defaults if empty — don't overwrite user's selection
      if (ef && !ef.value) ef.value = pr;
      if (et && !et.value) et.value = pr;
    } catch (e) { console.error('initBil error:', e); }
  }

  function calcBil() {
    try {
    const from = document.getElementById('b-from').value;
    const to = document.getElementById('b-to').value;
    const tc = parseFloat(document.getElementById('b-tc').value) || 7.65;
    if (!from || !to) { document.getElementById('bil-out').innerHTML = '<div class="empty">Ingresa período (YYYY-MM)</div>'; return; }
    const fd = from + '-01', td = to + '-31';
    const fls = DB.flights.filter(f => f.d >= fd && f.d <= td && (f.verified !== false || (f.t !== 'STD' && f.t !== 'FF')));
    const fus = DB.fuel.filter(f => f.d >= fd && f.d <= td);
    const rt = App.getRateFD(fd);

    // --- Hours, sub-hour, espera, charter revenue ---
    const hrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const sub = { COCO: { n: 0, a: 0 }, CUCO: { n: 0, a: 0 }, SENSHI: { n: 0, a: 0 } };
    const esp = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const espHrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
    let charterRev = 0;
    // FF revenue charged to the responsible owner (they owe Senshi this amount)
    const ffRevenue = { COCO: 0, CUCO: 0, SENSHI: 0 };

    // Helper: for FF flights, determine who arranged it (owes Senshi the revenue)
    // Check f.r first, then f.u as fallback for legacy data
    function ffResponsible(f) {
      if (f.r && f.r !== 'SENSHI' && (f.r === 'COCO' || f.r === 'CUCO')) return f.r;
      if (f.u && f.u !== 'SENSHI' && (f.u === 'COCO' || f.u === 'CUCO')) return f.u;
      // Check if f.u contains an owner name as substring (e.g. "ALQ CUCO FF")
      if (f.u) {
        if (f.u.toUpperCase().indexOf('COCO') >= 0) return 'COCO';
        if (f.u.toUpperCase().indexOf('CUCO') >= 0) return 'CUCO';
      }
      return null;
    }

    fls.forEach(f => {
      const r = f.r; if (hrs[r] === undefined) return;
      // FF flights: costs go to SENSHI, revenue charged to responsible owner
      const ffOwner = (f.t === 'FF') ? ffResponsible(f) : null;
      const costOwner = (f.t === 'FF' && ffOwner) ? 'SENSHI' : r;
      hrs[costOwner] += f.h;
      if (f.h > 0 && f.h < 1) { sub[costOwner].n++; sub[costOwner].a += f.h; }
      espHrs[costOwner] += (f.eh || 0);
      esp[costOwner] += (f.eh || 0) * rt.gw;
      if ((f.rv || 0) > 0) {
        if (f.t === 'FF' && ffOwner) {
          ffRevenue[ffOwner] += f.rv;
        }
        charterRev += f.rv;
      }
    });

    // --- Fuel (QTZ) ---
    let tfuel = 0;
    const antic = { COCO: 0, CUCO: 0, SENSHI: 0 };
    fus.forEach(f => {
      tfuel += f.m;
      if (f.ac) antic.COCO += f.ac;
      if (f.au) antic.CUCO += f.au;
      if (f.as) antic.SENSHI += f.as;
    });

    const th = hrs.COCO + hrs.CUCO + hrs.SENSHI;
    const qph = th > 0 ? tfuel / th : 0;
    const fuelProp = { COCO: hrs.COCO * qph, CUCO: hrs.CUCO * qph, SENSHI: hrs.SENSHI * qph };
    const fuelNet = { COCO: fuelProp.COCO - antic.COCO, CUCO: fuelProp.CUCO - antic.CUCO, SENSHI: fuelProp.SENSHI - antic.SENSHI };

    // --- Fernando (USD) ---
    const bilH = r => hrs[r] - sub[r].a + sub[r].n;
    const pilFee = r => bilH(r) * rt.pilot;
    const ruAmt = r => (sub[r].n - sub[r].a) * rt.pilot;

    // --- Reserva mantenimiento (USD — fondo Senshi, NO va a Fernando) ---
    const resv = r => hrs[r] * rt.res;

    const fromParts = from.split('-'), toParts = to.split('-');
    const numMonths = (+toParts[0] - +fromParts[0]) * 12 + (+toParts[1] - +fromParts[1]) + 1;
    const adminFee = rt.admin * numMonths;

    // Fernando total = pilotaje + espera + admin — reserva NOT included
    const totFer = pilFee('COCO') + pilFee('CUCO') + pilFee('SENSHI')
                 + esp.COCO + esp.CUCO + esp.SENSHI + adminFee;

    const fQ = v => `Q${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fD = v => `$${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const sg = v => v < 0 ? 'neg' : '';
    const periodLbl = from === to ? from : `${from} → ${to}`;

    // --- Maintenance data (compute before cache) ---
    const maintData = (typeof Maintenance !== 'undefined') ? Maintenance.billingForPeriod(from, to) : null;
    const maintUSD = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const maintQTZ = { COCO: 0, CUCO: 0, SENSHI: 0 };
    if (maintData) {
      ['COCO', 'CUCO', 'SENSHI'].forEach(o => {
        maintUSD[o] = maintData[o].USD;
        maintQTZ[o] = maintData[o].QTZ;
      });
    }

    // --- Flight expenses data (compute before cache) ---
    const fexpData = (typeof FlightExpenses !== 'undefined') ? FlightExpenses.billingForPeriod(from, to) : null;
    const fexpUSD = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const fexpQTZ = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const fexpCreditUSD = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const fexpCreditQTZ = { COCO: 0, CUCO: 0, SENSHI: 0 };
    if (fexpData) {
      ['COCO', 'CUCO', 'SENSHI'].forEach(o => {
        fexpUSD[o] = fexpData[o].USD;
        fexpQTZ[o] = fexpData[o].QTZ;
        if (fexpData.payer_credits && fexpData.payer_credits[o]) {
          fexpCreditUSD[o] = fexpData.payer_credits[o].USD || 0;
          fexpCreditQTZ[o] = fexpData.payer_credits[o].QTZ || 0;
        }
      });
    }

    // --- Cache ---
    lastBilData = {
      from, to, tc, periodLbl, rt, numMonths,
      hrs, sub, esp, espHrs, charterRev, ffRevenue,
      tfuel, antic, th, qph, fuelProp, fuelNet,
      bilH: { COCO: bilH('COCO'), CUCO: bilH('CUCO'), SENSHI: bilH('SENSHI') },
      pilFee: { COCO: pilFee('COCO'), CUCO: pilFee('CUCO'), SENSHI: pilFee('SENSHI') },
      ruAmt: { COCO: ruAmt('COCO'), CUCO: ruAmt('CUCO'), SENSHI: ruAmt('SENSHI') },
      resv: { COCO: resv('COCO'), CUCO: resv('CUCO'), SENSHI: resv('SENSHI') },
      adminFee, totFer, fQ, fD,
      maintData, maintUSD, maintQTZ,
      fexpData, fexpUSD, fexpQTZ
    };

    // ========== BUILD REPORT ==========

    const isPilotView = App.isPilotAdmin() && !App.isAdmin();

    let h = `<div class="stitle">Período: ${periodLbl} · TC Q${tc}/USD · Piloto: $${rt.pilot}/hr · Admin: $${rt.admin}/mes</div>`;

    if (isPilotView) {
      // ── PILOT VIEW: only show what Senshi owes Fernando ──
      h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">Pago a Fernando (USD)</div></div><div class="bil-bd">`;

      ['COCO', 'CUCO', 'SENSHI'].forEach((owner, idx) => {
        const label = owner === 'SENSHI' ? 'CHARTER' : owner;
        const ru = ruAmt(owner);
        const border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:4px' : '';
        h += `<div class="bil-row" style="${border}"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">${label}</div><div class="bil-val" style="font-size:9px;color:#8892A4">${bilH(owner).toFixed(1)} hrs fact.</div></div>
          <div class="bil-row"><div class="bil-lbl">↳ Pilotaje</div><div class="bil-val">${fD(pilFee(owner))}</div></div>`;
        if (ru > 0) {
          h += `<div class="bil-row"><div class="bil-lbl" style="color:#8B1A1A">↳ Roundup (${sub[owner].n} vuelo(s) &lt;1hr)</div><div class="bil-val pos">incl. +${fD(ru)}</div></div>`;
        }
        if (espHrs[owner] > 0) {
          h += `<div class="bil-row"><div class="bil-lbl">↳ Espera en tierra (${espHrs[owner].toFixed(1)}hr × $${rt.gw})</div><div class="bil-val">${fD(esp[owner])}</div></div>`;
        }
      });

      h += `<div class="bil-row" style="border-top:2px solid #E2E6EE;margin-top:4px"><div class="bil-lbl">Admin fee (${numMonths} mes${numMonths > 1 ? 'es' : ''})</div><div class="bil-val">${fD(adminFee)}</div></div>
        <div class="bil-row"><div class="bil-lbl"><b>TOTAL A COBRAR</b></div><div class="bil-val"><b>${fD(totFer)}</b></div></div>
      </div></div>`;

      // Download only the Senshi→Fernando invoice
      h += `<div style="margin-top:10px">
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('SENSHI')">📄 Descargar factura</button>
      </div>`;

      document.getElementById('bil-out').innerHTML = h;
      return;
    }

    // ========== FULL ADMIN/OWNER VIEW ==========

    // ── A — HORAS ──
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">A — Horas</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl">COCO</div><div class="bil-val">${hrs.COCO.toFixed(1)} hrs</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO</div><div class="bil-val">${hrs.CUCO.toFixed(1)} hrs</div></div>
      <div class="bil-row"><div class="bil-lbl">Charter</div><div class="bil-val">${hrs.SENSHI.toFixed(1)} hrs</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>Total</b></div><div class="bil-val"><b>${th.toFixed(1)} hrs</b></div></div>
    </div></div>`;

    // ── B — COMBUSTIBLE (QTZ) ──
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">B — Combustible (QTZ)</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl">Total combustible</div><div class="bil-val">${fQ(tfuel)}</div></div>
      <div class="bil-row"><div class="bil-lbl">QTZ/hr promedio</div><div class="bil-val">${fQ(qph)}</div></div>`;

    ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      h += `<div class="bil-row" style="border-top:1px solid #E2E6EE;margin-top:4px"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">${label}</div><div class="bil-val" style="font-size:9px;color:#8892A4">${hrs[owner].toFixed(1)} hrs</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Proporcional</div><div class="bil-val">${fQ(fuelProp[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Anticipo pagado</div><div class="bil-val">${fQ(antic[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl"><b>↳ Neto a cobrar</b></div><div class="bil-val ${sg(fuelNet[owner])}"><b>${fuelNet[owner] < 0 ? '(' + fQ(fuelNet[owner]) + ')' : fQ(fuelNet[owner])}</b></div></div>`;
    });
    h += `</div></div>`;

    // ── C — PILOTAJE FERNANDO (USD) — what Senshi pays Fernando ──
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">C — Pilotaje Fernando (USD · $${rt.pilot}/hr · Espera $${rt.gw}/hr)</div></div><div class="bil-bd">`;

    ['COCO', 'CUCO', 'SENSHI'].forEach((owner, idx) => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      const ru = ruAmt(owner);
      const border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:4px' : '';
      h += `<div class="bil-row" style="${border}"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">${label}</div><div class="bil-val" style="font-size:9px;color:#8892A4">${bilH(owner).toFixed(1)} hrs fact.</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Pilotaje</div><div class="bil-val">${fD(pilFee(owner))}</div></div>`;
      if (ru > 0) {
        h += `<div class="bil-row"><div class="bil-lbl" style="color:#8B1A1A">↳ Roundup (${sub[owner].n} vuelo(s) &lt;1hr)</div><div class="bil-val pos">incl. +${fD(ru)}</div></div>`;
      }
      if (espHrs[owner] > 0) {
        h += `<div class="bil-row"><div class="bil-lbl">↳ Espera en tierra (${espHrs[owner].toFixed(1)}hr × $${rt.gw})</div><div class="bil-val">${fD(esp[owner])}</div></div>`;
      }
    });

    h += `<div class="bil-row" style="border-top:2px solid #E2E6EE;margin-top:4px"><div class="bil-lbl">Admin fee Fernando (${numMonths} mes${numMonths > 1 ? 'es' : ''}) — 100% Senshi</div><div class="bil-val">${fD(adminFee)}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>TOTAL A PAGAR FERNANDO</b></div><div class="bil-val"><b>${fD(totFer)}</b></div></div>
    </div></div>`;

    // ── D — MANTENIMIENTO (costos reales asignados por TACH) ──
    if (typeof Maintenance !== 'undefined') {
      h += Maintenance.buildBillingSectionD(from, to);
    } else {
      // Fallback: old flat reserva
      const totRes = resv('COCO') + resv('CUCO') + resv('SENSHI');
      h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">D — Reserva Mantenimiento (USD · $${rt.res}/hr · Fondo Senshi)</div></div><div class="bil-bd">
        <div class="bil-row"><div class="bil-lbl">COCO</div><div class="bil-val">${fD(resv('COCO'))}</div></div>
        <div class="bil-row"><div class="bil-lbl">CUCO</div><div class="bil-val">${fD(resv('CUCO'))}</div></div>
        <div class="bil-row"><div class="bil-lbl">Charter</div><div class="bil-val">${fD(resv('SENSHI'))}</div></div>
        <div class="bil-row"><div class="bil-lbl"><b>Total reserva (fondo Senshi)</b></div><div class="bil-val"><b>${fD(totRes)}</b></div></div>
      </div></div>`;
    }

    // ── E — GASTOS DE VUELO ──
    if (typeof FlightExpenses !== 'undefined') {
      h += FlightExpenses.buildBillingSectionE(from, to);
    }

    // ── F — RESUMEN POR SOCIO ──
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">F — Resumen por socio</div></div><div class="bil-bd">`;

    ['COCO', 'CUCO', 'SENSHI'].forEach((owner, idx) => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      const border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:6px;padding-top:6px' : '';
      const ownerFerUSD = pilFee(owner) + esp[owner];
      const ownerAdminUSD = owner === 'SENSHI' ? adminFee : 0;
      // Flight expenses
      const ownerFexpUSD = fexpData ? fexpUSD[owner] : 0;
      const ownerFexpQTZ = fexpData ? fexpQTZ[owner] : 0;
      // Payer credits (out of pocket for other owners' flights)
      const ownerCredUSD = fexpData ? fexpCreditUSD[owner] : 0;
      const ownerCredQTZ = fexpData ? fexpCreditQTZ[owner] : 0;
      // FF revenue — owner owes Senshi this amount for FF flights they arranged
      const ownerFFRev = ffRevenue[owner] || 0;
      // Fernando portion (what goes to Fernando via Senshi)
      const ferTotal = ownerFerUSD + ownerAdminUSD;
      // Total USD owed to Senshi = Fernando portion + expenses - credits + FF revenue
      // NOTE: Maintenance tracked separately — not included in owner balances
      const totalUSD = ferTotal + ownerFexpUSD - ownerCredUSD + ownerFFRev;
      const totalQTZ = fuelNet[owner] + ownerFexpQTZ - ownerCredQTZ;

      h += `<div class="bil-row" style="${border}"><div class="bil-lbl" style="font-weight:700;font-size:11px">${label}</div><div class="bil-val"></div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Combustible neto (QTZ)</div><div class="bil-val ${sg(fuelNet[owner])}">${fuelNet[owner] < 0 ? '(' + fQ(fuelNet[owner]) + ')' : fQ(fuelNet[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Pilotaje + espera (USD)</div><div class="bil-val">${fD(ownerFerUSD)}</div></div>
        ${ownerAdminUSD > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Admin fee (USD, 100% Charter)</div><div class="bil-val">${fD(ownerAdminUSD)}</div></div>` : ''}
        ${ownerFexpUSD > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Gastos de vuelo (USD)</div><div class="bil-val">${fD(ownerFexpUSD)}</div></div>` : ''}
        ${ownerFexpQTZ > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Gastos de vuelo (QTZ)</div><div class="bil-val">${fQ(ownerFexpQTZ)}</div></div>` : ''}
        ${ownerCredUSD > 0 ? `<div class="bil-row"><div class="bil-lbl" style="color:#1A6B3A">↳ Credito gastos pagados de bolsillo (USD)</div><div class="bil-val neg">(${fD(ownerCredUSD)})</div></div>` : ''}
        ${ownerCredQTZ > 0 ? `<div class="bil-row"><div class="bil-lbl" style="color:#1A6B3A">↳ Credito gastos pagados de bolsillo (QTZ)</div><div class="bil-val neg">(${fQ(ownerCredQTZ)})</div></div>` : ''}
        ${ownerFFRev > 0 ? `<div class="bil-row"><div class="bil-lbl" style="color:#B8600A">↳ Ingreso FF por cobrar (USD)</div><div class="bil-val" style="color:#B8600A">${fD(ownerFFRev)}</div></div>` : ''}
        <div class="bil-row"><div class="bil-lbl"><b>↳ Total USD</b></div><div class="bil-val"><b>${fD(totalUSD)}</b></div></div>
        <div class="bil-row"><div class="bil-lbl"><b>↳ Total QTZ</b></div><div class="bil-val ${sg(totalQTZ)}"><b>${totalQTZ < 0 ? '(' + fQ(totalQTZ) + ')' : fQ(totalQTZ)}</b></div></div>`;
    });
    h += `</div></div>`;

    // ── G — QuickBooks Summary ──
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">G — QuickBooks Summary</div></div><div class="bil-bd">`;

    const totMaintUSD = maintUSD.COCO + maintUSD.CUCO + maintUSD.SENSHI;
    const totMaintQTZ = maintQTZ.COCO + maintQTZ.CUCO + maintQTZ.SENSHI;
    const totFexpUSD = fexpUSD.COCO + fexpUSD.CUCO + fexpUSD.SENSHI;
    const totFexpQTZ = fexpQTZ.COCO + fexpQTZ.CUCO + fexpQTZ.SENSHI;

    ['COCO', 'CUCO', 'SENSHI'].forEach((owner, idx) => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      const border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:4px;padding-top:4px' : '';
      const ownerMUSD = maintData ? maintUSD[owner] : resv(owner);
      const ownerMQTZ = maintData ? maintQTZ[owner] : 0;
      const maintLbl = maintData ? 'Mante real' : 'Reserva mante';
      const ownerFxUSD = fexpData ? fexpUSD[owner] : 0;
      const ownerFxQTZ = fexpData ? fexpQTZ[owner] : 0;
      h += `<div class="bil-row" style="${border}"><div class="bil-lbl" style="font-weight:700;font-size:10px">${label}</div><div class="bil-val"></div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Combustible neto (QTZ)</div><div class="bil-val ${sg(fuelNet[owner])}">${fuelNet[owner] < 0 ? '(' + fQ(fuelNet[owner]) + ')' : fQ(fuelNet[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Pilotaje${esp[owner] > 0 ? ' + espera' : ''} (USD)</div><div class="bil-val">${fD(pilFee(owner) + esp[owner])}</div></div>
        ${ownerMUSD > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ ${maintLbl} (USD)</div><div class="bil-val">${fD(ownerMUSD)}</div></div>` : ''}
        ${ownerMQTZ > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ ${maintLbl} (QTZ)</div><div class="bil-val">${fQ(ownerMQTZ)}</div></div>` : ''}
        ${ownerFxUSD > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Gastos vuelo (USD)</div><div class="bil-val">${fD(ownerFxUSD)}</div></div>` : ''}
        ${ownerFxQTZ > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Gastos vuelo (QTZ)</div><div class="bil-val">${fQ(ownerFxQTZ)}</div></div>` : ''}`;
    });

    h += `<div class="bil-row" style="border-top:1px solid #E2E6EE;margin-top:4px"><div class="bil-lbl">Admin fee Fernando (USD, 100% Senshi)</div><div class="bil-val">${fD(adminFee)}</div></div>`;
    if (charterRev > 0) {
      h += `<div class="bil-row"><div class="bil-lbl">Charter — Ingreso bruto (USD)</div><div class="bil-val">${fD(charterRev)}</div></div>`;
    }
    h += `<div class="bil-row"><div class="bil-lbl"><b>Total Fernando (USD)</b></div><div class="bil-val"><b>${fD(totFer)}</b></div></div>
      <div class="bil-row"><div class="bil-lbl"><b>Total Mantenimiento (USD)</b></div><div class="bil-val"><b>${fD(maintData ? totMaintUSD : resv('COCO') + resv('CUCO') + resv('SENSHI'))}</b></div></div>
      ${(maintData && totMaintQTZ > 0) ? `<div class="bil-row"><div class="bil-lbl"><b>Total Mantenimiento (QTZ)</b></div><div class="bil-val"><b>${fQ(totMaintQTZ)}</b></div></div>` : ''}
      ${totFexpUSD > 0 ? `<div class="bil-row"><div class="bil-lbl"><b>Total Gastos Vuelo (USD)</b></div><div class="bil-val"><b>${fD(totFexpUSD)}</b></div></div>` : ''}
      ${totFexpQTZ > 0 ? `<div class="bil-row"><div class="bil-lbl"><b>Total Gastos Vuelo (QTZ)</b></div><div class="bil-val"><b>${fQ(totFexpQTZ)}</b></div></div>` : ''}
    </div></div>`;

    // QB notes
    const notes = [];
    ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
      const label = owner === 'SENSHI' ? 'Charter' : owner;
      const ru = ruAmt(owner);
      if (ru > 0) notes.push(`${label}: Roundup ${fD(ru)} (${sub[owner].n} vuelo(s) &lt;1hr → 1hr) incluido en pilotaje`);
    });
    if (notes.length) h += `<div class="qb-note">📋 Nota QB:<br>${notes.join('<br>')}</div>`;

    // ── H — SALDOS PENDIENTES ──
    if (typeof Payments !== 'undefined') {
      h += Payments.buildBillingSectionH(from, to);
    }

    // ── Download buttons — 3 invoices ──
    h += `<div class="stitle" style="margin-top:14px">Descargar facturas</div>
      <div style="display:grid;grid-template-columns:1fr;gap:7px;margin-bottom:10px">
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('COCO')">📄 COCO — lo que COCO debe a Senshi</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('CUCO')">📄 CUCO — lo que CUCO debe a Senshi</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('SENSHI')">📄 Senshi — lo que Senshi paga a Fernando</button>
      </div>`;

    document.getElementById('bil-out').innerHTML = h;
    } catch (e) { console.error('calcBil error:', e); document.getElementById('bil-out').innerHTML = '<div class="empty">Error: ' + e.message + '</div>'; }
  }

  // --- Invoice generation ---
  // COCO/CUCO: what they owe Senshi (fuel QTZ + pilotaje/espera/reserva USD)
  // SENSHI: what Senshi pays Fernando (all 3 pilotaje + espera + admin USD) + Senshi fuel QTZ
  //         Reserva NOT included in Senshi→Fernando invoice (it stays in the Senshi fund)
  function downloadInvoice(owner) {
    if (!lastBilData) { alert('Calcula el billing primero'); return; }
    const d = lastBilData;
    const fQ = v => `Q${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fD = v => `$${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fQs = v => v < 0 ? `-${fQ(v)}` : fQ(v);
    const fDs = v => v < 0 ? `-${fD(v)}` : fD(v);

    let qtzLines = [];
    let usdLines = [];

    if (owner === 'SENSHI') {
      // ── SENSHI→Fernando: pilotaje + espera + admin for ALL owners ──
      // No fuel — fuel is paid via corporate card, not to Fernando

      // USD: all owners' pilotaje + espera, then admin (NO reserva)
      ['COCO', 'CUCO', 'SENSHI'].forEach(o => {
        const oLabel = o === 'SENSHI' ? 'Charter' : o;
        const ruNote = d.ruAmt[o] > 0 ? ` (incl. roundup ${fD(d.ruAmt[o])} por ${d.sub[o].n} vuelo(s) <1hr)` : '';
        usdLines.push({ desc: `Pilotaje ${oLabel} (${d.bilH[o].toFixed(1)} hrs × $${d.rt.pilot}/hr)${ruNote}`, amt: d.pilFee[o] });
        if (d.espHrs[o] > 0) {
          usdLines.push({ desc: `Espera ${oLabel} (${d.espHrs[o].toFixed(1)} hrs × $${d.rt.gw}/hr)`, amt: d.esp[o] });
        }
      });
      usdLines.push({ desc: `Admin fee Fernando (${d.numMonths} mes × $${d.rt.admin}/mes)`, amt: d.adminFee });

    } else {
      // ── COCO/CUCO → Senshi: fuel + pilotaje + espera + maintenance ──

      // QTZ: their fuel
      qtzLines.push({ desc: `Combustible proporcional (${d.hrs[owner].toFixed(1)} hrs × Q${d.qph.toFixed(2)}/hr)`, amt: d.fuelProp[owner] });
      if (d.antic[owner] > 0) qtzLines.push({ desc: 'Menos: anticipo ya pagado', amt: -d.antic[owner] });

      // USD: pilotaje + espera (no admin — that's 100% Senshi)
      const ruNote = d.ruAmt[owner] > 0 ? ` (incl. roundup ${fD(d.ruAmt[owner])} por ${d.sub[owner].n} vuelo(s) <1hr)` : '';
      usdLines.push({ desc: `Pilotaje Fernando (${d.bilH[owner].toFixed(1)} hrs × $${d.rt.pilot}/hr)${ruNote}`, amt: d.pilFee[owner] });
      if (d.espHrs[owner] > 0) {
        usdLines.push({ desc: `Espera en tierra (${d.espHrs[owner].toFixed(1)} hrs × $${d.rt.gw}/hr)`, amt: d.esp[owner] });
      }

      // Maintenance tracked separately — not included in owner invoices

      // Flight expenses
      if (d.fexpData && d.fexpData.expenses.length > 0 && typeof FlightExpenses !== 'undefined') {
        const fxLines = FlightExpenses.invoiceLinesForOwner(d.from, d.to, owner);
        if (fxLines) {
          fxLines.usdLines.forEach(l => usdLines.push(l));
          fxLines.qtzLines.forEach(l => qtzLines.push(l));
        }
      }

      // FF revenue — owner owes Senshi for FF flights they arranged
      if (d.ffRevenue && d.ffRevenue[owner] > 0) {
        usdLines.push({ desc: `Ingreso FF por cobrar (vuelos Friends & Family)`, amt: d.ffRevenue[owner] });
      }
    }

    const totalQTZ = qtzLines.reduce((s, l) => s + l.amt, 0);
    const totalUSD = usdLines.reduce((s, l) => s + l.amt, 0);
    const label = owner === 'SENSHI' ? 'Senshi' : owner;
    const subtitle = owner === 'SENSHI'
      ? 'Senshi paga a Fernando — pilotaje + espera + admin (todos los socios)'
      : `${owner} debe a Senshi — combustible + pilotaje + espera + gastos`;

    // --- Balance section for COCO/CUCO invoices ---
    let balanceHTML = '';
    if (owner !== 'SENSHI' && typeof Payments !== 'undefined') {
      const TRACKING_START = '2026-01';
      const OPENING_BALANCES = { COCO: { qtz: 7133.71, usd: 0 }, CUCO: { qtz: -22129.57, usd: 0 }, SENSHI: { qtz: 0, usd: 0 } };
      const ob = OPENING_BALANCES[owner] || { qtz: 0, usd: 0 };
      let begQTZ = ob.qtz, begUSD = ob.usd;

      // Accumulate charges before this period
      const effectiveFrom = d.from < TRACKING_START ? TRACKING_START : d.from;
      if (effectiveFrom > TRACKING_START && Payments.getOwnerBalances) {
        // Use getChargeMonths indirectly — compute prior charges
        // Simple approach: get current balances and subtract this period's charges/payments
      }

      // Simpler: use the same paymentSign helper logic
      function paymentSign(p, o) {
        if (p.from === o) return -1;
        if (p.from === 'SENSHI' && p.to === o) return -1;
        return 1;
      }

      // Prior charges (tracking start to period start)
      if (effectiveFrom > TRACKING_START) {
        const priorMonths = [];
        let py = +TRACKING_START.split('-')[0], pm = +TRACKING_START.split('-')[1];
        const ey = +effectiveFrom.split('-')[0], em = +effectiveFrom.split('-')[1];
        while (py < ey || (py === ey && pm < em)) {
          const mm = py + '-' + String(pm).padStart(2, '0');
          const fd2 = mm + '-01', td2 = mm + '-31';
          const fls2 = DB.flights.filter(f => f.d >= fd2 && f.d <= td2 && (f.verified !== false || (f.t !== 'STD' && f.t !== 'FF')));
          const fus2 = DB.fuel.filter(f => f.d >= fd2 && f.d <= td2);
          const rt2 = App.getRateFD(fd2);
          let h2 = {COCO:0,CUCO:0,SENSHI:0}, sub2 = {COCO:{n:0,a:0},CUCO:{n:0,a:0},SENSHI:{n:0,a:0}}, esp2 = {COCO:0,CUCO:0,SENSHI:0};
          let ffR = 0;
          fls2.forEach(f => {
            const r = f.r; if (!h2.hasOwnProperty(r)) return;
            let ffO = null;
            if (f.t === 'FF') {
              if (r !== 'SENSHI' && (r==='COCO'||r==='CUCO')) ffO = r;
              else if (f.u) { if (f.u.toUpperCase().indexOf('COCO')>=0) ffO='COCO'; if (f.u.toUpperCase().indexOf('CUCO')>=0) ffO='CUCO'; }
            }
            const co = (f.t==='FF' && ffO) ? 'SENSHI' : r;
            h2[co] += f.h;
            if (f.h>0 && f.h<1) { sub2[co].n++; sub2[co].a += f.h; }
            esp2[co] += (f.eh||0);
            if (f.t==='FF' && ffO===owner && (f.rv||0)>0) ffR += f.rv;
          });
          const th2 = h2.COCO+h2.CUCO+h2.SENSHI;
          let tf2=0, ant2={COCO:0,CUCO:0,SENSHI:0};
          fus2.forEach(f => { tf2+=f.m; if(f.ac) ant2.COCO+=f.ac; if(f.au) ant2.CUCO+=f.au; if(f.as) ant2.SENSHI+=f.as; });
          const qph2 = th2>0 ? tf2/th2 : 0;
          const fNet = h2[owner]*qph2 - (ant2[owner]||0);
          const bH = h2[owner] - sub2[owner].a + sub2[owner].n;
          const pF = bH * rt2.pilot;
          const eF = esp2[owner] * rt2.gw;
          const aF = (owner==='SENSHI') ? rt2.admin : 0;
          let fxU=0,fxQ=0,fxCU=0,fxCQ=0;
          if (typeof FlightExpenses!=='undefined' && FlightExpenses.billingForPeriod) {
            const fxd = FlightExpenses.billingForPeriod(mm,mm);
            if (fxd&&fxd[owner]) { fxU=fxd[owner].USD||0; fxQ=fxd[owner].QTZ||0; }
            if (fxd&&fxd.payer_credits&&fxd.payer_credits[owner]) { fxCU=fxd.payer_credits[owner].USD||0; fxCQ=fxd.payer_credits[owner].QTZ||0; }
          }
          let mU=0,mQ=0;
          (DB.misc_charges||[]).forEach(c => { if(c.owner===owner&&c.date>=fd2&&c.date<=td2) { if(c.currency==='USD') mU+=c.amount; else mQ+=c.amount; } });
          begQTZ += fNet + fxQ - fxCQ + mQ;
          begUSD += pF + eF + aF + fxU - fxCU + mU + ffR;
          pm++; if(pm>12){pm=1;py++;}
        }
      }

      // Prior payments
      const effFromDate = effectiveFrom + '-01';
      (DB.payments||[]).forEach(p => {
        if ((p.from===owner||p.to===owner) && p.date < effFromDate && p.date >= TRACKING_START+'-01') {
          const s = paymentSign(p, owner);
          begQTZ += s * (p.amount_qtz||0);
          begUSD += s * (p.amount_usd||0);
        }
      });

      // Period payments
      const periodTo = d.to + '-31';
      let payQTZ = 0, payUSD = 0;
      (DB.payments||[]).forEach(p => {
        if ((p.from===owner||p.to===owner) && p.date >= effFromDate && p.date <= periodTo) {
          const s = paymentSign(p, owner);
          payQTZ += s * (p.amount_qtz||0);
          payUSD += s * (p.amount_usd||0);
        }
      });

      const endQTZ = begQTZ + totalQTZ + payQTZ;
      const endUSD = begUSD + totalUSD + payUSD;

      balanceHTML = `
<div class="sec-hd" style="margin-top:24px">Estado de cuenta</div>
<table>
  <thead><tr><th>Concepto</th><th>QTZ</th><th>USD</th></tr></thead>
  <tbody>
    <tr><td>Saldo anterior</td><td style="text-align:right;font-weight:600">${fQs(begQTZ)}</td><td style="text-align:right;font-weight:600">${fDs(begUSD)}</td></tr>
    <tr><td>+ Cargos del periodo</td><td style="text-align:right;color:#8B1A1A">${fQs(totalQTZ)}</td><td style="text-align:right;color:#8B1A1A">${fDs(totalUSD)}</td></tr>
    ${(payQTZ !== 0 || payUSD !== 0) ? `<tr><td>- Pagos del periodo</td><td style="text-align:right;color:#1A6B3A">${fQs(payQTZ)}</td><td style="text-align:right;color:#1A6B3A">${fDs(payUSD)}</td></tr>` : ''}
    <tr class="total"><td><b>Saldo al ${d.to}</b></td><td style="text-align:right" class="${endQTZ < 0 ? 'neg' : ''}"><b>${fQs(endQTZ)}</b></td><td style="text-align:right" class="${endUSD < 0 ? 'neg' : ''}"><b>${fDs(endUSD)}</b></td></tr>
  </tbody>
</table>
<div style="font-size:9px;color:#8892A4;text-align:center;margin-top:6px">Positivo = debe a Senshi · Negativo = Senshi debe</div>`;
    }

    const invoiceHTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Factura ${label} — ${d.periodLbl}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;color:#1A1F2E;max-width:700px;margin:0 auto;padding:30px 24px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #1B2A4A}
.logo{font-size:28px;font-weight:900;color:#1B2A4A;letter-spacing:.04em}
.logo-sub{font-size:9px;color:#8892A4;letter-spacing:.1em;text-transform:uppercase}
.meta{text-align:right;font-size:11px;color:#8892A4;line-height:1.6}
.meta b{color:#1A1F2E}
.title{font-size:16px;font-weight:700;color:#1B2A4A;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.subtitle{font-size:11px;color:#8892A4;margin-bottom:20px}
.sec-hd{font-size:12px;font-weight:700;color:#1B2A4A;text-transform:uppercase;letter-spacing:.04em;padding:10px 0 6px;border-bottom:2px solid #1B2A4A;margin-top:20px}
table{width:100%;border-collapse:collapse;margin-bottom:4px}
th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8892A4;padding:8px 10px;border-bottom:2px solid #E2E6EE}
th:last-child{text-align:right}
td{padding:10px;font-size:12px;border-bottom:1px solid #F0F2F6}
td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.note{font-size:9px;color:#8892A4;font-style:italic}
tr.total td{border-top:2px solid #1B2A4A;font-size:14px;font-weight:800;padding-top:12px}
.footer{margin-top:24px;padding-top:14px;border-top:1px solid #E2E6EE;font-size:10px;color:#8892A4;text-align:center}
.neg{color:#1A6B3A}
.grand{margin-top:24px;padding:14px;background:#F5F6F8;border-radius:8px}
.grand-row{display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:4px 0}
@media print{body{padding:10px}.no-print{display:none!important}}
.print-btn{display:block;margin:0 auto 20px;padding:10px 28px;background:#1B2A4A;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨 Imprimir</button>
<div class="header">
  <div><div class="logo">TG-SHI</div><div class="logo-sub">Senshi Aviation</div></div>
  <div class="meta">
    <div><b>Factura — ${label}</b></div>
    <div>Período: ${d.periodLbl}</div>
    <div>Generado: ${new Date().toLocaleDateString('es-GT')}</div>
  </div>
</div>
<div class="title">Factura — ${label}</div>
<div class="subtitle">${subtitle}</div>

${qtzLines.length > 0 ? `
<div class="sec-hd">Combustible (QTZ)</div>
<table>
  <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
  <tbody>
    ${qtzLines.map(l => `<tr><td>${l.desc}${l.note ? `<div class="note">${l.note}</div>` : ''}</td><td class="${l.amt < 0 ? 'neg' : ''}">${fQs(l.amt)}</td></tr>`).join('')}
    <tr class="total"><td><b>TOTAL QTZ</b></td><td class="${totalQTZ < 0 ? 'neg' : ''}">${fQs(totalQTZ)}</td></tr>
  </tbody>
</table>` : ''}

${usdLines.length > 0 ? `
<div class="sec-hd">${owner === 'SENSHI' ? 'Pago a Fernando (USD)' : 'Pilotaje + Reserva (USD)'}</div>
<table>
  <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
  <tbody>
    ${usdLines.map(l => `<tr><td>${l.desc}${l.note ? `<div class="note">${l.note}</div>` : ''}</td><td class="${l.amt < 0 ? 'neg' : ''}">${fDs(l.amt)}</td></tr>`).join('')}
    <tr class="total"><td><b>TOTAL USD</b></td><td>${fDs(totalUSD)}</td></tr>
  </tbody>
</table>` : ''}

<div class="grand">
  <div class="grand-row"><span>Total QTZ periodo</span><span class="${totalQTZ < 0 ? 'neg' : ''}">${fQs(totalQTZ)}</span></div>
  <div class="grand-row"><span>Total USD periodo</span><span>${fDs(totalUSD)}</span></div>
</div>

${balanceHTML}

<div class="footer">
  TG-SHI · Senshi Aviation · Generado automáticamente
</div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(invoiceHTML); w.document.close(); }
    else { alert('Permite pop-ups para descargar la factura'); }
  }

  return { initBil, calcBil, downloadInvoice };
})();
