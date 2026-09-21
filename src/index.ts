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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") return health(env);

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
