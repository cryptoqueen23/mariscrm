interface Env {
  DB: D1Database;
  APP_NAME: string;
  APP_ORIGIN: string;
}

type Signup = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  postalCode?: string;
  language?: string;
  emailConsent?: boolean;
  smsConsent?: boolean;
};

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });

const normalizeEmail = (v?: string) => v?.trim().toLowerCase() || null;
const normalizePhone = (v?: string) => {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
};

async function health(env: Env) {
  const row = await env.DB.prepare("SELECT 1 AS ok").first();
  return json({ ok: row?.ok === 1, service: env.APP_NAME });
}

async function publicForm(env: Env, slug: string) {
  const form = await env.DB.prepare(
    `SELECT f.id, f.name, f.slug, p.name AS project_name
     FROM forms f JOIN projects p ON p.id=f.project_id
     WHERE f.slug=? AND f.active=1`
  ).bind(slug).first();
  return form ? json(form) : json({ error: "Form not found" }, 404);
}

async function signup(request: Request, env: Env, slug: string) {
  const form = await env.DB.prepare(
    "SELECT id, list_id FROM forms WHERE slug=? AND active=1"
  ).bind(slug).first<{ id: string; list_id: string | null }>();
  if (!form) return json({ error: "Form not found" }, 404);

  let body: Signup;
  try { body = await request.json<Signup>(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  if (!email && !phone) return json({ error: "Email or valid US phone is required" }, 400);
  if (body.smsConsent && !phone) return json({ error: "A valid phone is required for SMS consent" }, 400);

  let existing = null;
  if (email) existing = await env.DB.prepare("SELECT id FROM contacts WHERE lower(email)=?").bind(email).first<{id:string}>();
  if (!existing && phone) existing = await env.DB.prepare("SELECT id FROM contacts WHERE phone=?").bind(phone).first<{id:string}>();

  const contactId = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  if (existing) {
    await env.DB.prepare(
      `UPDATE contacts SET
       email=COALESCE(?,email), phone=COALESCE(?,phone),
       first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name),
       city=COALESCE(?,city), postal_code=COALESCE(?,postal_code),
       language=COALESCE(?,language), updated_at=?
       WHERE id=?`
    ).bind(email, phone, body.firstName?.trim() || null, body.lastName?.trim() || null,
      body.city?.trim() || null, body.postalCode?.trim() || null,
      body.language?.trim() || null, now, contactId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO contacts
       (id,email,phone,first_name,last_name,city,postal_code,language,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(contactId,email,phone,body.firstName?.trim()||null,body.lastName?.trim()||null,
      body.city?.trim()||null,body.postalCode?.trim()||null,body.language?.trim()||"en",now,now).run();
  }

  if (form.list_id) {
    await env.DB.prepare(
      `INSERT INTO memberships(contact_id,list_id,status,joined_at)
       VALUES(?,?, 'active',?)
       ON CONFLICT(contact_id,list_id) DO UPDATE SET status='active'`
    ).bind(contactId, form.list_id, now).run();
  }

  const ip = request.headers.get("CF-Connecting-IP");
  const ua = request.headers.get("User-Agent");
  const source = request.headers.get("Referer") || "direct";

  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO submissions(id,form_id,contact_id,referrer,source,submitted_at) VALUES(?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), form.id, contactId, request.headers.get("Referer"), source, now)
  ];
  if (body.emailConsent) statements.push(
    env.DB.prepare("INSERT INTO consents(id,contact_id,channel,status,consent_text,source,ip_address,user_agent,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),contactId,"email","granted","I agree to receive email updates.",slug,ip,ua,now)
  );
  if (body.smsConsent) statements.push(
    env.DB.prepare("INSERT INTO consents(id,contact_id,channel,status,consent_text,source,ip_address,user_agent,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),contactId,"sms","granted","I agree to receive SMS updates. Message and data rates may apply. Reply STOP to opt out.",slug,ip,ua,now)
  );
  await env.DB.batch(statements);

  return json({ ok: true, contactId }, 201);
}


function scoopJoinPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join Coryell County Scoop</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17202a;background:#f5f2eb}
*{box-sizing:border-box}body{margin:0}.shell{min-height:100vh;display:grid;grid-template-columns:1fr 1fr}
.hero{padding:clamp(40px,7vw,90px);background:#162635;color:#fff;display:flex;flex-direction:column;justify-content:center}
.kicker{font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;font-weight:800;opacity:.72}
h1{font-family:Georgia,serif;font-size:clamp(3rem,7vw,6.2rem);line-height:.92;margin:.3em 0}.hero p{font-size:1.1rem;line-height:1.65;max-width:580px;color:#dce5ea}
.formside{padding:clamp(28px,6vw,80px);display:flex;align-items:center}.card{width:min(620px,100%);margin:auto;background:#fff;border:1px solid #ded9cf;border-radius:22px;padding:clamp(24px,5vw,46px);box-shadow:0 20px 60px rgba(23,32,42,.08)}
h2{font-family:Georgia,serif;font-size:2rem;margin:0 0 8px}.intro{color:#5b6470;margin:0 0 28px;line-height:1.5}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}label.field{display:block;font-weight:700;font-size:.86rem}
input,select{width:100%;margin-top:7px;padding:13px 14px;border:1px solid #cfc9bf;border-radius:10px;font:inherit;background:#fff;color:#17202a}
.check{display:flex;gap:10px;align-items:flex-start;font-size:.88rem;line-height:1.4;color:#444;margin-top:14px}.check input{width:auto;margin-top:3px}
button{width:100%;border:0;border-radius:10px;padding:15px 18px;margin-top:22px;background:#162635;color:#fff;font-weight:800;font-size:1rem;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}.privacy{font-size:.76rem;line-height:1.5;color:#747474;margin-top:16px}.msg{display:none;margin-top:16px;padding:13px;border-radius:10px}.ok{display:block;background:#eaf7ee;color:#155b2e}.err{display:block;background:#fff0f0;color:#8b2020}
@media(max-width:850px){.shell{grid-template-columns:1fr}.hero{min-height:auto;padding:48px 28px}.formside{padding:24px 16px 48px}.grid{grid-template-columns:1fr}.full{grid-column:auto}}
</style>
</head>
<body><main class="shell">
<section class="hero"><div class="kicker">Coryell County Scoop</div><h1>Stay in<br>the Scoop.</h1><p>Facebook is where we gather. This independent list gives our community another way to stay connected when a social platform is unavailable or simply doesn't show you an important update.</p><p><strong>Free to join. Local. Independent.</strong></p></section>
<section class="formside"><div class="card"><h2>Join the community list</h2><p class="intro">Choose how you'd like to hear from Coryell County Scoop. Mobile number is optional unless you request text alerts.</p>
<form id="join">
<div class="grid">
<label class="field">First name<input name="firstName" autocomplete="given-name" required></label>
<label class="field">Last name<input name="lastName" autocomplete="family-name" required></label>
<label class="field full">Email address<input name="email" type="email" autocomplete="email" required></label>
<label class="field">Mobile number <span style="font-weight:400">(optional)</span><input name="phone" type="tel" autocomplete="tel" placeholder="(254) 555-1234"></label>
<label class="field">ZIP code<input name="postalCode" autocomplete="postal-code" inputmode="numeric"></label>
<label class="field">City<input name="city" autocomplete="address-level2"></label>
<label class="field">Preferred language<select name="language"><option value="en">English</option><option value="es">Español</option></select></label>
</div>
<label class="check"><input name="emailConsent" type="checkbox" checked><span>Yes, send me Coryell County Scoop email updates. I can unsubscribe at any time.</span></label>
<label class="check"><input name="smsConsent" type="checkbox"><span>Yes, I agree to receive recurring Coryell County Scoop text alerts at the number provided. Consent is not a condition of joining. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.</span></label>
<button id="submit" type="submit">JOIN THE SCOOP</button>
<div id="msg" class="msg" role="status" aria-live="polite"></div>
<p class="privacy">Your information is used to provide the updates you request. It will not be sold. You may withdraw email or SMS consent at any time.</p>
</form></div></section>
</main>
<script>
const form=document.getElementById('join'),msg=document.getElementById('msg'),btn=document.getElementById('submit');
form.addEventListener('submit',async(e)=>{e.preventDefault();msg.className='msg';msg.textContent='';btn.disabled=true;btn.textContent='JOINING…';
const fd=new FormData(form);const payload={firstName:fd.get('firstName'),lastName:fd.get('lastName'),email:fd.get('email'),phone:fd.get('phone'),city:fd.get('city'),postalCode:fd.get('postalCode'),language:fd.get('language'),emailConsent:fd.has('emailConsent'),smsConsent:fd.has('smsConsent')};
try{const r=await fetch('/api/public/forms/join-scoop/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to join right now.');form.reset();msg.textContent="You're in the Scoop. Welcome!";msg.className='msg ok';}
catch(err){msg.textContent=err.message||'Something went wrong. Please try again.';msg.className='msg err';}
finally{btn.disabled=false;btn.textContent='JOIN THE SCOOP';}});
</script></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}


async function adminDashboard(env: Env) {
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts").first<{n:number}>();
  const recent = await env.DB.prepare(
    `SELECT c.first_name, c.last_name, c.email, c.phone, c.city, c.postal_code, c.language, c.created_at,
      EXISTS(SELECT 1 FROM consents x WHERE x.contact_id=c.id AND x.channel='email' AND x.status='granted') AS email_ok,
      EXISTS(SELECT 1 FROM consents x WHERE x.contact_id=c.id AND x.channel='sms' AND x.status='granted') AS sms_ok
     FROM contacts c ORDER BY c.created_at DESC LIMIT 100`
  ).all();
  const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,(m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]||m));
  const rows=(recent.results||[]).map((r:any)=>`<tr><td><strong>${esc([r.first_name,r.last_name].filter(Boolean).join(" "))}</strong></td><td>${esc(r.email)}</td><td>${esc(r.phone)}</td><td>${esc(r.city)}</td><td>${esc(r.postal_code)}</td><td>${esc(r.language)}</td><td>${r.email_ok?"✓":"—"}</td><td>${r.sms_ok?"✓":"—"}</td><td>${esc(new Date(r.created_at).toLocaleString("en-US",{timeZone:"America/Chicago"}))}</td></tr>`).join("");
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mari CRM Dashboard</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f2eb;color:#17202a;font-family:Inter,system-ui,sans-serif}.top{background:#162635;color:#fff;padding:24px clamp(18px,5vw,60px);display:flex;justify-content:space-between;align-items:end;gap:20px}.brand{font-family:Georgia,serif;font-size:2rem}.sub{opacity:.7;font-size:.85rem}.wrap{padding:32px clamp(18px,5vw,60px)}.stats{display:flex;gap:16px;margin-bottom:28px}.stat{background:#fff;border:1px solid #ddd6ca;border-radius:16px;padding:22px;min-width:180px}.num{font:700 2.2rem Georgia,serif}.label{color:#66707a;font-size:.82rem;text-transform:uppercase;letter-spacing:.08em}.card{background:#fff;border:1px solid #ddd6ca;border-radius:16px;overflow:hidden}.cardhead{padding:20px 22px;border-bottom:1px solid #eee8df;display:flex;justify-content:space-between;align-items:center}.cardhead h2{font:700 1.35rem Georgia,serif;margin:0}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:13px 16px;border-bottom:1px solid #eee8df;font-size:.88rem}th{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#69727b;background:#faf9f6}tbody tr:hover{background:#faf9f6}.note{color:#69727b;font-size:.82rem}.pill{display:inline-block;padding:7px 10px;background:#e8eee9;border-radius:999px;font-size:.78rem}@media(max-width:700px){.top{align-items:start;flex-direction:column}.stats{display:grid;grid-template-columns:1fr 1fr}.stat{min-width:0}}</style></head>
<body><header class="top"><div><div class="brand">Mari CRM</div><div class="sub">Independent audience management</div></div><span class="pill">Coryell County Scoop</span></header><main class="wrap">
<div class="stats"><div class="stat"><div class="num">${Number(total?.n||0).toLocaleString()}</div><div class="label">Contacts</div></div><div class="stat"><div class="num">${(recent.results||[]).length}</div><div class="label">Recent shown</div></div></div>
<section class="card"><div class="cardhead"><div><h2>Contacts</h2><div class="note">Newest signups first · up to 100 shown</div></div></div><div class="scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>City</th><th>ZIP</th><th>Language</th><th>Email OK</th><th>SMS OK</th><th>Joined</th></tr></thead><tbody>${rows||'<tr><td colspan="9">No contacts yet.</td></tr>'}</tbody></table></div></section>
</main></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") return health(env);
    if (request.method === "GET" && (url.pathname === "/join/scoop" || url.pathname === "/join/scoop/")) return scoopJoinPage();
    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) return adminDashboard(env);

    const formMatch = url.pathname.match(/^\/api\/public\/forms\/([^/]+)$/);
    if (request.method === "GET" && formMatch) return publicForm(env, decodeURIComponent(formMatch[1]));

    const signupMatch = url.pathname.match(/^\/api\/public\/forms\/([^/]+)\/signup$/);
    if (request.method === "POST" && signupMatch) return signup(request, env, decodeURIComponent(signupMatch[1]));

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mari CRM</title><style>body{font-family:system-ui;margin:0;background:#f6f5f2;color:#171717}.wrap{max-width:760px;margin:12vh auto;padding:32px}h1{font-family:Georgia,serif;font-size:3rem;margin-bottom:.3rem}.card{background:white;border:1px solid #ddd;border-radius:16px;padding:24px;margin-top:28px}code{background:#eee;padding:3px 6px;border-radius:5px}</style></head><body><main class="wrap"><h1>Mari CRM</h1><p>Independent audience management for all Mari projects.</p><div class="card"><strong>Application shell is running.</strong><p>Health: <code>/api/health</code></p><p>First public form: <code>/api/public/forms/join-scoop</code></p></div></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" }});
    }
    return json({ error: "Not found" }, 404);
  }
};
