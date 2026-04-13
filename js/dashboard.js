// =====================================================================
// TG-SHI v6.0 — js/dashboard.js
// Dashboard rendering, stats, recent flights, pending verification
// =====================================================================

const Dashboard = (() => {

  function render() {
    try {
    const t = Math.max(...DB.flights.map(f => f.hf || 0), 0);
    document.getElementById('tachVal').textContent = t.toFixed(1);
    document.getElementById('app-title').textContent = selPlane;
    buildDash();
    } catch(e) { console.error('Dashboard.render error:', e); }
  }

  function buildDash() {
    const yr = new Date().getFullYear().toString();
    const f26 = DB.flights.filter(f => f.d.startsWith(yr) && (!f.plane_id || f.plane_id === selPlane));
    let co = 0, cu = 0, se = 0;
    const mo = {};
    f26.forEach(f => {
      const m = +f.d.slice(5, 7);
      if (!mo[m]) mo[m] = { co: 0, cu: 0, se: 0 };
      if (f.r === 'COCO') { co += f.h; mo[m].co += f.h; }
      else if (f.r === 'CUCO') { cu += f.h; mo[m].cu += f.h; }
      else { se += f.h; mo[m].se += f.h; }
    });
    document.getElementById('d-co').textContent = co.toFixed(1);
    document.getElementById('d-cu').textContent = cu.toFixed(1);
    document.getElementById('d-se').textContent = se.toFixed(1);

    // Quick stats row
    const curMonth = new Date().getMonth() + 1;
    const monthFlights = f26.filter(f => +f.d.slice(5, 7) === curMonth);
    const monthHrs = monthFlights.reduce((s, f) => s + f.h, 0);
    const lastFlight = DB.flights.length > 0 ? DB.flights[DB.flights.length - 1].d : '—';
    const qsArea = document.getElementById('d-quick-stats');
    if (qsArea) {
      qsArea.innerHTML = `<div class="qs-row">
        <div class="qs"><div class="qs-l">Vuelos este mes</div><div class="qs-v">${monthFlights.length}</div><div class="qs-d">${MO[curMonth]}</div></div>
        <div class="qs"><div class="qs-l">Horas este mes</div><div class="qs-v">${monthHrs.toFixed(1)}</div><div class="qs-d">hrs</div></div>
        <div class="qs"><div class="qs-l">Último vuelo</div><div class="qs-v" style="font-size:12px">${lastFlight !== '—' ? lastFlight.slice(5) : '—'}</div><div class="qs-d">${lastFlight !== '—' ? lastFlight.slice(0, 4) : ''}</div></div>
      </div>`;
    }

    const mx = Math.max(...Object.values(mo).map(m => m.co + m.cu + m.se), 1);
    let bh = '';
    for (let m = 1; m <= 12; m++) {
      const d = mo[m]; if (!d || (d.co + d.cu + d.se) === 0) continue;
      const t = d.co + d.cu + d.se, sc = 100 / mx;
      bh += `<div class="mr"><div class="ml">${MO[m]}</div><div class="bt2"><div class="bs b1" style="width:${d.co * sc}%"></div><div class="bs b2" style="width:${d.cu * sc}%"></div><div class="bs b3" style="width:${d.se * sc}%"></div></div><div class="mh">${t.toFixed(1)}</div></div>`;
    }
    document.getElementById('d-bars').innerHTML = bh || '<div class="empty">Sin vuelos ' + yr + '</div>';
    document.getElementById('d-rec').innerHTML = [...DB.flights].reverse().slice(0, 5).map(Flights.fRow).join('');

    const tot = co + cu + se, pct = v => tot > 0 ? ` (${((v / tot) * 100).toFixed(0)}%)` : '';
    document.getElementById('d-sum').innerHTML = `
      <div class="qr"><div class="ql">Total horas ${yr}</div><div class="qv">${tot.toFixed(1)} hrs</div></div>
      <div class="qr"><div class="ql">COCO</div><div class="qv c1">${co.toFixed(1)}${pct(co)}</div></div>
      <div class="qr"><div class="ql">CUCO</div><div class="qv c2">${cu.toFixed(1)}${pct(cu)}</div></div>
      <div class="qr"><div class="ql">Charter</div><div class="qv c3">${se.toFixed(1)}${pct(se)}</div></div>
      <div class="qr"><div class="ql">Total vuelos</div><div class="qv">${DB.flights.length}</div></div>`;
  }

  function buildPending() {
    const pends = DB.flights.filter(f => f.verified === false);
    const sec = document.getElementById('pend-section');
    if (!App.isAdmin() || pends.length === 0) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    sec.innerHTML = `<div class="pend-section"><div class="pend-hd"><span class="pend-ht">✋ Vuelos pendientes</span><span class="pend-count">${pends.length}</span></div>
      ${pends.map(f => `<div class="pend-item"><div><div class="pend-info"><b>${f.rt || '—'}</b> · ${f.r} · <span class="bx ${f.t === 'FF' ? 'f' : 's'}">${f.t}</span></div><div class="pend-meta">${f.d} · ${f.h.toFixed(1)}hr · ${f.logged_by}</div></div><div class="pend-actions"><button class="ver-btn" onclick="Dashboard.verifyFlight(${f.id},'approve')">✓</button><button class="rej-btn" onclick="Dashboard.verifyFlight(${f.id},'reject')">✕</button></div></div>`).join('')}
    </div>`;
  }

  async function verifyFlight(id, action) {
    const f = DB.flights.find(x => x.id === id);
    if (!f) return;
    if (action === 'approve') { f.verified = true; f.verified_by = App.currentUser(); }
    else { f.t = 'PERSONAL'; f.rv = 0; f.verified = true; f.verified_by = App.currentUser(); }
    await API.saveData();
    App.buildAll();
  }

  return { render, buildDash, buildPending, verifyFlight };
})();
