/**
 * Cloudflare Pages Functions
 *
 * GET  /api/state            -> 근무표 데이터 읽기
 * POST /api/state            -> 근무표 저장 + 변경이력 기록 (관리자 세션 필요)
 * GET  /api/changelog        -> 변경이력 읽기
 * POST /api/auth/login       -> 관리자 로그인
 * GET  /api/auth/session     -> 관리자 세션 확인
 * POST /api/change-password  -> 비밀번호 변경
 *
 * KV 바인딩: SCHEDULER_KV
 *
 * 최초 비밀번호: 1234
 * (KV에 저장된 값이 없으면 아래 DEFAULT_HASH를 사용)
 */

const STATE_KEY = 'schedulerState';
const CHANGELOG_KEY = 'schedulerChangelog';
const PW_HASH_KEY = 'schedulerAdminPwHash';
const SESSION_VERSION_KEY = 'schedulerSessionVersion';
const SESSION_PREFIX = 'schedulerAdminSession:';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const KV_READ_OPTIONS = { cacheTtl: 30 };
const NOTICE_LIMIT = 5;
const CHANGELOG_LIMIT = 20;
const SNAPSHOT_LIMIT = 3;

// 최초 기본 비밀번호 '1234' 의 SHA-256
const DEFAULT_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getStoredHash(env) {
  const hash = await env.SCHEDULER_KV.get(PW_HASH_KEY, KV_READ_OPTIONS);
  return hash || DEFAULT_HASH;
}

function shouldBypassKvCache(request) {
  const url = new URL(request.url);
  return url.searchParams.get('fresh') === '1';
}

async function getKvValue(env, key, request) {
  if (request && shouldBypassKvCache(request)) {
    return env.SCHEDULER_KV.get(key);
  }
  return env.SCHEDULER_KV.get(key, KV_READ_OPTIONS);
}

function normalizeStatePayload(state) {
  const safe = state && typeof state === 'object' ? { ...state } : {};
  if (!Array.isArray(safe.notices)) safe.notices = [];
  if (!Array.isArray(safe.snapshots)) safe.snapshots = [];
  safe._revision = Number(safe._revision || 0);
  safe._lastSavedAt = safe._lastSavedAt || '';
  return safe;
}

function cloneSnapshotState(state) {
  const cloned = JSON.parse(JSON.stringify({
    ...state,
    snapshots: []
  }));
  delete cloned._lastTimestamp;
  return cloned;
}

function createSnapshotEntry(state, { note = '', notice = '', timestamp = '', revision = 0 } = {}) {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    timestamp,
    note: note || '근무표 수정',
    notice: notice || '',
    revision,
    state: cloneSnapshotState(state)
  };
}

async function getStoredState(env, request) {
  const raw = await getKvValue(env, STATE_KEY, request);
  if (!raw) return normalizeStatePayload({});
  try {
    return normalizeStatePayload(JSON.parse(raw));
  } catch {
    return normalizeStatePayload({});
  }
}

async function getLatestStoredState(env) {
  const raw = await env.SCHEDULER_KV.get(STATE_KEY);
  if (!raw) return normalizeStatePayload({});
  try {
    return normalizeStatePayload(JSON.parse(raw));
  } catch {
    return normalizeStatePayload({});
  }
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function createDefaultEntryForEmployee(state, employee, dateKey) {
  const date = parseDateKey(dateKey);
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0) return { shift: '휴무', tags: [] };
  if (state.holidays && state.holidays[dateKey]) return { shift: '휴무', tags: [] };
  return { shift: employee.role, tags: [] };
}

async function getSessionVersion(env) {
  const raw = await env.SCHEDULER_KV.get(SESSION_VERSION_KEY, KV_READ_OPTIONS);
  const parsed = Number(raw || '1');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function readBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function createAdminSession(env) {
  const token = crypto.randomUUID();
  const version = await getSessionVersion(env);
  await env.SCHEDULER_KV.put(
    `${SESSION_PREFIX}${token}`,
    JSON.stringify({ createdAt: Date.now(), version }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return token;
}

async function getAdminSession(env, request, bodyToken = '') {
  const token = bodyToken || readBearerToken(request);
  if (!token) return null;

  const sessionKey = `${SESSION_PREFIX}${token}`;
  const raw = await env.SCHEDULER_KV.get(sessionKey, KV_READ_OPTIONS);
  if (!raw) return null;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    await env.SCHEDULER_KV.delete(sessionKey);
    return null;
  }

  const activeVersion = await getSessionVersion(env);
  if (Number(session.version) !== activeVersion) {
    await env.SCHEDULER_KV.delete(sessionKey);
    return null;
  }

  await env.SCHEDULER_KV.put(sessionKey, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  return { token, session };
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 JSON' }, 400));

  const password = String(body.password || '');
  if (!password) return cors(json({ error: '비밀번호를 입력해줘.' }, 400));

  const storedHash = await getStoredHash(env);
  const inputHash = await sha256Hex(password);
  if (inputHash !== storedHash) {
    return cors(json({ error: '비밀번호가 일치하지 않아.' }, 403));
  }

  const token = await createAdminSession(env);
  return cors(json({ ok: true, token }));
}

async function handleSessionCheck(request, env) {
  const session = await getAdminSession(env, request);
  if (!session) return cors(json({ ok: false }, 403));
  return cors(json({ ok: true }));
}

async function handleGetState(request, env) {
  const state = await getStoredState(env, request);
  return cors(json(state));
}

async function handlePostState(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 JSON' }, 400));

  const { _adminToken, _changeNote, _noticeContent, _baseRevision, ...statePayload } = body;
  const session = await getAdminSession(env, request, _adminToken);
  if (!session) {
    return cors(json({ error: '관리자 인증이 만료됐어. 다시 로그인해줘.' }, 403));
  }

  const currentState = await getLatestStoredState(env);
  const currentRevision = Number(currentState._revision || 0);
  const baseRevision = Number(_baseRevision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 관리자가 먼저 저장했어. 새로고침 후 다시 확인해줘.',
      currentRevision,
      currentTimestamp: currentState._lastSavedAt || ''
    }, 409));
  }

  delete statePayload.isAdmin;
  delete statePayload.notices;
  delete statePayload._revision;
  delete statePayload._lastSavedAt;

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timestamp = kst.toISOString().replace('T', ' ').slice(0, 16) + ' (KST)';
  const nextRevision = currentRevision + 1;

  const nextNotices = Array.isArray(currentState.notices) ? [...currentState.notices] : [];
  const noticeContent = String(_noticeContent || '').trim();
  if (noticeContent) {
    nextNotices.unshift({
      id: Date.now(),
      message: noticeContent,
      timestamp,
      year: statePayload.year,
      month: statePayload.month
    });
  }

  const nextState = normalizeStatePayload({
    ...statePayload,
    notices: nextNotices.slice(0, NOTICE_LIMIT),
    snapshots: Array.isArray(currentState.snapshots) ? [...currentState.snapshots] : [],
    _revision: nextRevision,
    _lastSavedAt: timestamp
  });

  const nextSnapshot = createSnapshotEntry(nextState, {
    note: _changeNote || '근무표 수정',
    notice: noticeContent,
    timestamp,
    revision: nextRevision
  });
  nextState.snapshots = [nextSnapshot, ...nextState.snapshots].slice(0, SNAPSHOT_LIMIT);

  await env.SCHEDULER_KV.put(STATE_KEY, JSON.stringify(nextState));

  const rawLog = await env.SCHEDULER_KV.get(CHANGELOG_KEY, KV_READ_OPTIONS);
  const logs = rawLog ? JSON.parse(rawLog) : [];
  logs.unshift({
    id: Date.now(),
    timestamp,
    note: _changeNote || '근무표 수정',
    year: statePayload.year,
    month: statePayload.month,
  });
  if (logs.length > CHANGELOG_LIMIT) logs.splice(CHANGELOG_LIMIT);
  await env.SCHEDULER_KV.put(CHANGELOG_KEY, JSON.stringify(logs));

  return cors(json({
    ok: true,
    timestamp,
    revision: nextRevision,
    notices: nextState.notices,
    snapshots: nextState.snapshots
  }));
}

async function handleGetChangelog(request, env) {
  const raw = await getKvValue(env, CHANGELOG_KEY, request);
  return cors(new Response(raw || '[]', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

async function handleDeleteNotice(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 JSON' }, 400));

  const session = await getAdminSession(env, request, body.adminToken);
  if (!session) {
    return cors(json({ error: '관리자 인증이 만료됐어. 다시 로그인해줘.' }, 403));
  }

  const currentState = await getLatestStoredState(env);
  const currentRevision = Number(currentState._revision || 0);
  const baseRevision = Number(body.baseRevision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.',
      currentRevision,
      currentTimestamp: currentState._lastSavedAt || ''
    }, 409));
  }

  const noticeId = Number(body.noticeId || 0);
  const nextNotices = Array.isArray(currentState.notices)
    ? currentState.notices.filter(item => Number(item.id) !== noticeId)
    : [];

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timestamp = kst.toISOString().replace('T', ' ').slice(0, 16) + ' (KST)';
  const nextRevision = currentRevision + 1;

  const nextState = normalizeStatePayload({
    ...currentState,
    notices: nextNotices,
    _revision: nextRevision,
    _lastSavedAt: timestamp
  });

  await env.SCHEDULER_KV.put(STATE_KEY, JSON.stringify(nextState));

  return cors(json({
    ok: true,
    notices: nextState.notices,
    revision: nextRevision,
    timestamp
  }));
}

async function handleDeleteChangelog(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 JSON' }, 400));

  const session = await getAdminSession(env, request, body.adminToken);
  if (!session) {
    return cors(json({ error: '관리자 인증이 만료됐어. 다시 로그인해줘.' }, 403));
  }

  const logId = Number(body.logId || 0);
  const raw = await env.SCHEDULER_KV.get(CHANGELOG_KEY, KV_READ_OPTIONS);
  const logs = raw ? JSON.parse(raw) : [];
  const nextLogs = Array.isArray(logs)
    ? logs.filter(item => Number(item.id) !== logId)
    : [];

  await env.SCHEDULER_KV.put(CHANGELOG_KEY, JSON.stringify(nextLogs));

  return cors(json({
    ok: true,
    logs: nextLogs
  }));
}

async function handleChangePassword(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 JSON' }, 400));

  const session = await getAdminSession(env, request, body.adminToken);
  if (!session) {
    return cors(json({ error: '관리자 인증이 만료됐어. 다시 로그인해줘.' }, 403));
  }

  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!currentPassword || !newPassword) {
    return cors(json({ error: '필드 누락' }, 400));
  }
  if (newPassword.length < 4) {
    return cors(json({ error: '새 비밀번호는 4자 이상이어야 해.' }, 400));
  }

  const storedHash = await getStoredHash(env);
  const currentHash = await sha256Hex(currentPassword);
  if (currentHash !== storedHash) {
    return cors(json({ error: '현재 비밀번호가 틀렸어.' }, 403));
  }

  const newHash = await sha256Hex(newPassword);
  await env.SCHEDULER_KV.put(PW_HASH_KEY, newHash);

  const nextVersion = (await getSessionVersion(env)) + 1;
  await env.SCHEDULER_KV.put(SESSION_VERSION_KEY, String(nextVersion));

  return cors(json({ ok: true }));
}

async function handleRestoreSnapshot(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 JSON' }, 400));

  const session = await getAdminSession(env, request, body.adminToken);
  if (!session) {
    return cors(json({ error: '관리자 인증이 만료됐어. 다시 로그인해줘.' }, 403));
  }

  const currentState = await getLatestStoredState(env);
  const currentRevision = Number(currentState._revision || 0);
  const baseRevision = Number(body.baseRevision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 관리자가 먼저 변경했어. 새로고침 후 다시 시도해줘.',
      currentRevision,
      currentTimestamp: currentState._lastSavedAt || ''
    }, 409));
  }

  const snapshotId = Number(body.snapshotId || 0);
  const snapshot = Array.isArray(currentState.snapshots)
    ? currentState.snapshots.find(item => Number(item.id) === snapshotId)
    : null;

  if (!snapshot || !snapshot.state) {
    return cors(json({ error: '복원할 저장본을 찾지 못했어.' }, 404));
  }

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timestamp = kst.toISOString().replace('T', ' ').slice(0, 16) + ' (KST)';
  const nextRevision = currentRevision + 1;

  const backupSnapshot = createSnapshotEntry(currentState, {
    note: '복원 전 자동 백업',
    notice: '',
    timestamp: currentState._lastSavedAt || timestamp,
    revision: currentRevision
  });

  const restoredState = normalizeStatePayload({
    ...cloneSnapshotState(snapshot.state),
    snapshots: [],
    _revision: nextRevision,
    _lastSavedAt: timestamp
  });

  const snapshotPool = Array.isArray(currentState.snapshots)
    ? currentState.snapshots.filter(item => Number(item.id) !== snapshotId)
    : [];
  restoredState.snapshots = [backupSnapshot, snapshot, ...snapshotPool].slice(0, SNAPSHOT_LIMIT);

  await env.SCHEDULER_KV.put(STATE_KEY, JSON.stringify(restoredState));

  const rawLog = await env.SCHEDULER_KV.get(CHANGELOG_KEY, KV_READ_OPTIONS);
  const logs = rawLog ? JSON.parse(rawLog) : [];
  logs.unshift({
    id: Date.now(),
    timestamp,
    note: `${snapshot.timestamp || ''} 저장본으로 복원`,
    year: restoredState.year,
    month: restoredState.month,
  });
  if (logs.length > CHANGELOG_LIMIT) logs.splice(CHANGELOG_LIMIT);
  await env.SCHEDULER_KV.put(CHANGELOG_KEY, JSON.stringify(logs));

  return cors(json({
    ok: true,
    timestamp,
    revision: nextRevision,
    state: restoredState
  }));
}

async function handleRequestWishOff(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 JSON' }, 400));

  const employeeId = Number(body.employeeId);
  const dateKey = String(body.dateKey || '');
  const enabled = body.enabled !== false;
  const baseRevision = Number(body.baseRevision || 0);

  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return cors(json({ error: '직원 또는 날짜 정보가 올바르지 않아.' }, 400));
  }

  const state = await getLatestStoredState(env);
  const currentRevision = Number(state._revision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.',
      currentRevision,
      currentTimestamp: state._lastSavedAt || ''
    }, 409));
  }

  const employee = Array.isArray(state.employees)
    ? state.employees.find(item => Number(item.id) === employeeId)
    : null;

  if (!employee) {
    return cors(json({ error: '직원 정보를 찾지 못했어.' }, 404));
  }

  const date = parseDateKey(dateKey);
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || (state.holidays && state.holidays[dateKey])) {
    return cors(json({ error: '이미 기본 휴무인 날짜는 희망휴무 신청이 필요 없어.' }, 400));
  }

  if (!state.schedule || typeof state.schedule !== 'object') state.schedule = {};
  if (!state.schedule[employeeId]) state.schedule[employeeId] = {};

  const currentEntry = state.schedule[employeeId][dateKey]
    ? { ...state.schedule[employeeId][dateKey] }
    : createDefaultEntryForEmployee(state, employee, dateKey);

  const tags = Array.isArray(currentEntry.tags) ? [...currentEntry.tags] : [];
  const wishOffIndex = tags.indexOf('희망휴무');
  const shouldEnable = enabled;

  if (shouldEnable && wishOffIndex === -1) {
    currentEntry._viewerRequestedBaseShift = currentEntry.shift || employee.role;
    currentEntry.shift = '휴무';
    tags.push('희망휴무');
  }

  if (!shouldEnable && wishOffIndex !== -1) {
    tags.splice(wishOffIndex, 1);
    currentEntry.shift = currentEntry._viewerRequestedBaseShift || employee.role;
    delete currentEntry._viewerRequestedBaseShift;
  }

  currentEntry.tags = tags;
  state.schedule[employeeId][dateKey] = currentEntry;
  state._revision = Number(state._revision || 0) + 1;
  state._lastSavedAt = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' (KST)';

  await env.SCHEDULER_KV.put(STATE_KEY, JSON.stringify(state));
  return cors(json({ ok: true, state }));
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const path = new URL(request.url).pathname;

  if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  if (path.startsWith('/api/auth/login')) {
    if (method === 'POST') return handleLogin(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/auth/session')) {
    if (method === 'GET') return handleSessionCheck(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/change-password')) {
    if (method === 'POST') return handleChangePassword(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/restore-snapshot')) {
    if (method === 'POST') return handleRestoreSnapshot(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/request-wish-off')) {
    if (method === 'POST') return handleRequestWishOff(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/changelog')) {
    if (method === 'GET') return handleGetChangelog(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/delete-notice')) {
    if (method === 'POST') return handleDeleteNotice(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/delete-changelog')) {
    if (method === 'POST') return handleDeleteChangelog(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/state')) {
    if (method === 'GET') return handleGetState(request, env);
    if (method === 'POST') return handlePostState(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }

  return cors(json({ error: 'Not Found' }, 404));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return onRequest({ request, env });
    }

    return env.ASSETS.fetch(request);
  }
};
