// =====================================================================
// TG-SHI Worker — Password Reset Endpoints
// Add these routes to your existing Cloudflare Worker
//
// SETUP REQUIRED:
// 1. Add environment variable RESEND_API_KEY in Workers settings
// 2. Add a KV namespace binding called RESET_TOKENS (or use your existing KV)
// 3. Update RESET_PAGE_URL to your GitHub Pages reset.html URL
// 4. Update FROM_EMAIL to your verified Resend sender domain
// =====================================================================

const RESET_PAGE_URL = 'https://cucogiron.github.io/tgshi-aviation/reset.html';
const FROM_EMAIL = 'noreply@senshi-aviation.com'; // Must be verified in Resend
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

// --- Helper: generate random token ---
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const arr = new Uint8Array(48);
  crypto.getRandomValues(arr);
  for (const b of arr) token += chars[b % chars.length];
  return token;
}

// --- Helper: send email via Resend ---
async function sendResetEmail(env, toEmail, userName, token) {
  const resetLink = `${RESET_PAGE_URL}?token=${token}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `Senshi Aviation <${FROM_EMAIL}>`,
      to: [toEmail],
      subject: 'Restablecer contraseña — TG-SHI',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;max-width:500px;margin:0 auto;padding:30px">
          <div style="font-size:24px;font-weight:900;color:#1B2A4A;letter-spacing:.04em">TG-SHI</div>
          <div style="font-size:10px;color:#8892A4;letter-spacing:.1em;text-transform:uppercase;margin-bottom:24px">Senshi Aviation</div>
          <p style="font-size:14px;color:#333;line-height:1.6">
            Hola <b>${userName}</b>,
          </p>
          <p style="font-size:14px;color:#333;line-height:1.6">
            Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para crear una nueva:
          </p>
          <div style="text-align:center;margin:28px 0">
            <a href="${resetLink}" style="display:inline-block;padding:14px 36px;background:#1B2A4A;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700">Restablecer contraseña</a>
          </div>
          <p style="font-size:12px;color:#8892A4;line-height:1.6">
            Este enlace expira en 1 hora. Si no solicitaste este cambio, puedes ignorar este email.
          </p>
          <p style="font-size:11px;color:#AAA;margin-top:24px;border-top:1px solid #EEE;padding-top:12px">
            TG-SHI · Senshi Aviation
          </p>
        </div>
      `
    })
  });

  return res.ok;
}

// =====================================================================
// ADD THESE ROUTE HANDLERS TO YOUR EXISTING WORKER'S fetch() HANDLER
// =====================================================================

// In your existing worker, add these two route checks:
//
// if (url.pathname === '/reset-request' && request.method === 'POST') {
//   return handleResetRequest(request, env);
// }
// if (url.pathname === '/reset-confirm' && request.method === 'POST') {
//   return handleResetConfirm(request, env);
// }

async function handleResetRequest(request, env) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const { uid, email } = await request.json();
    if (!uid || !email) {
      return new Response(JSON.stringify({ ok: false, error: 'Falta usuario o email' }), { headers: corsHeaders });
    }

    // Load current data from KV
    const raw = await env.DATA.get('tgshi_data');
    if (!raw) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos no disponibles' }), { headers: corsHeaders });
    }
    const data = JSON.parse(raw);

    // Verify user exists and email matches
    const user = data.users && data.users[uid.toUpperCase()];
    if (!user || !user.email || user.email.toLowerCase() !== email.toLowerCase()) {
      // Always return success to prevent user enumeration
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // Generate token and store with expiry
    const token = generateToken();
    await env.DATA.put(`reset_token:${token}`, JSON.stringify({
      uid: uid.toUpperCase(),
      created: Date.now()
    }), { expirationTtl: TOKEN_EXPIRY_SECONDS });

    // Send email via Resend
    const sent = await sendResetEmail(env, user.email, user.name || uid, token);
    if (!sent) {
      console.error('Failed to send reset email to', user.email);
    }

    // Always return success (don't leak whether user/email exists)
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

  } catch (e) {
    console.error('handleResetRequest error:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), { headers: corsHeaders });
  }
}

async function handleResetConfirm(request, env) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const { token, password } = await request.json();
    if (!token || !password || password.length < 4) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos inválidos' }), { headers: corsHeaders });
    }

    // Look up token
    const tokenRaw = await env.DATA.get(`reset_token:${token}`);
    if (!tokenRaw) {
      return new Response(JSON.stringify({ ok: false, error: 'Token expired or invalid' }), { headers: corsHeaders });
    }
    const tokenData = JSON.parse(tokenRaw);

    // Load current data
    const raw = await env.DATA.get('tgshi_data');
    if (!raw) {
      return new Response(JSON.stringify({ ok: false, error: 'Datos no disponibles' }), { headers: corsHeaders });
    }
    const data = JSON.parse(raw);

    // Update password
    if (!data.passwords) data.passwords = {};
    data.passwords[tokenData.uid] = password;

    // Save data back
    await env.DATA.put('tgshi_data', JSON.stringify(data));

    // Delete used token
    await env.DATA.delete(`reset_token:${token}`);

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });

  } catch (e) {
    console.error('handleResetConfirm error:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Error interno' }), { headers: corsHeaders });
  }
}

// =====================================================================
// CORS PREFLIGHT — add to your OPTIONS handler:
// =====================================================================
// if (request.method === 'OPTIONS') {
//   return new Response(null, {
//     headers: {
//       'Access-Control-Allow-Origin': '*',
//       'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
//       'Access-Control-Allow-Headers': 'Content-Type, Authorization',
//     }
//   });
// }
