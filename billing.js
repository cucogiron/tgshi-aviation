// =====================================================================
// TG-SHI v5.2 — js/billing.js
// Billing calculations (sections A–F) + downloadable invoices
// =====================================================================

const Billing = (() => {

  // Cached billing data for invoice generation
  let lastBilData = null;

  function initBil() {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth() + 1;
    const pr = m === 1 ? `${y - 1}-12` : `${y}-${App.pad2(m - 1)}`;
    document.getElementById('b-from').value = pr;
    document.getElementById('b-to').value = pr;
  }

  function calcBil() {
    const from = document.getElementById('b-from').value;
    const to = document.getElementById('b-to').value;
    const tc = parseFloat(document.getElementById('b-tc').value) || 7.65;
    if (!from || !to) return;
    const fd = from + '-01', td = to + '-31';
    const fls = DB.flights.filter(f => f.d >= fd && f.d <= td && (f.verified !== false || (f.t !== 'STD' && f.t !== 'FF')));
    const fus = DB.fuel.filter(f => f.d >= fd && f.d <= td);
    const rt = App.getRateFD(fd);

    const hrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const sub = { COCO: { n: 0, a: 0 }, CUCO: { n: 0, a: 0 }, SENSHI: { n: 0, a: 0 } };
    const esp = { COCO: 0, CUCO: 0, SENSHI: 0 };
    const espHrs = { COCO: 0, CUCO: 0, SENSHI: 0 };
    let charterRev = 0;

    fls.forEach(f => {
      const r = f.r; if (hrs[r] === undefined) return;
      hrs[r] += f.h;
      if (f.h > 0 && f.h < 1) { sub[r].n++; sub[r].a += f.h; }
      if (espHrs[r] !== undefined) { espHrs[r] += (f.eh || 0); esp[r] += (f.eh || 0) * rt.gw; }
      if ((f.rv || 0) > 0) charterRev += f.rv;
    });

    let tfuel = 0, acCO = 0, acCU = 0;
    fus.forEach(f => { tfuel += f.m; acCO += (f.ac || 0); acCU += (f.au || 0); });

    const th = hrs.COCO + hrs.CUCO + hrs.SENSHI;
    const qph = th > 0 ? tfuel / th : 0;
    const prCO = hrs.COCO * qph, prCU = hrs.CUCO * qph;
    const bilH = r => hrs[r] - sub[r].a + sub[r].n;
    const pilFee = r => bilH(r) * rt.pilot;
    const ruAmt = r => (sub[r].n - sub[r].a) * rt.pilot;
    const resv = r => hrs[r] * rt.res;

    const fromParts = from.split('-'), toParts = to.split('-');
    const numMonths = (+toParts[0] - +fromParts[0]) * 12 + (+toParts[1] - +fromParts[1]) + 1;
    const adminFee = rt.admin * numMonths;
    const totFer = pilFee('COCO') + pilFee('CUCO') + pilFee('SENSHI') + esp.COCO + esp.CUCO + esp.SENSHI + adminFee;

    const fQ = v => `Q${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fD = v => `$${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const sg = v => v < 0 ? 'neg' : '';

    const periodLbl = from === to ? from : `${from} → ${to}`;
    const ruCO = ruAmt('COCO'), ruCU = ruAmt('CUCO');
    const espCO = esp.COCO, espCU = esp.CUCO, espSE = esp.SENSHI;

    // Cache data for invoice generation
    lastBilData = {
      from, to, tc, periodLbl, rt, numMonths,
      hrs, sub, esp, espHrs, charterRev,
      tfuel, acCO, acCU, th, qph, prCO, prCU,
      bilH: { COCO: bilH('COCO'), CUCO: bilH('CUCO'), SENSHI: bilH('SENSHI') },
      pilFee: { COCO: pilFee('COCO'), CUCO: pilFee('CUCO'), SENSHI: pilFee('SENSHI') },
      ruAmt: { COCO: ruCO, CUCO: ruCU },
      resv: { COCO: resv('COCO'), CUCO: resv('CUCO'), SENSHI: resv('SENSHI') },
      adminFee, totFer, fQ, fD
    };

    let h = `<div class="stitle">Período: ${periodLbl} · TC Q${tc}/USD · Piloto: $${rt.pilot}/hr · Admin: $${rt.admin}/mes</div>`;

    // A — Hours
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">A — Horas</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl">COCO</div><div class="bil-val">${hrs.COCO.toFixed(1)} hrs</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO</div><div class="bil-val">${hrs.CUCO.toFixed(1)} hrs</div></div>
      <div class="bil-row"><div class="bil-lbl">Charter/Shenshi</div><div class="bil-val">${hrs.SENSHI.toFixed(1)} hrs</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>Total</b></div><div class="bil-val"><b>${th.toFixed(1)} hrs</b></div></div>
    </div></div>`;

    // B — Fuel
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">B — Combustible</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl">Total QTZ</div><div class="bil-val">${fQ(tfuel)}</div></div>
      <div class="bil-row"><div class="bil-lbl">QTZ/hr promedio</div><div class="bil-val">${fQ(qph)}</div></div>
      <div class="bil-row"><div class="bil-lbl">COCO — prop. ${hrs.COCO.toFixed(1)}hr</div><div class="bil-val">${fQ(prCO)}</div></div>
      <div class="bil-row"><div class="bil-lbl">COCO — anticipo ya pagado</div><div class="bil-val">${fQ(acCO)}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>COCO neto a cobrar</b></div><div class="bil-val ${sg(prCO - acCO)}"><b>${fQ(prCO - acCO)}</b></div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO — prop. ${hrs.CUCO.toFixed(1)}hr</div><div class="bil-val">${fQ(prCU)}</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO — anticipo ya pagado</div><div class="bil-val">${fQ(acCU)}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>CUCO neto a cobrar</b></div><div class="bil-val ${sg(prCU - acCU)}"><b>${fQ(prCU - acCU)}</b></div></div>
    </div></div>`;

    // C — Pilotaje Fernando
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">C — Pilotaje Fernando ($${rt.pilot}/hr · Espera $${rt.gw}/hr)</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">COCO</div><div class="bil-val" style="font-size:9px;color:#8892A4">${bilH('COCO').toFixed(1)} hrs fact.</div></div>
      <div class="bil-row"><div class="bil-lbl">↳ Pilotaje</div><div class="bil-val">${fD(pilFee('COCO'))}</div></div>
      ${ruCO > 0 ? `<div class="bil-row"><div class="bil-lbl" style="color:#8B1A1A">↳ Roundup (${sub.COCO.n} vuelo(s) &lt;1hr)</div><div class="bil-val pos">incl. +${fD(ruCO)}</div></div>` : ''}
      ${espHrs.COCO > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Espera en tierra (${espHrs.COCO.toFixed(1)}hr × $${rt.gw})</div><div class="bil-val">${fD(espCO)}</div></div>` : ''}
      <div class="bil-row" style="border-top:1px solid #E2E6EE;margin-top:2px"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">CUCO</div><div class="bil-val" style="font-size:9px;color:#8892A4">${bilH('CUCO').toFixed(1)} hrs fact.</div></div>
      <div class="bil-row"><div class="bil-lbl">↳ Pilotaje</div><div class="bil-val">${fD(pilFee('CUCO'))}</div></div>
      ${ruCU > 0 ? `<div class="bil-row"><div class="bil-lbl" style="color:#8B1A1A">↳ Roundup (${sub.CUCO.n} vuelo(s) &lt;1hr)</div><div class="bil-val pos">incl. +${fD(ruCU)}</div></div>` : ''}
      ${espHrs.CUCO > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Espera en tierra (${espHrs.CUCO.toFixed(1)}hr × $${rt.gw})</div><div class="bil-val">${fD(espCU)}</div></div>` : ''}
      <div class="bil-row" style="border-top:1px solid #E2E6EE;margin-top:2px"><div class="bil-lbl" style="font-weight:600;color:#8892A4;font-size:9px;text-transform:uppercase;letter-spacing:.06em">SHENSHI</div><div class="bil-val" style="font-size:9px;color:#8892A4">${bilH('SENSHI').toFixed(1)} hrs</div></div>
      <div class="bil-row"><div class="bil-lbl">↳ Pilotaje</div><div class="bil-val">${fD(pilFee('SENSHI'))}</div></div>
      ${espHrs.SENSHI > 0 ? `<div class="bil-row"><div class="bil-lbl">↳ Espera en tierra (${espHrs.SENSHI.toFixed(1)}hr × $${rt.gw})</div><div class="bil-val">${fD(espSE)}</div></div>` : ''}
      <div class="bil-row" style="border-top:2px solid #E2E6EE;margin-top:4px"><div class="bil-lbl">Admin fee Fernando (${numMonths} mes${numMonths > 1 ? 'es' : ''})</div><div class="bil-val">${fD(adminFee)}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>TOTAL A PAGAR FERNANDO</b></div><div class="bil-val"><b>${fD(totFer)}</b></div></div>
    </div></div>`;

    // D — Reserva
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">D — Reserva ($${rt.res}/hr)</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl">COCO</div><div class="bil-val">${fD(resv('COCO'))}</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO</div><div class="bil-val">${fD(resv('CUCO'))}</div></div>
      <div class="bil-row"><div class="bil-lbl">Shenshi</div><div class="bil-val">${fD(resv('SENSHI'))}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>Total reserva</b></div><div class="bil-val"><b>${fD(resv('COCO') + resv('CUCO') + resv('SENSHI'))}</b></div></div>
    </div></div>`;

    // F — QuickBooks Summary
    h += `<div class="bil-sec"><div class="bil-hd"><div class="bil-ht">F — QuickBooks Summary</div></div><div class="bil-bd">
      <div class="bil-row"><div class="bil-lbl">COCO — Comb. neto (QTZ)</div><div class="bil-val ${sg(prCO - acCO)}">${fQ(prCO - acCO)}</div></div>
      <div class="bil-row"><div class="bil-lbl">COCO — Pilotaje${espCO > 0 ? ' + espera' : ''}</div><div class="bil-val">${fD(pilFee('COCO') + espCO)}</div></div>
      <div class="bil-row"><div class="bil-lbl">COCO — Reserva mante</div><div class="bil-val">${fD(resv('COCO'))}</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO — Comb. neto (QTZ)</div><div class="bil-val ${sg(prCU - acCU)}">${fQ(prCU - acCU)}</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO — Pilotaje${espCU > 0 ? ' + espera' : ''}</div><div class="bil-val">${fD(pilFee('CUCO') + espCU)}</div></div>
      <div class="bil-row"><div class="bil-lbl">CUCO — Reserva mante</div><div class="bil-val">${fD(resv('CUCO'))}</div></div>
      <div class="bil-row"><div class="bil-lbl">Shenshi — Charter</div><div class="bil-val">${fD(charterRev)}</div></div>
      <div class="bil-row"><div class="bil-lbl"><b>Total Fernando</b></div><div class="bil-val"><b>${fD(totFer)}</b></div></div>
    </div></div>`;

    const notes = [];
    if (ruCO > 0) notes.push(`COCO: Agregar ${fD(ruCO)} roundup (${sub.COCO.n} vuelo(s) &lt;1hr → 1hr)`);
    if (ruCU > 0) notes.push(`CUCO: Agregar ${fD(ruCU)} roundup (${sub.CUCO.n} vuelo(s) &lt;1hr → 1hr)`);
    if (notes.length) h += `<div class="qb-note">📋 Nota QB:<br>${notes.join('<br>')}</div>`;

    // Download buttons
    h += `<div class="stitle" style="margin-top:14px">Descargar facturas</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px">
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('COCO','QTZ')">📄 COCO (QTZ)</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('COCO','USD')">📄 COCO (USD)</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('CUCO','QTZ')">📄 CUCO (QTZ)</button>
        <button class="btn sm" style="width:100%" onclick="Billing.downloadInvoice('CUCO','USD')">📄 CUCO (USD)</button>
      </div>`;

    document.getElementById('bil-out').innerHTML = h;
  }

  // --- Invoice generation ---
  function downloadInvoice(owner, currency) {
    if (!lastBilData) { alert('Calcula el billing primero'); return; }
    const d = lastBilData;
    const isQTZ = currency === 'QTZ';
    const tc = d.tc;

    // Build line items for this owner
    const lines = [];
    const fmtAmt = v => {
      const abs = Math.abs(v);
      const prefix = v < 0 ? '-' : '';
      if (isQTZ) return `${prefix}Q${abs.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `${prefix}$${abs.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    const toC = v => isQTZ ? v * tc : v; // USD amounts stay, QTZ amounts convert from USD base

    // Fuel (already in QTZ)
    const fuelProp = owner === 'COCO' ? d.prCO : d.prCU;
    const fuelAdv = owner === 'COCO' ? d.acCO : d.acCU;
    const fuelNet = fuelProp - fuelAdv;
    if (isQTZ) {
      lines.push({ desc: `Combustible proporcional (${d.hrs[owner].toFixed(1)} hrs × Q${d.qph.toFixed(2)}/hr)`, amt: fuelProp });
      if (fuelAdv > 0) lines.push({ desc: 'Menos: anticipo ya pagado', amt: -fuelAdv });
    } else {
      lines.push({ desc: `Combustible proporcional (${d.hrs[owner].toFixed(1)} hrs)`, amt: fuelProp / tc });
      if (fuelAdv > 0) lines.push({ desc: 'Menos: anticipo ya pagado', amt: -fuelAdv / tc });
    }

    // Pilotaje (in USD)
    const pilotFee = d.pilFee[owner];
    if (isQTZ) {
      lines.push({ desc: `Pilotaje Fernando (${d.bilH[owner].toFixed(1)} hrs × $${d.rt.pilot}/hr × Q${tc})`, amt: pilotFee * tc });
    } else {
      lines.push({ desc: `Pilotaje Fernando (${d.bilH[owner].toFixed(1)} hrs × $${d.rt.pilot}/hr)`, amt: pilotFee });
    }

    // Roundup
    const ru = d.ruAmt[owner];
    if (ru > 0) {
      lines.push({ desc: `Roundup (${d.sub[owner].n} vuelo(s) <1hr → 1hr)`, amt: isQTZ ? ru * tc : ru, note: 'incluido en pilotaje' });
    }

    // Espera
    if (d.espHrs[owner] > 0) {
      const espAmt = d.esp[owner];
      if (isQTZ) {
        lines.push({ desc: `Espera en tierra (${d.espHrs[owner].toFixed(1)} hrs × $${d.rt.gw}/hr × Q${tc})`, amt: espAmt * tc });
      } else {
        lines.push({ desc: `Espera en tierra (${d.espHrs[owner].toFixed(1)} hrs × $${d.rt.gw}/hr)`, amt: espAmt });
      }
    }

    // Admin fee (split equally)
    const adminShare = d.adminFee / 2;
    if (isQTZ) {
      lines.push({ desc: `Admin fee Fernando (${d.numMonths} mes × $${d.rt.admin}/mes ÷ 2 × Q${tc})`, amt: adminShare * tc });
    } else {
      lines.push({ desc: `Admin fee Fernando (${d.numMonths} mes × $${d.rt.admin}/mes ÷ 2)`, amt: adminShare });
    }

    // Reserva
    const reserva = d.resv[owner];
    if (isQTZ) {
      lines.push({ desc: `Reserva mantenimiento (${d.hrs[owner].toFixed(1)} hrs × $${d.rt.res}/hr × Q${tc})`, amt: reserva * tc });
    } else {
      lines.push({ desc: `Reserva mantenimiento (${d.hrs[owner].toFixed(1)} hrs × $${d.rt.res}/hr)`, amt: reserva });
    }

    // Total
    const total = lines.reduce((s, l) => s + l.amt, 0);

    // Build HTML
    const invoiceHTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Factura ${owner} — ${d.periodLbl}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;color:#1A1F2E;max-width:700px;margin:0 auto;padding:30px 24px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #1B2A4A}
.logo{font-size:28px;font-weight:900;color:#1B2A4A;letter-spacing:.04em}
.logo-sub{font-size:9px;color:#8892A4;letter-spacing:.1em;text-transform:uppercase}
.meta{text-align:right;font-size:11px;color:#8892A4;line-height:1.6}
.meta b{color:#1A1F2E}
.title{font-size:16px;font-weight:700;color:#1B2A4A;margin-bottom:16px;text-transform:uppercase;letter-spacing:.04em}
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
@media print{
  body{padding:10px}
  .no-print{display:none!important}
}
.print-btn{display:block;margin:0 auto 20px;padding:10px 28px;background:#1B2A4A;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">🖨 Imprimir</button>
<div class="header">
  <div><div class="logo">TG-SHI</div><div class="logo-sub">Shenshi Aviation</div></div>
  <div class="meta">
    <div><b>Factura — ${owner}</b></div>
    <div>Período: ${d.periodLbl}</div>
    <div>Moneda: ${currency}</div>
    ${isQTZ ? `<div>TC: Q${tc}/USD</div>` : ''}
    <div>Generado: ${new Date().toLocaleDateString('es-GT')}</div>
  </div>
</div>
<div class="title">Detalle de costos — ${owner}</div>
<table>
  <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
  <tbody>
    ${lines.map(l => `<tr><td>${l.desc}${l.note ? `<div class="note">${l.note}</div>` : ''}</td><td class="${l.amt < 0 ? 'neg' : ''}">${fmtAmt(l.amt)}</td></tr>`).join('')}
    <tr class="total"><td><b>TOTAL</b></td><td>${fmtAmt(total)}</td></tr>
  </tbody>
</table>
<div class="footer">
  TG-SHI · Shenshi Aviation · Generado automáticamente
</div>
</body>
</html>`;

    // Open in new tab
    const w = window.open('', '_blank');
    if (w) { w.document.write(invoiceHTML); w.document.close(); }
    else { alert('Permite pop-ups para descargar la factura'); }
  }

  return { initBil, calcBil, downloadInvoice };
})();
