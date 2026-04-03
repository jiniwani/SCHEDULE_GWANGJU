  const STORAGE_KEY = 'labSchedulerSimpleDefaultV1';

  const TAGS = [
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
    '야간지원'
  ];

  const ADMIN_SESSION_KEY = 'labSchedulerSessionV2';
  const ADMIN_TOKEN_KEY = 'labSchedulerTokenV2';
  const ACTIVE_TEAM_KEY = 'labSchedulerActiveTeamV2';

  let dragData = null;
  let editingMemoId = null;
  let knownLatestChangeId = null;
  let restorePreviewSnapshotId = null;
  let teamManagerCache = [];
  let editingTeamConfigId = null;

  let state = {
    year: 2026,
    month: 3,
    slotConfig: { 조출: 0, 주간: 3, 야간: 6 },
    visibleRows: { 조출: false, 야간: true },
    copiedDateKey: null,
    memoOpen: false,
    memos: [],
    employees: [
      { id: 1, name: '박준환', role: '주간' },
      { id: 2, name: '손가영', role: '주간' },
      { id: 3, name: '정석희', role: '주간' },
      { id: 4, name: '김지효', role: '야간' },
      { id: 5, name: '한혜림', role: '야간' },
      { id: 6, name: '박석호', role: '야간' },
      { id: 7, name: '강승혜', role: '야간' },
      { id: 8, name: '조영오', role: '야간' },
      { id: 9, name: '양다연', role: '야간' }
    ],
    schedule: {},
    holidays: {
      '2026-03-01': { name: '삼일절' }
    },
    subHolidays: {
      '2026-03-02': { name: '대체공휴일' }
    },
    notices: [],
    snapshots: [],
    _revision: 0,
    _lastSavedAt: '',
    activeTab: 'calendar',
    selectedEmployeeId: null,
    viewerWishOffMode: false,
    viewerWishOffDrafts: {},
    isAdmin: false,
    isSuperAdmin: false,
    sessionRole: 'guest',
    currentTeamId: '',
    currentTeamName: '',
    availableTeams: [],
    teamMeta: null,
    authReady: false,
    highlightColors: {
      work: '#dbeafe',
      off: '#fee2e2'
    }
  };

  const COLOR_PRESETS = {
    classic: { work: '#dbeafe', off: '#fee2e2' },
    mint: { work: '#d1fae5', off: '#ecfeff' },
    warm: { work: '#fef3c7', off: '#ffe4e6' },
    violet: { work: '#ede9fe', off: '#f5f3ff' }
  };

  function clamp(v, min, max){
    return Math.max(min, Math.min(max, v));
  }

  function hexToRgb(hex){
    const cleaned = String(hex || '').replace('#','').trim();
    const full = cleaned.length === 3 ? cleaned.split('').map(c => c + c).join('') : cleaned;
    const num = parseInt(full, 16);
    if(Number.isNaN(num) || full.length !== 6) return { r: 219, g: 234, b: 254 };
    return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
  }

  function rgbToHex(r,g,b){
    return '#' + [r,g,b].map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('');
  }

  function mixWithWhite(hex, ratio){
    const {r,g,b}=hexToRgb(hex);
    return rgbToHex(r + (255-r)*ratio, g + (255-g)*ratio, b + (255-b)*ratio);
  }

  function darken(hex, ratio){
    const {r,g,b}=hexToRgb(hex);
    return rgbToHex(r*(1-ratio), g*(1-ratio), b*(1-ratio));
  }

  function ensureHighlightColors(){
    if(!state.highlightColors) state.highlightColors = { work:'#60a5fa', off:'#94a3b8' };
    if(!state.highlightColors.work) state.highlightColors.work = '#60a5fa';
    if(!state.highlightColors.off) state.highlightColors.off = '#94a3b8';
  }

  function ensureEarlyShiftSetting(){
    if(!state.slotConfig) state.slotConfig = {};
    if(typeof state.slotConfig.조출 !== 'number') state.slotConfig.조출 = 0;
  }

  function ensureVisibleRows(){
    if(!state.visibleRows) state.visibleRows = { 조출: false, 야간: true };
    if(typeof state.visibleRows.조출 !== 'boolean') state.visibleRows.조출 = (state.slotConfig?.조출 || 0) > 0;
    if(typeof state.visibleRows.야간 !== 'boolean') state.visibleRows.야간 = true;
  }

  function applyHighlightColors(){
    ensureHighlightColors();
    const root = document.documentElement;
    const work = state.highlightColors.work;
    const off = state.highlightColors.off;

    root.style.setProperty('--work-bg-start', mixWithWhite(work, 0.65));
    root.style.setProperty('--work-bg-end', mixWithWhite(work, 0.84));
    root.style.setProperty('--work-border', work);
    root.style.setProperty('--work-outline', mixWithWhite(work, 0.45));
    root.style.setProperty('--work-text', darken(work, 0.22));
    root.style.setProperty('--off-bg-start', mixWithWhite(off, 0.68));
    root.style.setProperty('--off-bg-end', mixWithWhite(off, 0.84));
    root.style.setProperty('--off-border', off);
    root.style.setProperty('--off-outline', mixWithWhite(off, 0.46));
    root.style.setProperty('--off-text', darken(off, 0.22));

    root.style.setProperty('--work-bg-start-fade', mixWithWhite(work, 0.88));
    root.style.setProperty('--work-bg-end-fade', mixWithWhite(work, 0.94));
    root.style.setProperty('--work-border-fade', mixWithWhite(work, 0.72));
    root.style.setProperty('--work-outline-fade', mixWithWhite(work, 0.82));
    root.style.setProperty('--work-text-fade', mixWithWhite(darken(work,0.12), 0.35));
    root.style.setProperty('--off-bg-start-fade', mixWithWhite(off, 0.9));
    root.style.setProperty('--off-bg-end-fade', mixWithWhite(off, 0.95));
    root.style.setProperty('--off-border-fade', mixWithWhite(off, 0.74));
    root.style.setProperty('--off-outline-fade', mixWithWhite(off, 0.84));
    root.style.setProperty('--off-text-fade', mixWithWhite(darken(off,0.1), 0.38));

    const workPicker = document.getElementById('workColorPicker');
    const offPicker = document.getElementById('offColorPicker');
    if(workPicker) workPicker.value = work;
    if(offPicker) offPicker.value = off;
  }

  function setHighlightColor(type, value){
    ensureHighlightColors();
    if(type === 'work' || type === 'off'){
      state.highlightColors[type] = value;
      saveState();
      applyHighlightColors();
      renderAll();
    }
  }

  function applyColorPreset(name){
    const preset = COLOR_PRESETS[name];
    if(!preset) return;
    state.highlightColors = { ...preset };
    saveState();
    applyHighlightColors();
    renderAll();
  }

  function isAdmin(){
    return state.sessionRole === 'team_admin' || state.sessionRole === 'super_admin' || !!state.isAdmin;
  }

  function isSuperAdmin(){
    return state.sessionRole === 'super_admin' || !!state.isSuperAdmin;
  }

  function requireAdmin(){
    if(isAdmin()) return true;
    alert('팀 관리자 또는 상위 관리자 로그인 후 사용할 수 있어.');
    return false;
  }

  function getAdminToken(){
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
  }

  function getActiveTeamId(){
    return state.currentTeamId || sessionStorage.getItem(ACTIVE_TEAM_KEY) || '';
  }

  function setActiveTeamId(teamId){
    state.currentTeamId = teamId || '';
    if(teamId){
      sessionStorage.setItem(ACTIVE_TEAM_KEY, teamId);
    }else{
      sessionStorage.removeItem(ACTIVE_TEAM_KEY);
    }
  }

  function applySessionInfo(session){
    const safeSession = session || {};
    state.sessionRole = safeSession.role || 'guest';
    state.isAdmin = safeSession.role === 'team_admin' || safeSession.role === 'super_admin';
    state.isSuperAdmin = safeSession.role === 'super_admin';
    state.availableTeams = Array.isArray(safeSession.teams) ? safeSession.teams : [];
    state.currentTeamId = safeSession.teamId || getActiveTeamId() || '';
    state.currentTeamName = safeSession.teamName || '';
    if(state.currentTeamId){
      sessionStorage.setItem(ACTIVE_TEAM_KEY, state.currentTeamId);
    }
  }

  function clearAdminSession(){
    state.isAdmin = false;
    state.isSuperAdmin = false;
    state.sessionRole = 'guest';
    state.currentTeamId = '';
    state.currentTeamName = '';
    state.teamMeta = null;
    state.authReady = true;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(ACTIVE_TEAM_KEY);
  }

  function saveAdminSession(){
    if(state.sessionRole !== 'guest' && getAdminToken()){
      sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
    }else{
      clearAdminSession();
    }
  }

  async function restoreAdminSession(){
    const token = getAdminToken();
    if(!token){
      clearAdminSession();
      return;
    }

    try{
      const res = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if(res.ok){
        const data = await res.json().catch(() => ({}));
        applySessionInfo(data.session || {});
        state.authReady = true;
        sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
        return;
      }
    }catch(e){}

    clearAdminSession();
  }

  async function loadAuthOptions(){
    try{
      const res = await fetch('/api/auth/options');
      const data = await res.json().catch(() => ({}));
      if(res.ok && Array.isArray(data.teams)){
        state.availableTeams = data.teams;
      }
    }catch(e){}
  }

  function getAuthHeaders(extra = {}){
    const headers = { ...extra };
    const token = getAdminToken();
    if(token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function buildApiUrl(path, extras = {}){
    const params = new URLSearchParams();
    const teamId = getActiveTeamId();
    if(teamId) params.set('teamId', teamId);
    Object.entries(extras).forEach(([key, value]) => {
      if(value !== undefined && value !== null && value !== ''){
        params.set(key, value);
      }
    });
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  }

  let syncTimer = null;
  function showSyncStatus(status){
    const badge = document.getElementById('syncBadge');
    if(!badge) return;
    clearTimeout(syncTimer);
    const map = {
      saving:  { text:'저장 중…',  cls:'saving'  },
      saved:   { text:'저장 완료', cls:'saved'   },
      error:   { text:'저장 실패', cls:'error'   },
      loading: { text:'불러오는 중…', cls:'loading' },
      loaded:  { text:'',          cls:''        },
    };
    const m = map[status] || {};
    if(!m.text){ badge.style.display='none'; return; }
    badge.textContent = m.text;
    badge.className = 'sync-badge ' + m.cls;
    badge.style.display = 'inline-flex';
    if(status === 'saved'){
      syncTimer = setTimeout(()=>{ badge.style.display='none'; }, 2000);
    }
  }

  // 로컬 상태만 유지 (KV 전송 없음 — 명시적 저장 버튼으로만 KV에 씀)
  function saveState(){
    saveAdminSession();
    // 미저장 변경 있음 표시
    if(isAdmin()) markUnsaved();
  }

  // ── 명시적 저장 (저장 버튼 클릭 시) ──────────────────────────
  async function explicitSave(changeNote, noticeContent = ''){
    if(!isAdmin()) return;
    showSyncStatus('saving');
      try{
      const { isAdmin: _a, ...payload } = state;
      delete payload.memoOpen;
        const res = await fetch(buildApiUrl('/api/state'), {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...payload,
          _adminToken: getAdminToken(),
          _changeNote: changeNote,
          _noticeContent: noticeContent,
          _baseRevision: Number(state._revision || 0),
          teamId: getActiveTeamId()
        })
      });
      if(res.status === 403){
        clearAdminSession();
        renderAll();
        throw new Error('admin session expired');
      }
      if(res.status === 409){
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'save conflict');
      }
      if(!res.ok) throw new Error('save failed');
      const data = await res.json();
      state._lastTimestamp = data.timestamp || '';
      state._lastSavedAt = data.timestamp || '';
      state._revision = Number(data.revision || state._revision || 0);
      if(Array.isArray(data.notices)) state.notices = data.notices;
      if(Array.isArray(data.snapshots)) state.snapshots = data.snapshots;
      markSaved();
      if(state.activeTab === 'changelog') await loadChangelog(true);
      renderAll();
      showSyncStatus('saved');
    }catch(e){
      showSyncStatus('error');
      if(e.message === 'admin session expired'){
        alert('관리자 세션이 만료됐어. 다시 로그인해줘.');
      } else if(e.message){
        alert(e.message);
      }
    }
  }

  // ── 미저장 상태 표시 ──────────────────────────────────────────
  let _hasUnsaved = false;
  function markUnsaved(){
    if(_hasUnsaved) return;
    _hasUnsaved = true;
    const btn = document.getElementById('explicitSaveBtn');
    if(btn){ btn.classList.add('unsaved'); btn.textContent = '● 저장'; }
  }
  function markSaved(){
    _hasUnsaved = false;
    const btn = document.getElementById('explicitSaveBtn');
    if(btn){ btn.classList.remove('unsaved'); btn.textContent = '저장'; }
  }

  function canUseReportTools(){
    return !!state.isAdmin;
  }

  async function deleteNotice(noticeId){
    if(!isAdmin()) return;
    if(!confirm('이 공지를 삭제할까?')) return;
    showSyncStatus('saving');
    try{
      const res = await fetch(buildApiUrl('/api/delete-notice'), {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          adminToken: getAdminToken(),
          noticeId: Number(noticeId),
          baseRevision: Number(state._revision || 0),
          teamId: getActiveTeamId()
        })
      });
      const data = await res.json();
      if(res.status === 403){
        clearAdminSession();
        renderAll();
        throw new Error(data.error || 'admin session expired');
      }
      if(res.status === 409){
        throw new Error(data.error || 'delete conflict');
      }
      if(!res.ok) throw new Error(data.error || 'notice delete failed');
      state.notices = Array.isArray(data.notices) ? data.notices : [];
      state._revision = Number(data.revision || state._revision || 0);
      state._lastSavedAt = data.timestamp || state._lastSavedAt || '';
      renderAll();
      showSyncStatus('saved');
    }catch(e){
      showSyncStatus('error');
      alert(e.message || '공지 삭제에 실패했어.');
    }
  }

  async function deleteChangelog(logId){
    if(!isAdmin()) return;
    if(!confirm('이 변경이력을 삭제할까?')) return;
    showSyncStatus('saving');
    try{
      const res = await fetch(buildApiUrl('/api/delete-changelog'), {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          adminToken: getAdminToken(),
          logId: Number(logId),
          teamId: getActiveTeamId()
        })
      });
      const data = await res.json();
      if(res.status === 403){
        clearAdminSession();
        renderAll();
        throw new Error(data.error || 'admin session expired');
      }
      if(!res.ok) throw new Error(data.error || 'changelog delete failed');
      changelogCache = Array.isArray(data.logs) ? data.logs : [];
      knownLatestChangeId = changelogCache[0]?.id ?? null;
      renderNoticePanel();
      await loadChangelog(true);
      showSyncStatus('saved');
    }catch(e){
      showSyncStatus('error');
      alert(e.message || '변경이력 삭제에 실패했어.');
    }
  }

  function renderNoticePanel(){
    const panel = document.getElementById('noticePanel');
    const list = document.getElementById('noticeList');
    const meta = document.getElementById('noticePanelMeta');
    if(!panel || !list || !meta) return;

    const notices = Array.isArray(state.notices) ? state.notices : [];
    if(!notices.length){
      panel.classList.add('hidden');
      list.innerHTML = '';
      meta.textContent = '';
      return;
    }

    panel.classList.remove('hidden');
    meta.textContent = `누적 공지 ${notices.length}건`;
    const reportButton = state.isAdmin ? `
      <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
        <button class="btn small" type="button" onclick="openReportModal()">보고문 만들기</button>
      </div>
    ` : '';
    list.innerHTML = reportButton + notices.map(notice => `
      <div class="notice-item">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <div class="notice-item-title">${escHtml(notice.message || '공지')}</div>
          ${isAdmin() ? `<button class="btn small" type="button" onclick="deleteNotice(${Number(notice.id)})">삭제</button>` : ''}
        </div>
        <div class="notice-item-meta">${escHtml(normalizeDisplayTimestamp(notice.timestamp || ''))} · ${notice.year}년 ${notice.month}월</div>
      </div>
    `).join('');
  }

  function renderLastSavedInfo(){
    const el = document.getElementById('lastSavedInfo');
    if(!el) return;

    if(!state._lastSavedAt){
      el.textContent = '마지막 저장 없음';
      return;
    }

    const displayTimestamp = normalizeDisplayTimestamp(state._lastSavedAt);
    el.textContent = `마지막 저장 ${displayTimestamp}`;
  }

  function normalizeDisplayTimestamp(value){
    return String(value || '').replace(/\s*\(KST\)\s*$/,'').trim();
  }

  function collectSaveWarnings(){
    const warnings = [];
    const weeks = getRenderWeeks(state.year, state.month);
    const visibleDates = [];
    weeks.forEach(week => {
      week.forEach(date => {
        const y = date.getFullYear();
        const m = date.getMonth() + 1;
        if(y === state.year && m === state.month){
          visibleDates.push(dKey(y, m, date.getDate()));
        }
      });
    });

    visibleDates.forEach(dateKey => {
      const result = validateDay(dateKey);
      if(result.dayCount !== state.slotConfig.주간){
        warnings.push(`${dateKey} 주간 ${result.dayCount}/${state.slotConfig.주간}`);
      }
      if(state.visibleRows?.야간 !== false && result.nightCount !== state.slotConfig.야간){
        warnings.push(`${dateKey} 야간 ${result.nightCount}/${state.slotConfig.야간}`);
      }
    });

    return warnings;
  }

  function buildSaveWarningsMarkup(warnings){
    if(!warnings.length){
      return `
        <div class="save-warning-box">
          <div class="save-warning-title">저장 전 점검</div>
          <div class="save-warning-empty">현재 확인된 인원 경고는 없어.</div>
        </div>
      `;
    }

    const visibleWarnings = warnings.slice(0, 8);
    const extraCount = warnings.length - visibleWarnings.length;

    return `
      <div class="save-warning-box">
        <div class="save-warning-title">저장 전 경고 ${warnings.length}건</div>
        <ol class="save-warning-list">
          ${visibleWarnings.map(item => `<li>${escHtml(item)}</li>`).join('')}
          ${extraCount > 0 ? `<li>외 ${extraCount}건 더 있어.</li>` : ''}
        </ol>
      </div>
    `;
  }

  function buildSnapshotPreview(snapshot){
    if(!snapshot){
      return `
        <div class="muted" style="font-size:13px;">미리볼 저장본이 없어.</div>
      `;
    }

    const snapshotState = snapshot.state || {};
    const noticeText = snapshot.notice ? escHtml(snapshot.notice) : '없음';
    const employeeCount = Array.isArray(snapshotState.employees) ? snapshotState.employees.length : 0;
    return `
      <div style="display:flex;flex-direction:column;gap:8px;">
          <div><strong>저장 시각:</strong> ${escHtml(normalizeDisplayTimestamp(snapshot.timestamp || '-'))}</div>
        <div><strong>변경이력:</strong> ${escHtml(snapshot.note || '근무표 수정')}</div>
        <div><strong>공지:</strong> ${noticeText}</div>
        <div><strong>기준 월:</strong> ${snapshotState.year || '-'}년 ${snapshotState.month || '-'}월</div>
        <div><strong>직원 수:</strong> ${employeeCount}명</div>
        <div><strong>revision:</strong> ${Number(snapshot.revision || 0)}</div>
      </div>
    `;
  }

  function buildReportTemplate(logs = changelogCache){
    const targetLogs = Array.isArray(logs) ? logs.slice(0, 5) : [];
    const lines = ['[검사실 근무표 변경 보고]'];

    if(targetLogs.length){
      const latest = targetLogs[0];
        const baseDate = normalizeDisplayTimestamp(latest.timestamp || '').split(' ')[0] || '-';
      lines.push(`기준시각: ${baseDate}`);
      lines.push('');
      lines.push('변경내용');
      targetLogs.forEach((log, idx) => {
          lines.push(`${idx + 1}. ${log.note || '근무표 수정'} (${normalizeDisplayTimestamp(log.timestamp || '-')})`);
      });
    } else {
      lines.push('기준시각: -');
      lines.push('');
      lines.push('변경내용');
      lines.push('- 아직 불러온 변경이력이 없습니다.');
    }
    lines.push('');
    lines.push('위와 같이 근무표 변경 되었습니다.');

    return lines.join('\n');
  }

  async function copyTextToClipboard(text){
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function openReportModal(){
    if(!state.isAdmin) return;
    const template = buildReportTemplate();
    openModal(`
      <div class="modal-head">
        <div class="modal-title">보고문 만들기</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>
      <div class="muted" style="margin-bottom:10px;font-size:13px;">
        기본 템플릿을 자동으로 채워뒀어. 복사 전에 자유롭게 수정하면 돼.
      </div>
      <div class="field" style="min-width:100%;">
        <label>보고 내용</label>
        <textarea id="reportTemplateInput" class="memo-textarea" style="min-height:260px;">${escHtml(template)}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn" type="button" onclick="resetReportTemplate()">템플릿 다시 채우기</button>
        <button class="btn primary" type="button" onclick="copyReportTemplate()">복사</button>
      </div>
    `);
  }

  function resetReportTemplate(){
    const textarea = document.getElementById('reportTemplateInput');
    if(textarea) textarea.value = buildReportTemplate();
  }

  async function copyReportTemplate(){
    const textarea = document.getElementById('reportTemplateInput');
    const value = textarea?.value || '';
    if(!value.trim()){
      alert('복사할 내용이 없어.');
      return;
    }
    try{
      await copyTextToClipboard(value);
      alert('보고문을 복사했어.');
    }catch(e){
      alert('복사에 실패했어. 다시 시도해줘.');
    }
  }

  async function loadState(forceFresh = false){
    showSyncStatus('loading');
    try{
      const url = buildApiUrl('/api/state', forceFresh ? { fresh: '1' } : {});
      const res = await fetch(url, {
        headers: getAuthHeaders()
      });
      if(res.ok){
          const parsed = await res.json();
          const {
            isAdmin: _ignoredIsAdmin,
            _teamMeta,
            _session,
            ...safeParsed
          } = parsed;
          state = { ...state, ...safeParsed };
          state.teamMeta = _teamMeta || null;
          if(_session) applySessionInfo(_session);
          state.memoOpen = false;
          if(!Array.isArray(state.notices)) state.notices = [];
          if(!Array.isArray(state.snapshots)) state.snapshots = [];
          state._revision = Number(state._revision || 0);
          state.authReady = true;
        showSyncStatus('loaded');
      } else if(res.status === 403){
        clearAdminSession();
        showSyncStatus('error');
      } else {
        showSyncStatus('error');
      }
    }catch(e){
      showSyncStatus('error');
    }
  }

  function dKey(y,m,d){
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  function parseDateKey(key){
    const [y,m,d] = key.split('-').map(Number);
    return new Date(y, m-1, d);
  }

  function getDays(y,m){
    return new Date(y, m, 0).getDate();
  }

  function getMonthKeyPrefix(y,m){
    return `${y}-${String(m).padStart(2,'0')}-`;
  }

  function getMonthMatrix(y,m){
    const first = new Date(y, m-1, 1);
    const firstDay = first.getDay();
    const start = new Date(y, m-1, 1 - firstDay);
    const weeks = [];
    for(let w=0; w<6; w++){
      const week = [];
      for(let d=0; d<7; d++){
        const current = new Date(start);
        current.setDate(start.getDate() + w * 7 + d);
        week.push(current);
      }
      weeks.push(week);
    }
    return weeks;
  }

  function getRenderWeeks(y,m){
    return getMonthMatrix(y,m);
  }

  function isRealMonthInWeek(week, y, m){
    return week.some(date => date.getFullYear() === y && (date.getMonth()+1) === m);
  }

  function isHolidayDate(dateKey){
    return !!state.holidays[dateKey];
  }

  function createDefaultEntry(emp, dateKey){
    const dt = parseDateKey(dateKey);
    const dow = dt.getDay();

    if(dow === 0) return { shift:'휴무', tags:[] };
    if(isHolidayDate(dateKey)) return { shift:'휴무', tags:[] };

    return { shift: emp.role, tags:[] };
  }

  function ensureScheduleForMonth(y,m){
    const days = getDays(y,m);
    for(const emp of state.employees){
      if(!state.schedule[emp.id]) state.schedule[emp.id] = {};
      for(let d=1; d<=days; d++){
        const key = dKey(y,m,d);
        if(state.schedule[emp.id][key]) continue;
        state.schedule[emp.id][key] = createDefaultEntry(emp, key);
      }
    }
  }

  function refreshDefaultEntriesForMonth(y,m){
    const days = getDays(y,m);
    for(const emp of state.employees){
      if(!state.schedule[emp.id]) state.schedule[emp.id] = {};
      for(let d=1; d<=days; d++){
        const key = dKey(y,m,d);
        const current = state.schedule[emp.id][key];
        const fresh = createDefaultEntry(emp, key);

        if(!current){
          state.schedule[emp.id][key] = fresh;
          continue;
        }

        const isUntouched =
          Array.isArray(current.tags) &&
          current.tags.length === 0 &&
          (current.shift === '주간' || current.shift === '야간' || current.shift === '휴무');

        if(isUntouched){
          state.schedule[emp.id][key] = fresh;
        }
      }
    }
  }

  function getEntry(empId, dateKey){
    const dt = parseDateKey(dateKey);
    ensureScheduleForMonth(dt.getFullYear(), dt.getMonth()+1);
    if(!state.schedule[empId]) state.schedule[empId] = {};
    if(!state.schedule[empId][dateKey]){
      const emp = state.employees.find(e=>e.id===empId);
      state.schedule[empId][dateKey] = createDefaultEntry(emp, dateKey);
    }
    return state.schedule[empId][dateKey];
  }

  function isWishOffTagged(entry){
    return Array.isArray(entry?.tags) && entry.tags.includes('희망휴무');
  }

  function getWishOffDraftAction(dateKey){
    if(!state.viewerWishOffDrafts || typeof state.viewerWishOffDrafts !== 'object') return null;
    if(Object.prototype.hasOwnProperty.call(state.viewerWishOffDrafts, dateKey)){
      return !!state.viewerWishOffDrafts[dateKey];
    }
    return null;
  }

  function countWishOffDrafts(){
    if(!state.viewerWishOffDrafts || typeof state.viewerWishOffDrafts !== 'object') return 0;
    return Object.keys(state.viewerWishOffDrafts).length;
  }

  function clearWishOffDrafts(){
    state.viewerWishOffDrafts = {};
  }

  function getSelectedEmployee(){
    if(!state.selectedEmployeeId) return null;
    return state.employees.find(e => Number(e.id) === Number(state.selectedEmployeeId)) || null;
  }

  function getCurrentMonthWishOffDates(empId){
    if(!empId) return [];
    ensureScheduleForMonth(state.year, state.month);
    const prefix = getMonthKeyPrefix(state.year, state.month);
    const bucket = state.schedule?.[empId] || {};
    return Object.keys(bucket)
      .filter(dateKey => dateKey.startsWith(prefix) && isWishOffTagged(bucket[dateKey]))
      .sort();
  }

  function isViewerWishOffMode(){
    return state.sessionRole === 'team_viewer' && !!state.viewerWishOffMode && !!state.selectedEmployeeId;
  }

  function getEmployeesByShift(dateKey, shift){
    const arr = [];
    for(const emp of state.employees){
      const entry = getEntry(emp.id, dateKey);
      if(entry.shift === shift){
        arr.push({ employee: emp, entry });
      }
    }
    return arr;
  }

  function validateDay(dateKey){
    ensureVisibleRows();
    const dayCount = getEmployeesByShift(dateKey, '주간').length;
    const nightCount = getEmployeesByShift(dateKey, '야간').length;
    const dayWarn = dayCount !== state.slotConfig.주간;
    const nightWarn = state.visibleRows.야간 ? (nightCount !== state.slotConfig.야간) : false;
    return {
      dayCount,
      nightCount,
      isWarn: dayWarn || nightWarn
    };
  }

  function normalizeTagClass(tag){
    if(/^대휴\(.+\)$/.test(tag)) return 'tag-대휴custom';
    return 'tag-' + tag
      .replaceAll('&','')
      .replaceAll('(','')
      .replaceAll(')','')
      .replaceAll('/','')
      .replaceAll(' ','');
  }

  function renderChip(item, dateKey, shift){
    const classes = item.entry.tags.map(normalizeTagClass).join(' ');
    const text = item.entry.tags.length
      ? `${item.employee.name} (${item.entry.tags.join(', ')})`
      : item.employee.name;

    const base = shift === '야간' ? 'person-chip night-chip' : (shift === '휴무' ? 'off-chip' : 'person-chip');
    const focusClass = Number(state.selectedEmployeeId) === Number(item.employee.id) ? 'employee-focus' : '';
    const clickable = isAdmin()
      ? `draggable="true"
         ondragstart="dragStart(event, ${item.employee.id}, '${dateKey}', '${shift}')"
         onclick="openAssignmentModal(${item.employee.id}, '${dateKey}')"
         title="클릭: 수정 / 드래그: 이동"`
      : `draggable="false" title="${text}"`;

    return `
      <button
        class="${base} ${classes} ${focusClass}"
        ${clickable}
      >
        ${text}
      </button>
    `;
  }

  function renderShiftRow(label, items, slotCount, dateKey){
    const rowClass =
      label === '조출' ? 'shift-row-early' :
      label === '주간' ? 'shift-row-day' :
      label === '야간' ? 'shift-row-night' :
      'shift-row-off';

    let html = `
      <div class="shift-block ${rowClass}"
           ondragover="allowDrop(event)"
           ondragleave="dragLeave(event)"
           ondrop="handleDrop(event, '${dateKey}', '${label}')">
        <div class="shift-label">${label}</div>
        <div class="slot-area">
    `;

    if(label === '휴무'){
      if(items.length === 0){
        if(isAdmin()) html += `<button class="empty-slot no-print" onclick="openAssignBySlot('${dateKey}', '휴무')">추가</button>`;
      }else{
        html += items.map(item => renderChip(item, dateKey, '휴무')).join('');
        if(isAdmin()) html += `<button class="empty-slot no-print" onclick="openAssignBySlot('${dateKey}', '휴무')">+ 추가</button>`;
      }
    }else{
      for(let i=0; i<items.length; i++){
        html += renderChip(items[i], dateKey, label);
      }
      const remain = Math.max(0, slotCount - items.length);
      if(isAdmin()){
        for(let i=0; i<remain; i++){
          html += `<button class="empty-slot no-print" onclick="openAssignBySlot('${dateKey}', '${label}')">빈자리 ${i+1}</button>`;
        }
      }
    }

    html += `</div></div>`;
    return html;
  }

  function getDayCellClasses(dateKey, isCurrentMonth, holiday, subHoliday){
    let cellClass = 'day-cell';
    if(!isCurrentMonth) cellClass += ' other-month';
    if(holiday) cellClass += ' holiday';
    if(subHoliday) cellClass += ' subholiday';
    if(state.selectedEmployeeId && isCurrentMonth){
      const selectedEntry = getEntry(Number(state.selectedEmployeeId), dateKey);
      if(selectedEntry.shift === '휴무'){
        cellClass += ' emp-off-highlight';
      }else{
        cellClass += ' emp-work-highlight';
      }
      if(isViewerWishOffMode()){
        const draftAction = getWishOffDraftAction(dateKey);
        if(draftAction === true){
          cellClass += ' wishoff-pending-add';
        }else if(draftAction === false){
          cellClass += ' wishoff-pending-remove';
        }else{
          cellClass += isWishOffTagged(selectedEntry) ? ' wishoff-selected' : ' wishoff-target';
        }
      }
    }
    return cellClass;
  }

  function renderDayContent({
    dateKey,
    dayNumber,
    holiday,
    subHoliday,
    isCurrentMonth,
    numClass,
    earlyItems,
    dayItems,
    nightItems,
    offItems,
    validation,
    isCopied
  }){
    let html = `
      <div class="day-head">
        <div>
          <div class="day-num ${numClass}">${dayNumber}</div>
          <div class="mini-actions no-print ${isAdmin() ? '' : 'hidden'}">
            <button class="mini-btn ${isCopied ? 'copy-active' : ''}" onclick="copyDateConfig('${dateKey}')">복사</button>
            <button class="mini-btn" onclick="pasteDateConfig('${dateKey}')">붙여넣기</button>
          </div>
        </div>
        <div class="badge-wrap">
          ${holiday ? `<span class="holiday-badge">${holiday.name}</span>` : ''}
          ${subHoliday ? `<span class="subholiday-badge">${subHoliday.name}</span>` : ''}
        </div>
      </div>
    `;

    if(state.visibleRows?.조출 && (state.slotConfig.조출 || 0) > 0){
      html += renderShiftRow('조출', earlyItems, state.slotConfig.조출, dateKey);
    }
    html += renderShiftRow('주간', dayItems, state.slotConfig.주간, dateKey);
    if(state.visibleRows?.야간 !== false){
      html += renderShiftRow('야간', nightItems, state.slotConfig.야간, dateKey);
    }
    html += renderShiftRow('휴무', offItems, 0, dateKey);

    if(isCurrentMonth && isAdmin()){
      html += `
        <div class="count-row no-print">
          <span class="count-pill ${validation.dayCount !== state.slotConfig.주간 ? 'bad' : ''}">
            주간 ${validation.dayCount}/${state.slotConfig.주간}
          </span>
          <span class="count-pill ${validation.nightCount !== state.slotConfig.야간 ? 'bad' : ''}">
            야간 ${validation.nightCount}/${state.slotConfig.야간}
          </span>
        </div>
      `;
    }

    return html;
  }

  function renderMobileCalendar(days){
    let html = '<div class="mobile-calendar">';

    for(let d=1; d<=days; d++){
      const dateKey = dKey(state.year, state.month, d);
      const date = parseDateKey(dateKey);
      const dow = date.getDay();
      const numClass = dow === 0 ? 'sun' : (dow === 6 ? 'sat' : '');
      const holiday = state.holidays[dateKey];
      const subHoliday = state.subHolidays[dateKey];
      const earlyItems = getEmployeesByShift(dateKey, '조출');
      const dayItems = getEmployeesByShift(dateKey, '주간');
      const nightItems = getEmployeesByShift(dateKey, '야간');
      const offItems = getEmployeesByShift(dateKey, '휴무');
      const validation = validateDay(dateKey);
      const cardClasses = getDayCellClasses(dateKey, true, holiday, subHoliday)
        .split(' ')
        .filter(cls => cls !== 'day-cell')
        .join(' ');
      const wishOffAttrs = getWishOffCellAttributes(dateKey, true);

      html += `
        <section class="mobile-day-card ${cardClasses}" ${wishOffAttrs}>
          ${renderDayContent({
            dateKey,
            dayNumber: d,
            holiday,
            subHoliday,
            isCurrentMonth: true,
            numClass,
            earlyItems,
            dayItems,
            nightItems,
            offItems,
            validation,
            isCopied: state.copiedDateKey === dateKey
          })}
        </section>
      `;
    }

    html += '</div>';
    return html;
  }

  function renderCalendar(){
    ensureScheduleForMonth(state.year, state.month);
    document.getElementById('monthLabel').textContent = `${state.year}년 ${state.month}월`;
    const selectedEmp = state.selectedEmployeeId
      ? state.employees.find(e => Number(e.id) === Number(state.selectedEmployeeId))
      : null;
    const teamTitle = state.currentTeamName ? ` · ${state.currentTeamName}` : '';
    document.getElementById('printTitle').textContent = selectedEmp
      ? `${state.year}년 ${state.month}월 근무표${teamTitle} (${selectedEmp.name})`
      : `${state.year}년 ${state.month}월 근무표${teamTitle}`;

    const weeks = getRenderWeeks(state.year, state.month);
    const realWeekCount = weeks.filter(week => isRealMonthInWeek(week, state.year, state.month)).length;
    const currentMonthDays = getDays(state.year, state.month);
    const printRowHeight = '27.6mm';

    let html = `
      <div class="desktop-calendar">
      <table class="calendar ${realWeekCount === 5 ? 'five-week-month' : 'six-week-month'}" data-week-count="6" style="--print-row-height:${printRowHeight}">
        <thead>
          <tr>
            <th class="sun">일요일</th>
            <th>월요일</th>
            <th>화요일</th>
            <th>수요일</th>
            <th>목요일</th>
            <th>금요일</th>
            <th class="sat">토요일</th>
          </tr>
        </thead>
        <tbody>
    `;

    weeks.forEach((week, weekIndex) => {
      const isExtraWeek = weekIndex === 5 && !isRealMonthInWeek(week, state.year, state.month);
      html += `<tr class="${isExtraWeek ? 'extra-week' : ''}">`;
      for(const date of week){
        const y = date.getFullYear();
        const m = date.getMonth() + 1;
        const d = date.getDate();
        const dateKey = dKey(y,m,d);
        const isCurrentMonth = y === state.year && m === state.month;
        const dow = date.getDay();
        const numClass = dow === 0 ? 'sun' : (dow === 6 ? 'sat' : '');

        const holiday = state.holidays[dateKey];
        const subHoliday = state.subHolidays[dateKey];
        const earlyItems = getEmployeesByShift(dateKey, '조출');
        const dayItems = getEmployeesByShift(dateKey, '주간');
        const nightItems = getEmployeesByShift(dateKey, '야간');
        const offItems = getEmployeesByShift(dateKey, '휴무');
        const validation = validateDay(dateKey);
        const cellClass = getDayCellClasses(dateKey, isCurrentMonth, holiday, subHoliday);
        const wishOffAttrs = getWishOffCellAttributes(dateKey, isCurrentMonth);

        html += `<td class="${cellClass}" ${wishOffAttrs}>`;
        html += renderDayContent({
          dateKey,
          dayNumber: d,
          holiday,
          subHoliday,
          isCurrentMonth,
          numClass,
          earlyItems,
          dayItems,
          nightItems,
          offItems,
          validation,
          isCopied: state.copiedDateKey === dateKey
        });
        html += `</td>`;
      }
      html += '</tr>';
    });

    html += `</tbody></table></div>`;
    html += renderMobileCalendar(currentMonthDays);
    document.getElementById('calendarWrap').innerHTML = html;
  }

  function getWishOffCellAttributes(dateKey, isCurrentMonth){
    if(!isCurrentMonth || !isViewerWishOffMode()) return '';
    return `onclick="handleViewerWishOffClick('${dateKey}')" title="희망휴무 신청/해제"`;
  }

  function shouldUseNativeMobilePrint(){
    const ua = navigator.userAgent || '';
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|SamsungBrowser/i.test(ua);
    const touchDevice = navigator.maxTouchPoints > 0;
    const narrowViewport = window.innerWidth <= 1024;
    return mobileUa || (touchDevice && narrowViewport);
  }

  let _html2canvasLoader = null;
  function loadHtml2Canvas(){
    if(window.html2canvas) return Promise.resolve(window.html2canvas);
    if(_html2canvasLoader) return _html2canvasLoader;
    _html2canvasLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = () => resolve(window.html2canvas);
      script.onerror = () => reject(new Error('PNG 저장 도구를 불러오지 못했어.'));
      document.head.appendChild(script);
    });
    return _html2canvasLoader;
  }

  let _xlsxPopulateLoader = null;
  function loadXlsxPopulate(){
    if(window.XlsxPopulate) return Promise.resolve(window.XlsxPopulate);
    if(_xlsxPopulateLoader) return _xlsxPopulateLoader;
    _xlsxPopulateLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx-populate/browser/xlsx-populate.min.js';
      script.onload = () => resolve(window.XlsxPopulate);
      script.onerror = () => reject(new Error('엑셀 저장 도구를 불러오지 못했어.'));
      document.head.appendChild(script);
    });
    return _xlsxPopulateLoader;
  }

  function excelColumnName(index){
    let column = '';
    let current = index;
    while(current > 0){
      const remainder = (current - 1) % 26;
      column = String.fromCharCode(65 + remainder) + column;
      current = Math.floor((current - 1) / 26);
    }
    return column;
  }

  function getExcelEmployees(){
    const selected = getSelectedEmployee();
    return selected ? [selected] : [...state.employees];
  }

  function getStandardWorkableDays(year, month){
    const days = getDays(year, month);
    let workable = 0;
    for(let d = 1; d <= days; d++){
      const dateKey = dKey(year, month, d);
      const dow = parseDateKey(dateKey).getDay();
      if(dow === 0) continue;
      if(state.holidays?.[dateKey] || state.subHolidays?.[dateKey]) continue;
      workable++;
    }
    return workable;
  }

  function getPrimaryLeaveCategory(entry){
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    if(tags.find(tag => /^대휴\(/.test(tag))) return '대체';
    if(tags.includes('연차')) return '연차';
    if(tags.includes('반차')) return '반차';
    if(tags.includes('경조')) return '경조';
    if(tags.includes('코로나')) return '코로나';
    if(tags.includes('교육&학회')) return '공가';
    if(tags.includes('희망휴무')) return '희망휴무';
    if(tags.includes('여름휴가')) return '연차';
    if(tags.includes('검체관리')) return '검체관리';
    if(tags.includes('주간지원')) return '주간지원';
    if(tags.includes('야간지원')) return '야간지원';
    return '';
  }

  function getExcelDayCode(emp, dateKey, entry){
    const leaveType = getPrimaryLeaveCategory(entry);
    if(leaveType === '대체') return '대';
    if(leaveType === '연차') return '연';
    if(leaveType === '반차') return '반';
    if(leaveType === '경조') return '경';
    if(leaveType === '코로나') return '코';
    if(leaveType === '공가') return '공';
    if(entry?.shift === '조출' || entry?.shift === '주간') return '주';
    if(entry?.shift === '야간'){
      const dow = parseDateKey(dateKey).getDay();
      const isHoliday = !!state.holidays?.[dateKey] || !!state.subHolidays?.[dateKey];
      return (dow === 0 || dow === 6 || isHoliday) ? 'C' : 'A';
    }
    if(leaveType === '희망휴무' || leaveType === '검체관리' || leaveType === '주간지원' || leaveType === '야간지원') return '휴';
    return '휴';
  }

  function buildExcelNotes(dateKey, entry, emp){
    const parts = [];
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    if(tags.length) parts.push(`${parseDateKey(dateKey).getDate()}일 ${tags.join(', ')}`);

    const defaultEntry = createDefaultEntry(emp, dateKey);
    if(entry?.shift && entry.shift !== defaultEntry.shift){
      parts.push(`${parseDateKey(dateKey).getDate()}일 ${defaultEntry.shift}→${entry.shift}`);
    }

    return parts;
  }

  function buildExcelEmployeeMetrics(emp, year, month){
    const days = getDays(year, month);
    const leaveCounts = { 대체: 0, 연차: 0, 경조: 0, 코로나: 0, 공가: 0 };
    const dayCodes = [];
    const reasonParts = [];

    for(let d = 1; d <= days; d++){
      const dateKey = dKey(year, month, d);
      const entry = getEntry(emp.id, dateKey);
      const leaveType = getPrimaryLeaveCategory(entry);
      dayCodes.push(getExcelDayCode(emp, dateKey, entry));
      reasonParts.push(...buildExcelNotes(dateKey, entry, emp));

      if(leaveType === '대체') leaveCounts.대체++;
      else if(leaveType === '연차') leaveCounts.연차++;
      else if(leaveType === '경조') leaveCounts.경조++;
      else if(leaveType === '코로나') leaveCounts.코로나++;
      else if(leaveType === '공가') leaveCounts.공가++;
    }

    return {
      dayCodes,
      leaveCounts,
      notes: reasonParts.join(' / ')
    };
  }

  async function loadExcelTemplateWorkbook(){
    const XlsxPopulate = await loadXlsxPopulate();
    const res = await fetch('./schedule-report-template.xlsx');
    if(!res.ok) throw new Error('보고 양식 템플릿 파일을 찾지 못했어.');
    const buffer = await res.arrayBuffer();
    return XlsxPopulate.fromDataAsync(buffer);
  }

  function getExcelTemplateWorksheets(workbook){
    const sheets = workbook.sheets();
    return sheets.length ? sheets : [];
  }

  function getExcelHeaderStyleTemplateWorksheet(workbook){
    return workbook.sheet('12월 취합 (야간근무+연장)') || workbook.sheets()[0];
  }

  function getExcelTemplateStandardDays(workbook){
    const sheets = getExcelTemplateWorksheets(workbook);
    for(const sheet of sheets){
      const topValue = sheet.cell('P3').value();
      if(topValue !== undefined && topValue !== null && String(topValue).trim() !== ''){
        return topValue;
      }
      for(let rowNumber = 8; rowNumber <= 49; rowNumber++){
        const rowValue = sheet.cell(`AL${rowNumber}`).value();
        if(rowValue !== undefined && rowValue !== null && String(rowValue).trim() !== ''){
          return rowValue;
        }
      }
    }
    return '';
  }

  function clearTemplateRow(worksheet, rowNumber){
    for(let column = 1; column <= 5; column++){
      worksheet.cell(`${excelColumnName(column)}${rowNumber}`).value('');
    }
    for(let column = 6; column <= 36; column++){
      worksheet.cell(`${excelColumnName(column)}${rowNumber}`).value('');
    }
    worksheet.cell(`AL${rowNumber}`).value('');
    worksheet.cell(`BC${rowNumber}`).value('');
  }

  function getEmployeeReportCode(emp){
    if(emp.employeeNo) return emp.employeeNo;
    if(emp.code) return emp.code;
    return `L${String(emp.id).padStart(5, '0')}`;
  }

  function readEmployeeNo(inputId){
    const value = document.getElementById(inputId)?.value || '';
    return value.trim();
  }

  function applyExcelDayHeaders(worksheet, styleWorksheet, year, month){
    const days = getDays(year, month);
    const weekdayStyle = styleWorksheet.cell('G7').style();
    const saturdayStyle = styleWorksheet.cell('H7').style();
    const sundayStyle = styleWorksheet.cell('I7').style();

    for(let column = 6; column <= 36; column++){
      const cell = worksheet.cell(`${excelColumnName(column)}7`);
      const dayNumber = column - 5;
      if(dayNumber > days){
        cell.value('');
        cell.style(weekdayStyle);
        continue;
      }

      const date = parseDateKey(dKey(year, month, dayNumber));
      const dow = date.getDay();
      cell.value(dayNumber);
      if(dow === 6){
        cell.style(saturdayStyle);
      }else if(dow === 0){
        cell.style(sundayStyle);
      }else{
        cell.style(weekdayStyle);
      }
    }
  }

  function populateExcelTemplateWorksheet(worksheet, options){
    const {
      employees,
      days,
      firstEmployeeRow,
      lastEmployeeRow,
      defaultRegion,
      defaultDepartment,
      standardWorkableDays,
      reportStandardDays,
      headerStyleWorksheet
    } = options;

    worksheet.cell('F3').value(state.month);
    worksheet.cell('K3').value(standardWorkableDays);
    worksheet.cell('C3').value(`${state.teamMeta?.location || '광주호남검사센터'}\n${defaultDepartment} (${state.teamMeta?.workType || '주 5일제'})`);
    worksheet.cell('N3').value(`기준\n일수\n(${state.teamMeta?.standardHours || '8hr'})`);
    worksheet.cell('P3').value(reportStandardDays);
    worksheet.cell('AL7').value(`개인 기준 \n(${state.teamMeta?.standardHours || '8hr'})`);

    applyExcelDayHeaders(worksheet, headerStyleWorksheet, state.year, state.month);

    for(let rowNumber = firstEmployeeRow; rowNumber <= lastEmployeeRow; rowNumber++){
      clearTemplateRow(worksheet, rowNumber);
    }

    employees.forEach((emp, index) => {
      const rowNumber = firstEmployeeRow + index;
      const metrics = buildExcelEmployeeMetrics(emp, state.year, state.month);
      worksheet.cell(`A${rowNumber}`).value(index + 1);
      worksheet.cell(`B${rowNumber}`).value(emp.region || defaultRegion);
      worksheet.cell(`C${rowNumber}`).value(emp.department || defaultDepartment);
      worksheet.cell(`D${rowNumber}`).value(getEmployeeReportCode(emp));
      worksheet.cell(`E${rowNumber}`).value(emp.name);
      worksheet.cell(`AL${rowNumber}`).value(reportStandardDays);
      worksheet.cell(`BC${rowNumber}`).value(metrics.notes || '');

      metrics.dayCodes.forEach((code, dayIndex) => {
        if(dayIndex >= days) return;
        worksheet.cell(`${excelColumnName(6 + dayIndex)}${rowNumber}`).value(code);
      });
    });
  }

  async function exportScheduleAsExcel(){
    ensureScheduleForMonth(state.year, state.month);

    try{
      const workbook = await loadExcelTemplateWorkbook();
      const worksheets = getExcelTemplateWorksheets(workbook);
      if(!worksheets.length){
        throw new Error('엑셀 템플릿 시트를 찾지 못했어.');
      }

      const employees = getExcelEmployees();
      const days = getDays(state.year, state.month);
      const firstEmployeeRow = 8;
      const lastEmployeeRow = 49;
      if(employees.length > (lastEmployeeRow - firstEmployeeRow + 1)){
        throw new Error('보고 양식에 들어갈 직원 수를 초과했어.');
      }

      const baseWorksheet = worksheets[0];
      const headerStyleWorksheet = getExcelHeaderStyleTemplateWorksheet(workbook);
      const defaultRegion = state.teamMeta?.region || baseWorksheet.cell('B8').value() || '광주';
      const defaultDepartment = state.teamMeta?.department || baseWorksheet.cell('C8').value() || '분자미생물학팀';
      const standardWorkableDays = getStandardWorkableDays(state.year, state.month);
      const reportStandardDays = getExcelTemplateStandardDays(workbook);

      worksheets.forEach((worksheet) => {
        populateExcelTemplateWorksheet(worksheet, {
          employees,
          days,
          firstEmployeeRow,
          lastEmployeeRow,
          defaultRegion,
          defaultDepartment,
          standardWorkableDays,
          reportStandardDays,
          headerStyleWorksheet
        });
      });

      const blob = await workbook.outputAsync();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `근무표_${state.year}-${String(state.month).padStart(2, '0')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }catch(e){
      console.error(e);
      alert(e.message || '엑셀 내보내기에 실패했어.');
    }
  }

  async function exportCalendarAsPng(){
    const view = document.getElementById('view-calendar');
    if(!view){
      alert('이미지로 저장할 근무표를 찾지 못했어.');
      return;
    }

    const prevTab = state.activeTab;
    state.activeTab = 'calendar';
    renderAll();

    try{
      const html2canvas = await loadHtml2Canvas();
      const target = document.getElementById('view-calendar');
      if(!target) throw new Error('근무표 화면이 준비되지 않았어.');
      const selectedEmp = state.employees.find(e=>Number(e.id) === Number(state.selectedEmployeeId));
      const fileName = selectedEmp
        ? `근무표_${state.year}-${String(state.month).padStart(2,'0')}_${selectedEmp.name}.png`
        : `근무표_${state.year}-${String(state.month).padStart(2,'0')}.png`;
      const canvas = await html2canvas(target, {
        backgroundColor: '#f5f7fb',
        scale: Math.max(2, window.devicePixelRatio || 1),
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: Math.max(document.documentElement.scrollWidth, window.innerWidth),
        windowHeight: Math.max(document.documentElement.scrollHeight, window.innerHeight)
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      if(/iPhone|iPad|iPod/i.test(navigator.userAgent || '')){
        const preview = window.open('');
        if(preview){
          preview.document.write(`<title>${escapeHtml(fileName)}</title><img src="${dataUrl}" style="width:100%;height:auto;display:block" alt="근무표 PNG" />`);
          preview.document.close();
        }
      }
    }catch(e){
      alert(e.message || 'PNG 저장에 실패했어. 잠시 후 다시 시도해줘.');
    }finally{
      state.activeTab = prevTab;
      renderAll();
    }
  }

  function triggerPrint(){
      const view = document.getElementById('view-calendar');
      const stylesheet = document.querySelector('link[rel="stylesheet"]');
      if(!view || !stylesheet){
      alert('인쇄할 화면을 아직 준비하지 못했어. 잠시 후 다시 시도해줘.');
        return;
      }
      const isMobilePrint = shouldUseNativeMobilePrint();
      if(isMobilePrint){
        exportCalendarAsPng();
        return;
      }
      const popup = window.open('', '_blank', isMobilePrint ? '' : 'width=1280,height=900');
    const title = document.getElementById('printTitle')?.textContent || `${state.year}년 ${state.month}월 근무표`;
    const rootStyle = document.documentElement.style.cssText || '';
    const printMarkup = `
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <link rel="stylesheet" href="${stylesheet.href}" />
        <style>:root{${rootStyle}}</style>
      </head>
        <body>
          <div class="app">
            ${view.outerHTML}
          </div>
          <script>
            var isMobilePrint = ${isMobilePrint ? 'true' : 'false'};
            window.addEventListener('load', function(){
              setTimeout(function(){
                window.focus();
                if(typeof window.print === 'function'){
                  window.print();
                }
              }, isMobilePrint ? 450 : 250);
            });
            if(!isMobilePrint){
              window.addEventListener('afterprint', function(){
                window.close();
              });
            }
          <\/script>
        </body>
        </html>
      `;

    if(popup){
      popup.document.open();
      popup.document.write(printMarkup);
      popup.document.close();
      return;
    }

    if(typeof window.print === 'function'){
      setTimeout(() => window.print(), 150);
      return;
    }

    alert('이 기기에서는 인쇄 창을 열지 못했어. 팝업 차단을 해제하거나 다른 브라우저에서 다시 시도해줘.');
  }

  function renderEmployees(){
    let html = `
      <thead>
        <tr>
          <th style="width:80px">ID</th>
          <th style="width:140px">사번</th>
          <th>이름</th>
          <th style="width:120px">기본 근무</th>
          <th style="width:220px">관리</th>
        </tr>
      </thead>
      <tbody>
    `;

    for(const emp of state.employees){
      html += `
        <tr>
          <td>${emp.id}</td>
          <td>${emp.employeeNo || ''}</td>
          <td>${emp.name}</td>
          <td>${emp.role}</td>
          <td>
            <div class="table-actions-inline">
            <button class="btn" onclick="openEmployeeModal(${emp.id})">수정</button>
            <button class="btn danger" onclick="deleteEmployee(${emp.id})">삭제</button>
            </div>
          </td>
        </tr>
      `;
    }

    html += '</tbody>';
    document.getElementById('employeeTable').innerHTML = html;
  }

  function renderHolidayTables(){
    const holidayRows = Object.entries(state.holidays)
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([date,v])=>`
        <tr>
          <td>${date}</td>
          <td>${v.name}</td>
          <td><button class="btn danger" onclick="removeHoliday('${date}')">삭제</button></td>
        </tr>
      `).join('');

    document.getElementById('holidayTable').innerHTML = `
      <thead><tr><th>날짜</th><th>이름</th><th>관리</th></tr></thead>
      <tbody>${holidayRows || `<tr><td colspan="3" class="muted">등록된 공휴일이 없습니다.</td></tr>`}</tbody>
    `;

    const subRows = Object.entries(state.subHolidays)
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([date,v])=>`
        <tr>
          <td>${date}</td>
          <td>${v.name}</td>
          <td><button class="btn danger" onclick="removeSubHoliday('${date}')">삭제</button></td>
        </tr>
      `).join('');

    document.getElementById('subHolidayTable').innerHTML = `
      <thead><tr><th>날짜</th><th>이름</th><th>관리</th></tr></thead>
      <tbody>${subRows || `<tr><td colspan="3" class="muted">등록된 대체휴무일이 없습니다.</td></tr>`}</tbody>
    `;
  }

  function getWeekBuckets(y,m){
    const days = getDays(y,m);
    const buckets = [];
    let start = 1;
    while(start <= days){
      const end = Math.min(start + 6, days);
      buckets.push({ start, end });
      start += 7;
    }
    return buckets;
  }

  function formatWeeklyType(value){
    const int = Math.floor(value);
    const decimal = value - int;
    if(decimal === 0) return `주 ${int}일`;
    if(Math.abs(decimal - 0.5) < 0.01) return `주 ${int}.5일`;
    return `주 ${value.toFixed(1)}일`;
  }

  function getMonthOffset(baseYear, baseMonth, offset){
    const date = new Date(baseYear, baseMonth - 1 + offset, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }

  function getWeekendHolidayWorkStats(empId, year, month){
    const days = getDays(year, month);
    let total = 0;
    let weekend = 0;
    let holiday = 0;

    for(let d = 1; d <= days; d++){
      const dateKey = dKey(year, month, d);
      const entry = getEntry(empId, dateKey);
      const isWorkDay = entry.shift === '조출' || entry.shift === '주간' || entry.shift === '야간';
      if(!isWorkDay) continue;

      const dow = parseDateKey(dateKey).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isHoliday = !!state.holidays?.[dateKey] || !!state.subHolidays?.[dateKey];
      if(!isWeekend && !isHoliday) continue;

      total++;
      if(isWeekend) weekend++;
      if(isHoliday) holiday++;
    }

    return { total, weekend, holiday };
  }

  function formatWeekendHolidaySummary(stats){
    return `${stats.total}회 (주말 ${stats.weekend}, 공휴일 ${stats.holiday})`;
  }

  function calculateStats(){
    ensureScheduleForMonth(state.year, state.month);
    const prevMonth = getMonthOffset(state.year, state.month, -1);
    const prevPrevMonth = getMonthOffset(state.year, state.month, -2);
    const weekBuckets = getWeekBuckets(state.year, state.month);

    return state.employees.map(emp=>{
      let dayShift = 0;
      let nightShift = 0;
      let offShift = 0;
      const weeklyCounts = [];

      for(let w=0; w<weekBuckets.length; w++){
        let count = 0;
        for(let d=weekBuckets[w].start; d<=weekBuckets[w].end; d++){
          const key = dKey(state.year, state.month, d);
          const entry = getEntry(emp.id, key);
          if(entry.shift === '조출' || entry.shift === '주간'){
            dayShift++;
            count++;
          }else if(entry.shift === '야간'){
            nightShift++;
            count++;
          }else{
            offShift++;
          }
        }
        weeklyCounts.push(count);
      }

      const totalWork = dayShift + nightShift;
      const avgWeekly = weekBuckets.length ? totalWork / weekBuckets.length : 0;
      const currentWeekendHoliday = getWeekendHolidayWorkStats(emp.id, state.year, state.month);
      const prevWeekendHoliday = getWeekendHolidayWorkStats(emp.id, prevMonth.year, prevMonth.month);
      const prevPrevWeekendHoliday = getWeekendHolidayWorkStats(emp.id, prevPrevMonth.year, prevPrevMonth.month);

      return {
        name: emp.name,
        role: emp.role,
        dayShift,
        nightShift,
        offShift,
        totalWork,
        weeklyCounts,
        avgWeekly,
        currentWeekendHoliday,
        prevWeekendHoliday,
        prevPrevWeekendHoliday
      };
    });
  }

  function renderStats(){
    const rows = calculateStats();

    let html = `
      <div class="muted" style="margin-bottom:12px">
        기준: 주간 + 야간 = 근무일, 휴무 = 비근무일
      </div>
        <table class="basic stats-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>기본 근무</th>
            <th>주간 근무일</th>
            <th>야간 근무일</th>
            <th>휴무일</th>
              <th>총 근무일</th>
              <th>주차별 근무일</th>
              <th>평균 주당 근무일</th>
              <th>${state.year}년 ${state.month}월 주말/공휴일 근무</th>
              <th>${getMonthOffset(state.year, state.month, -1).year}년 ${getMonthOffset(state.year, state.month, -1).month}월 주말/공휴일 근무</th>
              <th>${getMonthOffset(state.year, state.month, -2).year}년 ${getMonthOffset(state.year, state.month, -2).month}월 주말/공휴일 근무</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
      `;

    rows.forEach(item=>{
      const weeklyText = item.weeklyCounts.map((v,i)=>`${i+1}주차 ${v}일`).join(' / ');
      let judge = formatWeeklyType(item.avgWeekly);
      if(item.avgWeekly >= 5.75) judge += ' · 과다';
      else if(item.avgWeekly >= 5.25) judge += ' · 주 5일 이상';
      else if(item.avgWeekly >= 4.75) judge += ' · 주 5일권';
      else if(item.avgWeekly >= 4.25) judge += ' · 주 4.5일권';
      else judge += ' · 주 4일권';

      html += `
        <tr>
          <td>${item.name}</td>
          <td>${item.role}</td>
          <td>${item.dayShift}</td>
          <td>${item.nightShift}</td>
            <td>${item.offShift}</td>
            <td><strong>${item.totalWork}</strong></td>
            <td>${weeklyText}</td>
            <td>${item.avgWeekly.toFixed(1)}일</td>
            <td>${formatWeekendHolidaySummary(item.currentWeekendHoliday)}</td>
            <td>${formatWeekendHolidaySummary(item.prevWeekendHoliday)}</td>
            <td>${formatWeekendHolidaySummary(item.prevPrevWeekendHoliday)}</td>
            <td>${judge}</td>
          </tr>
        `;
      });

    html += '</tbody></table>';
    document.getElementById('statsWrap').innerHTML = html;
  }

  function renderEmployeeFilter(){
    const select = document.getElementById('employeeFilter');
    const status = document.getElementById('filterStatus');
    if(!select || !status) return;

    const options = ['<option value="">전체 일정</option>']
      .concat(state.employees.map(emp => `<option value="${emp.id}">${emp.name}</option>`));

    select.innerHTML = options.join('');
    select.value = state.selectedEmployeeId ? String(state.selectedEmployeeId) : '';

    if(state.selectedEmployeeId){
      const emp = state.employees.find(e => Number(e.id) === Number(state.selectedEmployeeId));
      status.textContent = emp
        ? `${emp.name}`
        : '전체 일정';
    }else{
      status.textContent = '전체 일정';
    }
  }

  function renderWishOffHelper(){
    const panel = document.getElementById('wishOffHelper');
    if(!panel) return;
    if(isAdmin()){
      panel.classList.add('hidden');
      return;
    }

    const emp = getSelectedEmployee();
    if(!emp){
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }

    const appliedDates = getCurrentMonthWishOffDates(emp.id);
    const draftEntries = Object.entries(state.viewerWishOffDrafts || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const modeActive = isViewerWishOffMode();

    const draftMarkup = draftEntries.length
      ? `<div class="wishoff-chip-list">
          ${draftEntries.map(([dateKey, enabled]) => `
            <button class="wishoff-chip-btn ${enabled ? 'pending-add' : 'pending-remove'}" type="button" onclick="handleViewerWishOffClick('${dateKey}')">
              ${dateKey} · ${enabled ? '신청 예정' : '해제 예정'}
            </button>
          `).join('')}
        </div>`
      : `<div class="wishoff-helper-empty">${modeActive ? '달력에서 날짜를 눌러 추가하거나, 아래 신청 날짜를 눌러 해제할 수 있어.' : '희망휴무 입력을 켜면 여러 날짜를 한 번에 선택할 수 있어.'}</div>`;

    const appliedMarkup = appliedDates.length
      ? `<div class="wishoff-chip-list">
          ${appliedDates.map(dateKey => {
            const draftAction = getWishOffDraftAction(dateKey);
            const extraClass = draftAction === false ? 'pending-remove' : (draftAction === true ? 'pending-add' : '');
            const suffix = draftAction === false ? ' · 해제 예정' : '';
            return `<button class="wishoff-chip-btn ${extraClass}" type="button" onclick="${modeActive ? `handleViewerWishOffClick('${dateKey}')` : 'void(0)'}">${dateKey}${suffix}</button>`;
          }).join('')}
        </div>`
      : `<div class="wishoff-helper-empty">이번 달 희망휴무 신청 내역이 아직 없어.</div>`;

    panel.innerHTML = `
      <div class="wishoff-helper-head">
        <div>
          <div class="wishoff-helper-title">${emp.name} 희망휴무</div>
          <div class="wishoff-helper-desc">입력 모드에서는 달력 날짜를 눌러 신청 예정이나 해제 예정으로 바꾸고, 상단의 선택 저장으로 한 번에 반영할 수 있어.</div>
        </div>
      </div>
      <div class="wishoff-helper-grid">
        <div class="wishoff-helper-card">
          <div class="wishoff-helper-label">현재 선택 중</div>
          ${draftMarkup}
        </div>
        <div class="wishoff-helper-card">
          <div class="wishoff-helper-label">이번 달 신청됨</div>
          ${appliedMarkup}
        </div>
      </div>
    `;
    panel.classList.remove('hidden');
  }

  function setEmployeeFilter(value){
    state.selectedEmployeeId = value ? Number(value) : null;
    clearWishOffDrafts();
    if(!state.selectedEmployeeId) state.viewerWishOffMode = false;
    saveState();
    renderAll();
  }

  function clearEmployeeFilter(){
    state.selectedEmployeeId = null;
    state.viewerWishOffMode = false;
    clearWishOffDrafts();
    saveState();
    renderAll();
  }

  function toggleWishOffMode(){
    if(isAdmin()) return;
    if(!state.selectedEmployeeId){
      alert('먼저 본인 이름을 선택해줘.');
      return;
    }
    if(state.viewerWishOffMode){
      clearWishOffDrafts();
    }
    state.viewerWishOffMode = !state.viewerWishOffMode;
    renderAll();
  }

  async function handleViewerWishOffClick(dateKey){
    if(!isViewerWishOffMode()) return;
    const dt = parseDateKey(dateKey);
    if(dt.getDay() === 0 || isHolidayDate(dateKey)){
      alert('이미 기본 휴무인 날짜는 희망휴무 신청이 필요 없어.');
      return;
    }

    const selectedId = Number(state.selectedEmployeeId);
    const entry = getEntry(selectedId, dateKey);
    const currentDraft = getWishOffDraftAction(dateKey);
    if(currentDraft === null){
      if(!state.viewerWishOffDrafts || typeof state.viewerWishOffDrafts !== 'object') state.viewerWishOffDrafts = {};
      state.viewerWishOffDrafts[dateKey] = !isWishOffTagged(entry);
    }else{
      delete state.viewerWishOffDrafts[dateKey];
    }
    renderAll();
  }

  function cancelViewerWishOffSelection(){
    clearWishOffDrafts();
    renderAll();
  }

  async function submitViewerWishOffBatch(){
    if(!isViewerWishOffMode()) return;
    const drafts = Object.entries(state.viewerWishOffDrafts || {});
    if(!drafts.length){
      alert('먼저 날짜를 선택해줘.');
      return;
    }

    const selectedId = Number(state.selectedEmployeeId);
    showSyncStatus('saving');
    try{
      for(const [dateKey, enabled] of drafts){
        const res = await fetch(buildApiUrl('/api/request-wish-off'), {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            employeeId: selectedId,
            dateKey,
            enabled: !!enabled,
            baseRevision: Number(state._revision || 0),
            teamId: getActiveTeamId()
          })
        });
        const data = await res.json();
        if(!res.ok){
          throw new Error(data.error || '희망휴무 저장 실패');
        }
        const { isAdmin: _ignoredIsAdmin, ...safeState } = data.state || {};
        state = { ...state, ...safeState };
        state.memoOpen = false;
        if(!Array.isArray(state.notices)) state.notices = [];
        state._revision = Number(state._revision || 0);
      }
      clearWishOffDrafts();
      showSyncStatus('saved');
      renderAll();
    }catch(e){
      showSyncStatus('error');
      alert(e.message || '희망휴무 저장에 실패했어.');
    }
  }

  function renderMemos(){
    const panel = document.getElementById('memoPanel');
    panel.classList.toggle('hidden', !state.memoOpen);

    const memoToggleBtn = document.getElementById('memoToggleBtn');
    if(memoToggleBtn){
      memoToggleBtn.textContent = state.memoOpen ? '메모장 닫기' : '메모장 열기';
      memoToggleBtn.classList.toggle('primary', state.memoOpen);
    }

    const wrap = document.getElementById('memoList');
    const memos = [...state.memos].sort((a,b)=>b.updatedAt - a.updatedAt);

    if(memos.length === 0){
      wrap.innerHTML = `<div class="muted">저장된 메모가 없습니다.</div>`;
      return;
    }

    wrap.innerHTML = memos.map(memo=>`
      <div class="memo-item">
        <div class="memo-item-head">
          <div>
            <div class="memo-item-title">${escapeHtml(memo.title || '(제목 없음)')}</div>
            <div class="memo-item-date">수정: ${formatDateTime(memo.updatedAt)}</div>
          </div>
        </div>
        <div class="memo-item-body">${escapeHtml(memo.content || '')}</div>
        <div class="memo-actions">
          <button class="btn small" onclick="editMemo(${memo.id})">수정</button>
          <button class="btn small danger" onclick="deleteMemo(${memo.id})">삭제</button>
        </div>
      </div>
    `).join('');
  }

  function toggleMemoPanel(){
      if(!requireAdmin()) return;
      state.memoOpen = !state.memoOpen;
      renderMemos();
    }

  function escapeHtml(str){
    return String(str)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;')
      .replaceAll('\n','<br>');
  }

  function formatDateTime(ts){
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }

  function saveMemo(){
    if(!requireAdmin()) return;
    const title = document.getElementById('memoTitle').value.trim();
    const content = document.getElementById('memoContent').value.trim();

    if(!title && !content){
      alert('메모 제목 또는 내용을 입력해줘.');
      return;
    }

    const now = Date.now();

    if(editingMemoId){
      const target = state.memos.find(m=>m.id === editingMemoId);
      if(target){
        target.title = title;
        target.content = content;
        target.updatedAt = now;
      }
    } else {
      state.memos.push({
        id: now,
        title,
        content,
        createdAt: now,
        updatedAt: now
      });
    }

    saveState();
    resetMemoForm();
    renderMemos();
  }

  function editMemo(id){
    if(!requireAdmin()) return;
    const memo = state.memos.find(m=>m.id === id);
    if(!memo) return;

    editingMemoId = id;
    document.getElementById('memoTitle').value = memo.title || '';
    document.getElementById('memoContent').value = memo.content || '';
  }

  function deleteMemo(id){
    if(!requireAdmin()) return;
    const memo = state.memos.find(m=>m.id === id);
    if(!memo) return;
    if(!confirm(`"${memo.title || '이 메모'}"를 삭제할까?`)) return;

    state.memos = state.memos.filter(m=>m.id !== id);
    if(editingMemoId === id){
      resetMemoForm();
    }
    saveState();
    renderMemos();
  }

  function resetMemoForm(){
    editingMemoId = null;
    document.getElementById('memoTitle').value = '';
    document.getElementById('memoContent').value = '';
  }

  function applyRoleView(){
    const adminMode = isAdmin();
    const viewerMode = state.sessionRole === 'team_viewer';
    const guestMode = state.sessionRole === 'guest';
    document.querySelectorAll('.admin-only').forEach(el=>{
      el.classList.toggle('hidden-by-role', !adminMode);
    });
    document.querySelectorAll('.viewer-only').forEach(el=>{
      el.classList.toggle('hidden-by-role', !viewerMode);
    });
    document.querySelectorAll('.super-admin-only').forEach(el=>{
      el.classList.toggle('hidden-by-role', !isSuperAdmin());
    });

    const roleBadge = document.getElementById('roleBadge');
    const adminBtn = document.getElementById('adminAuthBtn');
    if(roleBadge){
      if(isSuperAdmin()){
        roleBadge.textContent = `상위 관리자 · ${state.currentTeamName || '전체 팀'}`;
      }else if(adminMode){
        roleBadge.textContent = `${state.currentTeamName || '현재 팀'} 관리자 · 편집 가능`;
      }else if(viewerMode){
        roleBadge.textContent = `${state.currentTeamName || '현재 팀'} 조회 모드`;
      }else{
        roleBadge.textContent = '로그인 필요';
      }
      roleBadge.classList.toggle('admin', adminMode || isSuperAdmin());
      roleBadge.classList.toggle('viewer', viewerMode || guestMode);
    }
    if(adminBtn){
      adminBtn.textContent = guestMode ? '로그인' : '로그아웃';
    }
    const wishOffBtn = document.getElementById('wishOffModeBtn');
    const wishOffSaveBtn = document.getElementById('wishOffSaveBtn');
    const wishOffCancelBtn = document.getElementById('wishOffCancelBtn');
    const draftCount = countWishOffDrafts();
    if(wishOffBtn){
      wishOffBtn.textContent = state.viewerWishOffMode ? `희망휴무 입력 중${draftCount ? ` (${draftCount})` : ''}` : '희망휴무 입력 켜기';
      wishOffBtn.classList.toggle('toggle-active', !!state.viewerWishOffMode);
    }
    if(wishOffSaveBtn){
      wishOffSaveBtn.classList.toggle('hidden', !state.viewerWishOffMode);
      wishOffSaveBtn.textContent = draftCount ? `선택 저장 (${draftCount})` : '선택 저장';
    }
    if(wishOffCancelBtn){
      wishOffCancelBtn.classList.toggle('hidden', !state.viewerWishOffMode);
    }

    if(!adminMode){
      state.activeTab = 'calendar';
    }
  }

  function renderTeamSwitcher(){
    const wrap = document.getElementById('teamSwitcherWrap');
    const select = document.getElementById('teamSwitcher');
    if(!wrap || !select) return;
    if(!isSuperAdmin() || !state.availableTeams.length){
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    select.innerHTML = state.availableTeams
      .map(team => `<option value="${team.id}">${team.name}</option>`)
      .join('');
    select.value = getActiveTeamId() || state.availableTeams[0]?.id || '';
  }

  function renderAuthGate(forceOpen = false){
    const gate = document.getElementById('authGate');
    const body = document.getElementById('authGateBody');
    if(!gate || !body) return;
    const needsAuth = forceOpen || state.sessionRole === 'guest' || !getAdminToken();
    gate.classList.toggle('hidden', !needsAuth);
    if(!needsAuth) return;

    const teamOptions = state.availableTeams.length
      ? state.availableTeams.map(team => `<option value="${team.id}">${team.name}</option>`).join('')
      : '<option value="">등록된 팀 없음</option>';

    body.innerHTML = `
      <div class="form-row" style="flex-direction:column;align-items:stretch;gap:12px;">
        <div class="field" style="min-width:100%;">
          <label>로그인 유형</label>
          <select id="authLoginType" onchange="toggleAuthTeamField()">
            <option value="team_viewer">팀 조회</option>
            <option value="team_admin">팀 관리자</option>
            <option value="super_admin">상위 관리자</option>
          </select>
        </div>
        <div class="field" id="authTeamField" style="min-width:100%;">
          <label>팀</label>
          <select id="authTeamId">${teamOptions}</select>
        </div>
        <div class="field" style="min-width:100%;">
          <label>비밀번호</label>
          <input id="authPasswordInput" type="password" placeholder="비밀번호" onkeydown="if(event.key==='Enter') submitAdminLogin()" />
        </div>
        <div class="muted" style="font-size:12px;">팀별 조회/관리자 비밀번호는 상위 관리자 화면에서 따로 관리할 수 있어.</div>
      </div>
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn" onclick="openRecoverPasswordModal()">상위 관리자 비밀번호 복원</button>
        <button class="btn primary" onclick="submitAdminLogin()">로그인</button>
      </div>
    `;
    toggleAuthTeamField();
  }

  function renderAll(){
    ensureEarlyShiftSetting();
    ensureVisibleRows();
    applyHighlightColors();
    applyRoleView();
    renderTeamSwitcher();
    renderAuthGate();
    renderLastSavedInfo();
    const earlyBtn = document.getElementById('earlyShiftToggleBtn');
    if(earlyBtn){
      const earlyOn = state.visibleRows.조출 && (state.slotConfig.조출 > 0);
      earlyBtn.textContent = earlyOn ? '조출줄 끄기' : '조출줄 켜기';
      earlyBtn.classList.toggle('primary', earlyOn);
    }
    const nightBtn = document.getElementById('nightShiftToggleBtn');
    if(nightBtn){
      nightBtn.textContent = state.visibleRows.야간 ? '야간줄 끄기' : '야간줄 켜기';
      nightBtn.classList.toggle('primary', state.visibleRows.야간);
    }
    renderCalendar();
    renderEmployees();
    renderHolidayTables();
    renderStats();
    renderEmployeeFilter();
    renderWishOffHelper();
    renderNoticePanel();
    renderMemos();

    document.querySelectorAll('.tab').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
    });

    document.getElementById('view-calendar').classList.toggle('hidden', state.activeTab !== 'calendar');
    document.getElementById('view-employees').classList.toggle('hidden', !isAdmin() || state.activeTab !== 'employees');
    document.getElementById('view-holiday').classList.toggle('hidden', !isAdmin() || state.activeTab !== 'holiday');
    document.getElementById('view-stats').classList.toggle('hidden', !isAdmin() || state.activeTab !== 'stats');
    document.getElementById('view-settings').classList.toggle('hidden', !isAdmin() || state.activeTab !== 'settings');
    document.getElementById('view-changelog').classList.toggle('hidden', state.activeTab !== 'changelog');
  }

  function showTab(tab){
    const publicTabs = ['calendar', 'changelog'];
    if(!publicTabs.includes(tab) && !requireAdmin()) return;
    state.activeTab = tab;
    // changelog 탭 전환은 KV 저장 불필요
    if(tab !== 'changelog') saveState();
    renderAll();
  }

  async function handleTeamSwitch(teamId){
    if(!isSuperAdmin()) return;
    if(!teamId || teamId === getActiveTeamId()) return;
    setActiveTeamId(teamId);
    await loadState(true);
    await loadChangelog(true);
    renderAll();
  }

  async function fetchTeamManagerList(){
    const res = await fetch('/api/teams', {
      headers: getAuthHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || '팀 목록을 불러오지 못했어.');
    teamManagerCache = Array.isArray(data.teams) ? data.teams : [];
    state.availableTeams = [...teamManagerCache];
  }

  function renderTeamManagerModal(){
    const selected = editingTeamConfigId
      ? teamManagerCache.find(team => team.id === editingTeamConfigId)
      : null;
    const listMarkup = teamManagerCache.map(team => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#fff;">
        <div style="min-width:0;">
          <div style="font-weight:800;">${escHtml(team.name)}</div>
          <div style="font-size:12px;color:var(--muted);">${escHtml(team.department || '')} · ${escHtml(team.location || '')}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn small" type="button" onclick="editTeamConfig('${team.id}')">수정</button>
          <button class="btn small danger" type="button" onclick="deleteTeamConfig('${team.id}')">삭제</button>
        </div>
      </div>
    `).join('');

    openModal(`
      <div class="modal-head">
        <div class="modal-title">팀 관리</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>
      <div style="display:grid;grid-template-columns:minmax(220px, 1fr) minmax(280px, 1.2fr);gap:16px;">
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:13px;font-weight:800;">등록된 팀</div>
          ${listMarkup || `<div class="muted">등록된 팀이 없어.</div>`}
          <button class="btn" type="button" onclick="startCreateTeam()">새 팀 추가</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:13px;font-weight:800;">${selected ? '팀 수정' : '새 팀 추가'}</div>
          <div class="field">
            <label>팀 이름</label>
            <input id="teamFormName" type="text" value="${selected ? escHtml(selected.name || '') : ''}" placeholder="예: 분자미생물학팀" />
          </div>
          <div class="field">
            <label>부서명</label>
            <input id="teamFormDepartment" type="text" value="${selected ? escHtml(selected.department || '') : ''}" placeholder="엑셀 보고용 부서명" />
          </div>
          <div class="field">
            <label>센터/위치</label>
            <input id="teamFormLocation" type="text" value="${selected ? escHtml(selected.location || '') : ''}" placeholder="예: 광주호남검사센터" />
          </div>
          <div class="field">
            <label>지역</label>
            <input id="teamFormRegion" type="text" value="${selected ? escHtml(selected.region || '') : '광주'}" />
          </div>
          <div class="field">
            <label>근무 타입 표기</label>
            <input id="teamFormWorkType" type="text" value="${selected ? escHtml(selected.workType || '') : '주 5일제'}" />
          </div>
          <div class="field">
            <label>기준 시간 표기</label>
            <input id="teamFormStandardHours" type="text" value="${selected ? escHtml(selected.standardHours || '') : '8시간'}" />
          </div>
          <div class="field">
            <label>팀 관리자 비밀번호 ${selected ? '(변경 시에만 입력)' : ''}</label>
            <input id="teamFormAdminPassword" type="password" placeholder="${selected ? '비워두면 유지' : '4자 이상'}" />
          </div>
          <div class="field">
            <label>팀 조회 비밀번호 ${selected ? '(변경 시에만 입력)' : ''}</label>
            <input id="teamFormViewerPassword" type="password" placeholder="${selected ? '비워두면 유지' : '4자 이상'}" />
          </div>
          <div id="teamFormMsg" class="muted" style="min-height:20px;font-size:12px;"></div>
          <div class="modal-actions">
            <button class="btn" type="button" onclick="startCreateTeam()">새 팀 입력</button>
            <button class="btn primary" type="button" onclick="saveTeamConfig()">${selected ? '수정 저장' : '팀 생성'}</button>
          </div>
        </div>
      </div>
    `);
  }

  async function openTeamManager(){
    if(!isSuperAdmin()){
      alert('상위 관리자만 팀을 관리할 수 있어.');
      return;
    }
    try{
      await fetchTeamManagerList();
      editingTeamConfigId = null;
      renderTeamManagerModal();
    }catch(e){
      alert(e.message || '팀 목록을 불러오지 못했어.');
    }
  }

  function startCreateTeam(){
    editingTeamConfigId = null;
    renderTeamManagerModal();
  }

  function editTeamConfig(teamId){
    editingTeamConfigId = teamId;
    renderTeamManagerModal();
  }

  async function saveTeamConfig(){
    const team = {
      name: (document.getElementById('teamFormName')?.value || '').trim(),
      department: (document.getElementById('teamFormDepartment')?.value || '').trim(),
      location: (document.getElementById('teamFormLocation')?.value || '').trim(),
      region: (document.getElementById('teamFormRegion')?.value || '').trim(),
      workType: (document.getElementById('teamFormWorkType')?.value || '').trim(),
      standardHours: (document.getElementById('teamFormStandardHours')?.value || '').trim(),
      adminPassword: document.getElementById('teamFormAdminPassword')?.value || '',
      viewerPassword: document.getElementById('teamFormViewerPassword')?.value || ''
    };
    const msg = document.getElementById('teamFormMsg');
    if(!team.name){
      if(msg) msg.textContent = '팀 이름을 입력해줘.';
      return;
    }
    if(!editingTeamConfigId && team.adminPassword.length < 4){
      if(msg) msg.textContent = '새 팀의 관리자 비밀번호는 4자 이상이어야 해.';
      return;
    }
    if(!editingTeamConfigId && team.viewerPassword.length < 4){
      if(msg) msg.textContent = '새 팀의 조회 비밀번호는 4자 이상이어야 해.';
      return;
    }

    try{
      const shouldRelogin =
        !!editingTeamConfigId &&
        (!!team.adminPassword.trim() || !!team.viewerPassword.trim());
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          adminToken: getAdminToken(),
          action: editingTeamConfigId ? 'update' : 'create',
          teamId: editingTeamConfigId || undefined,
          team
        })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || '팀 저장 실패');
      if(shouldRelogin){
        await loadAuthOptions();
        alert('팀 비밀번호를 변경해서 다시 로그인해줘.');
        clearAdminSession();
        closeModal();
        renderAll();
        return;
      }
      await loadAuthOptions();
      await fetchTeamManagerList();
      editingTeamConfigId = null;
      renderTeamManagerModal();
    }catch(e){
      if(msg) msg.textContent = e.message || '팀 저장에 실패했어.';
    }
  }

  async function deleteTeamConfig(teamId){
    const team = teamManagerCache.find(item => item.id === teamId);
    if(!team) return;
    if(!confirm(`${team.name} 팀을 삭제할까?`)) return;
    try{
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          adminToken: getAdminToken(),
          action: 'delete',
          teamId
        })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || '팀 삭제 실패');
      await loadAuthOptions();
      alert('팀을 삭제했어. 보안을 위해 다시 로그인해줘.');
      clearAdminSession();
      renderAll();
      closeModal();
    }catch(e){
      alert(e.message || '팀 삭제에 실패했어.');
    }
  }

  async function handleAdminAuth(){
    if(state.sessionRole !== 'guest'){
      clearAdminSession();
      await loadAuthOptions();
      saveState();
      renderAll();
      return;
    }
    await loadAuthOptions();
    renderAuthGate(true);
  }

  function toggleAuthTeamField(){
    const loginType = document.getElementById('authLoginType')?.value || 'team_viewer';
    const teamField = document.getElementById('authTeamField');
    if(teamField){
      teamField.classList.toggle('hidden', loginType === 'super_admin');
    }
  }

  async function submitAdminLogin(){
    const loginType = document.getElementById('authLoginType')?.value || 'team_viewer';
    const teamId = document.getElementById('authTeamId')?.value || '';
    const value = document.getElementById('authPasswordInput')?.value || '';
    if(!value){
      alert('비밀번호를 입력해줘.');
      return;
    }
    if(loginType !== 'super_admin' && !teamId){
      alert('팀을 선택해줘.');
      return;
    }

    try{
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginType,
          teamId,
          password: value
        })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok || !data.token){
        alert(data.error || '비밀번호가 일치하지 않아.');
        return;
      }

      sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      applySessionInfo(data.session || {});
      state.authReady = true;
      saveState();
      document.getElementById('authGate')?.classList.add('hidden');
      await loadState(true);
      await loadChangelog(true);
      renderAll();
    }catch(e){
      alert('로그인 중 오류가 발생했어. 잠시 후 다시 시도해줘.');
    }
  }

  function openRecoverPasswordModal(){
    openModal(`
      <div class="modal-head">
        <div class="modal-title">비밀번호 복원</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>

      <div class="form-row" style="flex-direction:column;gap:12px;">
        <div class="field" style="min-width:280px">
          <label>복구코드</label>
          <input id="recoverCodeInput" type="password" placeholder="복구코드" />
        </div>
        <div class="field" style="min-width:280px">
          <label>새 비밀번호</label>
          <input id="recoverPwNew" type="password" placeholder="새 비밀번호" />
        </div>
        <div class="field" style="min-width:280px">
          <label>새 비밀번호 확인</label>
          <input id="recoverPwConfirm" type="password" placeholder="새 비밀번호 다시 입력"
            onkeydown="if(event.key==='Enter') submitRecoverPassword()" />
        </div>
      </div>

      <div class="muted" style="margin-top:8px;font-size:12px;">복구코드는 화면에 표시하지 않아. 운영 중 별도로 보관한 복구코드를 입력해줘.</div>
      <div id="recoverPwMsg" style="font-size:13px;margin-top:8px;min-height:20px;"></div>

      <div class="modal-actions">
        <button class="btn" onclick="handleAdminAuth()">로그인으로 돌아가기</button>
        <button class="btn primary" onclick="submitRecoverPassword()">비밀번호 재설정</button>
      </div>
    `);
  }

  async function submitRecoverPassword(){
    const recoveryCode = document.getElementById('recoverCodeInput')?.value || '';
    const newPassword = document.getElementById('recoverPwNew')?.value || '';
    const confirmPassword = document.getElementById('recoverPwConfirm')?.value || '';
    const msgEl = document.getElementById('recoverPwMsg');

    if(!recoveryCode){ msgEl.textContent = '복구코드를 입력해줘.'; msgEl.style.color='#dc2626'; return; }
    if(!newPassword || newPassword.length < 4){ msgEl.textContent = '새 비밀번호는 4자 이상이어야 해.'; msgEl.style.color='#dc2626'; return; }
    if(newPassword !== confirmPassword){ msgEl.textContent = '새 비밀번호가 일치하지 않아.'; msgEl.style.color='#dc2626'; return; }

    msgEl.textContent = '재설정 중…';
    msgEl.style.color = '#2563eb';

    try{
      const res = await fetch('/api/recover-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recoveryCode,
          newPassword
        })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        msgEl.textContent = data.error || '복원 실패';
        msgEl.style.color = '#dc2626';
        return;
      }
      clearAdminSession();
      saveState();
      msgEl.textContent = '비밀번호를 재설정했어. 새 비밀번호로 다시 로그인해줘.';
      msgEl.style.color = '#16a34a';
      setTimeout(() => handleAdminAuth(), 800);
    }catch(e){
      msgEl.textContent = '서버 오류. 다시 시도해줘.';
      msgEl.style.color = '#dc2626';
    }
  }

  // ── 비밀번호 변경 모달 ──────────────────────────────────────
  function openChangeRecoveryCodeModal(){
    if(!isSuperAdmin()){
      alert('상위 관리자만 복구코드를 변경할 수 있어.');
      return;
    }
    openModal(`
      <div class="modal-head">
        <div class="modal-title">복구코드 변경</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>

      <div class="form-row" style="flex-direction:column;gap:12px;">
        <div class="field" style="min-width:280px">
          <label>현재 복구코드</label>
          <input id="recoveryCurrent" type="password" placeholder="현재 복구코드" />
        </div>
        <div class="field" style="min-width:280px">
          <label>새 복구코드</label>
          <input id="recoveryNew" type="password" placeholder="새 복구코드" />
        </div>
        <div class="field" style="min-width:280px">
          <label>새 복구코드 확인</label>
          <input id="recoveryConfirm" type="password" placeholder="새 복구코드 다시 입력"
            onkeydown="if(event.key==='Enter') submitChangeRecoveryCode()" />
        </div>
      </div>

      <div id="recoveryChangeMsg" style="font-size:13px;margin-top:8px;min-height:20px;"></div>

      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">취소</button>
        <button class="btn primary" onclick="submitChangeRecoveryCode()">변경</button>
      </div>
    `);
  }

  async function submitChangeRecoveryCode(){
    const currentVal = document.getElementById('recoveryCurrent')?.value || '';
    const newVal = document.getElementById('recoveryNew')?.value || '';
    const confirmVal = document.getElementById('recoveryConfirm')?.value || '';
    const msgEl = document.getElementById('recoveryChangeMsg');

    if(!currentVal){ msgEl.textContent = '현재 복구코드를 입력해줘.'; msgEl.style.color='#dc2626'; return; }
    if(!newVal || newVal.length < 4){ msgEl.textContent = '새 복구코드는 4자 이상이어야 해.'; msgEl.style.color='#dc2626'; return; }
    if(newVal !== confirmVal){ msgEl.textContent = '새 복구코드가 일치하지 않아.'; msgEl.style.color='#dc2626'; return; }

    msgEl.textContent = '변경 중…';
    msgEl.style.color = '#2563eb';

    try{
      const res = await fetch(buildApiUrl('/api/change-recovery-code'), {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          adminToken: getAdminToken(),
          currentRecoveryCode: currentVal,
          newRecoveryCode: newVal
        })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        msgEl.textContent = data.error || '변경 실패';
        msgEl.style.color = '#dc2626';
        return;
      }
      msgEl.textContent = '복구코드를 변경했어.';
      msgEl.style.color = '#16a34a';
      setTimeout(() => closeModal(), 1000);
    }catch(e){
      msgEl.textContent = '서버 오류. 다시 시도해줘.';
      msgEl.style.color = '#dc2626';
    }
  }

  // ── 저장 모달 (변경 메모 입력 후 KV 전송) ──────────────────
  function openSaveModal(){
    if(!requireAdmin()) return;
    const warnings = collectSaveWarnings();
    openModal(`
      <div class="modal-head">
        <div class="modal-title">근무표 저장</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>
      <div class="form-row" style="flex-direction:column;align-items:stretch;">
        ${buildSaveWarningsMarkup(warnings)}
        <div class="field" style="min-width:300px;width:100%;">
          <label>변경이력 메모</label>
          <input id="saveNoteInput" type="text" placeholder="예: 4월 야간 배정 수정"
            onkeydown="if(event.key==='Enter') confirmSave()" />
        </div>
        <div class="field" style="min-width:300px;width:100%;">
          <label>공지 내용 (선택)</label>
          <textarea id="saveNoticeInput" class="memo-textarea" style="min-height:90px;" placeholder="예: 4월 야간 스케줄을 일부 조정했습니다. 확인 부탁드립니다."></textarea>
        </div>
        <div class="muted" style="font-size:12px;">변경이력 메모는 기록에 남고, 공지 내용은 사용자 화면 상단 공지에 누적 표시돼.</div>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">취소</button>
        <button class="btn primary" onclick="confirmSave()">저장</button>
      </div>
    `);
    setTimeout(()=>{ document.getElementById('saveNoteInput')?.focus(); }, 80);
  }

  async function confirmSave(){
    const note = (document.getElementById('saveNoteInput')?.value || '').trim();
    const notice = (document.getElementById('saveNoticeInput')?.value || '').trim();
    if(!note){
      alert('변경이력 메모를 입력해줘.');
      return;
    }
    closeModal();
    await explicitSave(note, notice);
  }

  function openRestoreManager(snapshotId = null){
    if(!requireAdmin()) return;
    const snapshots = Array.isArray(state.snapshots) ? state.snapshots : [];
    if(!snapshots.length){
      openModal(`
        <div class="modal-head">
          <div class="modal-title">복원 관리</div>
          <button class="btn" onclick="closeModal()">닫기</button>
        </div>
        <div class="muted" style="font-size:13px;">아직 복원할 저장본이 없어. 관리자 저장이 1번 이상 있어야 해.</div>
        <div class="modal-actions">
          <button class="btn" onclick="closeModal()">닫기</button>
        </div>
      `);
      return;
    }

    if(snapshotId == null){
      restorePreviewSnapshotId = restorePreviewSnapshotId || Number(snapshots[0].id);
    } else {
      restorePreviewSnapshotId = Number(snapshotId);
    }

    const activeSnapshot = snapshots.find(item => Number(item.id) === Number(restorePreviewSnapshotId)) || snapshots[0];
    restorePreviewSnapshotId = Number(activeSnapshot.id);

    openModal(`
      <div class="modal-head">
        <div class="modal-title">복원 관리</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>
      <div class="snapshot-layout">
        <div class="snapshot-list">
          ${snapshots.map(snapshot => `
            <button class="snapshot-card ${Number(snapshot.id) === Number(activeSnapshot.id) ? 'active' : ''}" type="button" onclick="openRestoreManager(${Number(snapshot.id)})">
              <div class="snapshot-card-title">${escHtml(snapshot.note || '근무표 수정')}</div>
                <div class="snapshot-card-meta">${escHtml(normalizeDisplayTimestamp(snapshot.timestamp || '-'))}</div>
              <div class="snapshot-card-meta">${(snapshot.state?.year || '-') }년 ${(snapshot.state?.month || '-') }월 · rev ${Number(snapshot.revision || 0)}</div>
            </button>
          `).join('')}
        </div>
        <div class="snapshot-preview">
          <div class="save-warning-title" style="margin-bottom:12px;">복원 전 미리보기</div>
          ${buildSnapshotPreview(activeSnapshot)}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">닫기</button>
        <button class="btn primary" onclick="restoreSnapshot(${Number(activeSnapshot.id)})">이 저장본으로 복원</button>
      </div>
    `);
  }

  async function restoreSnapshot(snapshotId){
    if(!requireAdmin()) return;
    const snapshot = (Array.isArray(state.snapshots) ? state.snapshots : []).find(item => Number(item.id) === Number(snapshotId));
    if(!snapshot){
      alert('복원할 저장본을 찾지 못했어.');
      return;
    }
    if(!confirm(`"${snapshot.note || '근무표 수정'}" 저장본으로 복원할까?\n현재 상태는 복원 전 자동 백업돼.`)) return;

    showSyncStatus('saving');
    try{
      const res = await fetch(buildApiUrl('/api/restore-snapshot'), {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          adminToken: getAdminToken(),
          baseRevision: Number(state._revision || 0),
          snapshotId: Number(snapshotId),
          teamId: getActiveTeamId()
        })
      });

      if(res.status === 403){
        clearAdminSession();
        renderAll();
        throw new Error('admin session expired');
      }
      if(res.status === 409){
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'restore conflict');
      }
      if(!res.ok) throw new Error('restore failed');

      const data = await res.json();
      const restored = data.state || {};
      const { isAdmin: _ignoredIsAdmin, ...safeRestored } = restored;
      state = { ...state, ...safeRestored };
      state.memoOpen = false;
      if(!Array.isArray(state.notices)) state.notices = [];
      if(!Array.isArray(state.snapshots)) state.snapshots = [];
      state._revision = Number(data.revision || state._revision || 0);
      state._lastSavedAt = data.timestamp || state._lastSavedAt || '';
      markSaved();
      closeModal();
      await loadChangelog(true);
      renderAll();
      showSyncStatus('saved');
    }catch(e){
      showSyncStatus('error');
      if(e.message === 'admin session expired'){
        alert('관리자 세션이 만료됐어. 다시 로그인해줘.');
      } else if(e.message){
        alert(e.message);
      }
    }
  }

  function openChangePasswordModal(){
    if(!requireAdmin()) return;
    openModal(`
      <div class="modal-head">
        <div class="modal-title">${isSuperAdmin() ? '상위 관리자 비밀번호 변경' : '팀 관리자 비밀번호 변경'}</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>

      <div class="form-row" style="flex-direction:column;gap:12px;">
        <div class="field" style="min-width:280px">
          <label>현재 비밀번호</label>
          <input id="pwCurrent" type="password" placeholder="현재 비밀번호" />
        </div>
        <div class="field" style="min-width:280px">
          <label>새 비밀번호</label>
          <input id="pwNew" type="password" placeholder="새 비밀번호" />
        </div>
        <div class="field" style="min-width:280px">
          <label>새 비밀번호 확인</label>
          <input id="pwConfirm" type="password" placeholder="새 비밀번호 다시 입력"
            onkeydown="if(event.key==='Enter') submitChangePassword()" />
        </div>
      </div>

      <div id="pwChangeMsg" style="font-size:13px;margin-top:8px;min-height:20px;"></div>

      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">취소</button>
        <button class="btn primary" onclick="submitChangePassword()">변경</button>
      </div>
    `);
  }

  async function submitChangePassword(){
    const currentVal = document.getElementById('pwCurrent')?.value || '';
    const newVal     = document.getElementById('pwNew')?.value || '';
    const confirmVal = document.getElementById('pwConfirm')?.value || '';
    const msgEl      = document.getElementById('pwChangeMsg');

    if(!newVal){ msgEl.textContent = '새 비밀번호를 입력해줘.'; msgEl.style.color='#dc2626'; return; }
    if(newVal !== confirmVal){ msgEl.textContent = '새 비밀번호가 일치하지 않아.'; msgEl.style.color='#dc2626'; return; }
    if(newVal.length < 4){ msgEl.textContent = '비밀번호는 4자 이상이어야 해.'; msgEl.style.color='#dc2626'; return; }
    if(!currentVal){ msgEl.textContent = '현재 비밀번호를 입력해줘.'; msgEl.style.color='#dc2626'; return; }

    msgEl.textContent = '변경 중…';
    msgEl.style.color = '#2563eb';

    try{
      const res = await fetch(buildApiUrl('/api/change-password'), {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          adminToken: getAdminToken(),
          currentPassword: currentVal,
          newPassword: newVal
        })
      });
      const data = await res.json();
      if(!res.ok){
        if(res.status === 403){
          clearAdminSession();
          renderAll();
        }
        msgEl.textContent = data.error || '변경 실패';
        msgEl.style.color = '#dc2626';
        return;
      }
      clearAdminSession();
      renderAll();
      msgEl.textContent = '✓ 비밀번호가 변경됐어. 다시 로그인해줘.';
      msgEl.style.color = '#16a34a';
      setTimeout(() => closeModal(), 1200);
    }catch(e){
      msgEl.textContent = '서버 오류. 다시 시도해줘.';
      msgEl.style.color = '#dc2626';
    }
  }

  function changeMonth(delta){
    state.month += delta;
    if(state.month > 12){
      state.month = 1;
      state.year++;
    }
    if(state.month < 1){
      state.month = 12;
      state.year--;
    }
    ensureScheduleForMonth(state.year, state.month);
    saveState();
    renderAll();
  }

  function addEmployee(){
    if(!requireAdmin()) return;
    const employeeNo = readEmployeeNo('empEmployeeNo');
    const name = document.getElementById('empName').value.trim();
    const role = document.getElementById('empRole').value;
    if(!name){
      alert('이름을 입력해줘.');
      return;
    }
    const id = state.employees.length ? Math.max(...state.employees.map(e=>e.id)) + 1 : 1;
    state.employees.push({ id, employeeNo, name, role });
    ensureScheduleForMonth(state.year, state.month);
    document.getElementById('empEmployeeNo').value = '';
    document.getElementById('empName').value = '';
    saveState('직원 추가');
    renderAll();
  }

  function deleteEmployee(empId){
    if(!requireAdmin()) return;
    const emp = state.employees.find(e=>e.id === empId);
    if(!emp) return;
    if(!confirm(`${emp.name} 직원을 삭제할까?`)) return;
    state.employees = state.employees.filter(e=>e.id !== empId);
    delete state.schedule[empId];
    if(Number(state.selectedEmployeeId) === Number(empId)) state.selectedEmployeeId = null;
    saveState();
    renderAll();
  }

  function openEmployeeModal(empId = null){
    if(!requireAdmin()) return;
    const emp = empId ? state.employees.find(e=>e.id === empId) : null;
    openModal(`
      <div class="modal-head">
        <div class="modal-title">${emp ? '직원 수정' : '직원 추가'}</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>

      <div class="form-row">
        <div class="field">
          <label>사번</label>
          <input id="modalEmpEmployeeNo" type="text" value="${emp ? (emp.employeeNo || '') : ''}" placeholder="예: L20089" />
        </div>
        <div class="field">
          <label>이름</label>
          <input id="modalEmpName" type="text" value="${emp ? emp.name : ''}" />
        </div>
        <div class="field">
          <label>기본 근무</label>
          <select id="modalEmpRole">
            <option value="주간" ${emp && emp.role === '주간' ? 'selected' : ''}>주간</option>
            <option value="야간" ${emp && emp.role === '야간' ? 'selected' : ''}>야간</option>
          </select>
        </div>
      </div>

      <div class="modal-actions">
        ${emp ? `<button class="btn danger" onclick="deleteEmployee(${emp.id}); closeModal();">삭제</button>` : ''}
        <button class="btn" onclick="closeModal()">취소</button>
        <button class="btn primary" onclick="${emp ? `saveEmployeeEdit(${emp.id})` : `saveEmployeeCreate()`}">저장</button>
      </div>
    `);
  }

  function saveEmployeeCreate(){
    if(!requireAdmin()) return;
    const employeeNo = readEmployeeNo('modalEmpEmployeeNo');
    const name = document.getElementById('modalEmpName').value.trim();
    const role = document.getElementById('modalEmpRole').value;
    if(!name){
      alert('이름을 입력해줘.');
      return;
    }
    const id = state.employees.length ? Math.max(...state.employees.map(e=>e.id)) + 1 : 1;
    state.employees.push({ id, employeeNo, name, role });
    ensureScheduleForMonth(state.year, state.month);
    refreshDefaultEntriesForMonth(state.year, state.month);
    saveState();
    closeModal();
    renderAll();
  }

  function saveEmployeeEdit(empId){
    if(!requireAdmin()) return;
    const employeeNo = readEmployeeNo('modalEmpEmployeeNo');
    const name = document.getElementById('modalEmpName').value.trim();
    const role = document.getElementById('modalEmpRole').value;
    if(!name){
      alert('이름을 입력해줘.');
      return;
    }
    const emp = state.employees.find(e=>e.id === empId);
    if(!emp) return;
    emp.employeeNo = employeeNo;
    emp.name = name;
    emp.role = role;
    refreshDefaultEntriesForMonth(state.year, state.month);
    saveState(`${emp.name} 역할 변경 → ${role}`);
    closeModal();
    renderAll();
  }

  function openAssignmentModal(empId, dateKey){
    if(!requireAdmin()) return;
    const emp = state.employees.find(e=>e.id === empId);
    const entry = getEntry(empId, dateKey);
    const customDaehuTag = entry.tags.find(tag => /^대휴\((.*)\)$/.test(tag)) || '';
    const customDaehuDate = customDaehuTag ? customDaehuTag.replace(/^대휴\((.*)\)$/, '$1') : '';

    const checks = TAGS.map(tag=>`
      <label class="tag-label">
        <input type="checkbox" value="${tag}" ${entry.tags.includes(tag) ? 'checked' : ''} />
        <span class="${normalizeTagClass(tag)}" style="padding:4px 8px;border-radius:999px;border:1px solid transparent">${tag}</span>
      </label>
    `).join('');

    openModal(`
      <div class="modal-head">
        <div class="modal-title">${emp.name} · ${dateKey}</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>

      <div class="form-row">
        <div class="field">
          <label>근무 유형</label>
          <select id="assignShift">
            <option value="조출" ${entry.shift === '조출' ? 'selected' : ''}>조출</option>
            <option value="주간" ${entry.shift === '주간' ? 'selected' : ''}>주간</option>
            <option value="야간" ${entry.shift === '야간' ? 'selected' : ''}>야간</option>
            <option value="휴무" ${entry.shift === '휴무' ? 'selected' : ''}>휴무</option>
          </select>
        </div>
      </div>

      <div>
        <div style="font-weight:800; margin-bottom:8px">태그</div>
        <div class="tag-box" id="assignTags">${checks}</div>
      </div>

      <div class="form-row" style="margin-top:12px">
        <div class="field" style="min-width:220px">
          <label>대휴 날짜 직접 입력</label>
          <input id="customDaehuDate" type="text" placeholder="예: 3/18 또는 18" value="${customDaehuDate}" />
        </div>
        <div class="muted" style="font-size:12px; align-self:center; padding-bottom:2px;">입력하면 태그가 대휴(입력값) 형식으로 저장돼</div>
      </div>

      <div class="modal-actions">
        <button class="btn danger" onclick="clearAssignment(${empId}, '${dateKey}')">기본값으로</button>
        <button class="btn" onclick="closeModal()">취소</button>
        <button class="btn primary" onclick="saveAssignment(${empId}, '${dateKey}')">저장</button>
      </div>
    `);
  }

  function openAssignBySlot(dateKey, shift){
    if(!requireAdmin()) return;
    const assignedIds = new Set(getEmployeesByShift(dateKey, shift).map(x=>x.employee.id));
    const available = state.employees.filter(emp => !assignedIds.has(emp.id));

    const options = available.map(emp=>`
      <option value="${emp.id}">${emp.name} (${emp.role})</option>
    `).join('');

    openModal(`
      <div class="modal-head">
        <div class="modal-title">${dateKey} · ${shift} 배정</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>

      <div class="form-row">
        <div class="field" style="min-width:260px">
          <label>직원 선택</label>
          <select id="slotAssignEmp">
            ${options || `<option value="">배정 가능한 직원 없음</option>`}
          </select>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">취소</button>
        <button class="btn primary" onclick="saveAssignBySlot('${dateKey}', '${shift}')">배정</button>
      </div>
    `);
  }

  function saveAssignBySlot(dateKey, shift){
    if(!requireAdmin()) return;
    const empId = Number(document.getElementById('slotAssignEmp').value);
    if(!empId){
      closeModal();
      return;
    }
    state.schedule[empId][dateKey].shift = shift;
    saveState();
    closeModal();
    renderAll();
  }

  function clearAssignment(empId, dateKey){
    if(!requireAdmin()) return;
    const emp = state.employees.find(e=>e.id === empId);
    state.schedule[empId][dateKey] = createDefaultEntry(emp, dateKey);
    saveState(`${emp.name} ${dateKey} 기본값으로 초기화`);
    closeModal();
    renderAll();
  }

  function saveAssignment(empId, dateKey){
    if(!requireAdmin()) return;
    const shift = document.getElementById('assignShift').value;
    const tags = [...document.querySelectorAll('#assignTags input[type="checkbox"]:checked')].map(el=>el.value);
    const customDaehuDate = (document.getElementById('customDaehuDate')?.value || '').trim();

    if(customDaehuDate){
      tags.push(`대휴(${customDaehuDate})`);
    }

    state.schedule[empId][dateKey] = { shift, tags };
    const emp2 = state.employees.find(e=>e.id===empId);
    saveState(`${emp2 ? emp2.name : empId} ${dateKey} → ${shift}`);
    closeModal();
    renderAll();
  }


  function toggleEarlyShiftRow(){
    if(!requireAdmin()) return;
    ensureEarlyShiftSetting();
    ensureVisibleRows();
    if(state.visibleRows.조출 && (state.slotConfig.조출 > 0)){
      state.visibleRows.조출 = false;
    }else{
      if((state.slotConfig.조출 || 0) === 0) state.slotConfig.조출 = 1;
      state.visibleRows.조출 = true;
    }
    saveState();
    renderAll();
  }

  function toggleNightShiftRow(){
    if(!requireAdmin()) return;
    ensureVisibleRows();
    state.visibleRows.야간 = !state.visibleRows.야간;
    saveState();
    renderAll();
  }

  function openSlotConfigModal(){
    if(!requireAdmin()) return;
    openModal(`
      <div class="modal-head">
        <div class="modal-title">근무 슬롯 설정</div>
        <button class="btn" onclick="closeModal()">닫기</button>
      </div>

      <div class="form-row">
        <div class="field">
          <label>조출 슬롯 수</label>
          <input id="slotEarly" type="number" min="0" value="${state.slotConfig.조출 || 0}" />
        </div>
        <div class="field">
          <label>주간 슬롯 수</label>
          <input id="slotDay" type="number" min="0" value="${state.slotConfig.주간}" />
        </div>
        <div class="field">
          <label>야간 슬롯 수</label>
          <input id="slotNight" type="number" min="0" value="${state.slotConfig.야간}" />
        </div>
      </div>
      <div class="muted" style="font-size:12px; margin-top:4px;">
        조출 슬롯 수가 1 이상이면 조출줄을 켤 수 있고, 야간줄도 상단 버튼으로 켜고 끌 수 있어.
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">취소</button>
        <button class="btn primary" onclick="saveSlotConfig()">저장</button>
      </div>
    `);
  }

  function saveSlotConfig(){
    if(!requireAdmin()) return;
    ensureEarlyShiftSetting();
    state.slotConfig.조출 = Number(document.getElementById('slotEarly').value || 0);
    state.slotConfig.주간 = Number(document.getElementById('slotDay').value || 0);
    state.slotConfig.야간 = Number(document.getElementById('slotNight').value || 0);
    saveState('근무 슬롯 설정 변경');
    closeModal();
    renderAll();
  }

  function addHoliday(){
    if(!requireAdmin()) return;
    const date = document.getElementById('holidayDate').value;
    const name = document.getElementById('holidayName').value.trim();
    if(!date || !name){
      alert('날짜와 이름을 모두 입력해줘.');
      return;
    }
    state.holidays[date] = { name };
    refreshDefaultEntriesForMonth(state.year, state.month);
    document.getElementById('holidayDate').value = '';
    document.getElementById('holidayName').value = '';
    saveState('공휴일 등록');
    renderAll();
  }

  function removeHoliday(date){
    if(!requireAdmin()) return;
    delete state.holidays[date];
    refreshDefaultEntriesForMonth(state.year, state.month);
    saveState('공휴일 삭제');
    renderAll();
  }

  function addSubHoliday(){
    if(!requireAdmin()) return;
    const date = document.getElementById('subDate').value;
    const name = document.getElementById('subName').value.trim();
    if(!date || !name){
      alert('날짜와 이름을 모두 입력해줘.');
      return;
    }
    state.subHolidays[date] = { name };
    document.getElementById('subDate').value = '';
    document.getElementById('subName').value = '';
    saveState('대체휴무일 등록');
    renderAll();
  }

  function removeSubHoliday(date){
    if(!requireAdmin()) return;
    delete state.subHolidays[date];
    saveState('대체휴무일 삭제');
    renderAll();
  }

  function resetCurrentMonth(){
    if(!requireAdmin()) return;
    if(!confirm(`${state.year}년 ${state.month}월을 기본값으로 다시 생성할까?`)) return;
    const prefix = getMonthKeyPrefix(state.year, state.month);
    for(const empId in state.schedule){
      for(const key in state.schedule[empId]){
        if(key.startsWith(prefix)) delete state.schedule[empId][key];
      }
    }
    ensureScheduleForMonth(state.year, state.month);
    saveState('현재 월 초기화');
    renderAll();
  }

  function copyDateConfig(dateKey){
    if(!requireAdmin()) return;
    state.copiedDateKey = dateKey;
    saveState();
    renderAll();
  }

  function pasteDateConfig(targetDateKey){
    if(!requireAdmin()) return;
    if(!state.copiedDateKey){
      alert('먼저 복사할 날짜를 선택해줘.');
      return;
    }
    if(state.copiedDateKey === targetDateKey) return;

    for(const emp of state.employees){
      const sourceEntry = getEntry(emp.id, state.copiedDateKey);
      state.schedule[emp.id][targetDateKey] = {
        shift: sourceEntry.shift,
        tags: [...sourceEntry.tags]
      };
    }

    saveState('날짜 복사 붙여넣기');
    renderAll();
  }

  function dragStart(e, empId, fromDate, fromShift){
    if(!requireAdmin()) return;
    dragData = { empId, fromDate, fromShift };
  }

  function allowDrop(e){
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function dragLeave(e){
    e.currentTarget.classList.remove('drag-over');
  }

  function handleDrop(e, toDate, toShift){
    if(!requireAdmin()) return;
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if(!dragData) return;

    const { empId, fromDate, fromShift } = dragData;
    dragData = null;

    if(fromDate === toDate && fromShift === toShift) return;

    if(fromDate === toDate){
      state.schedule[empId][toDate].shift = toShift;
    } else {
      state.schedule[empId][fromDate].shift = '휴무';
      state.schedule[empId][toDate].shift = toShift;
    }

    saveState('드래그로 배정 변경');
    renderAll();
  }

  function openModal(html){
    document.getElementById('modalBox').innerHTML = html;
    document.getElementById('modalBg').classList.add('open');
  }

  function closeModal(){
    restorePreviewSnapshotId = null;
    document.getElementById('modalBg').classList.remove('open');
  }

  document.getElementById('modalBg').addEventListener('click', (e)=>{
    if(e.target.id === 'modalBg') closeModal();
  });

  // ── 변경이력 로드 ─────────────────────────────────────────
  let changelogCache = [];
  async function loadChangelog(forceFresh = false){
    const el = document.getElementById('changelogList');
    const badge = document.getElementById('changelogSyncStatus');
    if(!el) return;
    if(!getAdminToken()) return;
    if(badge){ badge.textContent='불러오는 중…'; badge.className='sync-badge loading'; badge.style.display='inline-flex'; }
    try{
      const url = buildApiUrl('/api/changelog', forceFresh ? { fresh: '1' } : {});
      const res = await fetch(url, {
        headers: getAuthHeaders()
      });
      if(res.status === 403){
        clearAdminSession();
        renderAll();
        return;
      }
      const logs = await res.json();
      changelogCache = logs;
      knownLatestChangeId = logs[0]?.id ?? knownLatestChangeId;
      renderNoticePanel();
      if(badge){ badge.style.display='none'; }
      const reportButton = state.isAdmin ? `
        <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
          <button class="btn small" type="button" onclick="openReportModal()">보고문 만들기</button>
        </div>
      ` : '';
      if(!logs.length){
        el.innerHTML = reportButton + `
          <div class="muted" style="font-size:13px;padding:8px 0;">아직 변경이력이 없어.</div>
        `;
        return;
      }
      el.innerHTML = reportButton + logs.map(log => `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:3px;">
              <div style="font-size:13px;font-weight:800;">${escHtml(log.note)}</div>
              ${isAdmin() ? `<button class="btn small" type="button" onclick="deleteChangelog(${Number(log.id)})">삭제</button>` : ''}
            </div>
            <div style="font-size:12px;color:var(--muted);">${escHtml(normalizeDisplayTimestamp(log.timestamp))} · ${log.year}년 ${log.month}월</div>
          </div>
        </div>
      `).join('');
    }catch(e){
      if(badge){ badge.textContent='오류'; badge.className='sync-badge error'; badge.style.display='inline-flex'; }
      el.innerHTML = '<div class="muted" style="font-size:13px;padding:8px 0;">불러오기 실패. 잠시 후 다시 시도해줘.</div>';
    }
  }

  function escHtml(str){ return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function refreshFromServer(){
    if(!getAdminToken()){
      renderAuthGate(true);
      return;
    }
    await loadState(true);
    state.activeTab = 'calendar';
    ensureHighlightColors();
    ensureEarlyShiftSetting();
    ensureVisibleRows();
    applyHighlightColors();
    ensureScheduleForMonth(state.year, state.month);
    await loadChangelog(true);
    renderAll();
  }

  // ── 초기화 ──────────────────────────────────────────────────
  (async () => {
    await loadAuthOptions();
    await restoreAdminSession();
    if(getAdminToken()){
      await loadState();
      await loadChangelog();
    }
    ensureHighlightColors();
    ensureEarlyShiftSetting();
    ensureVisibleRows();
    applyHighlightColors();
    ensureScheduleForMonth(state.year, state.month);
    markSaved(); // 초기 로드 시 미저장 없음
    renderAll();
  })();

/* 메모장 드래그 기능 */
(function(){
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const panel = document.getElementById('memoPanel');
  const header = document.getElementById('memoHeader');

  if(!panel || !header) return;

  header.addEventListener('mousedown', function(e){
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.right = 'auto';
  });

  document.addEventListener('mousemove', function(e){
    if(!isDragging) return;
    panel.style.left = (e.clientX - offsetX) + 'px';
    panel.style.top = (e.clientY - offsetY) + 'px';
  });

  document.addEventListener('mouseup', function(){
    isDragging = false;
  });
})();
