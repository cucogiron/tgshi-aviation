// =====================================================================
// TG-SHI v6.0 -- js/admin.js
// User, pilot, plane CRUD + password reset + worker config + setup
// =====================================================================

const Admin = (() => {

  function closeEdit() { document.getElementById('edit-modal').style.display = 'none'; }

  function showSetupNeeded(msg) {
    const area = document.getElementById('token-setup-area');
    if (!area) return;
    var inner = '<div class="token-setup"><h3>Configurar conexion</h3><p>' + (msg || 'Configura la conexion al servidor.') + '</p>';
    if (App.isAdmin()) {
      inner += '<div style="text-align:left;max-width:280px;margin:0 auto">'
        + '<div style="margin-bottom:8px"><label class="fl">Worker URL</label><input type="url" id="setup-url" value="' + API.getWorkerUrl() + '" placeholder="https://tgshi-api.xxx.workers.dev" style="font-size:12px"></div>'
        + '<div style="margin-bottom:8px"><label class="fl">Secret</label><input type="password" id="setup-secret" value="' + API.getWorkerSecret() + '" placeholder="secret" style="font-size:12px"></div>'
        + '<button onclick="API.quickSetup()">Conectar</button>'
        + '<div id="setup-msg" style="font-size:10px;color:#8892A4;margin-top:6px"></div>'
        + '</div>';
    } else {
      inner += '<p style="font-size:11px;color:#92400E">Pide a CUCO que configure.</p>';
    }
    inner += '</div>';
    area.innerHTML = inner;
  }

  function hideSetupNeeded() { const a = document.getElementById('token-setup-area'); if (a) a.innerHTML = ''; }

  function buildAdminPanel() {
    // Users list
    const ul = document.getElementById('user-list');
    if (ul) {
      ul.innerHTML = Object.entries(DB.users).map(function(entry) {
        var k = entry[0], v = entry[1];
        var phoneLine = v.phone ? ' - ' + v.phone : '';
        return '<div class="user-row">'
          + '<div class="user-info"><div class="user-icon">' + (v.icon || '?') + '</div><div><div class="user-name">' + k + '</div><div class="user-role">' + v.role + ' - ' + (v.name || '') + (v.email ? ' - ' + v.email : '') + phoneLine + '</div></div></div>'
          + '<div class="user-actions">'
          + '<button class="ubtn edit" onclick="Admin.editUser(\'' + k + '\')">Editar</button>'
          + (App.isAdmin() && k !== App.currentUser() ? '<button class="ubtn reset" onclick="Admin.resetUserPassword(\'' + k + '\')">Clave</button>' : '')
          + (k !== App.currentUser() ? '<button class="ubtn del" onclick="Admin.deleteUser(\'' + k + '\')">x</button>' : '')
          + '</div></div>';
      }).join('');
    }

    // Pilot roster list
    const pl2 = document.getElementById('pilot-roster-list');
    if (pl2) {
      const pilots = DB.pilots || [];
      if (pilots.length === 0) {
        pl2.innerHTML = '<div class="empty">Sin pilotos registrados</div>';
      } else {
        pl2.innerHTML = pilots.map(function(p) {
          return '<div class="pilot-row">'
            + '<div class="pilot-info"><div class="pilot-icon">P</div><div>'
            + '<div class="pilot-name">' + p.name + '</div>'
            + '<div class="pilot-phone">' + (p.phone || 'Sin telefono') + (p.user_id ? ' - usuario: ' + p.user_id : '') + '</div>'
            + '</div></div>'
            + '<div style="display:flex;align-items:center;gap:5px">'
            + '<span class="pilot-active ' + (p.active !== false ? 'yes' : 'no') + '">' + (p.active !== false ? 'Activo' : 'Inactivo') + '</span>'
            + '<button class="ubtn edit" onclick="Admin.editPilot(' + p.id + ')">Editar</button>'
            + '</div></div>';
        }).join('');
      }
    }

    // Planes list
    const pl = document.getElementById('plane-list');
    if (pl) {
      pl.innerHTML = DB.planes.map(function(p) {
        return '<div class="plane-row">'
          + '<div><div class="plane-name">' + p.id + '</div><div class="plane-type">' + (p.type || '') + ' ' + (p.active === false ? '(inactivo)' : '') + '</div></div>'
          + '<button class="ubtn edit" onclick="Admin.editPlane(\'' + p.id + '\')">Editar</button>'
          + '</div>';
      }).join('');
    }

    // Exchange partners list
    const xpList = document.getElementById('xp-list');
    if (xpList) {
      const partners = DB.exchange_partners || [];
      if (partners.length === 0) {
        xpList.innerHTML = '<div class="empty">Sin socios de intercambio</div>';
      } else {
        xpList.innerHTML = partners.map(function(p) {
          var planes = p.planes ? p.planes.join(', ') : (p.partner_plane || '--');
          return '<div class="plane-row">'
            + '<div><div class="plane-name">' + p.name + '</div><div class="plane-type">' + planes + ' - Rate ' + p.exchange_rate + ':1' + (p.notes ? ' - ' + p.notes : '') + '</div></div>'
            + '<button class="ubtn edit" onclick="Exchange.editPartner(' + p.id + ')">Editar</button>'
            + '</div>';
        }).join('');
      }
    }

    // Rates / Tarifas
    const curRate = (DB.rates && DB.rates.length > 0) ? DB.rates[DB.rates.length - 1] : {};
    const rtDisp = document.getElementById('rates-display');
    if (rtDisp) {
      let rhtml = '';
      if (curRate.d) {
        rhtml += '<div style="padding:8px 10px;background:#F0F7FF;border-radius:6px;margin-bottom:8px;font-size:11px;line-height:1.6">'
          + '<div style="font-weight:700;color:#1B2A4A;margin-bottom:2px">Vigente desde ' + curRate.d + '</div>'
          + '<div>Piloto: <b>$' + curRate.pilot + '/hr</b> - Espera: <b>$' + curRate.gw + '/hr</b></div>'
          + '<div>Admin: <b>$' + curRate.admin + '/mes</b> - Reserva: <b>$' + curRate.res + '/hr</b></div>'
          + '<div>Charter STD: <b>$' + curRate.std + '/hr</b> - FF: <b>$' + curRate.ff + '/hr</b></div>'
          + '</div>';
      }
      if (DB.rates.length > 1) {
        rhtml += '<div style="font-size:9px;color:#8892A4;margin-bottom:4px">Historial:</div>';
        DB.rates.slice(0, -1).forEach(function(r) {
          rhtml += '<div style="font-size:9px;color:#8892A4;padding:2px 0">Desde ' + r.d + ': $' + r.pilot + '/hr - Espera $' + r.gw + ' - Admin $' + r.admin + ' - Res $' + r.res + ' - STD $' + r.std + ' - FF $' + r.ff + '</div>';
        });
      }
      rtDisp.innerHTML = rhtml;
    }
    var rpil = document.getElementById('rt-pilot');
    if (rpil) rpil.value = curRate.pilot != null ? curRate.pilot : '';
    var rgw = document.getElementById('rt-gw');
    if (rgw) rgw.value = curRate.gw != null ? curRate.gw : '';
    var radm = document.getElementById('rt-admin');
    if (radm) radm.value = curRate.admin != null ? curRate.admin : '';
    var rres = document.getElementById('rt-res');
    if (rres) rres.value = curRate.res != null ? curRate.res : '';
    var rstd = document.getElementById('rt-std');
    if (rstd) rstd.value = curRate.std != null ? curRate.std : '';
    var rff = document.getElementById('rt-ff');
    if (rff) rff.value = curRate.ff != null ? curRate.ff : '';
    var rdt = document.getElementById('rt-date');
    if (rdt) rdt.value = curRate.d || '';

    // Worker config
    var u = document.getElementById('cfg-url'), s = document.getElementById('cfg-secret');
    if (u) u.value = API.getWorkerUrl();
    if (s) s.value = API.getWorkerSecret();
  }

  // --- Add User ---
  function openAddUser() {
    document.getElementById('edit-modal-title').textContent = 'Agregar usuario';
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">ID (username)</label><input type="text" id="nu-id" placeholder="ej. PEDRO" oninput="this.value=this.value.toUpperCase()"></div>'
      + '<div class="fs"><label class="fl">Nombre completo</label><input type="text" id="nu-name" placeholder="Pedro Garcia"></div>'
      + '<div class="fs"><label class="fl">Email</label><input type="email" id="nu-email" placeholder="pedro@email.com"></div>'
      + '<div class="fs"><label class="fl">Telefono (con codigo de pais)</label><input type="tel" id="nu-phone" placeholder="+502 5555-1234"></div>'
      + '<div class="fs"><label class="fl">Rol</label><select id="nu-role"><option value="owner">Owner (propietario)</option><option value="pilot">Piloto</option><option value="pilot_admin">Piloto Admin</option><option value="admin">Administrador</option></select></div>'
      + '<div class="fs"><label class="fl">Icono</label><input type="text" id="nu-icon" value="?" style="max-width:60px"></div>'
      + '<div class="fs"><label class="fl">Contrasena inicial</label><input type="text" id="nu-pass" placeholder="minimo 4 caracteres"></div>'
      + '<button class="btn" onclick="Admin.addUser()">Crear usuario</button>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function addUser() {
    var id = document.getElementById('nu-id').value.trim().toUpperCase();
    var name = document.getElementById('nu-name').value.trim();
    var email = (document.getElementById('nu-email').value || '').trim().toLowerCase();
    var phone = (document.getElementById('nu-phone').value || '').trim();
    var role = document.getElementById('nu-role').value;
    var icon = document.getElementById('nu-icon').value || '?';
    var pass = document.getElementById('nu-pass').value;
    if (!id || id.length < 2) { alert('ID debe tener al menos 2 caracteres'); return; }
    if (DB.users[id]) { alert('Usuario ya existe'); return; }
    if (!pass || pass.length < 4) { alert('Contrasena minimo 4 caracteres'); return; }
    var userData = { role: role, icon: icon, name: name, email: email };
    if (phone) userData.phone = phone;
    DB.users[id] = userData;
    if (!DB.passwords) DB.passwords = {};
    DB.passwords[id] = pass;
    closeEdit();
    var ok = await API.saveData();
    if (ok) { buildAdminPanel(); alert('Usuario ' + id + ' creado'); }
  }

  function editUser(id) {
    var u = DB.users[id]; if (!u) return;
    document.getElementById('edit-modal-title').textContent = 'Editar ' + id;
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Nombre</label><input type="text" id="eu-name" value="' + (u.name || '') + '"></div>'
      + '<div class="fs"><label class="fl">Email</label><input type="email" id="eu-email" value="' + (u.email || '') + '" placeholder="user@email.com"></div>'
      + '<div class="fs"><label class="fl">Telefono (con codigo de pais)</label><input type="tel" id="eu-phone" value="' + (u.phone || '') + '" placeholder="+502 5555-1234"></div>'
      + '<div class="fs"><label class="fl">Rol</label><select id="eu-role"><option value="owner" ' + (u.role === 'owner' ? 'selected' : '') + '>Owner</option><option value="pilot" ' + (u.role === 'pilot' ? 'selected' : '') + '>Piloto</option><option value="pilot_admin" ' + (u.role === 'pilot_admin' ? 'selected' : '') + '>Piloto Admin</option><option value="admin" ' + (u.role === 'admin' ? 'selected' : '') + '>Administrador</option></select></div>'
      + '<div class="fs"><label class="fl">Icono</label><input type="text" id="eu-icon" value="' + (u.icon || '?') + '" style="max-width:60px"></div>'
      + '<div class="fs"><label class="fl">Nueva contrasena (dejar vacio para no cambiar)</label><input type="text" id="eu-pass" placeholder=""></div>'
      + '<button class="btn" onclick="Admin.saveUser(\'' + id + '\')">Guardar</button>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function saveUser(id) {
    DB.users[id].name = document.getElementById('eu-name').value;
    DB.users[id].email = (document.getElementById('eu-email').value || '').trim().toLowerCase();
    DB.users[id].phone = (document.getElementById('eu-phone').value || '').trim();
    DB.users[id].role = document.getElementById('eu-role').value;
    DB.users[id].icon = document.getElementById('eu-icon').value;
    var pw = document.getElementById('eu-pass').value;
    if (pw && pw.length >= 4) { if (!DB.passwords) DB.passwords = {}; DB.passwords[id] = pw; }
    // Clean up empty phone
    if (!DB.users[id].phone) delete DB.users[id].phone;
    closeEdit(); await API.saveData(); buildAdminPanel();
  }

  async function deleteUser(id) {
    if (!confirm('Eliminar usuario ' + id + '?')) return;
    delete DB.users[id];
    if (DB.passwords) delete DB.passwords[id];
    await API.saveData(); buildAdminPanel();
  }

  // --- Password Reset (admin only) ---
  function generateTempPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var pw = '';
    for (var i = 0; i < 6; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  }

  async function resetUserPassword(userId) {
    if (!App.isAdmin()) return;
    if (!confirm('Restablecer la contrasena de ' + userId + '?')) return;
    var tempPw = generateTempPassword();
    if (!DB.passwords) DB.passwords = {};
    DB.passwords[userId] = tempPw;
    var ok = await API.saveData();
    if (ok) {
      document.getElementById('edit-modal-title').textContent = 'Contrasena restablecida';
      document.getElementById('edit-form-content').innerHTML =
        '<div class="temp-pw-display">'
        + '<div class="label">Contrasena temporal para ' + userId + '</div>'
        + '<div class="pw">' + tempPw + '</div>'
        + '<div class="note">Comparte esta contrasena con el usuario. Podra cambiarla desde Ajustes.</div>'
        + '</div>'
        + '<button class="btn" onclick="Admin.closeEdit()">Cerrar</button>';
      document.getElementById('edit-modal').style.display = 'flex';
    } else {
      alert('Error al restablecer contrasena');
    }
  }

  // --- Pilot Roster ---
  function openAddPilot() {
    document.getElementById('edit-modal-title').textContent = 'Agregar piloto';
    var userOpts = '<option value="">-- Ninguno --</option>'
      + Object.entries(DB.users).filter(function(entry) { return entry[1].role === 'pilot_admin' || entry[1].role === 'pilot'; })
        .map(function(entry) { return '<option value="' + entry[0] + '">' + entry[0] + ' -- ' + (entry[1].name || '') + '</option>'; }).join('');
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Nombre del piloto</label><input type="text" id="np2-name" placeholder="ej. Carlos Perez"></div>'
      + '<div class="fs"><label class="fl">Telefono</label><input type="tel" id="np2-phone" placeholder="+502 5555-1234"></div>'
      + '<div class="fs"><label class="fl">Vincular a usuario del sistema (opcional)</label><select id="np2-user">' + userOpts + '</select></div>'
      + '<button class="btn" onclick="Admin.addPilot()">Crear piloto</button>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function addPilot() {
    var name = document.getElementById('np2-name').value.trim();
    var phone = document.getElementById('np2-phone').value.trim();
    var userId = document.getElementById('np2-user').value || null;
    if (!name) { alert('Ingresa nombre del piloto'); return; }
    if (!DB.pilots) DB.pilots = [];
    if (!DB.meta) DB.meta = {};
    var id = (DB.meta.last_pilot_id || 0) + 1;
    DB.meta.last_pilot_id = id;
    DB.pilots.push({ id: id, name: name, phone: phone, user_id: userId, active: true });
    closeEdit();
    var ok = await API.saveData();
    if (ok) { buildAdminPanel(); alert('Piloto ' + name + ' creado'); }
  }

  function editPilot(id) {
    var p = (DB.pilots || []).find(function(x) { return x.id === id; }); if (!p) return;
    var userOpts = '<option value="">-- Ninguno --</option>'
      + Object.entries(DB.users).filter(function(entry) { return entry[1].role === 'pilot_admin' || entry[1].role === 'pilot'; })
        .map(function(entry) { return '<option value="' + entry[0] + '" ' + (p.user_id === entry[0] ? 'selected' : '') + '>' + entry[0] + ' -- ' + (entry[1].name || '') + '</option>'; }).join('');
    document.getElementById('edit-modal-title').textContent = 'Editar piloto';
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Nombre</label><input type="text" id="ep2-name" value="' + p.name + '"></div>'
      + '<div class="fs"><label class="fl">Telefono</label><input type="tel" id="ep2-phone" value="' + (p.phone || '') + '"></div>'
      + '<div class="fs"><label class="fl">Vincular a usuario</label><select id="ep2-user">' + userOpts + '</select></div>'
      + '<div class="fs"><label class="fl">Activo</label><select id="ep2-active"><option value="true" ' + (p.active !== false ? 'selected' : '') + '>Si</option><option value="false" ' + (p.active === false ? 'selected' : '') + '>No</option></select></div>'
      + '<div style="display:flex;gap:8px"><button class="btn" onclick="Admin.savePilot(' + id + ')">Guardar</button><button class="btn" style="background:#8B1A1A" onclick="Admin.deletePilot(' + id + ')">Eliminar</button></div>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function savePilot(id) {
    var p = (DB.pilots || []).find(function(x) { return x.id === id; }); if (!p) return;
    p.name = document.getElementById('ep2-name').value.trim();
    p.phone = document.getElementById('ep2-phone').value.trim();
    p.user_id = document.getElementById('ep2-user').value || null;
    p.active = document.getElementById('ep2-active').value === 'true';
    closeEdit(); await API.saveData(); buildAdminPanel();
  }

  async function deletePilot(id) {
    if (!confirm('Eliminar piloto?')) return;
    DB.pilots = (DB.pilots || []).filter(function(x) { return x.id !== id; });
    closeEdit(); await API.saveData(); buildAdminPanel();
  }

  // --- Plane Management ---
  function openAddPlane() {
    document.getElementById('edit-modal-title').textContent = 'Agregar avion';
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Matricula (ID)</label><input type="text" id="np-id" placeholder="TG-XXX" oninput="this.value=this.value.toUpperCase()"></div>'
      + '<div class="fs"><label class="fl">Nombre</label><input type="text" id="np-name" placeholder="ej. Senshi II"></div>'
      + '<div class="fs"><label class="fl">Tipo</label><input type="text" id="np-type" placeholder="ej. Cessna 182"></div>'
      + '<button class="btn" onclick="Admin.addPlane()">Crear avion</button>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function addPlane() {
    var id = document.getElementById('np-id').value.trim().toUpperCase();
    var name = document.getElementById('np-name').value;
    var type = document.getElementById('np-type').value;
    if (!id) { alert('Ingresa matricula'); return; }
    if (DB.planes.find(function(p) { return p.id === id; })) { alert('Ya existe'); return; }
    DB.planes.push({ id: id, name: name, type: type, active: true });
    closeEdit(); await API.saveData(); buildAdminPanel(); Calendar.buildPlaneSelectors();
  }

  function editPlane(id) {
    var p = DB.planes.find(function(x) { return x.id === id; }); if (!p) return;
    document.getElementById('edit-modal-title').textContent = 'Editar ' + id;
    document.getElementById('edit-form-content').innerHTML =
      '<div class="fs"><label class="fl">Nombre</label><input type="text" id="ep-name" value="' + (p.name || '') + '"></div>'
      + '<div class="fs"><label class="fl">Tipo</label><input type="text" id="ep-type" value="' + (p.type || '') + '"></div>'
      + '<div class="fs"><label class="fl">Activo</label><select id="ep-active"><option value="true" ' + (p.active !== false ? 'selected' : '') + '>Si</option><option value="false" ' + (p.active === false ? 'selected' : '') + '>No</option></select></div>'
      + '<button class="btn" onclick="Admin.savePlane(\'' + id + '\')">Guardar</button>';
    document.getElementById('edit-modal').style.display = 'flex';
  }

  async function savePlane(id) {
    var p = DB.planes.find(function(x) { return x.id === id; });
    p.name = document.getElementById('ep-name').value;
    p.type = document.getElementById('ep-type').value;
    p.active = document.getElementById('ep-active').value === 'true';
    closeEdit(); await API.saveData(); buildAdminPanel(); Calendar.buildPlaneSelectors();
  }

  // Worker config save
  async function saveWorkerCfg() {
    var url = document.getElementById('cfg-url').value.trim().replace(/\/+$/, '');
    var sec = document.getElementById('cfg-secret').value.trim();
    var msg = document.getElementById('cfg-msg');
    if (!url || !sec) { msg.textContent = 'Completa ambos campos'; return; }
    msg.textContent = 'Verificando...';
    try {
      var r = await fetch(url + '/data', { headers: { 'Authorization': 'Bearer ' + sec }, cache: 'no-store' });
      if (r.status === 401) { msg.textContent = 'Secret incorrecto'; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      API.setWorkerConfig(url, sec);
      msg.textContent = 'Guardado y verificado';
      msg.style.color = '#1A6B3A';
      await API.loadData();
      App.buildAll();
    } catch (e) { msg.textContent = 'Error: ' + e.message; msg.style.color = '#8B1A1A'; }
  }

  // Rates save
  async function saveRates() {
    var msg = document.getElementById('rates-msg');
    var pilot = parseFloat(document.getElementById('rt-pilot').value);
    var gw = parseFloat(document.getElementById('rt-gw').value);
    var admin = parseFloat(document.getElementById('rt-admin').value);
    var res = parseFloat(document.getElementById('rt-res').value);
    var std = parseFloat(document.getElementById('rt-std').value);
    var ff = parseFloat(document.getElementById('rt-ff').value);
    var d = document.getElementById('rt-date').value;
    if (!pilot || !gw || !admin || !std || !ff || !d) { msg.textContent = 'Completa todos los campos'; msg.style.color = '#8B1A1A'; return; }
    var newRate = { d: d, pilot: pilot, gw: gw, admin: admin, res: res || 0, std: std, ff: ff };

    // Check if same date exists -- update in place; otherwise add new
    var existing = DB.rates.findIndex(function(r) { return r.d === d; });
    if (existing >= 0) {
      DB.rates[existing] = newRate;
    } else {
      DB.rates.push(newRate);
      DB.rates.sort(function(a, b) { return a.d.localeCompare(b.d); });
    }

    var ok = await API.saveData();
    if (ok) {
      msg.textContent = 'Tarifas guardadas';
      msg.style.color = '#1A6B3A';
      buildAdminPanel();
    } else {
      msg.textContent = 'Error al guardar';
      msg.style.color = '#8B1A1A';
    }
  }

  return {
    closeEdit: closeEdit,
    showSetupNeeded: showSetupNeeded,
    hideSetupNeeded: hideSetupNeeded,
    buildAdminPanel: buildAdminPanel,
    openAddUser: openAddUser,
    addUser: addUser,
    editUser: editUser,
    saveUser: saveUser,
    deleteUser: deleteUser,
    resetUserPassword: resetUserPassword,
    openAddPilot: openAddPilot,
    addPilot: addPilot,
    editPilot: editPilot,
    savePilot: savePilot,
    deletePilot: deletePilot,
    openAddPlane: openAddPlane,
    addPlane: addPlane,
    editPlane: editPlane,
    savePlane: savePlane,
    saveWorkerCfg: saveWorkerCfg,
    saveRates: saveRates
  };
})();
