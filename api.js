const SESSION_PREFIX = 'schedulerSession:';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const KV_READ_OPTIONS = { cacheTtl: 30 };
const NOTICE_LIMIT = 5;
const CHANGELOG_LIMIT = 20;
const SNAPSHOT_LIMIT = 3;
const D1_META_TABLE = 'scheduler_meta';
const D1_TEAM_TABLE = 'scheduler_teams';
const D1_META_SUPER_ADMIN_HASH = 'super_admin_hash';
const D1_META_RECOVERY_HASH = 'recovery_hash';
const D1_META_SESSION_VERSION = 'session_version';

const DEFAULT_SUPER_ADMIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const LEGACY_BROKEN_RECOVERY_HASH = '41963f0d8ff4ff516d17df3f4d40e2683955f1c632dda298c4a39edb4f8090dd';
const DEFAULT_RECOVERY_HASH = '6053f37205842f63fe11ceb14b810bec05f1547a0f7a4f43d9abe1ee8691dcdd';
const DEFAULT_TEAM_VIEWER_HASH = '0ffe1abd1a08215353c233d6e009613e95eec4253832a761af28ff37ac5a150c';
const TEAM_TAGS = [
  '연차',
  '반차',
  '경조',
  '코로나',
  '교육&학회',
  '당직',
  '희망휴무',
  '검체관리',
  '여름휴가',
  '주간지원',
  '야간지원',
];
const DEFAULT_TAG_COLORS = {
  '연차': '#fde68a',
  '반차': '#fdba74',
  '경조': '#fbcfe8',
  '코로나': '#a5f3fc',
  '교육&학회': '#bbf7d0',
  '당직': '#fecdd3',
  '희망휴무': '#ddd6fe',
  '검체관리': '#d1d5db',
  '여름휴가': '#a7f3d0',
  '주간지원': '#bbf7d0',
  '야간지원': '#bfdbfe',
};
let storageReadyPromise = null;

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

function getD1Database(env) {
  return env.DB || env.SCHEDULER_DB || env.DATABASE || env.schedule || null;
}

function hasD1Storage(env) {
  return !!getD1Database(env);
}

function parseJsonText(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return fallback;
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return raw.toLowerCase();
}

function normalizeEnabledTags(tags, fallback = TEAM_TAGS) {
  if (!Array.isArray(tags)) return [...fallback];
  return TEAM_TAGS.filter(tag => tags.includes(tag));
}

function normalizeTagColors(colors, fallback = DEFAULT_TAG_COLORS) {
  const safeColors = colors && typeof colors === 'object' ? colors : {};
  const safeFallback = fallback && typeof fallback === 'object' ? fallback : DEFAULT_TAG_COLORS;
  return TEAM_TAGS.reduce((acc, tag) => {
    acc[tag] = normalizeHexColor(safeColors[tag], normalizeHexColor(safeFallback[tag], DEFAULT_TAG_COLORS[tag]));
    return acc;
  }, {});
}

async function getD1MetaValue(env, key) {
  const db = getD1Database(env);
  const row = await db
    .prepare(`SELECT value FROM ${D1_META_TABLE} WHERE key = ? LIMIT 1`)
    .bind(key)
    .first();
  return row?.value || '';
}

async function setD1MetaValue(env, key, value) {
  const db = getD1Database(env);
  await db
    .prepare(
      `INSERT INTO ${D1_META_TABLE} (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(key, String(value ?? ''))
    .run();
}

function normalizeRecoveryHash(hash) {
  if (!hash) return DEFAULT_RECOVERY_HASH;
  if (hash === LEGACY_BROKEN_RECOVERY_HASH) return DEFAULT_RECOVERY_HASH;
  return hash;
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

function getKstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function getCurrentYearMonth() {
  const now = getKstNow();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  };
}

function createKstTimestamp() {
  return getKstNow().toISOString().replace('T', ' ').slice(0, 16);
}

function normalizeDisplayTimestamp(value) {
  return String(value || '').replace(/\s*\(KST\)\s*$/, '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function normalizeTeamState(state) {
  const current = getCurrentYearMonth();
  const safe = state && typeof state === 'object' ? { ...state } : {};
  safe.year = Number(safe.year || current.year);
  safe.month = Number(safe.month || current.month);
  safe.slotConfig = safe.slotConfig && typeof safe.slotConfig === 'object'
    ? { 조출: Number(safe.slotConfig.조출 || 0), 주간: Number(safe.slotConfig.주간 || 3), 야간: Number(safe.slotConfig.야간 || 6) }
    : { 조출: 0, 주간: 3, 야간: 6 };
  safe.visibleRows = safe.visibleRows && typeof safe.visibleRows === 'object'
    ? { 조출: !!safe.visibleRows.조출, 야간: safe.visibleRows.야간 !== false }
    : { 조출: false, 야간: true };
  safe.copiedDateKey = safe.copiedDateKey || null;
  safe.memoOpen = false;
  safe.memos = Array.isArray(safe.memos) ? safe.memos : [];
  safe.employees = Array.isArray(safe.employees) ? safe.employees : [];
  safe.schedule = safe.schedule && typeof safe.schedule === 'object' ? safe.schedule : {};
  safe.holidays = safe.holidays && typeof safe.holidays === 'object' ? safe.holidays : {};
  safe.subHolidays = safe.subHolidays && typeof safe.subHolidays === 'object' ? safe.subHolidays : {};
  safe.notices = Array.isArray(safe.notices) ? safe.notices : [];
  safe.snapshots = Array.isArray(safe.snapshots) ? safe.snapshots : [];
  safe._revision = Number(safe._revision || 0);
  safe._lastSavedAt = safe._lastSavedAt || '';
  safe.activeTab = safe.activeTab || 'calendar';
  safe.selectedEmployeeId = safe.selectedEmployeeId || null;
  safe.viewerWishOffMode = !!safe.viewerWishOffMode;
  safe.viewerWishOffDrafts = safe.viewerWishOffDrafts && typeof safe.viewerWishOffDrafts === 'object' ? safe.viewerWishOffDrafts : {};
  safe.highlightColors = safe.highlightColors && typeof safe.highlightColors === 'object'
    ? {
        work: safe.highlightColors.work || '#dbeafe',
        off: safe.highlightColors.off || '#fee2e2',
      }
    : { work: '#dbeafe', off: '#fee2e2' };
  delete safe.isAdmin;
  delete safe.sessionRole;
  delete safe.currentTeamId;
  delete safe.currentTeamName;
  delete safe.teamId;
  delete safe.availableTeams;
  delete safe._teamMeta;
  delete safe._session;
  delete safe.authReady;
  delete safe._hasUnsaved;
  return safe;
}

function createDefaultTeamState(overrides = {}) {
  const current = getCurrentYearMonth();
  return normalizeTeamState({
    year: current.year,
    month: current.month,
    slotConfig: { 조출: 0, 주간: 3, 야간: 6 },
    visibleRows: { 조출: false, 야간: true },
    copiedDateKey: null,
    memoOpen: false,
    memos: [],
    employees: [],
    schedule: {},
    holidays: {},
    subHolidays: {},
    notices: [],
    snapshots: [],
    _revision: 0,
    _lastSavedAt: '',
    activeTab: 'calendar',
    selectedEmployeeId: null,
    viewerWishOffMode: false,
    viewerWishOffDrafts: {},
    highlightColors: { work: '#dbeafe', off: '#fee2e2' },
    ...overrides,
  });
}

function normalizeTeam(team, index = 0) {
  const safe = team && typeof team === 'object' ? { ...team } : {};
  const fallbackEnabledTags = safe.enabledTags || TEAM_TAGS;
  const enabledTags = normalizeEnabledTags(safe.enabledTags, fallbackEnabledTags);
  const tagColors = normalizeTagColors(safe.tagColors, DEFAULT_TAG_COLORS);
  return {
    id: safe.id || `team-${index + 1}`,
    name: safe.name || `팀 ${index + 1}`,
    region: safe.region || '광주',
    location: safe.location || '광주호남검사센터',
    department: safe.department || safe.name || `팀 ${index + 1}`,
    workType: safe.workType || '주 5일제',
    standardHours: safe.standardHours || '8시간',
    adminPasswordHash: safe.adminPasswordHash || DEFAULT_SUPER_ADMIN_HASH,
    viewerPasswordHash: safe.viewerPasswordHash || DEFAULT_TEAM_VIEWER_HASH,
    enabledTags: enabledTags.length ? enabledTags : [...TEAM_TAGS],
    tagColors,
    data: normalizeTeamState(safe.data),
    changelog: Array.isArray(safe.changelog) ? safe.changelog.slice(0, CHANGELOG_LIMIT) : [],
  };
}

function normalizeRootState(raw, { fallbackAdminHash, legacyChangelog = [] } = {}) {
  if (raw && raw.version === 2 && Array.isArray(raw.teams) && raw.teams.length) {
    return {
      version: 2,
      teams: raw.teams.map((team, index) => normalizeTeam(team, index)),
    };
  }

  const legacyTeamState = normalizeTeamState(raw);
  return {
    version: 2,
    teams: [
      normalizeTeam({
        id: 'team-default',
        name: legacyTeamState.department || '기본팀',
        region: '광주',
        location: '광주호남검사센터',
        department: '기본팀',
        workType: '주 5일제',
        standardHours: '8시간',
        adminPasswordHash: fallbackAdminHash || DEFAULT_SUPER_ADMIN_HASH,
        viewerPasswordHash: DEFAULT_TEAM_VIEWER_HASH,
        data: legacyTeamState,
        changelog: Array.isArray(legacyChangelog) ? legacyChangelog.slice(0, CHANGELOG_LIMIT) : [],
      }),
    ],
  };
}

async function getStoredRootState(env, request) {
  await ensureStorageReady(env, request);
  return getStoredRootStateFromD1(env);
}

async function getLatestStoredRootState(env) {
  await ensureStorageReady(env);
  return getStoredRootStateFromD1(env);
}

async function saveRootState(env, root) {
  await ensureStorageReady(env);
  await saveRootStateToD1(env, root);
}

async function saveRootStateToD1(env, root) {
  const db = getD1Database(env);
  const normalizedRoot = normalizeRootState(root);
  const existingRows = await db.prepare(`SELECT id FROM ${D1_TEAM_TABLE}`).all();
  const existingIds = new Set((existingRows?.results || []).map(row => row.id));
  const nextIds = new Set();
  const statements = [];

  normalizedRoot.teams.forEach(team => {
    const normalizedTeam = normalizeTeam(team);
    nextIds.add(normalizedTeam.id);
    statements.push(
      db
        .prepare(
          `INSERT INTO ${D1_TEAM_TABLE} (
             id, name, region, location, department, work_type, standard_hours,
             admin_password_hash, viewer_password_hash, data_json, changelog_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             region = excluded.region,
             location = excluded.location,
             department = excluded.department,
             work_type = excluded.work_type,
             standard_hours = excluded.standard_hours,
             admin_password_hash = excluded.admin_password_hash,
             viewer_password_hash = excluded.viewer_password_hash,
             data_json = excluded.data_json,
             changelog_json = excluded.changelog_json,
             updated_at = CURRENT_TIMESTAMP`
        )
        .bind(
          normalizedTeam.id,
          normalizedTeam.name,
          normalizedTeam.region,
          normalizedTeam.location,
          normalizedTeam.department,
          normalizedTeam.workType,
          normalizedTeam.standardHours,
          normalizedTeam.adminPasswordHash,
          normalizedTeam.viewerPasswordHash,
          JSON.stringify(normalizedTeam.data),
          JSON.stringify(Array.isArray(normalizedTeam.changelog) ? normalizedTeam.changelog : [])
        )
    );
  });

  existingIds.forEach(id => {
    if (!nextIds.has(id)) {
      statements.push(db.prepare(`DELETE FROM ${D1_TEAM_TABLE} WHERE id = ?`).bind(id));
    }
  });

  if (statements.length) {
    await db.batch(statements);
  }
}

async function getStoredRootStateFromD1(env) {
  const db = getD1Database(env);
  const result = await db
    .prepare(
      `SELECT
         id, name, region, location, department, work_type, standard_hours,
         admin_password_hash, viewer_password_hash, data_json, changelog_json
       FROM ${D1_TEAM_TABLE}
       ORDER BY created_at ASC, id ASC`
    )
    .all();

  const teams = (result?.results || []).map((row, index) => normalizeTeam({
    id: row.id,
    name: row.name,
    region: row.region,
    location: row.location,
    department: row.department,
    workType: row.work_type,
    standardHours: row.standard_hours,
    adminPasswordHash: row.admin_password_hash,
    viewerPasswordHash: row.viewer_password_hash,
    data: parseJsonText(row.data_json, {}),
    changelog: parseJsonText(row.changelog_json, []),
  }, index));

  if (teams.length) {
    return { version: 2, teams };
  }

  const fallbackAdminHash = (await getD1MetaValue(env, D1_META_SUPER_ADMIN_HASH)) || DEFAULT_SUPER_ADMIN_HASH;
  const root = normalizeRootState(null, { fallbackAdminHash, legacyChangelog: [] });
  await saveRootStateToD1(env, root);
  return root;
}

async function ensureStorageReady(env, request) {
  if (!hasD1Storage(env)) return;
  if (!storageReadyPromise) {
    storageReadyPromise = (async () => {
      const db = getD1Database(env);
      const metaTable = await db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
        .bind(D1_META_TABLE)
        .first();
      const teamTable = await db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
        .bind(D1_TEAM_TABLE)
        .first();

      if (!metaTable?.name || !teamTable?.name) {
        throw new Error('D1 schema is missing required tables. Initialize scheduler_meta and scheduler_teams first.');
      }

      if (!(await getD1MetaValue(env, D1_META_SUPER_ADMIN_HASH))) {
        await setD1MetaValue(env, D1_META_SUPER_ADMIN_HASH, DEFAULT_SUPER_ADMIN_HASH);
      }
      if (!(await getD1MetaValue(env, D1_META_RECOVERY_HASH))) {
        await setD1MetaValue(env, D1_META_RECOVERY_HASH, DEFAULT_RECOVERY_HASH);
      }
      if (!(await getD1MetaValue(env, D1_META_SESSION_VERSION))) {
        await setD1MetaValue(env, D1_META_SESSION_VERSION, 1);
      }

      const countRow = await db.prepare(`SELECT COUNT(*) AS count FROM ${D1_TEAM_TABLE}`).first();
      if (Number(countRow?.count || 0) > 0) return;

      const root = normalizeRootState(null, { fallbackAdminHash: DEFAULT_SUPER_ADMIN_HASH, legacyChangelog: [] });
      await saveRootStateToD1(env, root);
    })().catch(error => {
      storageReadyPromise = null;
      throw error;
    });
  }
  await storageReadyPromise;
}

async function getStoredSuperAdminHash(env) {
  await ensureStorageReady(env);
  return (await getD1MetaValue(env, D1_META_SUPER_ADMIN_HASH)) || DEFAULT_SUPER_ADMIN_HASH;
}

async function setStoredSuperAdminHash(env, value) {
  await ensureStorageReady(env);
  await setD1MetaValue(env, D1_META_SUPER_ADMIN_HASH, value);
}

async function getStoredRecoveryHash(env) {
  await ensureStorageReady(env);
  return normalizeRecoveryHash(await getD1MetaValue(env, D1_META_RECOVERY_HASH));
}

async function setStoredRecoveryHash(env, value) {
  await ensureStorageReady(env);
  await setD1MetaValue(env, D1_META_RECOVERY_HASH, value);
}

async function getSessionVersion(env) {
  await ensureStorageReady(env);
  const raw = await getD1MetaValue(env, D1_META_SESSION_VERSION);
  const parsed = Number(raw || '1');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function invalidateAllSessions(env) {
  const nextVersion = (await getSessionVersion(env)) + 1;
  await ensureStorageReady(env);
  await setD1MetaValue(env, D1_META_SESSION_VERSION, nextVersion);
  return nextVersion;
}

async function createSession(env, payload) {
  const token = crypto.randomUUID();
  const version = await getSessionVersion(env);
  await env.SCHEDULER_KV.put(
    `${SESSION_PREFIX}${token}`,
    JSON.stringify({
      createdAt: Date.now(),
      version,
      role: payload.role,
      teamId: payload.teamId || null,
    }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return token;
}

async function getSession(env, request, bodyToken = '') {
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

function isEditRole(role) {
  return role === 'team_admin' || role === 'super_admin';
}

function isSuperAdmin(role) {
  return role === 'super_admin';
}

function findTeamIndex(root, teamId) {
  return root.teams.findIndex(team => team.id === teamId);
}

function getPublicTeam(team) {
  return {
    id: team.id,
    name: team.name,
    region: team.region,
    location: team.location,
    department: team.department,
    workType: team.workType,
    standardHours: team.standardHours,
    enabledTags: normalizeEnabledTags(team.enabledTags, TEAM_TAGS),
    tagColors: normalizeTagColors(team.tagColors, DEFAULT_TAG_COLORS),
  };
}

function resolveRequestedTeamId(request, body = null) {
  const url = new URL(request.url);
  const queryTeamId = url.searchParams.get('teamId');
  return String((body && body.teamId) || queryTeamId || '').trim();
}

function resolveActiveTeam(root, session, request, body = null) {
  if (!root.teams.length) {
    throw new Error('등록된 팀이 없습니다.');
  }

  if (session.role === 'super_admin') {
    const requested = resolveRequestedTeamId(request, body);
    if (requested) {
      const found = root.teams.find(team => team.id === requested);
      if (found) return found;
    }
    return root.teams[0];
  }

  return root.teams.find(team => team.id === session.teamId) || null;
}

function buildSessionPayload(session, root, activeTeam) {
  return {
    role: session.role,
    teamId: activeTeam?.id || session.teamId || null,
    teamName: activeTeam?.name || '',
    teams: root.teams.map(getPublicTeam),
    canSwitchTeams: session.role === 'super_admin',
  };
}

function sanitizeTeamStatePayload(payload) {
  const safe = payload && typeof payload === 'object' ? { ...payload } : {};
  delete safe.isAdmin;
  delete safe.sessionRole;
  delete safe.isSuperAdmin;
  delete safe.currentTeamId;
  delete safe.currentTeamName;
  delete safe.availableTeams;
  delete safe._teamMeta;
  delete safe._session;
  delete safe.memoOpen;
  delete safe._lastTimestamp;
  return normalizeTeamState(safe);
}

function cloneSnapshotState(state) {
  const cloned = clone({
    ...state,
    snapshots: [],
  });
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
    state: cloneSnapshotState(state),
  };
}

function createDefaultEntryForEmployee(state, employee, dateKey) {
  const date = parseDateKey(dateKey);
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0) return { shift: '휴무', tags: [] };
  if (state.holidays && state.holidays[dateKey]) return { shift: '휴무', tags: [] };
  return { shift: employee.role, tags: [] };
}

function createTeamId() {
  return `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildTeamMetaFromInput(input = {}, fallback = {}) {
  return {
    name: String(input.name || fallback.name || '').trim() || '새 팀',
    region: String(input.region || fallback.region || '광주').trim() || '광주',
    location: String(input.location || fallback.location || '광주호남검사센터').trim() || '광주호남검사센터',
    department: String(input.department || fallback.department || input.name || '새 팀').trim() || '새 팀',
    workType: String(input.workType || fallback.workType || '주 5일제').trim() || '주 5일제',
    standardHours: String(input.standardHours || fallback.standardHours || '8시간').trim() || '8시간',
    enabledTags: normalizeEnabledTags(input.enabledTags, fallback.enabledTags || TEAM_TAGS),
    tagColors: normalizeTagColors(input.tagColors, fallback.tagColors || DEFAULT_TAG_COLORS),
  };
}

async function handleUpdateTeamSettings(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken);
  if (!sessionResult) {
    return cors(json({ error: '로그인 세션이 만료됐어. 다시 로그인해줘.' }, 403));
  }
  if (!isEditRole(sessionResult.session.role)) {
    return cors(json({ error: '수정 권한이 없어.' }, 403));
  }

  const root = await getLatestStoredRootState(env);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request, body);
  if (!activeTeam) return cors(json({ error: '팀을 찾지 못했어.' }, 404));

  const enabledTags = normalizeEnabledTags(body.enabledTags, activeTeam.enabledTags || TEAM_TAGS);
  if (!enabledTags.length) {
    return cors(json({ error: '최소 1개 태그는 선택해줘.' }, 400));
  }

  const teamIndex = findTeamIndex(root, activeTeam.id);
  if (teamIndex === -1) return cors(json({ error: '팀을 찾지 못했어.' }, 404));

  root.teams[teamIndex] = {
    ...root.teams[teamIndex],
    enabledTags,
    tagColors: normalizeTagColors(body.tagColors, root.teams[teamIndex].tagColors || DEFAULT_TAG_COLORS),
  };

  await saveRootState(env, root);
  return cors(json({
    ok: true,
    team: getPublicTeam(root.teams[teamIndex]),
  }));
}

async function handleAuthOptions(request, env) {
  const root = await getStoredRootState(env, request);
  return cors(json({
    ok: true,
    teams: root.teams.map(getPublicTeam),
  }));
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const role = String(body.loginType || '').trim();
  const password = String(body.password || '').trim();
  const teamId = String(body.teamId || '').trim();
  if (!password) return cors(json({ error: '비밀번호를 입력해줘.' }, 400));

  const root = await getStoredRootState(env, request);

  if (role === 'super_admin') {
    const storedHash = await getStoredSuperAdminHash(env);
    const inputHash = await sha256Hex(password);
    if (inputHash !== storedHash) {
      return cors(json({ error: '상위 관리자 비밀번호가 일치하지 않아.' }, 403));
    }
    const token = await createSession(env, { role: 'super_admin' });
    const activeTeam = root.teams[0] || null;
    return cors(json({
      ok: true,
      token,
      session: buildSessionPayload({ role: 'super_admin', teamId: activeTeam?.id || null }, root, activeTeam),
    }));
  }

  if (!teamId) return cors(json({ error: '팀을 선택해줘.' }, 400));
  const team = root.teams.find(item => item.id === teamId);
  if (!team) return cors(json({ error: '선택한 팀을 찾지 못했어.' }, 404));

  const inputHash = await sha256Hex(password);
  if (role === 'team_admin') {
    if (inputHash !== team.adminPasswordHash) {
      return cors(json({ error: '팀 관리자 비밀번호가 일치하지 않아.' }, 403));
    }
    const token = await createSession(env, { role: 'team_admin', teamId });
    return cors(json({
      ok: true,
      token,
      session: buildSessionPayload({ role: 'team_admin', teamId }, root, team),
    }));
  }

  if (role === 'team_viewer') {
    if (inputHash !== team.viewerPasswordHash) {
      return cors(json({ error: '팀 조회 비밀번호가 일치하지 않아.' }, 403));
    }
    const token = await createSession(env, { role: 'team_viewer', teamId });
    return cors(json({
      ok: true,
      token,
      session: buildSessionPayload({ role: 'team_viewer', teamId }, root, team),
    }));
  }

  return cors(json({ error: '지원하지 않는 로그인 방식이야.' }, 400));
}

async function handleSessionCheck(request, env) {
  const sessionResult = await getSession(env, request);
  if (!sessionResult) return cors(json({ ok: false }, 403));

  const root = await getStoredRootState(env, request);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request);
  if (!activeTeam) return cors(json({ ok: false, error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  return cors(json({
    ok: true,
    session: buildSessionPayload(sessionResult.session, root, activeTeam),
  }));
}

async function handleGetState(request, env) {
  const sessionResult = await getSession(env, request);
  if (!sessionResult) return cors(json({ error: '로그인이 필요해.' }, 403));

  const root = await getStoredRootState(env, request);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  return cors(json({
    ...clone(activeTeam.data),
    _teamMeta: getPublicTeam(activeTeam),
    _session: buildSessionPayload(sessionResult.session, root, activeTeam),
  }));
}

async function handlePostState(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body._adminToken);
  if (!sessionResult) {
    return cors(json({ error: '로그인 세션이 만료됐어. 다시 로그인해줘.' }, 403));
  }
  if (!isEditRole(sessionResult.session.role)) {
    return cors(json({ error: '수정 권한이 없어.' }, 403));
  }

  const root = await getLatestStoredRootState(env);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request, body);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  const teamIndex = findTeamIndex(root, activeTeam.id);
  if (teamIndex === -1) return cors(json({ error: '팀을 찾지 못했어.' }, 404));

  const currentState = normalizeTeamState(root.teams[teamIndex].data);
  const currentRevision = Number(currentState._revision || 0);
  const baseRevision = Number(body._baseRevision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 사용자가 먼저 저장했어. 새로고침 후 다시 확인해줘.',
      currentRevision,
      currentTimestamp: currentState._lastSavedAt || '',
    }, 409));
  }

  const { _changeNote, _noticeContent, ...statePayload } = body;
  const sanitized = sanitizeTeamStatePayload(statePayload);
  const timestamp = createKstTimestamp();
  const nextRevision = currentRevision + 1;

  const nextNotices = Array.isArray(currentState.notices) ? [...currentState.notices] : [];
  const noticeContent = String(_noticeContent || '').trim();
  if (noticeContent) {
    nextNotices.unshift({
      id: Date.now(),
      message: noticeContent,
      timestamp,
      year: sanitized.year,
      month: sanitized.month,
    });
  }

  const nextState = normalizeTeamState({
    ...sanitized,
    notices: nextNotices.slice(0, NOTICE_LIMIT),
    snapshots: Array.isArray(currentState.snapshots) ? [...currentState.snapshots] : [],
    _revision: nextRevision,
    _lastSavedAt: timestamp,
  });

  const nextSnapshot = createSnapshotEntry(nextState, {
    note: _changeNote || '근무표 수정',
    notice: noticeContent,
    timestamp,
    revision: nextRevision,
  });
  nextState.snapshots = [nextSnapshot, ...nextState.snapshots].slice(0, SNAPSHOT_LIMIT);

  const nextChangelog = Array.isArray(root.teams[teamIndex].changelog) ? [...root.teams[teamIndex].changelog] : [];
  nextChangelog.unshift({
    id: Date.now(),
    timestamp,
    note: _changeNote || '근무표 수정',
    year: nextState.year,
    month: nextState.month,
  });
  if (nextChangelog.length > CHANGELOG_LIMIT) nextChangelog.splice(CHANGELOG_LIMIT);

  root.teams[teamIndex] = {
    ...root.teams[teamIndex],
    data: nextState,
    changelog: nextChangelog,
  };

  await saveRootState(env, root);

  return cors(json({
    ok: true,
    timestamp,
    revision: nextRevision,
    notices: nextState.notices,
    snapshots: nextState.snapshots,
  }));
}

async function handleGetChangelog(request, env) {
  const sessionResult = await getSession(env, request);
  if (!sessionResult) return cors(json({ error: '로그인이 필요해.' }, 403));

  const root = await getStoredRootState(env, request);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  const team = root.teams[findTeamIndex(root, activeTeam.id)];
  return cors(json(Array.isArray(team?.changelog) ? team.changelog : []));
}

async function handleDeleteNotice(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken);
  if (!sessionResult) {
    return cors(json({ error: '로그인 세션이 만료됐어. 다시 로그인해줘.' }, 403));
  }
  if (!isEditRole(sessionResult.session.role)) {
    return cors(json({ error: '수정 권한이 없어.' }, 403));
  }

  const root = await getLatestStoredRootState(env);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request, body);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  const teamIndex = findTeamIndex(root, activeTeam.id);
  const currentState = normalizeTeamState(root.teams[teamIndex].data);
  const currentRevision = Number(currentState._revision || 0);
  const baseRevision = Number(body.baseRevision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 사용자가 먼저 변경했어. 새로고침 후 다시 시도해줘.',
      currentRevision,
      currentTimestamp: currentState._lastSavedAt || '',
    }, 409));
  }

  const noticeId = Number(body.noticeId || 0);
  const nextNotices = Array.isArray(currentState.notices)
    ? currentState.notices.filter(item => Number(item.id) !== noticeId)
    : [];

  const timestamp = createKstTimestamp();
  const nextRevision = currentRevision + 1;
  const nextState = normalizeTeamState({
    ...currentState,
    notices: nextNotices,
    _revision: nextRevision,
    _lastSavedAt: timestamp,
  });

  root.teams[teamIndex] = {
    ...root.teams[teamIndex],
    data: nextState,
  };

  await saveRootState(env, root);

  return cors(json({
    ok: true,
    notices: nextState.notices,
    revision: nextRevision,
    timestamp,
  }));
}

async function handleDeleteChangelog(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken);
  if (!sessionResult) {
    return cors(json({ error: '로그인 세션이 만료됐어. 다시 로그인해줘.' }, 403));
  }
  if (!isEditRole(sessionResult.session.role)) {
    return cors(json({ error: '수정 권한이 없어.' }, 403));
  }

  const root = await getLatestStoredRootState(env);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request, body);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  const teamIndex = findTeamIndex(root, activeTeam.id);
  const logId = Number(body.logId || 0);

  root.teams[teamIndex] = {
    ...root.teams[teamIndex],
    changelog: Array.isArray(root.teams[teamIndex].changelog)
      ? root.teams[teamIndex].changelog.filter(item => Number(item.id) !== logId)
      : [],
  };

  await saveRootState(env, root);

  return cors(json({
    ok: true,
    logs: root.teams[teamIndex].changelog,
  }));
}

async function handleChangePassword(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken);
  if (!sessionResult) {
    return cors(json({ error: '로그인 세션이 만료됐어. 다시 로그인해줘.' }, 403));
  }
  if (!isEditRole(sessionResult.session.role)) {
    return cors(json({ error: '비밀번호를 바꿀 권한이 없어.' }, 403));
  }

  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!currentPassword || !newPassword) {
    return cors(json({ error: '현재 비밀번호와 새 비밀번호를 입력해줘.' }, 400));
  }
  if (newPassword.length < 4) {
    return cors(json({ error: '새 비밀번호는 4자 이상이어야 해.' }, 400));
  }

  if (sessionResult.session.role === 'super_admin') {
    const storedHash = await getStoredSuperAdminHash(env);
    const currentHash = await sha256Hex(currentPassword);
    if (currentHash !== storedHash) {
      return cors(json({ error: '현재 상위 관리자 비밀번호가 일치하지 않아.' }, 403));
    }
    const newHash = await sha256Hex(newPassword);
    await setStoredSuperAdminHash(env, newHash);
    await invalidateAllSessions(env);
    return cors(json({ ok: true }));
  }

  const root = await getLatestStoredRootState(env);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request, body);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  const teamIndex = findTeamIndex(root, activeTeam.id);
  const currentHash = await sha256Hex(currentPassword);
  if (currentHash !== root.teams[teamIndex].adminPasswordHash) {
    return cors(json({ error: '현재 팀 관리자 비밀번호가 일치하지 않아.' }, 403));
  }

  root.teams[teamIndex] = {
    ...root.teams[teamIndex],
    adminPasswordHash: await sha256Hex(newPassword),
  };
  await saveRootState(env, root);
  await invalidateAllSessions(env);

  return cors(json({ ok: true }));
}

async function handleRecoverPassword(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const recoveryCode = String(body.recoveryCode || '');
  const newPassword = String(body.newPassword || '');
  if (!recoveryCode) return cors(json({ error: '복구코드를 입력해줘.' }, 400));
  if (!newPassword || newPassword.length < 4) {
    return cors(json({ error: '새 비밀번호는 4자 이상이어야 해.' }, 400));
  }

  const storedRecoveryHash = await getStoredRecoveryHash(env);
  const recoveryHash = await sha256Hex(recoveryCode);
  if (recoveryHash !== storedRecoveryHash) {
    return cors(json({ error: '복구코드가 일치하지 않아.' }, 403));
  }

  const newHash = await sha256Hex(newPassword);
  await setStoredSuperAdminHash(env, newHash);
  await invalidateAllSessions(env);
  return cors(json({ ok: true }));
}

async function handleChangeRecoveryCode(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken);
  if (!sessionResult || !isSuperAdmin(sessionResult.session.role)) {
    return cors(json({ error: '상위 관리자만 복구코드를 변경할 수 있어.' }, 403));
  }

  const currentRecoveryCode = String(body.currentRecoveryCode || '');
  const newRecoveryCode = String(body.newRecoveryCode || '');
  if (!currentRecoveryCode) return cors(json({ error: '현재 복구코드를 입력해줘.' }, 400));
  if (!newRecoveryCode || newRecoveryCode.length < 4) {
    return cors(json({ error: '새 복구코드는 4자 이상이어야 해.' }, 400));
  }

  const storedRecoveryHash = await getStoredRecoveryHash(env);
  const currentRecoveryHash = await sha256Hex(currentRecoveryCode);
  if (currentRecoveryHash !== storedRecoveryHash) {
    return cors(json({ error: '현재 복구코드가 일치하지 않아.' }, 403));
  }

  const newRecoveryHash = await sha256Hex(newRecoveryCode);
  await setStoredRecoveryHash(env, newRecoveryHash);
  return cors(json({ ok: true }));
}

async function handleRestoreSnapshot(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken);
  if (!sessionResult) {
    return cors(json({ error: '로그인 세션이 만료됐어. 다시 로그인해줘.' }, 403));
  }
  if (!isEditRole(sessionResult.session.role)) {
    return cors(json({ error: '복원 권한이 없어.' }, 403));
  }

  const root = await getLatestStoredRootState(env);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request, body);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  const teamIndex = findTeamIndex(root, activeTeam.id);
  const currentState = normalizeTeamState(root.teams[teamIndex].data);
  const currentRevision = Number(currentState._revision || 0);
  const baseRevision = Number(body.baseRevision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 관리자가 먼저 저장했어. 새로고침 후 다시 시도해줘.',
      currentRevision,
      currentTimestamp: currentState._lastSavedAt || '',
    }, 409));
  }

  const snapshotId = Number(body.snapshotId || 0);
  const snapshot = Array.isArray(currentState.snapshots)
    ? currentState.snapshots.find(item => Number(item.id) === snapshotId)
    : null;
  if (!snapshot || !snapshot.state) {
    return cors(json({ error: '복원할 저장본을 찾지 못했어.' }, 404));
  }

  const timestamp = createKstTimestamp();
  const nextRevision = currentRevision + 1;
  const backupSnapshot = createSnapshotEntry(currentState, {
    note: '복원 전 자동 백업',
    notice: '',
    timestamp: currentState._lastSavedAt || timestamp,
    revision: currentRevision,
  });

  const restoredState = normalizeTeamState({
    ...cloneSnapshotState(snapshot.state),
    snapshots: [],
    _revision: nextRevision,
    _lastSavedAt: timestamp,
  });
  const snapshotPool = Array.isArray(currentState.snapshots)
    ? currentState.snapshots.filter(item => Number(item.id) !== snapshotId)
    : [];
  restoredState.snapshots = [backupSnapshot, snapshot, ...snapshotPool].slice(0, SNAPSHOT_LIMIT);

  const nextChangelog = Array.isArray(root.teams[teamIndex].changelog) ? [...root.teams[teamIndex].changelog] : [];
  nextChangelog.unshift({
    id: Date.now(),
    timestamp,
    note: `${normalizeDisplayTimestamp(snapshot.timestamp || '')} 저장본으로 복원`,
    year: restoredState.year,
    month: restoredState.month,
  });
  if (nextChangelog.length > CHANGELOG_LIMIT) nextChangelog.splice(CHANGELOG_LIMIT);

  root.teams[teamIndex] = {
    ...root.teams[teamIndex],
    data: restoredState,
    changelog: nextChangelog,
  };

  await saveRootState(env, root);

  return cors(json({
    ok: true,
    timestamp,
    revision: nextRevision,
    state: restoredState,
  }));
}

async function handleRequestWishOff(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken || body.token);
  if (!sessionResult) {
    return cors(json({ error: '로그인 세션이 필요해.' }, 403));
  }

  const employeeId = Number(body.employeeId);
  const dateKey = String(body.dateKey || '');
  const enabled = body.enabled !== false;
  const baseRevision = Number(body.baseRevision || 0);
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return cors(json({ error: '직원 또는 날짜 정보가 올바르지 않아.' }, 400));
  }

  const root = await getLatestStoredRootState(env);
  const activeTeam = resolveActiveTeam(root, sessionResult.session, request, body);
  if (!activeTeam) return cors(json({ error: '팀 세션이 더 이상 유효하지 않아.' }, 403));
  const teamIndex = findTeamIndex(root, activeTeam.id);
  const state = normalizeTeamState(root.teams[teamIndex].data);
  const currentRevision = Number(state._revision || 0);
  if (baseRevision !== currentRevision) {
    return cors(json({
      error: '다른 사용자가 먼저 변경했어. 새로고침 후 다시 시도해줘.',
      currentRevision,
      currentTimestamp: state._lastSavedAt || '',
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

  if (enabled && wishOffIndex === -1) {
    currentEntry._viewerRequestedBaseShift = currentEntry.shift || employee.role;
    currentEntry.shift = '휴무';
    tags.push('희망휴무');
  }

  if (!enabled && wishOffIndex !== -1) {
    tags.splice(wishOffIndex, 1);
    currentEntry.shift = currentEntry._viewerRequestedBaseShift || employee.role;
    delete currentEntry._viewerRequestedBaseShift;
  }

  currentEntry.tags = tags;
  state.schedule[employeeId][dateKey] = currentEntry;
  state._revision = Number(state._revision || 0) + 1;
  state._lastSavedAt = createKstTimestamp();

  root.teams[teamIndex] = {
    ...root.teams[teamIndex],
    data: state,
  };

  await saveRootState(env, root);
  return cors(json({ ok: true, state }));
}

async function handleGetTeams(request, env) {
  const sessionResult = await getSession(env, request);
  if (!sessionResult || !isSuperAdmin(sessionResult.session.role)) {
    return cors(json({ error: '상위 관리자만 팀 목록을 관리할 수 있어.' }, 403));
  }

  const root = await getStoredRootState(env, request);
  return cors(json({
    ok: true,
    teams: root.teams.map(team => ({
      ...getPublicTeam(team),
      hasAdminPassword: !!team.adminPasswordHash,
      hasViewerPassword: !!team.viewerPasswordHash,
    })),
  }));
}

async function handlePostTeams(request, env) {
  const body = await readJson(request);
  if (!body) return cors(json({ error: '잘못된 요청이야.' }, 400));

  const sessionResult = await getSession(env, request, body.adminToken);
  if (!sessionResult || !isSuperAdmin(sessionResult.session.role)) {
    return cors(json({ error: '상위 관리자만 팀을 관리할 수 있어.' }, 403));
  }

  const action = String(body.action || '').trim();
  const root = await getLatestStoredRootState(env);

  if (action === 'create') {
    const input = body.team || {};
    const meta = buildTeamMetaFromInput(input);
    const adminPassword = String(input.adminPassword || '').trim();
    const viewerPassword = String(input.viewerPassword || '').trim();
    if (!meta.name) return cors(json({ error: '팀 이름을 입력해줘.' }, 400));
    if (adminPassword.length < 4) return cors(json({ error: '팀 관리자 비밀번호는 4자 이상이어야 해.' }, 400));
    if (viewerPassword.length < 4) return cors(json({ error: '팀 조회 비밀번호는 4자 이상이어야 해.' }, 400));

    const current = getCurrentYearMonth();
    root.teams.push(normalizeTeam({
      id: createTeamId(),
      ...meta,
      adminPasswordHash: await sha256Hex(adminPassword),
      viewerPasswordHash: await sha256Hex(viewerPassword),
      data: createDefaultTeamState({
        year: current.year,
        month: current.month,
      }),
      changelog: [],
    }, root.teams.length));

    await saveRootState(env, root);
    return cors(json({ ok: true, teams: root.teams.map(getPublicTeam) }));
  }

  const teamId = String(body.teamId || '').trim();
  const teamIndex = findTeamIndex(root, teamId);
  if (teamIndex === -1) return cors(json({ error: '대상 팀을 찾지 못했어.' }, 404));

  if (action === 'update') {
    const input = body.team || {};
    const meta = buildTeamMetaFromInput(input, root.teams[teamIndex]);
    const nextTeam = {
      ...root.teams[teamIndex],
      ...meta,
    };
    const adminPassword = String(input.adminPassword || '').trim();
    const viewerPassword = String(input.viewerPassword || '').trim();
    let shouldInvalidate = false;
    if (adminPassword) {
      if (adminPassword.length < 4) return cors(json({ error: '팀 관리자 비밀번호는 4자 이상이어야 해.' }, 400));
      nextTeam.adminPasswordHash = await sha256Hex(adminPassword);
      shouldInvalidate = true;
    }
    if (viewerPassword) {
      if (viewerPassword.length < 4) return cors(json({ error: '팀 조회 비밀번호는 4자 이상이어야 해.' }, 400));
      nextTeam.viewerPasswordHash = await sha256Hex(viewerPassword);
      shouldInvalidate = true;
    }
    root.teams[teamIndex] = nextTeam;
    await saveRootState(env, root);
    if (shouldInvalidate) await invalidateAllSessions(env);
    return cors(json({ ok: true, teams: root.teams.map(getPublicTeam) }));
  }

  if (action === 'delete') {
    if (root.teams.length <= 1) {
      return cors(json({ error: '마지막 팀은 삭제할 수 없어.' }, 400));
    }
    root.teams = root.teams.filter(team => team.id !== teamId);
    await saveRootState(env, root);
    await invalidateAllSessions(env);
    return cors(json({ ok: true, teams: root.teams.map(getPublicTeam) }));
  }

  return cors(json({ error: '지원하지 않는 팀 관리 요청이야.' }, 400));
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const path = new URL(request.url).pathname;

  if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

  if (path.startsWith('/api/auth/options')) {
    if (method === 'GET') return handleAuthOptions(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/auth/login')) {
    if (method === 'POST') return handleLogin(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/auth/session')) {
    if (method === 'GET') return handleSessionCheck(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/teams')) {
    if (method === 'GET') return handleGetTeams(request, env);
    if (method === 'POST') return handlePostTeams(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/team-settings')) {
    if (method === 'POST') return handleUpdateTeamSettings(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/change-password')) {
    if (method === 'POST') return handleChangePassword(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/recover-password')) {
    if (method === 'POST') return handleRecoverPassword(request, env);
    return cors(json({ error: 'Method Not Allowed' }, 405));
  }
  if (path.startsWith('/api/change-recovery-code')) {
    if (method === 'POST') return handleChangeRecoveryCode(request, env);
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
