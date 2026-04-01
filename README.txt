const STATE_KEY = 'schedulerState';
const CHANGELOG_KEY = 'schedulerChangelog';
const PW_HASH_KEY = 'schedulerAdminPwHash';
const SESSION_PREFIX = 'schedulerSession:';
const DEFAULT_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const SESSION_TTL = 60 * 60 * 24 * 7;

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, headers });
}

function json(data, status = 200) {
  return withCors(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  }));
}

async function getStoredHash(env) {
  const h = await env.SCHEDULER_KV.get(PW_HASH_KEY);
  return h || DEFAULT_HASH;
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function requireAuth(request, env) {
  const token = getBearerToken(request);
  if (!token) return false;
  const session = await env.SCHEDULER_KV.get(`${SESSION_PREFIX}${token}`);
  return session === '1';
}

function createToken() {
  return `${crypto.randomUUID()}-${Date.now()}`;
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '잘못된 JSON' }, 400);
  }

  const stored = await getStoredHash(env);
  if (!body?.passwordHash || body.passwordHash !== stored) {
    return json({ error: '비밀번호가 일치하지 않아.' }, 403);
  }

  const token = createToken();
  await env.SCHEDULER_KV.put(`${SESSION_PREFIX}${token}`, '1', { expirationTtl: SESSION_TTL });
  return json({ ok: true, token });
}

async function handleLogout(request, env) {
  const token = getBearerToken(request);
  if (token) {
    await env.SCHEDULER_KV.delete(`${SESSION_PREFIX}${token}`);
  }
  return json({ ok: true });
}

async function handleGetState(env) {
  const raw = await env.SCHEDULER_KV.get(STATE_KEY);
  return withCors(new Response(raw || '{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  }));
}

async function handlePostState(request, env) {
  const authed = await requireAuth(request, env);
  if (!authed) return json({ error: '인증 실패' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '잘못된 JSON' }, 400);
  }

  const { _changeNote, ...statePayload } = body;
  delete statePayload.isAdmin;

  await env.SCHEDULER_KV.put(STATE_KEY, JSON.stringify(statePayload));

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timestamp = kst.toISOString().replace('T', ' ').slice(0, 16) + ' (KST)';

  const rawLog = await env.SCHEDULER_KV.get(CHANGELOG_KEY);
  const logs = rawLog ? JSON.parse(rawLog) : [];
  logs.unshift({
    id: Date.now(),
    timestamp,
    note: _changeNote || '근무표 수정',
    year: statePayload.year,
    month: statePayload.month,
  });
  if (logs.length > 200) logs.splice(200);
  await env.SCHEDULER_KV.put(CHANGELOG_KEY, JSON.stringify(logs));

  return json({ ok: true, timestamp });
}

async function handleGetChangelog(env) {
  const raw = await env.SCHEDULER_KV.get(CHANGELOG_KEY);
  return withCors(new Response(raw || '[]', {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  }));
}

async function handleChangePassword(request, env) {
  const authed = await requireAuth(request, env);
  if (!authed) return json({ error: '인증 실패' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '잘못된 JSON' }, 400);
  }

  const { currentHash, newHash } = body;
  if (!currentHash || !newHash) {
    return json({ error: '필드 누락' }, 400);
  }
  if (!/^[0-9a-f]{64}$/.test(newHash)) {
    return json({ error: '잘못된 해시 형식' }, 400);
  }

  const stored = await getStoredHash(env);
  if (currentHash !== stored) {
    return json({ error: '현재 비밀번호가 틀렸어' }, 403);
  }

  await env.SCHEDULER_KV.put(PW_HASH_KEY, newHash);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    if (pathname === '/api/login') {
      if (method === 'POST') return handleLogin(request, env);
      return json({ error: 'Method Not Allowed' }, 405);
    }

    if (pathname === '/api/logout') {
      if (method === 'POST') return handleLogout(request, env);
      return json({ error: 'Method Not Allowed' }, 405);
    }

    if (pathname === '/api/change-password') {
      if (method === 'POST') return handleChangePassword(request, env);
      return json({ error: 'Method Not Allowed' }, 405);
    }

    if (pathname === '/api/changelog') {
      if (method === 'GET') return handleGetChangelog(env);
      return json({ error: 'Method Not Allowed' }, 405);
    }

    if (pathname === '/api/state') {
      if (method === 'GET') return handleGetState(env);
      if (method === 'POST') return handlePostState(request, env);
      return json({ error: 'Method Not Allowed' }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};
