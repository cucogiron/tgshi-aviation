// =====================================================================
// TG-SHI v6.0 — js/fuel.js
// Fuel log, new fuel form, year filters, running totals
// =====================================================================

const Fuel = (() => {
  let fuelYearFilter = 'ALL';

  function buildFuel() {
    let out = [...DB.fuel].reverse();

    // Apply year filter
    if (/^\d{4}$/.test(fuelYearFilter)) {
      out = out.filter(f => f.d.startsWith(fuelYearFilter));
    }

    // Calculate running totals per owner
    const fuelForTotals = fuelYearFilter === 'ALL' ? DB.fuel : DB.fuel.filter(f => f.d.startsWith(fuelYearFilter));
    let totalCOCO = 0, totalCUCO = 0;
    fuelForTotals.forEach(f => {
      totalCOCO += (f.ac || 0);
      totalCUCO += (f.au || 0);
    });
    const totalAll = fuelForTotals.reduce((s, f) => s + f.m, 0);

    const totalsArea = document.getElementById('fuel-totals-area');
    if (totalsArea) {
      totalsArea.innerHTML = `<div class="fuel-totals">
        <div class="ft-item">Total: <b>Q${totalAll.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</b></div>
        <div class="ft-item" style="color:#1B4E8A">COCO: <b>Q${totalCOCO.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</b></div>
        <div class="ft-item" style="color:#1A6B3A">CUCO: <b>Q${totalCUCO.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</b></div>
      </div>`;
    }

    if (!out.length) {
      document.getElementById('fuel-list').innerHTML = '<div class="empty"><div class="big">⛽</div>Sin registros</div>';
      return;
    }
    document.getElementById('fuel-list').innerHTML = out.slice(0, 60).map(f => {
      const ants = [];
      if ((f.ac || 0) > 0) ants.push(`COCO Q${f.ac.toLocaleString()}`);
      if ((f.au || 0) > 0) ants.push(`CUCO Q${f.au.toLocaleString()}`);
      if ((f.as || 0) > 0) ants.push(`Charter Q${f.as.toLocaleString()}`);
      return `<div class="fue"><div><div class="fue-l">Q${f.m.toLocaleString()} — ${f.py}</div><div class="fue-s">${ants.length ? ants.join(' · ') : 'Sin anticipo'}${f.no ? ' · ' + f.no : ''}</div></div><div class="fue-r"><div class="fue-d">${f.d.slice(5)}</div></div></div>`;
    }).join('');
  }

  function filtFuelYr(yr, el) {
    fuelYearFilter = yr;
    document.querySelectorAll('#fuel-yr-row .fp').forEach(p => p.classList.remove('on'));
    el.classList.add('on');
    buildFuel();
  }

  async function saveFu() {
    const d = document.getElementById('fu-d').value;
    const m = parseFloat(document.getElementById('fu-m').value);
    if (!d || isNaN(m) || m <= 0) { alert('Completa fecha y monto'); return; }
    const py = document.getElementById('fu-py').value;
    const no = document.getElementById('fu-no').value;
    let ac = 0, au = 0, as_ = 0;
    const acEl = document.getElementById('fu-adv-COCO'); if (acEl) ac = parseFloat(acEl.value) || 0;
    const auEl = document.getElementById('fu-adv-CUCO'); if (auEl) au = parseFloat(auEl.value) || 0;
    const fid = (DB.meta.last_fuel_id || 0) + 1; DB.meta.last_fuel_id = fid;
    DB.fuel.push({ id: fid, d, py, m, ac, au, as: as_, no });
    const ok = await API.saveData();
    document.getElementById('ok-fu').style.display = ok ? 'flex' : 'none';
    document.getElementById('err-fu').style.display = ok ? 'none' : 'block';
    if (ok) {
      setTimeout(() => document.getElementById('ok-fu').style.display = 'none', 3000);
      document.getElementById('fu-m').value = '';
      document.getElementById('fu-no').value = '';
    }
  }

  function fTab(t, el) {
    document.querySelectorAll('[id^="form-"]').forEach(d => d.style.display = 'none');
    document.getElementById('form-' + t).style.display = 'block';
    el.closest('.sc').querySelectorAll('.sb').forEach(b => b.classList.remove('on'));
    el.classList.add('on');
    if (t === 'admin') Admin.buildAdminPanel();
  }

  return { buildFuel, filtFuelYr, saveFu, fTab };
})();
