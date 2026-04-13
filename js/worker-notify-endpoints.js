// =====================================================================
// TG-SHI Worker -- Flight Notification Endpoints
// Add these routes to your existing Cloudflare Worker
//
// SETUP REQUIRED:
// 1. RESEND_API_KEY already exists
// 2. For Phase 2 WhatsApp/SMS, add:
//    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//    TWILIO_WHATSAPP_FROM, TWILIO_SMS_FROM
// =====================================================================

var NOTIFY_FROM_EMAIL = 'noreply@senshi-aviation.com';
var APP_URL = 'https://cucogiron.github.io/tgshi-aviation';

// --- Route handler: POST /notify ---
// Add to your existing worker fetch() handler:
//
// if (url.pathname === '/notify' && request.method === 'POST') {
//   return handleNotify(request, env);
// }

async function handleNotify(request, env) {
  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  // Auth check
  var authHeader = request.headers.get('Authorization') || '';
  var token = authHeader.replace('Bearer ', '');
  if (!token || token !== env.WORKER_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders
    });
  }

  try {
    var body = await request.json();
    var notifyType = body.type;
    var scheduleId = body.schedule_id;

    if (!notifyType || !scheduleId) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing type or schedule_id' }), {
        headers: corsHeaders
      });
    }

    // Load data
    var raw = await env.DATA.get('tgshi_data');
    if (!raw) {
      return new Response(JSON.stringify({ ok: false, error: 'Data not available' }), {
        headers: corsHeaders
      });
    }
    var data = JSON.parse(raw);

    // Find schedule entry
    var sched = null;
    var schedList = data.schedule || [];
    for (var i = 0; i < schedList.length; i++) {
      if (schedList[i].id === scheduleId) { sched = schedList[i]; break; }
    }
    if (!sched) {
      return new Response(JSON.stringify({ ok: false, error: 'Schedule not found' }), {
        headers: corsHeaders
      });
    }

    var result = { email: [], whatsapp: [], sms: [] };

    if (notifyType === 'flight_requested') {
      result = await notifyFlightRequested(env, data, sched);
    } else if (notifyType === 'flight_confirmed') {
      result = await notifyFlightConfirmed(env, data, sched);
    } else {
      return new Response(JSON.stringify({ ok: false, error: 'Unknown type: ' + notifyType }), {
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({ ok: true, sent: result }), {
      headers: corsHeaders
    });

  } catch (e) {
    console.error('handleNotify error:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      headers: corsHeaders
    });
  }
}

// =====================================================================
// Notification 1: Flight Requested
// =====================================================================
async function notifyFlightRequested(env, data, sched) {
  var result = { email: [], whatsapp: [], sms: [] };
  var users = data.users || {};
  var bookedBy = sched.booked_by || '';
  var booker = users[bookedBy] || {};
  var bookerName = booker.name || bookedBy;

  // Recipients: Fernando (pilot_admin) + the user who booked
  var recipients = [];

  // Find all pilot_admin users (Fernando)
  var uKeys = Object.keys(users);
  for (var i = 0; i < uKeys.length; i++) {
    var uid = uKeys[i];
    var u = users[uid];
    if (u.role === 'pilot_admin' && u.email) {
      recipients.push({ uid: uid, email: u.email, name: u.name || uid, phone: u.phone || '' });
    }
  }

  // Add booker if they have email and not already in list
  if (booker.email) {
    var already = false;
    for (var j = 0; j < recipients.length; j++) {
      if (recipients[j].uid === bookedBy) { already = true; break; }
    }
    if (!already) {
      recipients.push({ uid: bookedBy, email: booker.email, name: bookerName, phone: booker.phone || '' });
    }
  }

  // Build email content
  var dateDisplay = formatDateES(sched.date);
  var timeWindow = sched.start + ' - ' + sched.end;
  var route = sched.route || 'Pendiente';
  var plane = sched.plane_id || 'TG-SHI';
  var notes = sched.notes || '';

  var subject = 'Nueva solicitud de vuelo -- TG-SHI';

  // Send emails
  for (var k = 0; k < recipients.length; k++) {
    var recip = recipients[k];
    var isPilotAdmin = (users[recip.uid] && users[recip.uid].role === 'pilot_admin');
    var htmlBody = buildRequestedEmailHTML(dateDisplay, timeWindow, route, bookerName, plane, notes, isPilotAdmin);
    var sent = await sendEmailResend(env, recip.email, recip.name, subject, htmlBody);
    if (sent) result.email.push(recip.uid);
  }

  // Phase 2: WhatsApp / SMS
  // (stubs ready for TWILIO integration)

  return result;
}

// =====================================================================
// Notification 2: Flight Confirmed
// =====================================================================
async function notifyFlightConfirmed(env, data, sched) {
  var result = { email: [], whatsapp: [], sms: [] };
  var users = data.users || {};
  var pilots = data.pilots || [];
  var bookedBy = sched.booked_by || '';
  var booker = users[bookedBy] || {};
  var bookerName = booker.name || bookedBy;

  var recipients = [];

  // Booker gets notified
  if (booker.email) {
    recipients.push({ uid: bookedBy, email: booker.email, name: bookerName, phone: booker.phone || '' });
  }

  // Assigned pilot from roster
  var assignedPilot = null;
  if (sched.pilot_roster_id) {
    for (var i = 0; i < pilots.length; i++) {
      if (pilots[i].id === sched.pilot_roster_id) { assignedPilot = pilots[i]; break; }
    }
  }

  // If pilot has a linked user_id with email, add them
  if (assignedPilot && assignedPilot.user_id && users[assignedPilot.user_id]) {
    var pilotUser = users[assignedPilot.user_id];
    if (pilotUser.email) {
      var alreadyAdded = false;
      for (var j = 0; j < recipients.length; j++) {
        if (recipients[j].uid === assignedPilot.user_id) { alreadyAdded = true; break; }
      }
      if (!alreadyAdded) {
        recipients.push({
          uid: assignedPilot.user_id,
          email: pilotUser.email,
          name: pilotUser.name || assignedPilot.name,
          phone: pilotUser.phone || assignedPilot.phone || ''
        });
      }
    }
  }

  // Build email content
  var dateDisplay = formatDateES(sched.date);
  var timeWindow = sched.start + ' - ' + sched.end;
  var route = sched.route || 'Pendiente';
  var plane = sched.plane_id || 'TG-SHI';
  var notes = sched.notes || '';

  var flightTypeLabels = {
    PERSONAL: 'Personal',
    STD: 'Charter STD',
    FF: 'Charter FF',
    MANTE: 'Mantenimiento'
  };
  var flightType = flightTypeLabels[sched.flight_type] || sched.flight_type || 'N/A';
  var pilotName = assignedPilot ? assignedPilot.name : 'Sin asignar';
  var pilotPhone = assignedPilot ? (assignedPilot.phone || '') : '';

  var subject = 'Vuelo confirmado -- TG-SHI';

  // Send emails
  for (var k = 0; k < recipients.length; k++) {
    var recip = recipients[k];
    var htmlBody = buildConfirmedEmailHTML(dateDisplay, timeWindow, route, flightType, pilotName, pilotPhone, bookerName, plane, notes);
    var sent = await sendEmailResend(env, recip.email, recip.name, subject, htmlBody);
    if (sent) result.email.push(recip.uid);
  }

  return result;
}

// =====================================================================
// Email sending via Resend
// =====================================================================
async function sendEmailResend(env, toEmail, toName, subject, htmlBody) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return false;
  }
  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Senshi Aviation <' + NOTIFY_FROM_EMAIL + '>',
        to: [toEmail],
        subject: subject,
        html: htmlBody
      })
    });
    if (!res.ok) {
      var errText = await res.text();
      console.error('Resend error:', res.status, errText);
    }
    return res.ok;
  } catch (e) {
    console.error('sendEmailResend error:', e);
    return false;
  }
}

// =====================================================================
// HTML Email Templates
// =====================================================================

function buildRequestedEmailHTML(date, time, route, requester, plane, notes, isPilotAdmin) {
  var pendingLine = '';
  if (isPilotAdmin) {
    pendingLine = '<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px 14px;margin-top:16px;font-size:13px;color:#92400E;text-align:center">'
      + '<b>Pendiente tu confirmacion</b><br>'
      + '<a href="' + APP_URL + '" style="color:#92400E;font-weight:700">Abrir TG-SHI</a>'
      + '</div>';
  }

  var notesLine = '';
  if (notes) {
    notesLine = '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px;width:120px">Notas</td>'
      + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(notes) + '</td></tr>';
  }

  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica Neue,sans-serif;max-width:500px;margin:0 auto;padding:0">'
    + '<div style="background:#1B2A4A;padding:20px 24px;border-radius:12px 12px 0 0">'
    + '<div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:.04em">TG-SHI</div>'
    + '<div style="font-size:9px;color:rgba(255,255,255,.45);letter-spacing:.12em;text-transform:uppercase">Senshi Aviation</div>'
    + '</div>'
    + '<div style="background:#fff;padding:24px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">'
    + '<div style="font-size:16px;font-weight:700;color:#1B2A4A;margin-bottom:4px">Nueva solicitud de vuelo</div>'
    + '<div style="font-size:11px;color:#8892A4;margin-bottom:16px">Se ha registrado una nueva reserva pendiente de confirmacion.</div>'
    + '<table style="width:100%;border-collapse:collapse">'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px;width:120px">Fecha</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(date) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Horario</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(time) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Ruta</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(route) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Solicitado por</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(requester) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Avion</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(plane) + '</td></tr>'
    + notesLine
    + '</table>'
    + pendingLine
    + '</div>'
    + '<div style="text-align:center;padding:16px;font-size:10px;color:#AAA">TG-SHI - Senshi Aviation</div>'
    + '</div>';
}

function buildConfirmedEmailHTML(date, time, route, flightType, pilotName, pilotPhone, requester, plane, notes) {
  var pilotDisplay = escapeHtml(pilotName);
  if (pilotPhone) {
    pilotDisplay = pilotDisplay + ' - ' + escapeHtml(pilotPhone);
  }

  var notesLine = '';
  if (notes) {
    notesLine = '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px;width:120px">Notas</td>'
      + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(notes) + '</td></tr>';
  }

  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Helvetica Neue,sans-serif;max-width:500px;margin:0 auto;padding:0">'
    + '<div style="background:#1B2A4A;padding:20px 24px;border-radius:12px 12px 0 0">'
    + '<div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:.04em">TG-SHI</div>'
    + '<div style="font-size:9px;color:rgba(255,255,255,.45);letter-spacing:.12em;text-transform:uppercase">Senshi Aviation</div>'
    + '</div>'
    + '<div style="background:#fff;padding:24px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">'
    + '<div style="background:#ECFDF5;border:1px solid #10B981;border-radius:8px;padding:10px 14px;margin-bottom:16px;text-align:center">'
    + '<div style="font-size:15px;font-weight:700;color:#065F46">Vuelo confirmado</div>'
    + '</div>'
    + '<table style="width:100%;border-collapse:collapse">'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px;width:120px">Fecha</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(date) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Horario</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(time) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Ruta</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(route) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Tipo de vuelo</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(flightType) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Piloto asignado</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + pilotDisplay + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Solicitado por</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(requester) + '</td></tr>'
    + '<tr><td style="padding:6px 0;color:#8892A4;font-size:12px">Avion</td>'
    + '<td style="padding:6px 0;font-size:13px;font-weight:600;color:#1B2A4A">' + escapeHtml(plane) + '</td></tr>'
    + notesLine
    + '</table>'
    + '<div style="text-align:center;margin-top:16px">'
    + '<a href="' + APP_URL + '" style="display:inline-block;padding:12px 28px;background:#1B2A4A;color:#fff;text-decoration:none;border-radius:10px;font-size:13px;font-weight:700">Abrir TG-SHI</a>'
    + '</div>'
    + '</div>'
    + '<div style="text-align:center;padding:16px;font-size:10px;color:#AAA">TG-SHI - Senshi Aviation</div>'
    + '</div>';
}

// =====================================================================
// Helpers
// =====================================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateES(ds) {
  // "2026-04-15" -> "15 ABR 2026"
  var months = ['', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  var parts = ds.split('-');
  var day = parseInt(parts[2], 10);
  var mon = parseInt(parts[1], 10);
  var year = parts[0];
  return day + ' ' + months[mon] + ' ' + year;
}

// =====================================================================
// Phase 2 stubs: WhatsApp + SMS via Twilio
// =====================================================================

// Uncomment and wire up when TWILIO credentials are added to env
//
// async function sendWhatsApp(env, toPhone, message) {
//   if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) return false;
//   var url = 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json';
//   var auth = btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
//   var body = new URLSearchParams();
//   body.set('From', env.TWILIO_WHATSAPP_FROM);
//   body.set('To', 'whatsapp:' + toPhone);
//   body.set('Body', message);
//   try {
//     var res = await fetch(url, {
//       method: 'POST',
//       headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
//       body: body.toString()
//     });
//     return res.ok;
//   } catch (e) { console.error('WhatsApp error:', e); return false; }
// }
//
// async function sendSMS(env, toPhone, message) {
//   if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_SMS_FROM) return false;
//   var url = 'https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json';
//   var auth = btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN);
//   var body = new URLSearchParams();
//   body.set('From', env.TWILIO_SMS_FROM);
//   body.set('To', toPhone);
//   body.set('Body', message);
//   try {
//     var res = await fetch(url, {
//       method: 'POST',
//       headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
//       body: body.toString()
//     });
//     return res.ok;
//   } catch (e) { console.error('SMS error:', e); return false; }
// }
//
// function buildFlightTextMessage(type, date, time, route, requester, plane, pilotName, flightType, notes) {
//   var lines = [];
//   if (type === 'requested') {
//     lines.push('NUEVA SOLICITUD DE VUELO - TG-SHI');
//   } else {
//     lines.push('VUELO CONFIRMADO - TG-SHI');
//   }
//   lines.push('Fecha: ' + date);
//   lines.push('Horario: ' + time);
//   lines.push('Ruta: ' + route);
//   lines.push('Solicitado por: ' + requester);
//   lines.push('Avion: ' + plane);
//   if (flightType) lines.push('Tipo: ' + flightType);
//   if (pilotName) lines.push('Piloto: ' + pilotName);
//   if (notes) lines.push('Notas: ' + notes);
//   lines.push('');
//   lines.push(APP_URL);
//   return lines.join('\n');
// }
