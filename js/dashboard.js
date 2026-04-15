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
    f26.forEach(f => {
      // FF flights count as Charter for hours display (consistent with billing)
      var ffOwner = null;
      if (f.t === 'FF' && f.r !== 'SENSHI') {
        if (f.r === 'COCO' || f.r === 'CUCO') ffOwner = f.r;
        else if (f.u) {
          if (f.u.toUpperCase().indexOf('COCO') >= 0) ffOwner = 'COCO';
          if (f.u.toUpperCase().indexOf('CUCO') >= 0) ffOwner = 'CUCO';
        }
      }
      var costOwner = (f.t === 'FF' && ffOwner) ? 'SENSHI' : f.r;
      if (costOwner === 'COCO') co += f.h;
      else if (costOwner === 'CUCO') cu += f.h;
      else se += f.h;
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
        <div class="qs" style="cursor:pointer" onclick="App.nav('vl',2)"><div class="qs-l">Vuelos este mes</div><div class="qs-v">${monthFlights.length}</div><div class="qs-d">${MO[curMonth]}</div></div>
        <div class="qs" style="cursor:pointer" onclick="App.nav('vl',2)"><div class="qs-l">Horas este mes</div><div class="qs-v">${monthHrs.toFixed(1)}</div><div class="qs-d">hrs</div></div>
        <div class="qs" style="cursor:pointer" onclick="App.nav('sched',1)"><div class="qs-l">Último vuelo</div><div class="qs-v" style="font-size:12px">${lastFlight !== '—' ? lastFlight.slice(5) : '—'}</div><div class="qs-d">${lastFlight !== '—' ? lastFlight.slice(0, 4) : ''}</div></div>
      </div>`;
    }

    // Balance widget (admin only)
    const balCard = document.getElementById('d-bal-card');
    const balArea = document.getElementById('d-balances');
    if (balCard && balArea && App.isAdmin() && typeof Payments !== 'undefined' && Payments.getOwnerBalances) {
      try {
        const bal = Payments.getOwnerBalances();
        const fQ = v => `Q${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        const fD = v => `$${Math.abs(v).toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        const fSQ = v => v < 0 ? `-${fQ(v)}` : fQ(v);
        const fSD = v => v < 0 ? `-${fD(v)}` : fD(v);
        const sg = v => v < 0 ? 'color:#1A6B3A' : v > 0 ? 'color:#8B1A1A' : '';

        let bh = '';
        ['COCO', 'CUCO', 'SENSHI'].forEach(owner => {
          const label = owner === 'SENSHI' ? 'CHARTER' : owner;
          const b = bal[owner];
          const colors = { COCO: '#1B4E8A', CUCO: '#1A6B3A', SENSHI: '#B8600A' };
          bh += `<div class="qr">
            <div class="ql" style="font-weight:600;color:${colors[owner]}">${label}</div>
            <div class="qv" style="display:flex;gap:8px;font-size:11px">
              <span style="${sg(b.qtz)}">${fSQ(b.qtz)}</span>
              <span style="${sg(b.usd)}">${fSD(b.usd)}</span>
            </div>
          </div>`;
        });
        bh += `<div style="font-size:8px;color:#8892A4;text-align:center;margin-top:4px">Positivo = debe a Senshi · Negativo = Senshi debe</div>`;
        balArea.innerHTML = bh;
        balCard.style.display = 'block';
      } catch(e) { console.error('Balance widget error:', e); }
    }

    // Recent flights
    document.getElementById('d-rec').innerHTML = [...DB.flights].reverse().slice(0, 5).map(Flights.fRow).join('');

    // Summary — clickable rows
    const tot = co + cu + se, pct = v => tot > 0 ? ` (${((v / tot) * 100).toFixed(0)}%)` : '';
    document.getElementById('d-sum').innerHTML =
      `<div class="qr" style="cursor:pointer" onclick="App.nav('vl',2)"><div class="ql">Total horas ${yr}</div><div class="qv">${tot.toFixed(1)} hrs</div></div>
      <div class="qr" style="cursor:pointer" onclick="App.nav('vl',2);setTimeout(function(){Flights.filtV('COCO',document.querySelectorAll('#flt-row .fp')[1])},150)"><div class="ql">COCO</div><div class="qv c1">${co.toFixed(1)}${pct(co)}</div></div>
      <div class="qr" style="cursor:pointer" onclick="App.nav('vl',2);setTimeout(function(){Flights.filtV('CUCO',document.querySelectorAll('#flt-row .fp')[2])},150)"><div class="ql">CUCO</div><div class="qv c2">${cu.toFixed(1)}${pct(cu)}</div></div>
      <div class="qr" style="cursor:pointer" onclick="App.nav('vl',2);setTimeout(function(){Flights.filtV('SENSHI',document.querySelectorAll('#flt-row .fp')[3])},150)"><div class="ql">Charter</div><div class="qv c3">${se.toFixed(1)}${pct(se)}</div></div>
      <div class="qr" style="cursor:pointer" onclick="App.nav('vl',2)"><div class="ql">Total vuelos</div><div class="qv">${DB.flights.length}</div></div>`;
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
