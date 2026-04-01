/**
 * Cloudflare Pages Functions
 *
 * GET  /api/state          → 근무표 데이터 읽기
 * POST /api/state          → 근무표 저장 + 변경이력 기록 (관리자 전용)
 * GET  /api/changelog      → 변경이력 읽기
 * POST /api/change-password → 비밀번호 변경 (현재 비밀번호 검증 후 교체)
 *
 * KV 바인딩: SCHEDULER_KV
 *
 * 최초 비밀번호: 1234
 * (KV에 저장된 값이 없으면 아래 DEFAULT_HASH를 사용)
 */

const STATE_KEY     = 'schedulerState';
const CHANGELOG_KEY = 'schedulerChangelog';
const PW_HASH_KEY   = 'schedulerAdminPwHash';

// 최초 기본 비밀번호 '1234' 의 SHA-256
// 배포 후 앱 UI에서 변경하면 이 값은 더 이상 사용되지 않음
const DEFAULT_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

// ── 유틸 ──────────────────────────────────────────────────────
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// KV에서 현재 비밀번호 해시 가져오기 (없으면 기본값)
async function getStoredHash(env) {
  const h = await env.SCHEDULER_KV.get(PW_HASH_KEY);
  return h || DEFAULT_HASH;
}

// ── GET /api/state ────────────────────────────────────────────
async function handleGetState(env) {
  const raw = await env.SCHEDULER_KV.get(STATE_KEY);
  return cors(new Response(raw || '{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── POST /api/state ───────────────────────────────────────────
async function handlePostState(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return cors(json({ error: '잘못된 JSON' }, 400)); }

  const { _pwHash, _changeNote, ...statePayload } = body;
  const stored = await getStoredHash(env);

  if (!_pwHash || _pwHash !== stored) {
    return cors(json({ error: '인증 실패' }, 403));
  }

  delete statePayload.isAdmin;
  await env.SCHEDULER_KV.put(STATE_KEY, JSON.stringify(statePayload));

  // 변경이력 기록
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timestamp = kst.toISOString().replace('T', ' ').slice(0, 16) + ' (KST)';

  const rawLog = await env.SCHEDULER_KV.get(CHANGELOG_KEY);
  const logs = rawLog ? JSON.parse(rawLog) : [];
  logs.unshift({
    id: Date.now(),
    timestamp,
    note:  _changeNote || '근무표 수정',
    year:  statePayload.year,
    month: statePayload.month,
  });
  if (logs.length > 200) logs.splice(200);
  await env.SCHEDULER_KV.put(CHANGELOG_KEY, JSON.stringify(logs));

  return cors(json({ ok: true, timestamp }));
}

// ── GET /api/changelog ────────────────────────────────────────
async function handleGetChangelog(env) {
  const raw = await env.SCHEDULER_KV.get(CHANGELOG_KEY);
  return cors(new Response(raw || '[]', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── POST /api/change-password ─────────────────────────────────
async function handleChangePassword(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return cors(json({ error: '잘못된 JSON' }, 400)); }

  const { currentHash, newHash } = body;
  if (!currentHash || !newHash) {
    return cors(json({ error: '필드 누락' }, 400));
  }

  // 해시 형식 검증 (SHA-256 = 64자 hex)
  if (!/^[0-9a-f]{64}$/.test(newHash)) {
    return cors(json({ error: '잘못된 해시 형식' }, 400));
  }

  const stored = await getStoredHash(env);
  if (currentHash !== stored) {
    return cors(json({ error: '현재 비밀번호가 틀렸어' }, 403));
  }

  await env.SCHEDULER_KV.put(PW_HASH_KEY, newHash);
  return cors(json({ ok: true }));
}

// ── 라우터 ────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const path   = new URL(request.url).pathname;

  if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  if (path.startsWith('/api/change-password')) {
    if (method === 'POST') return handleChangePassword(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/changelog')) {
    if (method === 'GET') return handleGetChangelog(env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/state')) {
    if (method === 'GET')  return handleGetState(env);
    if (method === 'POST') return handlePostState(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }

  return cors(json({ error: 'Not Found' }, 404));
}
