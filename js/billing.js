// =====================================================================
// TG-SHI v6.0 — js/billing.js
// Billing calculations (sections A–F) + downloadable invoices
// Currency separation: Fuel in QTZ, Fernando/Reserva in USD
// Three owners: COCO, CUCO, SENSHI (Charter)
// =====================================================================

const Billing = (() => {

  // Cached billing data for invoice generation
  let lastBilData = null;

  function initBil() {
    try {
      const n = new Date(), y = n.getFullYear(), m = n.getMonth() + 1;
      const pr = m === 1 ? `${y - 1}-12` : `${y}-${App.pad2(m - 1)}`;
      const ef = document.getElementById('b-from');
      const et = document.getElementById('b-to');
      if (ef) ef.value = pr;
      if (et) et.value = pr;
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

    // --- Accumulate hours, sub-hour flights, espera, charter revenue ---
    const hrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const sub = { COCO: { n: 0, a: 0 }, CUCO: { n: 0, a: 0 }, SENSHI: { n: 0, a: 0 } };
    const esp = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const espHrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
    let charterRev = 0;

    fls.forEach(f => {
      const r = f.r; if (hrs[r] === undefined) return;
      hrs[r] += f.h;
      if (f.h > 0 && f.h < 1) { sub[r].n++; sub[r].a += f.h; }
      espHrs[r] += (f.eh || 0);
      esp[r] += (f.eh || 0) * rt.gw;
      if ((f.rv || 0) > 0) charterRev += f.rv;
    });

    // --- Fuel totals (QTZ) and anticipos per owner ---
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

    // Fuel proration per owner (QTZ)
    const fuelProp = { COCO: hrs.COCO * qph, CUCO: hrs.CUCO * qph, SENSHI: hrs.SENSHI * qph };
    const fuelNet = { COCO: fuelProp.COCO - antic.COCO, CUCO: fuelProp.CUCO - antic.CUCO, SENSHI: fuelProp.SENSHI - antic.SENSHI };

    // Billable hours (roundup: sub-hour flights count as 1hr each)
    const bilH = r => hrs[r] - sub[r].a + sub[r].n;
    const pilFee = r => bilH(r) * rt.pilot;   // USD
    const ruAmt = r => (sub[r].n - sub[r].a) * rt.pilot; // USD roundup portion
    const resv = r => hrs[r] * rt.res;          // USD

    const fromParts = from.split('-'), toParts = to.split('-');
    const numMonths = (+toParts[0] - +fromParts[0]) * 12 + (+toParts[1] - +fromParts[1]) + 1;
    const adminFee = rt.admin * numMonths; // USD total

    // Fernando total (USD) — all three owners
    const totFer = pilFee('COCO') + pilFee('CUCO') + pilFee('SENSHI')
                 + esp.COCO + esp.CUCO + esp.SENSHI + adminFee;

    // Formatters
    const fQ = v => `Q${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fD = v => `$${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const sg = v => v < 0 ? 'neg' : '';

    const periodLbl = from === to ? from : `${from} → ${to}`;

    // --- Cache for invoices ---
    lastBilData = {
      from, to, tc, periodLbl, rt, numMonths,
      hrs, sub, esp, espHrs, charterRev,
      tfuel, antic, th, qph, fuelProp, fuelNet,
      bilH: { COCO: bilH('COCO'), CUCO: bilH('CUCO'), SENSHI: bilH('SENSHI') },
      pilFee: { COCO: pilFee('COCO'), CUCO: pilFee('CUCO'), SENSHI: pilFee('SENSHI') },
      ruAmt: { COCO: ruAmt('COCO'), CUCO: ruAmt('CUCO'), SENSHI: ruAmt('SENSHI') },
      resv: { COCO: resv('COCO'), CUCO: resv('CUCO'), SENSHI: resv('SENSHI') },
      adminFee, totFer, fQ, fD
    };

    // ========== BUILD REPORT HTML ==========

    let h = `<div class="stitle">Período: ${periodLbl} · TC Q${tc}/USD · Piloto: $${rt.pilot}/hr · Admin: $${rt.admin}/mes</div>`;

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

    // Per-owner fuel breakdown
    ['COCO', 'CUCO', 'SENSHI'].forEach((owner, idx) => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      h += `<div class="bil-row" style="border-top:1px solid #E2E6EE;margin-top:4px"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">${label}</div><div class="bil-val" style="font-size:9px;color:#8892A4">${hrs[owner].toFixed(1)} hrs</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Proporcional</div><div class="bil-val">${fQ(fuelProp[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Anticipo pagado</div><div class="bil-val">${fQ(antic[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl"><b>↳ Neto a cobrar</b></div><div class="bil-val ${sg(fuelNet[owner])}"><b>${fuelNet[owner] < 0 ? '(' + fQ(fuelNet[owner]) + ')' : fQ(fuelNet[owner])}</b></div></div>`;
    });

    h += `</div></div>`;

    // ── C — PILOTAJE FERNANDO (USD) ──
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

    h += `<div class="bil-row" style="border-top:2px solid #E2E6EE;margin-top:4px"><div class="bil-lbl">Admin fee Fernando (${numMonths} mes${numMonths > 1 ? 'es' : ''})</div><div class="bil-val">${fD(adminFee)}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>TOTAL A PAGAR FERNANDO</b></div><div class="bil-val"><b>${fD(totFer)}</b></div></div>
    </div></div>`;

    // ── D — RESERVA MANTENIMIENTO (USD) ──
    const totRes = resv('COCO') + resv('CUCO') + resv('SENSHI');
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">D — Reserva Mantenimiento (USD · $${rt.res}/hr)</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl">COCO</div><div class="bil-val">${fD(resv('COCO'))}</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO</div><div class="bil-val">${fD(resv('CUCO'))}</div></div>
      <div class="bil-row"><div class="bil-lbl">Charter</div><div class="bil-val">${fD(resv('SENSHI'))}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>Total reserva</b></div><div class="bil-val"><b>${fD(totRes)}</b></div></div>
    </div></div>`;

    // ── E — RESUMEN POR SOCIO ──
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">E — Resumen por socio</div></div><div class="bil-bd">`;

    ['COCO', 'CUCO', 'SENSHI'].forEach((owner, idx) => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      const border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:6px;padding-top:6px' : '';
      const ownerFerUSD = pilFee(owner) + esp[owner];
      const ownerAdminUSD = adminFee / 3;
      const ownerResvUSD = resv(owner);
      const totalUSD = ownerFerUSD + ownerAdminUSD + ownerResvUSD;
      const totalQTZ = fuelNet[owner];

      h += `<div class="bil-row" style="${border}"><div class="bil-lbl" style="font-weight:700;font-size:11px">${label}</div><div class="bil-val"></div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Combustible neto (QTZ)</div><div class="bil-val ${sg(totalQTZ)}">${totalQTZ < 0 ? '(' + fQ(totalQTZ) + ')' : fQ(totalQTZ)}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Pilotaje + espera (USD)</div><div class="bil-val">${fD(ownerFerUSD)}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Admin fee (USD, ÷3)</div><div class="bil-val">${fD(ownerAdminUSD)}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Reserva mante (USD)</div><div class="bil-val">${fD(ownerResvUSD)}</div></div>
        <div class="bil-row"><div class="bil-lbl"><b>↳ Total USD</b></div><div class="bil-val"><b>${fD(totalUSD)}</b></div></div>
        <div class="bil-row"><div class="bil-lbl"><b>↳ Total QTZ</b></div><div class="bil-val ${sg(totalQTZ)}"><b>${totalQTZ < 0 ? '(' + fQ(totalQTZ) + ')' : fQ(totalQTZ)}</b></div></div>`;
    });

    h += `</div></div>`;

    // ── F — QuickBooks Summary ──
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">F — QuickBooks Summary</div></div><div class="bil-bd">`;

    ['COCO', 'CUCO', 'SENSHI'].forEach((owner, idx) => {
      const label = owner === 'SENSHI' ? 'CHARTER' : owner;
      const border = idx > 0 ? 'border-top:1px solid #E2E6EE;margin-top:4px;padding-top:4px' : '';
      h += `<div class="bil-row" style="${border}"><div class="bil-lbl" style="font-weight:700;font-size:10px">${label}</div><div class="bil-val"></div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Combustible neto (QTZ)</div><div class="bil-val ${sg(fuelNet[owner])}">${fuelNet[owner] < 0 ? '(' + fQ(fuelNet[owner]) + ')' : fQ(fuelNet[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Pilotaje${esp[owner] > 0 ? ' + espera' : ''} (USD)</div><div class="bil-val">${fD(pilFee(owner) + esp[owner])}</div></div>
        <div class="bil-row"><div class="bil-lbl">↳ Reserva mante (USD)</div><div class="bil-val">${fD(resv(owner))}</div></div>`;
    });

    h += `<div class="bil-row" style="border-top:1px solid #E2E6EE;margin-top:4px"><div class="bil-lbl">Admin fee Fernando (USD)</div><div class="bil-val">${fD(adminFee)}</div></div>`;
    if (charterRev > 0) {
      h += `<div class="bil-row"><div class="bil-lbl">Charter — Ingreso bruto (USD)</div><div class="bil-val">${fD(charterRev)}</div></div>`;
    }
    h += `<div class="bil-row"><div class="bil-lbl"><b>Total Fernando (USD)</b></div><div class="bil-val"><b>${fD(totFer)}</b></div></div>
    </div></div>`;

    // QB notes
    const notes = [];
    ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
      const label = owner === 'SENSHI' ? 'Charter' : owner;
      const ru = ruAmt(owner);
      if (ru > 0) notes.push(`${label}: Roundup ${fD(ru)} (${sub[owner].n} vuelo(s) &lt;1hr → 1hr) incluido en pilotaje`);
    });
    if (notes.length) h += `<div class="qb-note">📋 Nota QB:<br>${notes.join('<br>')}</div>`;

    // ── Download buttons — per owner, QTZ and USD separate ──
    h += `<div class="stitle" style="margin-top:14px">Descargar facturas</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px">
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('COCO','QTZ')">📄 COCO — QTZ</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('COCO','USD')">📄 COCO — USD</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('CUCO','QTZ')">📄 CUCO — QTZ</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('CUCO','USD')">📄 CUCO — USD</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('SENSHI','QTZ')">📄 Charter — QTZ</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('SENSHI','USD')">📄 Charter — USD</button>
      </div>`;

    document.getElementById('bil-out').innerHTML = h;
    } catch (e) { console.error('calcBil error:', e); document.getElementById('bil-out').innerHTML = '<div class="empty">Error: ' + e.message + '</div>'; }
  }

  // --- Invoice generation ---
  // QTZ invoice = fuel only (combustible is charged in QTZ)
  // USD invoice = Fernando + reserva only (pilotaje, espera, admin, reserva are charged in USD)
  function downloadInvoice(owner, currency) {
    if (!lastBilData) { alert('Calcula el billing primero'); return; }
    const d = lastBilData;
    const isQTZ = currency === 'QTZ';
    const tc = d.tc;
    const label = owner === 'SENSHI' ? 'Charter' : owner;

    const lines = [];
    const fmtAmt = v => {
      const abs = Math.abs(v);
      const prefix = v < 0 ? '-' : '';
      if (isQTZ) return `${prefix}Q${abs.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `${prefix}$${abs.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    if (isQTZ) {
      // ── QTZ INVOICE: Fuel only ──
      lines.push({ desc: `Combustible proporcional (${d.hrs[owner].toFixed(1)} hrs × Q${d.qph.toFixed(2)}/hr)`, amt: d.fuelProp[owner] });
      if (d.antic[owner] > 0) lines.push({ desc: 'Menos: anticipo ya pagado', amt: -d.antic[owner] });
    } else {
      // ── USD INVOICE: Fernando + Reserva ──
      lines.push({ desc: `Pilotaje Fernando (${d.bilH[owner].toFixed(1)} hrs × $${d.rt.pilot}/hr)`, amt: d.pilFee[owner] });
      const ru = d.ruAmt[owner];
      if (ru > 0) {
        lines.push({ desc: `↳ Roundup (${d.sub[owner].n} vuelo(s) <1hr → 1hr)`, amt: ru, note: 'incluido en pilotaje' });
      }
      if (d.espHrs[owner] > 0) {
        lines.push({ desc: `Espera en tierra (${d.espHrs[owner].toFixed(1)} hrs × $${d.rt.gw}/hr)`, amt: d.esp[owner] });
      }
      // Admin fee split by 3 (three owners)
      const adminShare = d.adminFee / 3;
      lines.push({ desc: `Admin fee Fernando (${d.numMonths} mes × $${d.rt.admin}/mes ÷ 3)`, amt: adminShare });
      // Reserva
      lines.push({ desc: `Reserva mantenimiento (${d.hrs[owner].toFixed(1)} hrs × $${d.rt.res}/hr)`, amt: d.resv[owner] });
    }

    const total = lines.reduce((s, l) => s + l.amt, 0);

    const invoiceHTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Factura ${label} ${isQTZ ? 'QTZ' : 'USD'} — ${d.periodLbl}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;color:#1A1F2E;max-width:700px;margin:0 auto;padding:30px 24px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #1B2A4A}
.logo{font-size:28px;font-weight:900;color:#1B2A4A;letter-spacing:.04em}
.logo-sub{font-size:9px;color:#8892A4;letter-spacing:.1em;text-transform:uppercase}
.meta{text-align:right;font-size:11px;color:#8892A4;line-height:1.6}
.meta b{color:#1A1F2E}
.title{font-size:16px;font-weight:700;color:#1B2A4A;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.subtitle{font-size:11px;color:#8892A4;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8892A4;padding:8px 10px;border-bottom:2px solid #E2E6EE}
th:last-child{text-align:right}
td{padding:10px;font-size:12px;border-bottom:1px solid #F0F2F6}
td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
td.note{font-size:9px;color:#8892A4;font-style:italic}
tr.total td{border-top:2px solid #1B2A4A;font-size:14px;font-weight:800;padding-top:12px}
.footer{margin-top:24px;padding-top:14px;border-top:1px solid #E2E6EE;font-size:10px;color:#8892A4;text-align:center}
.neg{color:#1A6B3A}
.pos{color:#8B1A1A}
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
    <div>Moneda: ${currency}</div>
    <div>Generado: ${new Date().toLocaleDateString('es-GT')}</div>
  </div>
</div>
<div class="title">Detalle de costos — ${label} (${currency})</div>
<div class="subtitle">${isQTZ ? 'Combustible' : 'Pilotaje Fernando + Reserva Mantenimiento'}</div>
<table>
  <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
  <tbody>
    ${lines.map(l => `<tr><td>${l.desc}${l.note ? `<div class="note">${l.note}</div>` : ''}</td><td class="${l.amt < 0 ? 'neg' : ''}">${fmtAmt(l.amt)}</td></tr>`).join('')}
    <tr class="total"><td><b>TOTAL ${currency}</b></td><td>${fmtAmt(total)}</td></tr>
  </tbody>
</table>
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
