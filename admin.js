// =====================================================================
// TG-SHI v6.0 — js/admin.js
// User, pilot, plane CRUD + password reset + worker config + setup
// =====================================================================

const Admin = (() => {

  function closeEdit() { document.getElementById('edit-modal').style.display = 'none'; }

  function showSetupNeeded(msg) {
    const area = document.getElementById('token-setup-area');
    if (!area) return;
    area.innerHTML = `<div class="token-setup"><h3>🔗 Configurar conexión</h3><p>${msg || 'Configura la conexión al servidor.'}</p>${App.isAdmin() ? `
      <div style="text-align:left;max-width:280px;margin:0 auto">
        <div style="margin-bottom:8px"><label class="fl">Worker URL</label><input type="url" id="setup-url" value="${API.getWorkerUrl()}" placeholder="https://tgshi-api.xxx.workers.dev" style="font-size:12px"></div>
        <div style="margin-bottom:8px"><label class="fl">Secret</label><input type="password" id="setup-secret" value="${API.getWorkerSecret()}" placeholder="secret" style="font-size:12px"></div>
        <button onclick="API.quickSetup()">Conectar</button>
        <div id="setup-msg" style="font-size:10px;color:#8892A4;margin-top:6px"></div>
      </div>` : `<p style="font-size:11px;color:#92400E">Pide a CUCO que configure.</p>`}</div>`;
  }

  function hideSetupNeeded() { const a = document.getElementById('token-setup-area'); if (a) a.innerHTML = ''; }

  function buildAdminPanel() {
    // Users list
    const ul = document.getElementById('user-list');
    if (ul) {
      ul.innerHTML = Object.entries(DB.users).map(([k, v]) => `
        <div class="user-row">
          <div class="user-info"><div class="user-icon">${v.icon || '👤'}</div><div><div class="user-name">${k}</div><div class="user-role">${v.role} · ${v.name || ''}</div></div></div>
          <div class="user-actions">
            <button class="ubtn edit" onclick="Admin.editUser('${k}')">Editar</button>
            ${App.isAdmin() && k !== App.currentUser() ? `<button class="ubtn reset" onclick="Admin.resetUserPassword('${k}')">🔑</button>` : ''}
            ${k !== App.currentUser() ? `<button class="ubtn del" onclick="Admin.deleteUser('${k}')">×</button>` : ''}
          </div>
        </div>`).join('');
    }

    // Pilot roster list
    const pl2 = document.getElementById('pilot-roster-list');
    if (pl2) {
      const pilots = DB.pilots || [];
      if (pilots.length === 0) {
        pl2.innerHTML = '<div class="empty">Sin pilotos registrados</div>';
      } else {
        pl2.innerHTML = pilots.map(p => `
          <div class="pilot-row">
            <div class="pilot-info">
              <div class="pilot-icon">🧑‍✈️</div>
              <div>
                <div class="pilot-name">${p.name}</div>
                <div class="pilot-phone">${p.phone || 'Sin teléfono'}${p.user_id ? ' · usuario: ' + p.user_id : ''}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span class="pilot-active ${p.active !== false ? 'yes' : 'no'}">${p.active !== false ? 'Activo' : 'Inactivo'}</span>
              <button class="ubtn edit" onclick="Admin.editPilot(${p.id})">Editar</button>
            </div>
          </div>`).join('');
      }
    }

    // Planes list
    const pl = document.getElementById('plane-list');
    if (pl) {
      pl.innerHTML = DB.planes.map(p => `
        <div class="plane-row">
          <div><div class="plane-name">${p.id}</div><div class="plane-type">${p.type || ''} ${p.active === false ? '(inactivo)' : ''}</div></div>
          <button class="ubtn edit" onclick="Admin.editPlane('${p.id}')">Editar</button>
        </div>`).join('');
    }

    // Exchange partners list
    const xpList = document.getElementById('xp-list');
    if (xpList) {
      const partners = DB.exchange_partners || [];
      if (partners.length === 0) {
        xpList.innerHTML = '<div class="empty">Sin socios de intercambio</div>';
      } else {
        xpList.innerHTML = partners.map(p => {
          const planes = p.planes ? p.planes.join(', ') : (p.partner_plane || '—');
          return `<div class="plane-row">
            <div><div class="plane-name">${p.name}</div><div class="plane-type">${planes} · Rate ${p.exchange_rate}:1${p.notes ? ' · ' + p.notes : ''}</div></div>
            <button class="ubtn edit" onclick="Exchange.editPartner(${p.id})">Editar</button>
          </div>`;
        }).join('');
      }
    }

    // Worker config
    const u = document.getElementById('cfg-url'), s = document.getElementById('cfg-secret');
    if (u) u.value = API.getWorkerUrl();
    if (s) s.value = API.getWorkerSecret();
  }

  // --- Add User ---
  function openAddUser() {
    document.getElementById('edit-modal-title').textContent = 'Agregar usuario';
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">ID (username)</label><input type="text" id="nu-id" placeholder="ej. PEDRO" oninput="this.value=this.value.toUpperCase()"></div>
      <div class="fs"><label class="fl">Nombre completo</label><input type="text" id="nu-name" placeholder="Pedro García"></div>
      <div class="fs"><label class="fl">Rol</label><select id="nu-role"><option value="owner">Owner (dueño/copropietario)</option><option value="pilot">Piloto</option><option value="pilot_admin">Piloto Admin</option><option value="admin">Administrador</option></select></div>
      <div class="fs"><label class="fl">Ícono</label><input type="text" id="nu-icon" value="👤" style="max-width:60px"></div>
      <div class="fs"><label class="fl">Contraseña inicial</label><input type="text" id="nu-pass" placeholder="mínimo 4 caracteres"></div>
      <button class="btn" onclick="Admin.addUser()">Crear usuario</button>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function addUser() {
    const id = document.getElementById('nu-id').value.trim().toUpperCase();
    const name = document.getElementById('nu-name').value.trim();
    const role = document.getElementById('nu-role').value;
    const icon = document.getElementById('nu-icon').value || '👤';
    const pass = document.getElementById('nu-pass').value;
    if (!id || id.length < 2) { alert('ID debe tener al menos 2 caracteres'); return; }
    if (DB.users[id]) { alert('Usuario ya existe'); return; }
    if (!pass || pass.length < 4) { alert('Contraseña mínimo 4 caracteres'); return; }
    DB.users[id] = { role, icon, name };
    if (!DB.passwords) DB.passwords = {};
    DB.passwords[id] = pass;
    closeEdit();
    const ok = await API.saveData();
    if (ok) { buildAdminPanel(); alert('✓ Usuario ' + id + ' creado'); }
  }

  function editUser(id) {
    const u = DB.users[id]; if (!u) return;
    document.getElementById('edit-modal-title').textContent = 'Editar ' + id;
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Nombre</label><input type="text" id="eu-name" value="${u.name || ''}"></div>
      <div class="fs"><label class="fl">Rol</label><select id="eu-role"><option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option><option value="pilot" ${u.role === 'pilot' ? 'selected' : ''}>Piloto</option><option value="pilot_admin" ${u.role === 'pilot_admin' ? 'selected' : ''}>Piloto Admin</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option></select></div>
      <div class="fs"><label class="fl">Ícono</label><input type="text" id="eu-icon" value="${u.icon || '👤'}" style="max-width:60px"></div>
      <div class="fs"><label class="fl">Nueva contraseña (dejar vacío para no cambiar)</label><input type="text" id="eu-pass" placeholder=""></div>
      <button class="btn" onclick="Admin.saveUser('${id}')">Guardar</button>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function saveUser(id) {
    DB.users[id].name = document.getElementById('eu-name').value;
    DB.users[id].role = document.getElementById('eu-role').value;
    DB.users[id].icon = document.getElementById('eu-icon').value;
    const pw = document.getElementById('eu-pass').value;
    if (pw && pw.length >= 4) { if (!DB.passwords) DB.passwords = {}; DB.passwords[id] = pw; }
    closeEdit(); await API.saveData(); buildAdminPanel();
  }

  async function deleteUser(id) {
    if (!confirm('¿Eliminar usuario ' + id + '?')) return;
    delete DB.users[id];
    if (DB.passwords) delete DB.passwords[id];
    await API.saveData(); buildAdminPanel();
  }

  // --- Password Reset (admin only) ---
  function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pw = '';
    for (let i = 0; i < 6; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  }

  async function resetUserPassword(userId) {
    if (!App.isAdmin()) return;
    if (!confirm(`¿Restablecer la contraseña de ${userId}?`)) return;
    const tempPw = generateTempPassword();
    if (!DB.passwords) DB.passwords = {};
    DB.passwords[userId] = tempPw;
    const ok = await API.saveData();
    if (ok) {
      // Show the temporary password in a modal
      document.getElementById('edit-modal-title').textContent = 'Contraseña restablecida';
      document.getElementById('edit-form-content').innerHTML = `
        <div class="temp-pw-display">
          <div class="label">Contraseña temporal para ${userId}</div>
          <div class="pw">${tempPw}</div>
          <div class="note">Comparte esta contraseña con el usuario. Podrá cambiarla desde Ajustes.</div>
        </div>
        <button class="btn" onclick="Admin.closeEdit()">Cerrar</button>`;
      document.getElementById('edit-modal').style.display = 'flex';
    } else {
      alert('Error al restablecer contraseña');
    }
  }

  // --- Pilot Roster ---
  function openAddPilot() {
    document.getElementById('edit-modal-title').textContent = 'Agregar piloto';
    const userOpts = '<option value="">— Ninguno —</option>' +
      Object.entries(DB.users).filter(([k, v]) => v.role === 'pilot_admin' || v.role === 'pilot')
        .map(([k, v]) => `<option value="${k}">${k} — ${v.name || ''}</option>`).join('');
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Nombre del piloto</label><input type="text" id="np2-name" placeholder="ej. Carlos Pérez"></div>
      <div class="fs"><label class="fl">Teléfono</label><input type="tel" id="np2-phone" placeholder="+502 5555-1234"></div>
      <div class="fs"><label class="fl">Vincular a usuario del sistema (opcional)</label><select id="np2-user">${userOpts}</select></div>
      <button class="btn" onclick="Admin.addPilot()">Crear piloto</button>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function addPilot() {
    const name = document.getElementById('np2-name').value.trim();
    const phone = document.getElementById('np2-phone').value.trim();
    const userId = document.getElementById('np2-user').value || null;
    if (!name) { alert('Ingresa nombre del piloto'); return; }
    if (!DB.pilots) DB.pilots = [];
    if (!DB.meta) DB.meta = {};
    const id = (DB.meta.last_pilot_id || 0) + 1;
    DB.meta.last_pilot_id = id;
    DB.pilots.push({ id, name, phone, user_id: userId, active: true });
    closeEdit();
    const ok = await API.saveData();
    if (ok) { buildAdminPanel(); alert('✓ Piloto ' + name + ' creado'); }
  }

  function editPilot(id) {
    const p = (DB.pilots || []).find(x => x.id === id); if (!p) return;
    const userOpts = '<option value="">— Ninguno —</option>' +
      Object.entries(DB.users).filter(([k, v]) => v.role === 'pilot_admin' || v.role === 'pilot')
        .map(([k, v]) => `<option value="${k}" ${p.user_id === k ? 'selected' : ''}>${k} — ${v.name || ''}</option>`).join('');
    document.getElementById('edit-modal-title').textContent = 'Editar piloto';
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Nombre</label><input type="text" id="ep2-name" value="${p.name}"></div>
      <div class="fs"><label class="fl">Teléfono</label><input type="tel" id="ep2-phone" value="${p.phone || ''}"></div>
      <div class="fs"><label class="fl">Vincular a usuario</label><select id="ep2-user">${userOpts}</select></div>
      <div class="fs"><label class="fl">Activo</label><select id="ep2-active"><option value="true" ${p.active !== false ? 'selected' : ''}>Sí</option><option value="false" ${p.active === false ? 'selected' : ''}>No</option></select></div>
      <div style="display:flex;gap:8px"><button class="btn" onclick="Admin.savePilot(${id})">Guardar</button><button class="btn" style="background:#8B1A1A" onclick="Admin.deletePilot(${id})">Eliminar</button></div>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function savePilot(id) {
    const p = (DB.pilots || []).find(x => x.id === id); if (!p) return;
    p.name = document.getElementById('ep2-name').value.trim();
    p.phone = document.getElementById('ep2-phone').value.trim();
    p.user_id = document.getElementById('ep2-user').value || null;
    p.active = document.getElementById('ep2-active').value === 'true';
    closeEdit(); await API.saveData(); buildAdminPanel();
  }

  async function deletePilot(id) {
    if (!confirm('¿Eliminar piloto?')) return;
    DB.pilots = (DB.pilots || []).filter(x => x.id !== id);
    closeEdit(); await API.saveData(); buildAdminPanel();
  }

  // --- Plane Management ---
  function openAddPlane() {
    document.getElementById('edit-modal-title').textContent = 'Agregar avión';
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Matrícula (ID)</label><input type="text" id="np-id" placeholder="TG-XXX" oninput="this.value=this.value.toUpperCase()"></div>
      <div class="fs"><label class="fl">Nombre</label><input type="text" id="np-name" placeholder="ej. Senshi II"></div>
      <div class="fs"><label class="fl">Tipo</label><input type="text" id="np-type" placeholder="ej. Cessna 182"></div>
      <button class="btn" onclick="Admin.addPlane()">Crear avión</button>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function addPlane() {
    const id = document.getElementById('np-id').value.trim().toUpperCase();
    const name = document.getElementById('np-name').value;
    const type = document.getElementById('np-type').value;
    if (!id) { alert('Ingresa matrícula'); return; }
    if (DB.planes.find(p => p.id === id)) { alert('Ya existe'); return; }
    DB.planes.push({ id, name, type, active: true });
    closeEdit(); await API.saveData(); buildAdminPanel(); Calendar.buildPlaneSelectors();
  }

  function editPlane(id) {
    const p = DB.planes.find(x => x.id === id); if (!p) return;
    document.getElementById('edit-modal-title').textContent = 'Editar ' + id;
    document.getElementById('edit-form-content').innerHTML = `
      <div class="fs"><label class="fl">Nombre</label><input type="text" id="ep-name" value="${p.name || ''}"></div>
      <div class="fs"><label class="fl">Tipo</label><input type="text" id="ep-type" value="${p.type || ''}"></div>
      <div class="fs"><label class="fl">Activo</label><select id="ep-active"><option value="true" ${p.active !== false ? 'selected' : ''}>Sí</option><option value="false" ${p.active === false ? 'selected' : ''}>No</option></select></div>
      <button class="btn" onclick="Admin.savePlane('${id}')">Guardar</button>`;
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function savePlane(id) {
    const p = DB.planes.find(x => x.id === id);
    p.name = document.getElementById('ep-name').value;
    p.type = document.getElementById('ep-type').value;
    p.active = document.getElementById('ep-active').value === 'true';
    closeEdit(); await API.saveData(); buildAdminPanel(); Calendar.buildPlaneSelectors();
  }

  // Worker config save
  async function saveWorkerCfg() {
    const url = document.getElementById('cfg-url').value.trim().replace(/\/+$/, '');
    const sec = document.getElementById('cfg-secret').value.trim();
    const msg = document.getElementById('cfg-msg');
    if (!url || !sec) { msg.textContent = 'Completa ambos campos'; return; }
    msg.textContent = 'Verificando…';
    try {
      const r = await fetch(url + '/data', { headers: { 'Authorization': 'Bearer ' + sec }, cache: 'no-store' });
      if (r.status === 401) { msg.textContent = 'Secret incorrecto'; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      API.setWorkerConfig(url, sec);
      msg.textContent = '✓ Guardado y verificado';
      msg.style.color = '#1A6B3A';
      await API.loadData();
      App.buildAll();
    } catch (e) { msg.textContent = 'Error: ' + e.message; msg.style.color = '#8B1A1A'; }
  }

  return {
    closeEdit, showSetupNeeded, hideSetupNeeded,
    buildAdminPanel,
    openAddUser, addUser, editUser, saveUser, deleteUser,
    resetUserPassword,
    openAddPilot, addPilot, editPilot, savePilot, deletePilot,
    openAddPlane, addPlane, editPlane, savePlane,
    saveWorkerCfg
  };
})();
