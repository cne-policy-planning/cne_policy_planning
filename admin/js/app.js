/*
 * 관리자 도구 · 화면
 */
(function () {
  'use strict';
  const SAS = window.SAS, X = window.SASExtract, S = window.SASStore;
  const $ = id => document.getElementById(id);

  // ---------- 작은 도구 ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  let toastTimer;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }
  function modal(content, buttons) {
    return new Promise(resolve => {
      const body = $('modalBody'); body.replaceChildren();
      body.append(typeof content === 'string' ? h('div', { html: content }) : content);
      const row = h('div', { class: 'actions' });
      (buttons || [{ label: '확인', value: true, primary: true }]).forEach(b => row.append(h('button', { class: b.primary ? 'primary' : b.danger ? 'danger' : '', onclick: () => { $('modal').classList.add('hidden'); resolve(b.value); } }, b.label)));
      body.append(row); $('modal').classList.remove('hidden');
    });
  }
  const confirmBox = (html, okLabel, danger) => modal(html, [{ label: '취소', value: false }, { label: okLabel || '확인', value: true, primary: !danger, danger }]);
  const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
  const pad3 = n => String(n).padStart(3, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = h('input', { type: 'file', accept, hidden: true });
      inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
      document.body.append(inp); inp.click();
    });
  }
  function levelChecks(container, selected, onChange) {
    container.replaceChildren(...SAS.LEVELS.map(l => {
      const cb = h('input', { type: 'checkbox', value: l.name, checked: (selected || []).includes(l.name), onchange: () => onChange && onChange([...container.querySelectorAll('input:checked')].map(i => i.value)) });
      return h('label', {}, cb, l.name);
    }));
  }
  const checkedLevels = container => [...container.querySelectorAll('input:checked')].map(i => i.value);

  // ---------- 탭 ----------
  let currentTab = 'register';
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    ['register', 'manage', 'save'].forEach(n => $('tab-' + n).classList.toggle('hidden', n !== name));
    if (name === 'manage') renderList();
    if (name === 'save') renderSaveStatus();
  }
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ---------- 상단 상태 ----------
  const GH = window.SASGitHub;
  function renderHeader() {
    const st = S.STATUS[S.state.status] || S.STATUS.empty;
    const pill = $('statusPill'); pill.textContent = st.label; pill.className = 'pill ' + st.tone;
    $('folderName').textContent = S.state.sourceLabel || '자료를 아직 불러오지 않음';
    $('docCount').textContent = S.state.docs.length;
    $('startCard').classList.toggle('hidden', !!S.state.source || S.state.docs.length > 0);
    renderTokenState();
  }
  S.onChange(() => { renderHeader(); if (currentTab === 'manage') renderList(); if (currentTab === 'save') renderSaveStatus(); });
  window.addEventListener('beforeunload', e => { if (S.state.status === 'unsaved') { e.preventDefault(); e.returnValue = ''; } });

  // ---------- 출입증 만료 표시·알림 ----------
  const LEVEL_TEXT = {
    month: d => `GitHub 출입증이 ${d.days}일 뒤(${d.date}) 만료됩니다. 미리 새 출입증을 발급해 두세요.`,
    week: d => `GitHub 출입증이 ${d.days}일 뒤(${d.date}) 만료됩니다. 만료되면 사이트에 반영할 수 없습니다.`,
    day: d => d.days === 0 ? `GitHub 출입증이 오늘(${d.date}) 만료됩니다. 지금 새 출입증으로 바꿔 주세요.` : `GitHub 출입증이 내일(${d.date}) 만료됩니다. 지금 새 출입증으로 바꿔 주세요.`,
    expired: d => `GitHub 출입증이 ${d.date}에 만료되었습니다. 새 출입증을 발급해 연결해 주세요.`
  };
  function renderTokenState() {
    const g = S.state.github;
    const btn = $('btnToken'), banner = $('tokenBanner');
    if (!g || !g.token) {
      btn.textContent = '🔑 GitHub 연결'; btn.className = 'small';
      banner.classList.add('hidden'); return;
    }
    const info = GH.expiryInfo(g.expiresAt);
    btn.textContent = info.days == null ? '🔑 연결됨' : info.days < 0 ? '🔑 출입증 만료' : `🔑 출입증 D-${info.days}`;
    btn.className = 'small' + (info.level === 'ok' || info.level === 'unknown' ? '' : ' danger');
    if (LEVEL_TEXT[info.level]) {
      banner.className = 'banner ' + info.level;
      banner.replaceChildren(h('span', {}, '🔑 ' + LEVEL_TEXT[info.level](info)), h('button', { class: 'small', onclick: () => openTokenDialog() }, '출입증 바꾸기'));
    } else banner.classList.add('hidden');
  }
  /** 만료 30일·7일·1일 전, 만료 후에 단계마다 한 번씩 알림창을 띄운다 */
  async function maybeAlertExpiry() {
    const g = S.state.github; if (!g || !g.expiresAt) return;
    const info = GH.expiryInfo(g.expiresAt);
    if (!LEVEL_TEXT[info.level]) return;
    const key = 'expiryAlert:' + g.expiresAt;
    const shown = (await S.kvGet(key)) || 'ok';
    if (GH.LEVEL_RANK[info.level] <= GH.LEVEL_RANK[shown]) return;
    await S.kvSet(key, info.level);
    const go = await modal(h('div', {}, h('h2', {}, info.level === 'expired' ? '⛔ 출입증 만료' : '⏰ 출입증 만료 알림'), h('p', {}, LEVEL_TEXT[info.level](info)),
      h('p', { class: 'small muted' }, 'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens에서 새로 발급한 뒤, 「출입증 바꾸기」에 붙여 넣으세요. 발급 방법은 사용설명서에 있습니다.')),
      [{ label: '나중에', value: false }, { label: '출입증 바꾸기', value: true, primary: true }]);
    if (go) openTokenDialog();
  }

  // ---------- 변경 감시 ----------
  const fmtTime = d => d ? new Date(d).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const STATUS_KO = { added: '추가', modified: '수정', removed: '삭제', renamed: '이름 바뀜' };
  const commitsUrl = () => `https://github.com/${S.state.github.owner}/${S.state.github.repo}/commits/${S.state.github.branch || 'main'}`;
  let lastActivity = null;

  function activityItem(it) {
    return h('div', { class: 'act-item' },
      h('div', {}, h('b', {}, fmtTime(it.date)), ' · ', it.author, ' ',
        it.fromTool ? h('span', { class: 'tag warn' }, '관리자 도구(다른 PC 또는 출처 불명)') : h('span', { class: 'tag err' }, 'GitHub 웹 화면 등 다른 곳'),
        it.program ? h('span', { class: 'tag err' }, '프로그램 파일 변경') : null),
      h('div', { class: 'small' }, it.title),
      it.files && it.files.length ? h('ul', { class: 'small muted' }, it.files.map(f => h('li', {}, `${STATUS_KO[f.status] || f.status}: ${f.path}`)), it.moreFiles ? h('li', {}, `외 ${it.moreFiles}개 파일`) : null) : null,
      h('a', { class: 'small', href: `https://github.com/${S.state.github.owner}/${S.state.github.repo}/commit/${it.sha}`, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub에서 자세히 보기 ↗'));
  }

  function renderActivityButton() {
    const b = $('btnActivity');
    const n = lastActivity && lastActivity.items ? lastActivity.items.length : 0;
    b.classList.toggle('hidden', !n);
    b.textContent = `⚠️ 확인 필요한 변경 ${n}건`;
  }

  async function showActivityDialog() {
    const a = lastActivity; if (!a || !a.items.length) return;
    const ok = await modal(h('div', {},
      h('h2', {}, '⚠️ 관리자 도구가 하지 않은 변경이 있습니다'),
      h('p', {}, `마지막으로 확인한 뒤 이 PC의 관리자 도구가 아닌 곳에서 ${a.items.length}건${a.overflow ? ' 이상' : ''}의 변경이 있었습니다.`),
      h('div', { class: 'act-list' }, a.items.map(activityItem)),
      a.overflow ? h('p', { class: 'small muted' }, '변경이 많아 최근 30건까지만 확인했습니다. 나머지는 GitHub 변경 기록에서 보세요.') : null,
      h('div', { class: 'notice' },
        h('b', {}, '선생님이 직접 한 변경이라면 '), '(프로그램 업데이트를 웹 화면으로 올렸거나, 다른 PC에서 반영한 경우) 「내가 한 변경이 맞음」을 누르세요.', h('br'),
        h('b', {}, '모르는 변경이라면 '), '출입증이 새어 나갔을 수 있습니다. ① GitHub Settings → Developer settings → Fine-grained tokens에서 출입증을 Delete하고 ② 새 출입증을 발급해 연결한 뒤 ③ 변경 기록에서 바뀐 내용을 되돌리세요.'),
      h('p', {}, h('a', { href: commitsUrl(), target: '_blank', rel: 'noopener noreferrer' }, '전체 변경 기록 열기 ↗'))),
      [{ label: '나중에 확인', value: false }, { label: '내가 한 변경이 맞음', value: true, primary: true }]);
    if (ok) {
      await S.acknowledgeActivity(a.headSha);
      lastActivity = { items: [] }; renderActivityButton();
      toast('확인했습니다. 이후의 변경부터 다시 감시합니다.');
    }
  }

  async function runActivityCheck() {
    try {
      lastActivity = await S.checkActivity();
      renderActivityButton();
      if (lastActivity.first) toast('변경 감시를 시작했습니다. 다음부터 관리자 도구가 하지 않은 변경을 알려 드립니다.', 5000);
      if (lastActivity.items.length) await showActivityDialog();
    } catch (e) { console.warn('변경 감시 실패', e); }
  }
  $('btnActivity').onclick = () => showActivityDialog();

  $('btnHistory').onclick = async () => {
    if (!S.state.github || !S.state.github.token) { toast('GitHub를 먼저 연결해 주세요.'); return; }
    try {
      const list = await S.recentActivity(20);
      const label = { mine: ['이 PC의 관리자 도구', 'ok'], tool: ['관리자 도구(다른 PC 또는 출처 불명)', 'warn'], other: ['GitHub 웹 화면 등', 'gray'] };
      await modal(h('div', {}, h('h2', {}, '최근 변경 기록'),
        h('div', { class: 'act-list' }, list.map(c => h('div', { class: 'act-item' },
          h('div', {}, h('b', {}, fmtTime(c.date)), ' · ', c.author, ' ', h('span', { class: 'tag ' + label[c.who][1] }, label[c.who][0])),
          h('div', { class: 'small' }, c.title)))),
        h('p', {}, h('a', { href: commitsUrl(), target: '_blank', rel: 'noopener noreferrer' }, 'GitHub에서 전체 기록 보기 ↗'))));
    } catch (e) { toast(e.message, 5000); }
  };

  // ---------- GitHub 연결 ----------
  const PERIODS = [['custom', 'GitHub에서 정한 만료일 입력'], ['30', '30일'], ['60', '60일'], ['90', '90일'], ['none', '만료 없음']];
  function tokenForm(opts) {
    opts = opts || {};
    const g = S.state.github || {};
    const detected = GH.detectRepo();
    const repoInput = h('input', { type: 'text', value: g.owner ? `${g.owner}/${g.repo}` : detected ? `${detected.owner}/${detected.repo}` : '', placeholder: '아이디/저장소이름 (예: myid/cne_policy_planning)' });
    const tokenInput = h('input', { type: 'password', placeholder: 'github_pat_… 로 시작하는 출입증 붙여 넣기', autocomplete: 'off', spellcheck: false });
    const periodSel = h('select', {}, ...PERIODS.map(([v, l]) => h('option', { value: v, selected: v === 'custom' }, l)));
    const dateInput = h('input', { type: 'date', value: GH.ymd(GH.addDays(new Date(), 365)) });
    periodSel.onchange = () => dateInput.classList.toggle('hidden', periodSel.value !== 'custom');
    const remember = h('input', { type: 'checkbox', checked: g.remember !== false });
    const msg = h('div');
    const go = h('button', { class: 'primary' }, opts.label || 'GitHub 연결');
    go.onclick = async () => {
      const repo = GH.parseRepo(repoInput.value);
      if (!repo) { msg.className = 'notice err'; msg.textContent = '저장소를 "아이디/저장소이름" 형태로 입력해 주세요.'; return; }
      const token = tokenInput.value.trim();
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) { msg.className = 'notice err'; msg.textContent = '출입증 형식이 아닙니다. GitHub에서 복사한 github_pat_로 시작하는 문자열 전체를 붙여 넣어 주세요.'; return; }
      if (token.startsWith('ghp_')) { msg.className = 'notice warn'; msg.textContent = '예전 방식(classic) 출입증입니다. 연결은 되지만, 이 저장소에만 권한을 주는 Fine-grained 출입증을 권장합니다.'; }
      const pv = periodSel.value;
      const expiresAt = pv === 'none' ? null : pv === 'custom' ? dateInput.value : GH.ymd(GH.addDays(new Date(), Number(pv)));
      if (pv === 'custom' && !expiresAt) { msg.className = 'notice err'; msg.textContent = '만료일을 입력해 주세요.'; return; }
      go.disabled = true; msg.className = 'notice'; msg.textContent = 'GitHub에 연결하는 중…';
      const cfg = { owner: repo.owner, repo: repo.repo, branch: '', token, expiresAt, remember: remember.checked };
      try {
        await S.connectGithub(cfg);
        msg.className = 'notice ok'; msg.textContent = '연결되었습니다.';
        if (opts.onDone) await opts.onDone();
      } catch (e) { msg.className = 'notice err'; msg.textContent = e.message; }
      finally { go.disabled = false; }
    };
    return h('div', { class: 'token-box' },
      field('저장소', repoInput, detected ? '사이트 주소에서 자동으로 채웠습니다.' : '사이트 주소(https://아이디.github.io/저장소/admin/)로 열면 자동으로 채워집니다.'),
      field('출입증 (Fine-grained personal access token)', tokenInput, '이 PC의 브라우저에만 보관되고, 사이트 파일에는 들어가지 않습니다.'),
      field('출입증 만료일', h('div', { class: 'row' }, periodSel, dateInput), 'GitHub에서 출입증을 만들 때 정한 만료일을 그대로 넣으세요. 이 날짜를 기준으로 30일·7일·1일 전에 알려 드립니다.'),
      h('label', { class: 'inline' }, remember, '이 PC에 출입증 기억하기 (공용 PC라면 끄세요)'),
      h('div', { class: 'actions', style: 'margin-top:0' }, go), msg);
  }

  function renderConnectBox() {
    const box = $('connectBox'); if (!box) return;
    const g = S.state.github;
    if (g && g.token) {
      box.replaceChildren(h('p', { class: 'muted' }, `${g.owner}/${g.repo}에 연결되어 있습니다.`),
        h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => loadGithub() }, 'GitHub에서 자료 불러오기')));
    } else {
      box.replaceChildren(
        h('p', { class: 'muted' }, 'GitHub 출입증을 연결하면 저장소의 자료를 불러오고, 작업한 내용을 「사이트에 반영」 버튼 한 번으로 올립니다.'),
        tokenForm({ onDone: () => loadGithub() }));
    }
  }

  async function loadGithub() {
    if (S.state.status === 'unsaved' && S.state.source && !(await confirmBox('반영하지 않은 변경이 있습니다. 다시 불러오면 변경 내용이 사라집니다. 계속할까요?', '계속', true))) return;
    const pending = !S.state.source ? S.state.docs.slice() : [];
    try {
      const r = await withProgress('GitHub에서 자료를 불러오는 중…', p => S.loadFromGithub(p));
      let msg = r.count ? `자료 ${r.count}건을 불러왔습니다.` : '저장소에 아직 자료가 없습니다. 자료를 등록해 반영해 보세요.';
      if (pending.length && await confirmBox(`불러오기 전에 작업한 자료 ${pending.length}건이 있습니다. 불러온 자료에 합칠까요?`, '합치기')) {
        const have = new Set(S.allIds());
        const add = pending.filter(d => !have.has(d.id));
        S.addDocs(add); msg += ` 작업 자료 ${add.length}건을 합쳤습니다.`;
      }
      toast(msg, 5000);
      if (S.state.docs.length) showTab('manage');
      await runActivityCheck();
      await offerDraft();
      await maybeAlertExpiry();
    } catch (e) {
      if (e.kind === 'auth') { toast(e.message, 7000); renderConnectBox(); openTokenDialog(); return; }
      await modal(h('div', {}, h('h2', {}, '자료를 불러오지 못했습니다'), h('p', {}, e.message)));
      // 불러오지 못했어도 무엇이 바뀌었는지는 확인할 수 있게 한다
      await runActivityCheck();
    }
  }

  function openTokenDialog() {
    const g = S.state.github;
    const body = h('div', {}, h('h2', {}, '🔑 GitHub 연결'));
    if (g && g.owner) {
      const info = GH.expiryInfo(g.expiresAt);
      body.append(h('table', { class: 'kv-table' }, h('tbody', {},
        h('tr', {}, h('td', {}, '저장소'), h('td', {}, `${g.owner}/${g.repo}`)),
        h('tr', {}, h('td', {}, '출입증'), h('td', {}, g.token ? '연결됨 (' + (g.remember ? '이 PC에 기억' : '창을 닫으면 지워짐') + ')' : '없음 — 다시 입력해 주세요')),
        h('tr', {}, h('td', {}, '만료일'), h('td', {}, info.date ? `${info.date} (${info.days < 0 ? '만료됨' : '남은 기간 ' + info.days + '일'})` : '만료 없음')),
        h('tr', {}, h('td', {}, '연결한 날'), h('td', {}, g.connectedAt ? new Date(g.connectedAt).toLocaleDateString('ko-KR') : '-')))));
      // 만료일만 고치기: 출입증을 다시 붙여 넣지 않아도 된다
      const expInput = h('input', { type: 'date', value: g.expiresAt || '', style: 'max-width:200px' });
      body.append(h('h3', {}, '만료일 고치기'),
        h('p', { class: 'small muted' }, 'GitHub의 Fine-grained tokens 목록에서 출입증 이름 옆에 표시된 만료일(Expires on …)과 같게 맞추세요. 출입증은 다시 넣지 않아도 됩니다.'),
        h('div', { class: 'row', style: 'justify-content:flex-start' }, expInput,
          h('button', { style: 'flex:0', onclick: async () => {
            if (!expInput.value) { toast('날짜를 선택해 주세요.'); return; }
            await S.setExpiry(expInput.value); await S.kvSet('expiryAlert:' + expInput.value, 'ok');
            toast('만료일을 ' + expInput.value + '로 고쳤습니다. 캘린더 알림도 다시 추가해 주세요.', 5000); openTokenDialog();
          } }, '만료일 저장'),
          h('button', { class: 'ghost', style: 'flex:0', onclick: async () => { await S.setExpiry(null); toast('만료 없음으로 바꿨습니다.'); openTokenDialog(); } }, '만료 없음')));
      if (g.expiresAt) body.append(h('div', { class: 'actions' },
        h('button', { onclick: () => { S.download(new Blob([GH.calendarFile(g.expiresAt, `${g.owner}/${g.repo}`)], { type: 'text/calendar;charset=utf-8' }), `GitHub출입증_만료알림_${g.expiresAt}.ics`); toast('캘린더 파일을 받았습니다. 열어서 휴대폰·PC 캘린더에 추가하세요.', 6000); } }, '📅 캘린더에 알림 추가 (30일·7일·1일 전)'),
        g.token ? h('button', { class: 'danger', onclick: async () => { if (await confirmBox('이 PC에서 출입증을 지울까요? 다시 반영하려면 출입증을 새로 입력해야 합니다.', '지우기', true)) { await S.forgetToken(); $('modal').classList.add('hidden'); renderConnectBox(); toast('출입증을 지웠습니다.'); } } }, '이 PC에서 출입증 지우기') : null));
      body.append(h('h3', {}, g.token ? '새 출입증으로 바꾸기' : '출입증 입력'));
    }
    body.append(tokenForm({ label: g && g.owner ? '바꾸고 연결 확인' : 'GitHub 연결', onDone: async () => {
      $('modal').classList.add('hidden'); renderConnectBox(); renderTokenState();
      if (!S.state.source) await loadGithub(); else toast('출입증을 바꿨습니다.');
      await S.kvSet('expiryAlert:' + S.state.github.expiresAt, 'ok');
    } }));
    body.append(h('div', { class: 'actions' }, h('button', { onclick: () => $('modal').classList.add('hidden') }, '닫기')));
    $('modalBody').replaceChildren(body); $('modal').classList.remove('hidden');
  }
  $('btnToken').onclick = () => openTokenDialog();

  // ---------- 시작 ----------
  async function withProgress(title, fn) {
    const bar = h('div'), wrap = h('div', {}, h('b', {}, title), h('div', { class: 'progress' }, bar), h('p', { class: 'muted small', text: '창을 닫지 마세요.' }));
    $('modalBody').replaceChildren(wrap); $('modal').classList.remove('hidden');
    try { return await fn((a, b) => { bar.style.width = Math.round(a / Math.max(1, b) * 100) + '%'; }); }
    finally { $('modal').classList.add('hidden'); }
  }
  /** 예비: 저장소 폴더 열기 */
  async function openFolderFlow(reopen) {
    if (S.state.source && S.state.status === 'unsaved' && !(await confirmBox('반영하지 않은 변경이 있습니다. 다른 곳에서 불러오면 변경 내용이 사라집니다. 계속할까요?', '계속', true))) return;
    const pending = !S.state.source ? S.state.docs.slice() : [];
    try {
      const r = await withProgress('저장소 폴더를 읽는 중…', p => reopen ? S.reopenLastFolder(p) : S.pickFolder(p));
      let msg = r.isRepo ? `자료 ${r.count}건을 불러왔습니다.` : '빈 폴더입니다. 저장하면 data 폴더가 만들어집니다.';
      if (pending.length && await confirmBox(`폴더를 열기 전에 작업한 자료 ${pending.length}건이 있습니다. 이 폴더의 자료에 합칠까요?`, '합치기')) {
        const have = new Set(S.allIds());
        S.addDocs(pending.filter(d => !have.has(d.id)));
        msg += ` 작업 자료 ${pending.filter(d => !have.has(d.id)).length}건을 합쳤습니다.`;
      }
      toast(msg, 5000);
      if (S.state.docs.length) showTab('manage');
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, 5000); }
  }
  $('btnOpenFolder').onclick = () => openFolderFlow(false);
  $('btnReopen').onclick = () => openFolderFlow(true);
  $('zipInput').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = await S.loadZip(f); toast(`자료 ${n}건을 불러왔습니다.`); showTab('manage'); } catch (err) { toast('불러오기 실패: ' + err.message, 5000); }
    e.target.value = '';
  };
  $('v1Input').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const docs = SAS.migrateV1(json, S.allIds());
      S.addDocs(docs);
      toast(`v1 자료 ${docs.length}건을 변환했습니다. 학교급과 웍스 링크를 확인해 주세요.`, 5000);
      showTab('manage'); selectDoc(docs[0] && docs[0].id);
    } catch (err) { toast('v1 JSON 변환 실패: ' + err.message, 5000); }
    e.target.value = '';
  };

  /** 반영하지 않고 닫은 작업이 있으면 이어서 할지 묻는다 */
  async function offerDraft() {
    const draft = await S.getDraft();
    if (!draft || !draft.docs || !draft.docs.length) return;
    const box = $('draftBox');
    const sameBase = !draft.base || draft.base === S.dataDigest();
    const restore = async () => {
      if (!sameBase && !(await confirmBox('이 작업을 저장한 뒤 GitHub의 자료가 다른 곳에서 바뀌었습니다. 이어서 반영하면 그 변경이 덮어써질 수 있습니다. 그래도 이어서 할까요?', '이어서 하기', true))) return;
      await S.restoreDraft(draft); box.classList.add('hidden'); $('modal').classList.add('hidden');
      toast('반영하지 않았던 작업을 이어서 합니다. 끝나면 「사이트에 반영」을 눌러 주세요.', 6000); showTab('manage');
    };
    const discard = async () => { await S.discardDraft(); box.classList.add('hidden'); $('modal').classList.add('hidden'); };
    let done;
    const finished = new Promise(r => { done = r; });
    const wrap = fn => async () => { await fn(); if ($('modal').classList.contains('hidden')) done(); };
    const content = h('div', {}, h('h2', {}, '반영하지 않은 작업이 있습니다'),
      h('p', {}, `${new Date(draft.saved_at).toLocaleString('ko-KR')}에 저장된 작업 · 자료 ${draft.docs.length}건${draft.source ? ' · ' + draft.source : ''}`),
      sameBase ? null : h('p', { class: 'notice warn' }, '그 뒤 GitHub의 자료가 바뀌었습니다. 이어서 하면 다른 곳의 변경을 덮어쓸 수 있습니다.'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: wrap(restore) }, '이어서 하기'), h('button', { onclick: wrap(discard) }, '버리기')));
    $('modalBody').replaceChildren(content); $('modal').classList.remove('hidden');
    return finished;
  }

  async function initStart() {
    if (!S.fsSupported()) { $('fsNotice').classList.remove('hidden'); $('btnOpenFolder').disabled = true; }
    const last = await S.lastFolderName();
    if (last && S.fsSupported()) { $('btnReopen').textContent = `지난 폴더 다시 열기 (${last})`; $('btnReopen').classList.remove('hidden'); }
    const cfg = await S.loadGithubConfig();
    if (cfg) { S.state.github = cfg; }
    renderConnectBox(); renderTokenState();
    if (cfg && cfg.token) await loadGithub();
    else {
      const draft = await S.getDraft();
      if (draft && draft.docs && draft.docs.length) {
        const box = $('draftBox'); box.classList.remove('hidden');
        box.replaceChildren(h('b', {}, '반영하지 않은 작업이 있습니다. '), `${new Date(draft.saved_at).toLocaleString('ko-KR')} · 자료 ${draft.docs.length}건. GitHub에 연결하면 이어서 할지 묻습니다.`);
      }
      if (cfg && cfg.expiresAt) maybeAlertExpiry();
    }
  }

  // 업무 분류 드롭다운: 고정 목록(SAS.CATEGORIES). 목록에 없는 기존 값은 지우지 않고 따로 보여 준다.
  function categoryOptions(current) {
    const opts = [h('option', { value: '', selected: !current }, '분류 선택')];
    if (current && !SAS.CATEGORIES.includes(current)) opts.push(h('option', { value: current, selected: true }, `${current} (목록에 없음)`));
    SAS.CATEGORIES.forEach(c => opts.push(h('option', { value: c, selected: c === current }, c)));
    return opts;
  }

  // ---------- ① 자료 등록 ----------
  levelChecks($('regLevels'), []);
  $('regOriginSite').replaceChildren(h('option', { value: '' }, '원 출처 선택(선택)'), ...SAS.ORIGIN_SITES.map(s => h('option', { value: s }, s)), h('option', { value: '기타' }, '기타'));
  $('regCategory').replaceChildren(...categoryOptions(''));
  $('regYear').value = new Date().getFullYear();

  let queue = [];
  let qSeq = 0;
  const drop = $('drop');
  drop.onclick = () => $('fileInput').click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); enqueue(e.dataTransfer.files); };
  $('fileInput').onchange = e => { enqueue(e.target.files); e.target.value = ''; };

  function enqueue(files) {
    for (const f of files) {
      if (queue.some(q => q.file.name === f.name && q.file.size === f.size)) continue;
      queue.push({ key: ++qSeq, file: f, title: SAS.titleFromFilename(f.name), works: '', status: 'pending', message: '', doc: null });
    }
    renderQueue();
  }

  function renderQueue() {
    $('queueWrap').classList.toggle('hidden', !queue.length);
    const tbody = $('queueTable').querySelector('tbody');
    tbody.replaceChildren(...queue.map(q => {
      const fmt = SAS.formatOf(q.file.name), kind = SAS.kindOf(fmt);
      const statusCell = h('td');
      if (q.status === 'pending') statusCell.append(h('span', { class: 'tag gray' }, kind === 'text' ? '분석 대기' : '링크형'));
      else if (q.status === 'working') statusCell.append(h('span', { class: 'tag' }, '분석 중 ' + (q.progress || '')));
      else if (q.status === 'error') statusCell.append(h('span', { class: 'tag err' }, '실패'), h('div', { class: 'small' }, q.message));
      else statusCell.append(...summaryOf(q.doc), q.message ? h('div', { class: 'small muted' }, q.message) : '');
      return h('tr', {},
        h('td', {}, h('div', { class: 'fname' }, q.file.name), h('div', { class: 'small muted' }, fmt.toUpperCase() + ' · ' + fmtBytes(q.file.size))),
        h('td', {}, h('input', { type: 'text', value: q.title, oninput: e => { q.title = e.target.value; if (q.doc) q.doc.title = q.title; } })),
        h('td', {}, h('input', { type: 'url', value: q.works, placeholder: 'https://works…', oninput: e => { q.works = e.target.value.trim(); if (q.doc) q.doc.works_url = q.works; } })),
        statusCell,
        h('td', {}, h('button', { class: 'small ghost', title: '목록에서 빼기', onclick: () => { queue = queue.filter(x => x !== q); renderQueue(); } }, '✕')));
    }));
    const ready = queue.filter(q => q.status === 'done').length;
    $('btnAddDocs').disabled = !ready;
    $('btnAddDocs').textContent = ready ? `목록에 추가 (${ready}건)` : '목록에 추가';
  }

  function summaryOf(doc) {
    if (!doc) return [];
    if (doc.kind === 'link') return [h('span', { class: 'tag gray' }, '링크형 자료'), h('div', { class: 'small muted' }, '자료명·검색어로 검색됩니다')];
    const forms = SAS.formList(doc).length;
    const out = [
      h('span', { class: 'tag ok' }, `${doc.blocks.length}${doc.format === 'pdf' ? '쪽' : '문단'}`),
      h('span', { class: doc.extraction.toc_found ? 'tag ok' : 'tag warn' }, `업무 ${doc.sections.length}개${doc.extraction.toc_found ? ' · 목차 인식' : ''}`)
    ];
    if (forms) out.push(h('span', { class: 'tag' }, `서식 ${forms}개`));
    if (doc.extraction.warnings.length) out.push(h('details', {}, h('summary', {}, `확인 ${doc.extraction.warnings.length}건`), h('ul', { class: 'small' }, doc.extraction.warnings.map(w => h('li', {}, w)))));
    return out;
  }

  function commonMeta() {
    const site = $('regOriginSite').value;
    return {
      school_levels: checkedLevels($('regLevels')),
      category: $('regCategory').value.trim(),
      year: $('regYear').value,
      origin: { site, url: $('regOriginUrl').value.trim(), note: '' }
    };
  }

  $('btnAnalyze').onclick = async () => {
    const meta = commonMeta();
    $('btnAnalyze').disabled = true;
    const ids = S.allIds();
    for (const q of queue.filter(q => q.status === 'pending' || q.status === 'error')) {
      q.status = 'working'; q.progress = ''; renderQueue();
      try {
        const r = await X.extractFile(q.file, (a, b) => { q.progress = `${a}/${b}`; renderQueue(); });
        q.doc = SAS.createDocument(Object.assign({}, meta, { title: q.title, filename: q.file.name, format: r.format, works_url: q.works }), r.blocks, ids.concat(queue.map(x => x.doc && x.doc.id).filter(Boolean)));
        const same = S.state.docs.find(d => SAS.norm(d.title) === SAS.norm(q.doc.title) && (d.year || '') === (q.doc.year || ''));
        q.message = same ? '같은 이름의 자료가 이미 있습니다. 새 판이면 「자료 관리 → 파일 교체」를 이용하세요.' : '';
        q.status = 'done';
      } catch (e) { q.status = 'error'; q.message = e.message; console.error(e); }
      renderQueue();
    }
    $('btnAnalyze').disabled = false;
    const n = queue.filter(q => q.status === 'done').length;
    $('queueMsg').textContent = n ? '결과를 확인한 뒤 "목록에 추가"를 누르세요.' : '';
  };

  $('btnAddDocs').onclick = async () => {
    const meta = commonMeta();
    const ready = queue.filter(q => q.status === 'done');
    const noLevel = ready.filter(q => !(q.doc.school_levels.length || meta.school_levels.length));
    if (noLevel.length) { toast('학교급을 하나 이상 선택해 주세요.', 4000); $('regLevels').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ready.forEach(q => {
      // 분석 뒤에 공통 정보를 바꾼 경우에도 반영
      if (!q.doc.school_levels.length) q.doc.school_levels = meta.school_levels.slice();
      if (!q.doc.category) q.doc.category = meta.category;
      if (!q.doc.year && meta.year) q.doc.year = Number(meta.year);
      if (!q.doc.origin.site) q.doc.origin = meta.origin;
      q.doc.title = q.title.trim() || q.doc.title; q.doc.works_url = q.works;
    });
    S.addDocs(ready.map(q => q.doc));
    queue = queue.filter(q => q.status !== 'done');
    renderQueue();
    toast(`${ready.length}건을 추가했습니다. 「③ 점검·반영」에서 반영해야 사이트에 나타납니다.`, 5000);
  };
  $('btnClearQueue').onclick = () => { queue = []; renderQueue(); $('queueMsg').textContent = ''; };

  // ---------- ② 자료 관리: 목록 ----------
  let selectedId = null;
  const fLevel = $('fLevel'), fCat = $('fCategory');
  SAS.LEVELS.forEach(l => fLevel.append(h('option', { value: l.name }, l.name)));
  ['fQuery', 'fLevel', 'fCategory', 'fNoWorks', 'fWarn'].forEach(id => $(id).addEventListener('input', renderList));

  function needsCheck(d) { const v = SAS.validateDocument(d); return v.errors.length > 0 || v.warnings.length > 0; }

  function renderList() {
    const cats = [...new Set(S.state.docs.map(d => d.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const curCat = fCat.value;
    fCat.replaceChildren(h('option', { value: '' }, '모든 분류'), ...cats.map(c => h('option', { value: c, selected: c === curCat }, c)));
    const q = SAS.norm($('fQuery').value);
    const list = S.state.docs.filter(d =>
      (!q || SAS.norm(d.title + d.category).includes(q)) &&
      (!fLevel.value || d.school_levels.includes(fLevel.value)) &&
      (!fCat.value || d.category === fCat.value) &&
      (!$('fNoWorks').checked || !d.works_url) &&
      (!$('fWarn').checked || needsCheck(d)))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    const box = $('docList');
    if (!list.length) { box.replaceChildren(h('p', { class: 'muted small', style: 'padding:8px' }, S.state.docs.length ? '조건에 맞는 자료가 없습니다.' : '등록된 자료가 없습니다.')); return; }
    box.replaceChildren(...list.map(d => {
      const v = SAS.validateDocument(d);
      return h('div', { class: 'doc-item' + (d.id === selectedId ? ' active' : ''), onclick: () => selectDoc(d.id) },
        h('div', { class: 't' }, d.title),
        h('div', { class: 'm' },
          d.school_levels.map(l => h('span', { class: 'tag' }, l)),
          h('span', { class: 'tag gray' }, d.format.toUpperCase()),
          v.errors.length ? h('span', { class: 'tag err' }, '오류') : v.warnings.length ? h('span', { class: 'tag warn' }, '확인') : null,
          S.state.changedIds.has(d.id) ? h('span', { class: 'tag warn' }, '저장 전') : null,
          ' ', [d.category, d.year].filter(Boolean).join(' · ')));
    }));
  }

  function selectDoc(id) {
    selectedId = id;
    document.querySelectorAll('.doc-item').forEach(el => el.classList.remove('active'));
    renderList(); renderEditor();
  }

  // ---------- ② 자료 관리: 편집 ----------
  const openSections = new Set();

  function field(label, input, hint) {
    return h('div', {}, h('label', {}, label), input, hint ? h('div', { class: 'small muted', style: 'margin-top:4px' }, hint) : null);
  }

  function reassignLinks(doc) {
    (doc.links || []).forEach(l => {
      // 직접 추가한 서식은 그 업무가 남아 있으면 그대로 둔다
      if (l.manual && (doc.sections || []).some(s => s.id === l.section_id)) return;
      const owners = (doc.sections || []).filter(s => l.block >= s.block_start && l.block <= s.block_end);
      l.section_id = owners.length ? owners[owners.length - 1].id : null;
    });
  }

  function changed(doc, rerender) {
    SAS.finalizeDocument(doc);
    S.touch(doc);
    if (rerender) renderEditor();
  }

  function pageLabel(doc, bi) {
    const b = doc.blocks[bi]; if (!b) return '';
    if (doc.format === 'pdf') return b.printed_page != null ? `${b.pdf_page}쪽(인쇄 ${b.printed_page})` : `${b.pdf_page}쪽`;
    return `문단 ${bi + 1}`;
  }
  function blockFromInput(doc, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return -1;
    if (doc.format === 'pdf') return doc.blocks.findIndex(b => b.pdf_page === n);
    return n - 1 >= 0 && n - 1 < doc.blocks.length ? n - 1 : -1;
  }
  const blockToInput = (doc, bi) => doc.format === 'pdf' ? (doc.blocks[bi] ? doc.blocks[bi].pdf_page : '') : bi + 1;

  function renderEditor() {
    const box = $('editor');
    const doc = S.getDoc(selectedId);
    if (!doc) { box.replaceChildren(h('div', { class: 'card empty-editor muted' }, '왼쪽 목록에서 자료를 선택하세요.')); return; }
    const v = SAS.validateDocument(doc);
    const forms = SAS.formList(doc);

    // 머리
    const head = h('div', { class: 'card' },
      h('div', { class: 'editor-head' },
        h('div', {}, h('h2', {}, doc.title),
          h('div', { class: 'kv' }, h('span', {}, doc.format.toUpperCase() + (doc.kind === 'link' ? ' · 링크형' : '')),
            doc.kind === 'text' ? h('span', {}, `${doc.blocks.length}${doc.format === 'pdf' ? '쪽' : '문단'} · 업무 ${doc.sections.length}개 · 서식 ${forms.length}개`) : null,
            h('span', {}, 'ID ' + doc.id), h('span', {}, '수정 ' + new Date(doc.updated_at).toLocaleString('ko-KR')))),
        h('div', {}, S.state.changedIds.has(doc.id) ? h('span', { class: 'pill warn' }, '저장 전') : null)),
      v.errors.length || v.warnings.length ? h('div', { class: 'notice ' + (v.errors.length ? 'err' : 'warn') }, h('ul', {}, [...v.errors, ...v.warnings].map(m => h('li', {}, m)))) : null);

    // 기본 정보
    const lv = h('div', { class: 'checks' });
    levelChecks(lv, doc.school_levels, sel => { doc.school_levels = sel; changed(doc); renderList(); });
    const originSel = h('select', { onchange: e => { doc.origin.site = e.target.value; changed(doc); } },
      h('option', { value: '' }, '선택 안 함'), ...[...SAS.ORIGIN_SITES, '기타'].map(s => h('option', { value: s, selected: doc.origin.site === s }, s)));
    const worksInput = h('input', { type: 'url', value: doc.works_url, placeholder: 'https://works…', onchange: e => { doc.works_url = e.target.value.trim(); changed(doc, true); renderList(); } });
    const meta = h('div', { class: 'card' }, h('h2', {}, '기본 정보'),
      h('div', { class: 'grid2' },
        field('자료명', h('input', { type: 'text', value: doc.title, onchange: e => { doc.title = e.target.value.trim(); changed(doc, true); renderList(); } })),
        field('학교급', lv),
        field('업무 분류', h('select', { onchange: e => { doc.category = e.target.value; changed(doc); renderList(); } }, ...categoryOptions(doc.category))),
        field('연도', h('input', { type: 'number', value: doc.year || '', onchange: e => { doc.year = e.target.value ? Number(e.target.value) : null; changed(doc); } })),
        field('웍스 링크 (원본 내려받기)', h('div', { class: 'row' }, worksInput, doc.works_url ? h('a', { class: 'btn small', href: doc.works_url, target: '_blank', rel: 'noopener noreferrer', style: 'flex:0' }, '열기 ↗') : null)),
        field('원 출처', h('div', { class: 'row' }, originSel, h('input', { type: 'url', value: doc.origin.url, placeholder: '게시글 주소', onchange: e => { doc.origin.url = e.target.value.trim(); changed(doc); } })), '개정판 확인용 기록입니다. 사용자 화면의 내려받기는 웍스 링크로 연결됩니다.')),
      h('div', { style: 'margin-top:14px' }, field('문서 전체 검색어 (쉼표로 구분)', h('textarea', { value: doc.search_keywords.join(', '), placeholder: '예: 유치원 업무, 교무학사, 매뉴얼', onchange: e => { doc.search_keywords = SAS.splitList(e.target.value); changed(doc); } }), '이 자료 전체를 대표하는 말입니다. 업무별 검색어는 아래 업무 목록에서 넣습니다.')));

    const parts = [head, meta];
    if (doc.kind === 'text') parts.push(sectionCard(doc), formsCard(doc, forms));
    parts.push(dangerCard(doc));
    box.replaceChildren(...parts.filter(Boolean));
  }

  function sectionCard(doc) {
    const isPdf = doc.format === 'pdf';
    const rows = [];
    doc.sections.forEach((s, i) => {
      const open = openSections.has(doc.id + s.id);
      const nForms = (doc.links || []).filter(l => l.section_id === s.id && l.form_no != null).length;
      rows.push(h('tr', { class: open ? 'open' : '' },
        h('td', { class: 'muted' }, i + 1),
        h('td', {}, h('input', { type: 'text', value: s.parent_heading || '', placeholder: '상위 분류', onchange: e => { s.parent_heading = e.target.value.trim(); s.auto = false; changed(doc); } })),
        h('td', {}, h('input', { type: 'text', value: s.heading, onchange: e => { s.heading = e.target.value.trim(); s.auto = false; changed(doc); } })),
        h('td', { style: 'white-space:nowrap' },
          h('input', { class: 'num', type: 'number', value: blockToInput(doc, s.block_start), title: isPdf ? '시작 PDF 쪽' : '시작 문단', onchange: e => setRange(doc, s, e.target.value, null) }), ' ~ ',
          h('input', { class: 'num', type: 'number', value: blockToInput(doc, s.block_end), title: isPdf ? '끝 PDF 쪽' : '끝 문단', onchange: e => setRange(doc, s, null, e.target.value) }),
          isPdf && s.printed_pages && s.printed_pages.length ? h('div', { class: 'small muted' }, '인쇄 ' + [...new Set([s.printed_pages[0], s.printed_pages[s.printed_pages.length - 1]])].join('~') + '쪽') : null),
        h('td', {}, h('input', { type: 'text', value: (s.keywords || []).join(', '), placeholder: '검색어', onchange: e => { s.keywords = SAS.splitList(e.target.value); changed(doc); } })),
        h('td', { class: 'muted', style: 'text-align:center' }, nForms || ''),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'small', onclick: () => { open ? openSections.delete(doc.id + s.id) : openSections.add(doc.id + s.id); renderEditor(); } }, open ? '접기' : '보기'),
          h('button', { class: 'small ghost', title: '업무 삭제', onclick: async () => { if (await confirmBox(`「${SAS.esc(s.heading)}」 업무 구간을 삭제할까요? 본문은 삭제되지 않고 검색 구간에서만 빠집니다.`, '삭제', true)) { doc.sections = doc.sections.filter(x => x !== s); reassignLinks(doc); changed(doc, true); } } }, '✕'))));
      if (open) {
        const secForms = (doc.links || []).filter(l => l.section_id === s.id && l.form_no != null);
        rows.push(h('tr', { class: 'open' }, h('td', { colspan: 7 },
          h('div', { class: 'small muted', style: 'margin-bottom:6px' }, `${pageLabel(doc, s.block_start)} ~ ${pageLabel(doc, s.block_end)} · 미리보기 시작 문장: ${SAS.sectionLead(doc, s, 90)}`),
          h('div', { class: 'preview' }, SAS.sectionText(doc, s)),
          h('div', { style: 'margin-top:10px' }, h('b', { class: 'small' }, `이 업무의 서식 ${secForms.length}개 `), h('button', { class: 'small', onclick: () => addFormsDialog(doc, s.id) }, '+ 서식 직접 추가'),
            ...secForms.map(l => h('div', { class: 'form-row' }, h('span', { class: 'no' }, l.form_no + '번'), h('span', {}, l.text, l.manual ? h('span', { class: 'tag gray' }, '직접 추가') : null), h('span', { class: 'small muted' }, l.bundle_page ? `모음 ${l.bundle_page}쪽` : '')))))));
      }
    });
    return h('div', { class: 'card' },
      h('div', { class: 'editor-head' }, h('h2', {}, `업무 목록 (${doc.sections.length})`),
        h('div', { class: 'actions', style: 'margin:0' },
          h('button', { class: 'small', onclick: () => addSection(doc) }, '+ 업무 추가'),
          h('button', { class: 'small ghost', onclick: () => resplit(doc) }, '자동 분할 다시'))),
      h('p', { class: 'muted small' }, (doc.extraction.toc_found ? '목차를 인식해 자동으로 나눴습니다. ' : '목차를 찾지 못해 본문 제목으로 나눴습니다. ') + `쪽 번호는 ${isPdf ? 'PDF 쪽(파일상 순서)' : '문단 번호'}입니다. 업무별 검색어는 사용자가 쓰는 말(예: 소풍)을 넣으면 해당 업무가 2순위로 검색됩니다.`),
      doc.sections.some(s => SAS.isUntitled(doc, s)) ? h('div', { class: 'notice warn' }, `목차가 없어 쪽·길이 기준으로 나눈 구간 ${doc.sections.filter(s => SAS.isUntitled(doc, s)).length}개는 사용자 화면의 「업무 목록」에 나오지 않고 업무명으로도 검색되지 않습니다(본문·검색어 검색은 됩니다). 업무명을 직접 고친 구간은 진짜 업무로 보고 목록에 나옵니다.`) : null,
      h('div', { style: 'overflow:auto' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ...['#', '상위 분류', '업무명', isPdf ? 'PDF 쪽' : '문단', '업무 검색어', '서식', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, rows))),
      doc.extraction.warnings.length ? h('details', {}, h('summary', {}, `추출 참고사항 ${doc.extraction.warnings.length}건`), h('ul', { class: 'small' }, doc.extraction.warnings.map(w => h('li', {}, w)))) : null);
  }

  function setRange(doc, s, startVal, endVal) {
    const st = startVal != null ? blockFromInput(doc, startVal) : s.block_start;
    const en = endVal != null ? blockFromInput(doc, endVal) : s.block_end;
    if (st < 0 || en < 0 || en < st) { toast('쪽 범위가 올바르지 않습니다.'); renderEditor(); return; }
    s.block_start = st; s.block_end = en; s.auto = false;
    doc.sections.sort((a, b) => a.block_start - b.block_start);
    reassignLinks(doc); changed(doc, true);
  }

  function nextSectionId(doc) {
    let n = 1; const used = new Set(doc.sections.map(s => s.id));
    while (used.has('sec-' + pad3(n))) n++;
    return 'sec-' + pad3(n);
  }

  async function addSection(doc) {
    const isPdf = doc.format === 'pdf';
    const name = h('input', { type: 'text', placeholder: '업무명' });
    const st = h('input', { type: 'number', placeholder: isPdf ? '시작 PDF 쪽' : '시작 문단' });
    const en = h('input', { type: 'number', placeholder: isPdf ? '끝 PDF 쪽' : '끝 문단' });
    const ok = await modal(h('div', {}, h('h2', {}, '업무 추가'), field('업무명', name), h('div', { class: 'grid2', style: 'margin-top:10px' }, field('시작', st), field('끝', en))),
      [{ label: '취소', value: false }, { label: '추가', value: true, primary: true }]);
    if (!ok) return;
    const a = blockFromInput(doc, st.value), b = blockFromInput(doc, en.value || st.value);
    if (!name.value.trim() || a < 0 || b < a) { toast('업무명과 쪽 범위를 확인해 주세요.'); return; }
    doc.sections.push({ id: nextSectionId(doc), heading: name.value.trim(), parent_heading: '', block_start: a, block_end: b, keywords: [], auto: false });
    doc.sections.sort((x, y) => x.block_start - y.block_start);
    reassignLinks(doc); changed(doc, true);
  }

  async function resplit(doc) {
    if (!(await confirmBox('목차·제목으로 업무를 다시 나눕니다. 업무명이 같은 업무의 검색어는 유지되고, 직접 고친 쪽 범위는 초기화됩니다.', '다시 나누기'))) return;
    const old = JSON.parse(JSON.stringify(doc));
    const r = SAS.sectionize(doc);
    doc.sections = r.sections;
    doc.extraction.toc_found = !!r.toc_found; doc.extraction.warnings = r.warnings || [];
    const kept = SAS.carryKeywords(old, doc);
    reassignLinks(doc); changed(doc, true);
    toast(`업무 ${doc.sections.length}개로 나눴습니다. 검색어 ${kept}개 업무 유지.`);
  }

  function formsCard(doc, forms) {
    const fb = doc.forms_bundle || (doc.forms_bundle = { works_url: '', filename: '', page_count: null, matched_at: null });
    const manualCount = forms.filter(f => f.manual).length;
    const card = h('div', { class: 'card' },
      h('div', { class: 'editor-head' }, h('h2', {}, `서식 (${forms.length})`),
        h('div', { class: 'actions', style: 'margin:0' }, h('button', { class: 'small', onclick: () => addFormsDialog(doc) }, '+ 서식 직접 추가'))));
    if (!forms.length) {
      card.append(h('p', { class: 'muted small' }, '이 자료에서 내려받기 서식 링크를 찾지 못했습니다(HWPX·스캔 자료 등). 관련 서식이 있으면 「+ 서식 직접 추가」로 업무별로 넣어 주세요. 사용자 화면에 "이 업무의 서식 N번"으로 안내됩니다.'));
      return card;
    }
    const found = forms.filter(f => f.bundle_page != null).length;
    card.append(
      h('p', { class: 'muted small' }, '자료 안의 서식 링크를 업무 순서대로 번호 매긴 목록입니다. 링크로 찾지 못한 서식은 「+ 서식 직접 추가」로 넣을 수 있으며, 기존 번호 뒤에 이어서 번호가 붙습니다. 이 번호 순서대로 한글에서 서식을 이어 붙여 "서식 모음" 파일 하나를 만들고, 웍스에 올린 링크를 아래에 넣으세요. 사용자에게는 "서식 모음 내려받기 → N번 서식 · 몇 쪽"으로 안내됩니다.'),
      h('div', { class: 'grid2' },
        field('서식 모음 웍스 링크', h('input', { type: 'url', value: fb.works_url, placeholder: 'https://works…', onchange: e => { fb.works_url = e.target.value.trim(); changed(doc, true); renderList(); } })),
        field('서식 모음 파일명 (안내용)', h('input', { type: 'text', value: fb.filename, placeholder: `예: ${doc.title}_서식모음.hwp`, onchange: e => { fb.filename = e.target.value.trim(); changed(doc); } }))),
      h('div', { class: 'actions' },
        h('button', { onclick: () => downloadFormList(doc) }, '① 서식 내려받기 목록 만들기'),
        h('button', { onclick: () => matchBundleFile(doc) }, '② 서식 모음에서 쪽 찾기 (PDF·HWPX)'),
        h('span', { class: 'small muted' }, fb.matched_at ? `쪽 확인 ${found}/${forms.length}개 · ${new Date(fb.matched_at).toLocaleDateString('ko-KR')}` : '아직 쪽 정보가 없습니다(번호만 안내됨)')),
      h('details', { open: manualCount > 0 && forms.length <= 30 ? true : null }, h('summary', {}, '서식 번호·쪽 목록 보기 / 직접 고치기'),
        h('div', { class: 'form-row small muted' }, h('span', {}, '번호'), h('span', {}, '서식명 (업무)'), h('span', {}, '모음 쪽')),
        ...forms.map(f => {
          const sec = doc.sections.find(s => s.id === f.section_id);
          return h('div', { class: 'form-row' },
            h('span', { class: 'no' }, f.form_no + '번'),
            h('span', {}, f.text, ' ', h('span', { class: 'small muted' }, sec ? `· ${sec.heading}` : '· 업무 없음'), ' ',
              f.url ? h('a', { class: 'small', href: f.url, target: '_blank', rel: 'noopener noreferrer' }, '원문↗') : null,
              f.manual ? h('span', { class: 'tag gray' }, '직접 추가') : null,
              f.bundle_found === false ? h('span', { class: 'tag warn' }, '못 찾음') : null,
              f.manual ? h('button', { class: 'small ghost', title: '직접 추가한 서식 삭제', onclick: async () => {
                if (!(await confirmBox(`「${SAS.esc(f.text)}」 서식을 지울까요? 뒤에 직접 추가한 서식의 번호가 하나씩 당겨집니다.`, '삭제', true))) return;
                SAS.removeManualForm(doc, f.id); changed(doc, true);
              } }, '✕') : null),
            h('input', { type: 'number', min: 1, value: f.bundle_page == null ? '' : f.bundle_page, onchange: e => {
              const v = e.target.value ? Number(e.target.value) : null;
              doc.links.filter(l => l.form_no === f.form_no).forEach(l => { l.bundle_page = v; l.bundle_found = v != null; });
              changed(doc);
            } }));
        })));
    return card;
  }

  /** 서식 직접 추가 창: 업무를 고르고 서식 이름을 한 줄에 하나씩 */
  async function addFormsDialog(doc, secId) {
    if (!doc.sections.length) { toast('먼저 업무 구간이 있어야 서식을 붙일 수 있습니다.'); return; }
    const sel = h('select', {}, ...doc.sections.map((s, i) => h('option', { value: s.id, selected: s.id === secId }, `${i + 1}. ${s.parent_heading ? s.parent_heading + ' › ' : ''}${s.heading}`)));
    const names = h('textarea', { rows: 5, placeholder: '예:\n현장체험학습 계획서(예시)\n학부모 동의서' });
    const url = h('input', { type: 'url', placeholder: '원래 내려받기 주소(선택)' });
    const page = h('input', { type: 'number', min: 1, placeholder: '서식 모음 쪽(선택)' });
    const ok = await modal(h('div', {}, h('h2', {}, '서식 직접 추가'),
      h('p', { class: 'muted small' }, '자료에서 링크로 찾지 못한 서식을 업무에 붙입니다. 번호는 기존 서식 뒤에 이어서 붙으니, 서식 모음 파일에도 같은 순서로 끝에 이어 붙여 주세요.'),
      field('업무', sel), h('div', { style: 'margin-top:10px' }, field('서식 이름 (한 줄에 하나씩, 여러 개 가능)', names)),
      h('div', { class: 'grid2', style: 'margin-top:10px' }, field('원래 주소', url, '출처 기록용입니다. 사용자 화면에는 나오지 않습니다.'), field('서식 모음 쪽', page, '서식을 1개만 넣을 때 쓸 수 있습니다.'))),
      [{ label: '취소', value: false }, { label: '추가', value: true, primary: true }]);
    if (!ok) return;
    const list = SAS.splitList(names.value);
    if (!list.length) { toast('서식 이름을 입력해 주세요.'); return; }
    if (url.value.trim() && !/^https?:\/\//i.test(url.value.trim())) { toast('주소는 http(s)로 시작해야 합니다.'); return; }
    try {
      const added = SAS.addManualForms(doc, sel.value, list, list.length === 1 ? url.value : '');
      if (list.length === 1 && page.value) added[0].bundle_page = Number(page.value);
      changed(doc, true); renderList();
      toast(`서식 ${added.length}개를 추가했습니다(${added[0].form_no}번${added.length > 1 ? `~${added[added.length - 1].form_no}번` : ''}).`);
    } catch (e) { toast(e.message); }
  }

  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60); }

  /** 번호·권장 파일명이 붙은 서식 내려받기 안내 페이지(HTML 파일) */
  function downloadFormList(doc) {
    const forms = SAS.formList(doc);
    const groups = [];
    forms.forEach(f => {
      const sec = doc.sections.find(s => s.id === f.section_id);
      const key = sec ? sec.id : '-';
      let g = groups.find(x => x.key === key);
      if (!g) groups.push(g = { key, title: sec ? `${sec.parent_heading ? sec.parent_heading + ' › ' : ''}${sec.heading}` : '기타', items: [] });
      g.items.push(f);
    });
    const e = SAS.esc;
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>서식 내려받기 목록 - ${e(doc.title)}</title>
<style>body{font-family:system-ui,'Malgun Gothic',sans-serif;background:#f5f7fa;color:#1d2939;margin:0;padding:24px;line-height:1.6}main{max-width:900px;margin:auto}.card{background:#fff;border:1px solid #e1e6ed;border-radius:14px;padding:18px 20px;margin-bottom:12px}h1{font-size:20px}h2{font-size:15px;margin:0 0 8px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px;border-bottom:1px solid #edf0f4;vertical-align:top}td.n{width:56px;color:#677489}code{background:#edf0f4;padding:1px 5px;border-radius:4px;user-select:all}a{color:#2462b3}tr.done{opacity:.45}ol{padding-left:20px}</style></head><body><main>
<h1>서식 내려받기 목록</h1><div class="card"><b>${e(doc.title)}</b> · 서식 ${forms.length}개 · 만든 날 ${new Date().toLocaleDateString('ko-KR')}
<ol><li>각 서식의 <b>내려받기</b>를 눌러 저장할 때, 오른쪽의 권장 파일명(번호로 시작)으로 저장하면 순서가 유지됩니다. 누른 줄은 흐리게 표시됩니다.</li>
<li>한글에서 새 문서를 열고 <b>입력 → 문서 끼워 넣기</b>로 1번부터 순서대로 넣습니다. 서식 사이에는 쪽 나누기(Ctrl+Enter)를 넣어 주세요.</li>
<li>완성한 파일을 웍스에 올리고, 관리자 도구의 「서식 모음 웍스 링크」에 공유 링크를 넣습니다.</li>
<li>같은 파일을 <b>PDF로도 저장</b>해 관리자 도구의 「서식 모음에서 쪽 찾기」에 넣으면 각 서식의 쪽 번호가 자동으로 채워집니다.</li></ol>
<p style="font-size:12px;color:#677489">PDF·한글이 아닌 큰 자료(길라잡이 등)는 모음에 넣기 어려우면 빼도 됩니다. 뺀 서식은 관리자 도구에서 쪽 칸을 비워 두세요.</p></div>
${groups.map(g => `<div class="card"><h2>${e(g.title)}</h2><table>${g.items.map(f => `<tr><td class="n">${f.form_no}번</td><td>${e(f.text)}<br><code>${e(pad3(f.form_no) + '_' + safeName(f.text))}</code></td><td style="width:90px">${f.url ? `<a href="${e(f.url)}" target="_blank" rel="noopener noreferrer" onclick="this.closest('tr').classList.add('done')">내려받기</a>` : '<span style="color:#677489;font-size:12px">직접 추가<br>(파일 직접 준비)</span>'}</td></tr>`).join('')}</table></div>`).join('\n')}
</main></body></html>`;
    S.download(new Blob([html], { type: 'text/html;charset=utf-8' }), `서식목록_${safeName(doc.title)}.html`);
    toast('서식 내려받기 목록을 저장했습니다. 브라우저로 열어 순서대로 내려받으세요.', 5000);
  }

  async function matchBundleFile(doc) {
    const file = await pickFile('.pdf,.hwpx');
    if (!file) return;
    try {
      const r = await withProgress('서식 모음에서 서식 위치를 찾는 중…', p => X.extractFile(file, p));
      if (r.kind !== 'text') throw new Error('PDF 또는 HWPX 파일만 쪽을 찾을 수 있습니다.');
      const m = SAS.matchBundle(doc, r.blocks);
      if (!doc.forms_bundle.filename) doc.forms_bundle.filename = file.name.replace(/\.(pdf|hwpx)$/i, '.hwp');
      changed(doc, true);
      await modal(`<h2>서식 위치 찾기 결과</h2><p>${m.total}개 중 <b>${m.found}개</b>를 찾았습니다.${m.hasPages ? '' : ' (HWPX는 쪽 정보가 없어 순서만 확인했습니다. 쪽을 표시하려면 PDF로 저장해 넣어 주세요.)'}</p>${m.missing.length ? `<p class="small">못 찾은 서식: ${m.missing.slice(0, 40).map(n => n + '번').join(', ')}${m.missing.length > 40 ? ' …' : ''}<br>서식 제목이 파일 안에 그대로 적혀 있지 않으면 찾지 못합니다. 목록에서 쪽을 직접 입력할 수 있습니다.</p>` : ''}`);
    } catch (e) { toast(e.message, 5000); }
  }

  function dangerCard(doc) {
    return h('div', { class: 'card danger-zone' }, h('h2', {}, '자료 교체·삭제'),
      h('p', { class: 'muted small' }, '새 판이 나오면 「파일 교체」로 같은 자료 ID를 유지한 채 본문을 바꿉니다. 업무명이 같은 업무의 검색어와 같은 서식의 쪽 정보는 옮겨집니다. 분석에 실패하면 기존 자료가 그대로 유지됩니다.'),
      h('div', { class: 'actions' },
        h('button', { onclick: () => replaceFile(doc) }, '파일 교체'),
        h('button', { class: 'danger', onclick: () => deleteDoc(doc) }, '자료 삭제')));
  }

  async function replaceFile(doc) {
    const file = await pickFile('');
    if (!file) return;
    let r;
    try { r = await withProgress('새 파일을 분석하는 중…', p => X.extractFile(file, p)); }
    catch (e) { toast('분석 실패 — 기존 자료를 유지합니다: ' + e.message, 6000); return; }
    const nd = SAS.createDocument({ id: doc.id, title: doc.title, school_levels: doc.school_levels, category: doc.category, year: doc.year, filename: file.name, format: r.format,
      works_url: doc.works_url, origin: doc.origin, search_keywords: doc.search_keywords, created_at: doc.created_at, forms_bundle: doc.forms_bundle }, r.blocks, []);
    const kept = SAS.carryKeywords(doc, nd);
    const keptForms = SAS.carryForms(doc, nd);
    const ok = await confirmBox(`<h2>파일 교체</h2><p><b>${SAS.esc(file.name)}</b></p><ul>
      <li>업무: ${doc.sections.length}개 → <b>${nd.sections.length}개</b>${nd.extraction.toc_found ? ' (목차 인식)' : ''}</li>
      <li>업무 검색어 유지: ${kept}개 업무</li><li>서식: ${SAS.formList(doc).length}개 → <b>${SAS.formList(nd).length}개</b> (쪽 정보 유지 ${keptForms}개)</li>
      ${nd.extraction.warnings.length ? `<li>참고: ${nd.extraction.warnings.map(SAS.esc).join(' / ')}</li>` : ''}</ul>
      <p class="small muted">웍스의 원본 파일도 새 판으로 바꿔 올리고, 링크가 바뀌었으면 웍스 링크를 고쳐 주세요. 서식이 바뀌었으면 서식 모음도 다시 만들어야 합니다.</p>`, '교체 적용');
    if (!ok) return;
    S.replaceDoc(doc.id, nd);
    renderEditor(); renderList();
    toast('교체했습니다. 「③ 점검·반영」에서 반영해 주세요.');
  }

  async function deleteDoc(doc) {
    if (!(await confirmBox(`<h2>자료 삭제</h2><p>「${SAS.esc(doc.title)}」을(를) 목록과 모든 색인에서 지웁니다. 「사이트에 반영」해야 사이트에서 사라집니다. 웍스의 원본 파일은 지워지지 않습니다.</p>`, '삭제', true))) return;
    S.removeDoc(doc.id);
    selectedId = null; renderEditor(); renderList();
    toast('삭제했습니다.');
  }

  // ---------- ③ 점검·반영 ----------
  /** 내용이 그대로면 생성 시각도 그대로 두어 불필요한 파일 변경을 막는다 */
  async function makeOutputs() {
    let o = SAS.buildOutputs(S.state.docs, { generatedAt: S.state.generatedAt || '1970-01-01T00:00:00.000Z' });
    const d = await S.diffOutputs(o);
    if (d.changed.length || d.deletions.length || !S.state.generatedAt) o = SAS.buildOutputs(S.state.docs, { generatedAt: new Date().toISOString() });
    return o;
  }

  async function runCheck() {
    const outputs = await makeOutputs();
    const chk = SAS.checkConsistency(S.state.docs, outputs);
    const diff = await S.diffOutputs(outputs);
    const st = outputs.stats;
    const lvStats = SAS.LEVELS.map(l => h('div', {}, h('b', {}, st.levels[l.slug].documents + '건'), h('span', {}, `${l.name} · 색인 ${fmtBytes(st.levels[l.slug].indexBytes)}`)));
    $('checkResult').replaceChildren(
      h('div', { class: 'stat' }, h('div', {}, h('b', {}, S.state.docs.length + '건'), h('span', {}, '전체 자료')), ...lvStats,
        h('div', {}, h('b', {}, fmtBytes(st.totalBytes)), h('span', {}, `데이터 ${st.fileCount}개 파일`)),
        h('div', {}, h('b', {}, diff.changed.length + diff.deletions.length + '개'), h('span', {}, `반영 시 바뀌는 파일${diff.deletions.length ? ` (삭제 ${diff.deletions.length})` : ''}`))),
      chk.errors.length ? h('div', { class: 'notice err' }, h('b', {}, `오류 ${chk.errors.length}건 — 고친 뒤 반영할 수 있습니다.`), h('ul', {}, chk.errors.slice(0, 50).map(e => h('li', {}, e)))) : h('div', { class: 'notice ok' }, '오류 없음. 반영할 수 있습니다.'),
      chk.warnings.length ? h('details', {}, h('summary', {}, `확인 권장 ${chk.warnings.length}건 (반영은 가능)`), h('ul', { class: 'small' }, chk.warnings.slice(0, 200).map(w => h('li', {}, w)))) : '');
    return { outputs, chk, diff };
  }
  $('btnCheck').onclick = () => runCheck();

  function renderSaveStatus() {
    const st = S.state.status, g = S.state.github, src = S.state.source;
    const connected = !!(g && g.token);
    const msg = {
      empty: '반영할 자료가 없습니다.',
      clean: '사이트(GitHub)와 내용이 같습니다.',
      unsaved: '반영하지 않은 변경이 있습니다. 「사이트에 반영」을 눌러야 공개 사이트에 나타납니다.',
      published: '반영했습니다. 1~2분 뒤 공개 사이트에서 검색됩니다.',
      exported: '폴더·ZIP으로 내보냈습니다. GitHub Desktop이나 GitHub 웹 화면으로 직접 올린 뒤 「직접 반영 완료로 표시」를 눌러 주세요.'
    }[st] || '';
    $('saveStatus').className = 'notice ' + (st === 'unsaved' ? 'warn' : st === 'published' || st === 'exported' ? '' : 'ok');
    $('saveStatus').textContent = msg + (connected ? '' : ' (GitHub가 연결되지 않았습니다. 오른쪽 위 🔑 버튼으로 연결해 주세요.)');
    $('btnPublish').disabled = !connected || src !== 'github';
    $('btnPublish').title = src && src !== 'github' ? 'GitHub에서 불러온 자료만 바로 반영할 수 있습니다. GitHub에서 불러온 뒤 다시 작업해 주세요.' : '';
    $('btnSaveFolder').disabled = !S.state.folder;
    $('btnPublished').disabled = st !== 'exported';
  }

  function autoMessage(diff) {
    const n = S.state.changedIds.size;
    const docs = [...S.state.changedIds].map(id => S.getDoc(id)).filter(Boolean);
    const names = docs.slice(0, 2).map(d => d.title).join(', ');
    return n ? `자료 ${n}건 반영: ${names}${n > 2 ? ' 외' : ''}` : `자료 반영 (파일 ${diff.changed.length + diff.deletions.length}개)`;
  }

  $('btnPublish').onclick = async () => {
    if (S.state.source !== 'github') { toast('GitHub에서 자료를 불러온 상태에서만 반영할 수 있습니다. 새로고침해 다시 불러와 주세요.', 5000); return; }
    const { outputs, chk, diff } = await runCheck();
    if (!chk.ok) { toast('오류를 먼저 고쳐 주세요.', 4000); return; }
    if (!diff.changed.length && !diff.deletions.length) { toast('바뀐 파일이 없습니다. 사이트와 내용이 같습니다.'); return; }
    const info = GH.expiryInfo(S.state.github && S.state.github.expiresAt);
    if (info.level === 'expired') { toast('출입증이 만료되었습니다. 새 출입증으로 바꿔 주세요.', 5000); openTokenDialog(); return; }
    const message = ($('commitMsg').value.trim() || autoMessage(diff)) + `\n\n관리자 도구에서 반영 · 바뀐 파일 ${diff.changed.length}개, 삭제 ${diff.deletions.length}개`;
    try {
      const r = await withProgress(`사이트에 반영하는 중… (파일 ${diff.changed.length + diff.deletions.length}개)`, p => S.publishToGithub(outputs, message, p));
      $('commitMsg').value = '';
      $('saveMsg').textContent = `${new Date().toLocaleTimeString('ko-KR')} 반영 완료: 파일 ${r.written}개 올림, ${r.deleted}개 삭제. 1~2분 뒤 사이트에서 확인하세요.`;
      toast('사이트에 반영했습니다.', 4000);
      renderSaveStatus(); runCheck();
    } catch (e) {
      await modal(h('div', {}, h('h2', {}, '반영하지 못했습니다'), h('p', {}, e.message), h('p', { class: 'small muted' }, '작업 내용은 이 브라우저에 보관되어 있습니다.')));
      if (e.kind === 'auth' || e.kind === 'permission') openTokenDialog();
    }
  };

  $('btnSaveFolder').onclick = async () => {
    const { outputs, chk, diff } = await runCheck();
    if (!chk.ok) { toast('오류를 먼저 고쳐 주세요.', 4000); return; }
    if (!diff.changed.length && !diff.deletions.length) { toast('바뀐 파일이 없습니다.'); return; }
    try {
      const r = await withProgress(`저장 중… (${diff.changed.length + diff.deletions.length}개 파일)`, p => S.saveToFolder(outputs, p));
      $('saveMsg').textContent = `${new Date().toLocaleTimeString('ko-KR')} 저장 완료: 파일 ${r.written}개 기록, ${r.deleted}개 삭제. GitHub Desktop에서 커밋·푸시하세요.`;
      renderSaveStatus(); runCheck();
    } catch (e) { toast('저장 실패: ' + e.message, 6000); }
  };
  async function zipOut(changedOnly) {
    const { outputs, chk } = await runCheck();
    if (!chk.ok) { toast('오류를 먼저 고쳐 주세요.', 4000); return; }
    try {
      const z = await S.buildZip(outputs, changedOnly);
      if (!z.count && !z.deletions) { toast('바뀐 파일이 없습니다.'); return; }
      S.download(z.blob, `data_${changedOnly ? 'changed' : 'all'}_${today()}.zip`);
      S.markExported();
      $('saveMsg').textContent = `ZIP을 만들었습니다: 파일 ${z.count}개${z.deletions ? `, 삭제할 파일 ${z.deletions}개 목록 포함` : ''}.`;
    } catch (e) { toast('ZIP 만들기 실패: ' + e.message, 6000); }
  }
  $('btnZipChanged').onclick = () => zipOut(true);
  $('btnZipAll').onclick = () => zipOut(false);
  $('btnPublished').onclick = () => { S.markPublished(); toast('반영 완료로 표시했습니다.'); };

  // ---------- 시작 ----------
  renderHeader(); renderQueue(); initStart();
  window.SASAdmin = { showTab, selectDoc, renderEditor, makeOutputs, openTokenDialog }; // 점검용
})();
