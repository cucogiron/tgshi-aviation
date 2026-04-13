// =====================================================================
// TG-SHI v5.2 — js/fuel.js
// Fuel log, new fuel form
// =====================================================================

const Fuel = (() => {

  function buildFuel() {
    const out = [...DB.fuel].reverse();
    if (!out.length) {
      document.getElementById('fuel-list').innerHTML = '<div class="empty"><div class="big">⛽</div>Sin registros</div>';
      return;
    }
    document.getElementById('fuel-list').innerHTML = out.slice(0, 60).map(f => {
      const ants = [];
      if ((f.ac || 0) > 0) ants.push(`COCO Q${f.ac.toLocaleString()}`);
      if ((f.au || 0) > 0) ants.push(`CUCO Q${f.au.toLocaleString()}`);
      if ((f.as || 0) > 0) ants.push(`SENSHI Q${f.as.toLocaleString()}`);
      return `<div class="fue"><div><div class="fue-l">Q${f.m.toLocaleString()} — ${f.py}</div><div class="fue-s">${ants.length ? ants.join(' · ') : 'Sin anticipo'}${f.no ? ' · ' + f.no : ''}</div></div><div class="fue-r"><div class="fue-d">${f.d.slice(5)}</div></div></div>`;
    }).join('');
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

  return { buildFuel, saveFu, fTab };
})();
