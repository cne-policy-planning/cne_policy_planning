/*
 * 관리자 도구 · 작업 상태와 데이터 입출력 (브라우저 전용)
 *
 * 자료를 불러오고 저장하는 곳(source)
 *  1) github (기본): 출입증으로 GitHub 저장소에서 바로 불러오고 바로 반영한다.
 *  2) folder (예비): GitHub Desktop 저장소 폴더에 바뀐 파일만 쓴다(웨일·크롬·엣지).
 *  3) zip    (예비): 데이터 ZIP을 불러오고 내려받는다.
 * 작업 중 내용은 이 브라우저의 IndexedDB에 임시 보관되어 창을 닫아도 복구할 수 있다.
 * 파일 지문은 git과 같은 blob SHA-1을 써서, GitHub의 파일 목록과 바로 비교한다.
 */
(function (root) {
  'use strict';
  const GH = root.SASGitHub;
  const DB_NAME = 'sas-admin', DB_VER = 1;
  const DATA_RE = /^data\/(documents|indexes|search|toc)\/|^data\/(documents|manifest)\.json$/;

  // ---------- IndexedDB ----------
  let dbPromise = null;
  function idb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function kvGet(key) {
    try { const db = await idb(); return await new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
    catch (e) { return undefined; }
  }
  async function kvSet(key, val) {
    try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; }
    catch (e) { return false; }
  }
  async function kvDel(key) {
    try { const db = await idb(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(key); t.oncomplete = res; t.onerror = res; }); } catch (e) { /* 무시 */ }
  }
  async function kvKeys(prefix) {
    try { const db = await idb(); return await new Promise(res => { const r = db.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => res(r.result.filter(k => String(k).startsWith(prefix))); r.onerror = () => res([]); }); }
    catch (e) { return []; }
  }

  // ---------- 상태 ----------
  const STATUS = {
    empty: { label: '자료 없음', tone: 'muted' },
    clean: { label: '사이트와 같음', tone: 'ok' },
    unsaved: { label: '반영 안 된 변경 있음', tone: 'warn' },
    published: { label: '반영 완료 · 사이트 갱신 1~2분', tone: 'info' },
    exported: { label: '내보내기 완료 · GitHub 반영 대기', tone: 'info' }
  };

  const state = {
    docs: [],
    source: null,             // 'github' | 'folder' | 'zip' | null
    sourceLabel: '',
    github: null,             // { owner, repo, branch, token, expiresAt, remember, connectedAt }
    head: null,               // GitHub에서 마지막으로 읽은 { commitSha, treeSha }
    folder: null,
    savedShas: new Map(),     // 저장된 곳의 data 파일 지문(path → git blob sha)
    otherPaths: new Set(),    // 저장소의 data 밖 파일(.nojekyll 확인용)
    status: 'empty',
    generatedAt: null,
    changedIds: new Set(),
    listeners: new Set()
  };

  function emit() { state.listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }
  function onChange(fn) { state.listeners.add(fn); }

  let draftTimer = null;
  function markChanged(id) {
    if (id) state.changedIds.add(id);
    state.status = 'unsaved';
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (state.status === 'unsaved') kvSet('draft', { saved_at: new Date().toISOString(), source: state.sourceLabel, base: dataDigest(), docs: state.docs }); }, 800);
    emit();
  }
  /** 저장된 곳의 data 파일 지문을 하나로 요약(임시 작업이 어느 시점 자료 위에서 만들어졌는지 확인용) */
  function dataDigest() {
    let h = 0x811c9dc5;
    const s = [...state.savedShas].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([p, v]) => p + ':' + v).join('|');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36) + ':' + state.savedShas.size;
  }
  async function clearDraft() { clearTimeout(draftTimer); await kvDel('draft'); }

  // ---------- 원본 파일(아직 사이트·창고에 올리지 않은 것) ----------
  // 자료 ID → File/Blob(PDF·HWP·엑셀 등 모든 형식). 창을 닫아도 이어서 반영할 수 있게 IndexedDB에도 넣어 둔다.
  // (예전 판과 맞추려고 함수·키 이름은 pdf를 그대로 쓴다)
  const pendingPdfs = new Map();
  // 고른 파일은 내용을 바로 복사해 둔다: File은 디스크의 파일을 가리키기만 해서, 반영 전에 파일을 옮기거나 고치면 읽지 못한다(NotFoundError)
  async function setPendingPdf(id, blob) {
    let copy = blob;
    try { copy = new File([await blob.arrayBuffer()], blob.name || id, { type: blob.type || '' }); } catch (e) { console.warn('[관리자 도구] 파일을 복사하지 못했습니다:', id, e && e.message); }
    pendingPdfs.set(id, copy); await kvSet('pdf:' + id, copy); markChanged(id);
  }
  /** 반영 대기 파일 읽기. 파일을 읽지 못하면 임시 보관본을 쓰고, 그것도 없으면 어느 자료인지 알려 준다 */
  async function readPending(id) {
    const blob = pendingPdfs.get(id);
    try { return new Uint8Array(await blob.arrayBuffer()); }
    catch (e) {
      try { const kept = await kvGet('pdf:' + id); if (kept) { const bytes = new Uint8Array(await kept.arrayBuffer()); pendingPdfs.set(id, kept); return bytes; } } catch (e2) { /* 아래에서 안내 */ }
      const d = getDoc(id);
      const err = new GH.GitHubError(`「${(d && d.title) || id}」의 파일 「${(blob && blob.name) || (d && d.filename) || ''}」을 찾을 수 없습니다. 파일을 고른 뒤 옮겼거나 이름을 바꿨거나 내용이 바뀌었을 수 있습니다.`, 'file-missing', 0);
      err.docId = id;
      throw err;
    }
  }
  async function dropPendingPdf(id) { pendingPdfs.delete(id); await kvDel('pdf:' + id); }
  function pendingPdfIds() { return [...pendingPdfs.keys()].filter(id => getDoc(id)); }
  async function restorePendingPdfs() {
    for (const k of await kvKeys('pdf:')) { const id = k.slice(4); const b = await kvGet(k); if (b && getDoc(id)) pendingPdfs.set(id, b); else await kvDel(k); }
  }
  function pdfPath(id) { return `files/${id}.pdf`; }
  /** 저장소의 PDF 중 어느 자료에서도 쓰지 않는 것(자료를 지운 경우) */
  function orphanPdfs(paths) {
    const used = new Set(state.docs.filter(d => d.pdf && !d.pdf.repo).map(d => d.pdf.path));
    return [...paths].filter(p => /^pdf\/[^/]+\.pdf$/.test(p) && !used.has(p));
  }

  function getDoc(id) { return state.docs.find(d => d.id === id); }
  function addDocs(list) { list.forEach(d => { state.docs.push(d); state.changedIds.add(d.id); }); markChanged(); }
  function replaceDoc(id, doc) { const i = state.docs.findIndex(d => d.id === id); if (i >= 0) state.docs[i] = doc; markChanged(id); }
  function removeDoc(id) { state.docs = state.docs.filter(d => d.id !== id); markChanged(id); }
  function touch(doc) { doc.updated_at = new Date().toISOString(); markChanged(doc.id); }
  function allIds() { return state.docs.map(d => d.id); }

  function setLoaded(source, label, docs, shas, generatedAt) {
    state.source = source; state.sourceLabel = label;
    state.docs = docs; state.savedShas = shas; state.generatedAt = generatedAt || null;
    state.changedIds = new Set();
    state.status = docs.length ? 'clean' : 'empty';
    emit();
  }

  /** 출력 파일 중 실제로 바뀐 것과 지울 것 */
  async function diffOutputs(outputs) {
    const changed = [];
    for (const [path, text] of outputs.files) {
      if (state.savedShas.get(path) !== await GH.gitBlobSha(text)) changed.push(path);
    }
    const deletions = [...state.savedShas.keys()].filter(p => DATA_RE.test(p) && !outputs.files.has(p));
    return { changed, deletions };
  }

  /** 자료 목록 파일 검사: 망가졌으면 "자료 없음"으로 읽지 않고 멈춘다(그대로 반영하면 전체 자료가 지워지므로) */
  function parseDocList(text) {
    let json;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    if (!json || !Array.isArray(json.documents) || json.documents.some(d => !d || typeof d.id !== 'string')) {
      throw new Error('자료 목록 파일(data/documents.json)이 손상되었거나 다른 내용으로 바뀌었습니다. 안전을 위해 불러오기를 멈췄습니다. 오른쪽 위 변경 기록에서 누가 바꿨는지 확인한 뒤, GitHub에서 이전 상태로 되돌려 주세요.');
    }
    return json.documents;
  }

  // ---------- GitHub ----------
  async function loadGithubConfig() {
    const saved = await kvGet('github');
    if (saved && saved.token) return saved;
    try { const s = sessionStorage.getItem('sas-github'); if (s) return JSON.parse(s); } catch (e) { /* 무시 */ }
    return saved || null;
  }
  async function saveGithubConfig(cfg) {
    const keep = Object.assign({}, cfg);
    if (cfg.remember) { await kvSet('github', keep); try { sessionStorage.removeItem('sas-github'); } catch (e) { /* 무시 */ } }
    else {
      // 기억하지 않기: 저장소·만료일만 남기고 출입증은 이 창을 닫으면 사라지게
      await kvSet('github', Object.assign({}, keep, { token: '' }));
      try { sessionStorage.setItem('sas-github', JSON.stringify(keep)); } catch (e) { /* 무시 */ }
    }
  }
  async function forgetToken() {
    const cfg = await kvGet('github');
    if (cfg) await kvSet('github', Object.assign({}, cfg, { token: '' }));
    try { sessionStorage.removeItem('sas-github'); } catch (e) { /* 무시 */ }
    if (state.github) state.github.token = '';
    emit();
  }

  /** 출입증은 그대로 두고 만료일만 고친다(null = 만료 없음) */
  async function setExpiry(expiresAt) {
    if (!state.github) return;
    state.github.expiresAt = expiresAt || null;
    await saveGithubConfig(state.github);
    emit();
  }

  /** 출입증 연결 확인 후 저장 */
  async function connectGithub(cfg) {
    const c = GH.client(cfg);
    const r = await c.verify();
    if (r.expiry) cfg.expiresAt = GH.ymd(new Date(r.expiry)); // 브라우저가 읽을 수 있는 경우
    cfg.branch = cfg.branch || (r.repo && r.repo.default_branch) || 'main';
    cfg.connectedAt = new Date().toISOString();
    state.github = cfg;
    await saveGithubConfig(cfg);
    emit();
    return r;
  }

  /** GitHub에서 자료 불러오기. 한 번 받은 파일은 지문으로 캐시해 다음부터 바뀐 것만 받는다 */
  async function loadFromGithub(onProgress) {
    const cfg = state.github;
    if (!cfg || !cfg.token) throw new GH.GitHubError('GitHub 출입증을 먼저 연결해 주세요.', 'auth', 0);
    const c = GH.client(cfg);
    const head = await c.getHead();
    const shas = new Map(), other = new Set();
    head.files.forEach((sha, path) => { if (DATA_RE.test(path)) shas.set(path, sha); else other.add(path); });
    const read = async path => {
      const sha = shas.get(path);
      const cached = await kvGet('blob:' + sha);
      if (cached != null) return cached;
      const text = await c.getBlobText(sha);
      await kvSet('blob:' + sha, text);
      return text;
    };
    const docs = [];
    let generatedAt = null;
    if (shas.has('data/documents.json')) {
      const list = parseDocList(await read('data/documents.json'));
      const paths = list.map(d => `data/documents/${d.id}.json`);
      const missing = paths.filter(p => !shas.has(p));
      if (missing.length) throw new Error(`자료 목록에는 있지만 파일이 없는 자료가 ${missing.length}건 있습니다: ${missing.slice(0, 3).join(', ')}`);
      let done = 0;
      const out = new Array(paths.length);
      const worker = async () => { for (;;) { const i = done++; if (i >= paths.length) return; out[i] = JSON.parse(await read(paths[i])); if (onProgress) onProgress(Math.min(done, paths.length), paths.length); } };
      await Promise.all(Array.from({ length: 6 }, worker));
      docs.push(...out);
      if (shas.has('data/manifest.json')) { try { generatedAt = JSON.parse(await read('data/manifest.json')).generated_at; } catch (e) { /* 무시 */ } }
    }
    // 지금 저장소에 없는 캐시는 지운다
    const keep = new Set([...shas.values()].map(s => 'blob:' + s));
    for (const k of await kvKeys('blob:')) if (!keep.has(k)) await kvDel(k);
    state.head = { commitSha: head.commitSha, treeSha: head.treeSha };
    state.otherPaths = other;
    setLoaded('github', `${cfg.owner}/${cfg.repo}`, docs, shas, generatedAt);
    return { count: docs.length };
  }

  /** 바뀐 파일만 GitHub에 반영 */
  async function publishToGithub(outputs, message, onProgress) {
    const cfg = state.github;
    if (!cfg || !cfg.token) throw new GH.GitHubError('GitHub 출입증을 먼저 연결해 주세요.', 'auth', 0);
    const c = GH.client(cfg);
    // 불러온 뒤 다른 곳(다른 PC 등)에서 자료가 바뀌었는지 확인: 바뀌었으면 덮어쓰지 않는다
    const latest = await c.getHead();
    const remote = new Map(); latest.files.forEach((sha, p) => { if (DATA_RE.test(p)) remote.set(p, sha); });
    const moved = [...new Set([...remote.keys(), ...state.savedShas.keys()])].filter(p => remote.get(p) !== state.savedShas.get(p));
    if (moved.length) {
      throw new GH.GitHubError(`불러온 뒤 GitHub의 자료 파일 ${moved.length}개가 다른 곳에서 바뀌었습니다. 덮어쓰지 않도록 반영을 멈췄습니다. 작업 내용은 이 브라우저에 보관되어 있으니, 새로고침 → 다시 불러오기 후 변경을 다시 적용해 주세요.`, 'conflict', 0);
    }
    clearTimeout(draftTimer);
    const { changed, deletions } = await diffOutputs(outputs);
    const files = changed.map(p => ({ path: p, content: outputs.files.get(p) }));
    // 예전 방식(본 저장소 pdf/ 폴더)의 원본 PDF: 새로 넣은 것은 조각으로 올리고, 지운 자료의 PDF는 함께 지운다.
    // 창고 방식 자료는 publishStorage에서 먼저 올라가므로 여기서는 건너뛴다.
    const pdfIds = pendingPdfIds().filter(id => { const d = getDoc(id); return d && d.pdf && !d.pdf.repo && !d.original; });
    for (let i = 0; i < pdfIds.length; i++) {
      const id = pdfIds[i], doc = getDoc(id);
      if (!doc || !doc.pdf) continue;
      const bytes = await readPending(id);
      const sha = await GH.gitBlobSha(bytes);
      if (latest.files.get(doc.pdf.path) !== sha) {
        if (onProgress) onProgress(i, pdfIds.length + 1);
        const got = await c.createBlob(bytes);
        files.push({ path: doc.pdf.path, sha: got || sha });
      }
    }
    const pdfDeletions = orphanPdfs(latest.files.keys());
    deletions.push(...pdfDeletions);
    // GitHub Pages가 data 폴더를 그대로 내보내도록(.nojekyll) 처음 한 번 만든다
    const hasNoJekyll = latest.files.has('.nojekyll');
    if (!hasNoJekyll) files.push({ path: '.nojekyll', content: '' });
    if (!files.length && !deletions.length) return { written: 0, deleted: 0, unchanged: true };
    const clientId = await getClientId();
    const r = await c.commit({ files, deletions, message: message + `\n\nSas-Admin-Client: ${clientId}`, parent: latest, onProgress });
    await rememberMyCommit(r.commitSha, latest.commitSha);
    // 반영 결과를 기준으로 지문 갱신
    for (const p of changed) {
      const text = outputs.files.get(p), sha = await GH.gitBlobSha(text);
      state.savedShas.set(p, sha);
      // 다음에 불러올 때 다시 받지 않도록 자료 파일은 캐시에 넣어 둔다
      if (/^data\/documents(\/|\.json$)|^data\/manifest\.json$/.test(p)) await kvSet('blob:' + sha, text);
    }
    deletions.forEach(p => state.savedShas.delete(p));
    for (const id of pdfIds) await dropPendingPdf(id);
    state.head = { commitSha: r.commitSha, treeSha: r.treeSha };
    state.generatedAt = outputs.manifest.generated_at;
    state.changedIds = new Set();
    state.status = 'published';
    await clearDraft();
    emit();
    return { written: files.length, deleted: deletions.length, pdfs: pdfIds.length, commitSha: r.commitSha };
  }

  // ---------- 원본 파일 창고(연도별 저장소) ----------
  /**
   * 반영 대기 중인 원본 파일을 창고에 배정한다(아직 올리지 않음). 반환 { repos, ids }
   */
  function planPendingStorage() {
    const ids = [...pendingPdfs.keys()].filter(id => getDoc(id));
    const r = root.SAS.planStorage(state.docs, ids, { prefix: (state.github && state.github.storagePrefix) || root.SAS.STORAGE_PREFIX });
    if (ids.length) markChanged();
    return { repos: r.repos, ids };
  }
  /** 창고 저장소마다 있는지·비었는지·Pages가 켜졌는지 확인. 반환 [{repo, ok, problem, pages}] */
  async function checkStorage(repos) {
    const cfg = state.github, out = [];
    for (const repo of repos) {
      const c = GH.client(Object.assign({}, cfg, { repo, branch: 'main' }));
      const it = { repo, ok: true, problem: '', pages: 'unknown', empty: false };
      try { const info = await c.api(''); it.branch = info.default_branch || 'main'; }
      catch (e) { it.ok = false; it.problem = e.status === 404 ? 'missing' : e.kind || 'other'; out.push(it); continue; }
      try { await c.getHead(); } catch (e) { if (e.status === 409 || e.kind === 'empty') it.empty = true; else { it.ok = false; it.problem = e.kind || 'other'; } }
      it.pages = await c.pagesStatus();
      out.push(it);
    }
    return out;
  }
  /**
   * 창고에 원본 파일을 올린다. 창고마다 약 200MB씩 나눠 커밋(중간에 끊겨도 올린 것은 남는다).
   * 올린 파일은 반영 대기에서 빠진다. 창고에서 더 이상 쓰지 않는 파일(교체·삭제된 자료)은 지운다.
   * onProgress(done, total, label)
   */
  async function publishStorage(onProgress) {
    const cfg = state.github;
    if (!cfg || !cfg.token) throw new GH.GitHubError('GitHub 출입증을 먼저 연결해 주세요.', 'auth', 0);
    const ids = [...pendingPdfs.keys()].filter(id => { const d = getDoc(id); return d && d.original && d.original.repo; });
    const byRepo = new Map();
    ids.forEach(id => { const r = getDoc(id).original.repo; if (!byRepo.has(r)) byRepo.set(r, []); byRepo.get(r).push(id); });
    // 지금 자료가 쓰는 창고 + 예전에 쓰던 창고(정리할 파일이 있을 수 있음)
    const known = new Set([...(await kvGet('storageRepos') || []), ...state.docs.filter(d => d.original && d.original.repo).map(d => d.original.repo)]);
    byRepo.forEach((_, r) => known.add(r));
    const total = ids.length; let done = 0, uploaded = 0;
    const pagesWarn = [];
    const BATCH = 200 * 1024 * 1024;
    for (const repo of [...known].sort()) {
      const c = GH.client(Object.assign({}, cfg, { repo, branch: 'main' }));
      let info;
      try { info = await c.api(''); }
      catch (e) {
        if (!byRepo.has(repo)) continue; // 예전 창고를 지웠으면 정리할 것도 없다
        if (e.status === 404) throw new GH.GitHubError(`창고 저장소 「${repo}」를 찾을 수 없습니다. GitHub에서 ${cfg.owner} 아래에 Public 저장소 「${repo}」를 만들고, 출입증이 이 저장소도 쓸 수 있게 해 주세요(출입증 설정 → Repository access).`, 'storage-missing', 404);
        throw e;
      }
      c.branch = info.default_branch || 'main';
      const cc = GH.client(Object.assign({}, cfg, { repo, branch: info.default_branch || 'main' }));
      let head;
      try { head = await cc.getHead(); }
      catch (e) {
        if (!(e.status === 409 || e.kind === 'empty')) throw e;
        await cc.initEmpty('.nojekyll', '', '창고 시작(관리자 도구)');
        head = await cc.getHead();
      }
      if (byRepo.has(repo) && (await cc.enablePages(info.default_branch || 'main')) === 'unknown' && (await cc.pagesStatus()) !== 'on') pagesWarn.push(repo);
      // 이 창고를 쓰는 자료의 파일 목록(지우면 안 되는 것)
      // 편집용 원본(PDF로 바꾸기 전 HWP 등)도 남긴다
      const keep = new Set(state.docs.flatMap(d => [d.original, d.edit]).filter(o => o && o.repo === repo).map(o => o.path));
      const deletions = [...head.files.keys()].filter(p => /^files\//.test(p) && !keep.has(p));
      const mine = byRepo.get(repo) || [];
      let batch = [], size = 0, batchIds = [];
      const flush = async (dels) => {
        if (!batch.length && !(dels && dels.length)) return;
        const r = await cc.commit({ files: batch, deletions: dels || [], message: `원본 파일 ${batch.length}개 올림${dels && dels.length ? `, ${dels.length}개 정리` : ''} (관리자 도구)`, parent: head });
        head = { commitSha: r.commitSha, treeSha: r.treeSha, files: head.files };
        for (const id of batchIds) await dropPendingPdf(id);
        batch = []; size = 0; batchIds = [];
      };
      if (!head.files.has('.nojekyll')) batch.push({ path: '.nojekyll', content: '' });
      for (const id of mine) {
        const doc = getDoc(id), o = doc.original;
        const bytes = await readPending(id);
        if (bytes.length > root.SAS.FILE_MAX) throw new GH.GitHubError(`「${doc.title}」 원본 파일이 ${(bytes.length / 1048576).toFixed(0)}MB라 올릴 수 없습니다(파일 하나 38MB까지). 용량을 줄인 파일로 바꿔 넣어 주세요.`, 'too-big', 0);
        o.bytes = bytes.length;
        if (onProgress) onProgress(done, total, `${repo} · ${o.name}`);
        const sha = await GH.gitBlobSha(bytes);
        if (head.files.get(o.path) !== sha) { await cc.createBlob(bytes); batch.push({ path: o.path, sha }); size += bytes.length; uploaded++; }
        batchIds.push(id); done++;
        if (size >= BATCH) await flush();
      }
      await flush(deletions);
    }
    await kvSet('storageRepos', [...known]);
    if (onProgress) onProgress(total, total, '');
    return { uploaded, total, pagesWarn };
  }
  /**
   * 원본 파일 다시 연결: 이름이 같은 파일을 자료에 붙인다. files: [File] → { attached, replaced }
   * - 원본이 없는 자료: 붙인다(같은 이름이 여럿이면 가장 작은 것).
   * - 반영 대기 중인 자료: 고른 파일이 더 작으면 바꾼다(용량을 줄인 PDF로 바꿔 넣기). 이미 창고에 올라간 자료는 건드리지 않는다.
   */
  async function attachOriginals(files) {
    const byName = new Map();
    files.forEach(f => { const k = root.SAS.norm(f.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(f); });
    byName.forEach(list => list.sort((a, b) => a.size - b.size));
    let attached = 0, replaced = 0;
    for (const d of state.docs) {
      if (!d.filename) continue;
      const list = byName.get(root.SAS.norm(d.filename)); if (!list) continue;
      const f = list[0];
      const pending = pendingPdfs.get(d.id);
      if (pending) {
        if (f.size >= pending.size) continue;
        await setPendingPdf(d.id, f);
        if (d.original) d.original.bytes = f.size;
        if (d.pdf) d.pdf.bytes = f.size;
        replaced++; continue;
      }
      if (d.original || d.pdf) continue;   // 이미 사이트·창고에 있는 자료
      d.original = root.SAS.makeOriginal(d.id, f.name, f.size, d.format === 'pdf' ? 'pdf' : root.SAS.formatOf(f.name));
      if (d.format === 'pdf') d.pdf = { repo: null, path: d.original.path, bytes: f.size };
      await setPendingPdf(d.id, f); attached++;
    }
    return { attached, replaced };
  }
  /** 반영 대기 중인데 너무 커서 올릴 수 없는 파일 */
  function pendingTooBig() {
    return [...pendingPdfs].filter(([id, b]) => getDoc(id) && b.size > root.SAS.FILE_MAX).map(([id, b]) => ({ id, name: getDoc(id).filename || getDoc(id).title, bytes: b.size }));
  }
  /** 원본 파일이 없는(내려받을 수 없는) 자료 */
  function docsWithoutOriginal() { return state.docs.filter(d => !d.works_url && !d.original && !d.pdf); }

  // ---------- 변경 감시 ----------
  // 이 브라우저(관리자 도구)가 만든 커밋을 기억해 두고, 그 밖의 커밋이 생기면 알린다.
  // 기준점(lastSeen): 관리자가 마지막으로 "확인"했거나, 이 도구가 마지막으로 반영한 커밋.
  const watchKey = () => `watch:${state.github.owner}/${state.github.repo}`;
  async function getClientId() {
    let id = await kvGet('clientId');
    if (!id) { id = Math.random().toString(36).slice(2, 10); await kvSet('clientId', id); }
    return id;
  }
  async function getWatch() { return (await kvGet(watchKey())) || { lastSeen: null, mine: [] }; }
  async function rememberMyCommit(sha, parentSha) {
    const w = await getWatch();
    w.mine = [sha, ...(w.mine || [])].slice(0, 300);
    // 반영 직전까지 확인되지 않은 변경이 없었을 때만 기준점을 옮긴다(사이에 낀 다른 변경을 덮어 숨기지 않도록)
    if (!w.lastSeen || w.lastSeen === parentSha) w.lastSeen = sha;
    await kvSet(watchKey(), w);
  }

  /**
   * 기준점 이후 이 PC의 관리자 도구가 만들지 않은 커밋을 찾는다.
   * 반환 { first, items:[{sha,date,author,title,fromTool,files,moreFiles}], overflow, headSha }
   */
  async function checkActivity() {
    const cfg = state.github;
    if (!cfg || !cfg.token) return { items: [] };
    const c = GH.client(cfg);
    const w = await getWatch();
    const commits = await c.listCommits(30);
    const headSha = commits.length ? commits[0].sha : null;
    if (!w.lastSeen) { w.lastSeen = headSha; await kvSet(watchKey(), w); return { first: true, items: [], headSha }; }
    const mine = new Set(w.mine || []);
    const newer = [];
    let found = false;
    for (const cm of commits) { if (cm.sha === w.lastSeen) { found = true; break; } newer.push(cm); }
    const items = newer.filter(cm => !mine.has(cm.sha)).map(cm => ({
      sha: cm.sha, date: cm.date, author: cm.author,
      title: cm.message.split('\n')[0].slice(0, 120),
      fromTool: /Sas-Admin-Client:/.test(cm.message)
    }));
    for (const it of items.slice(0, 8)) {
      try { const f = await c.commitFiles(it.sha); it.files = f.slice(0, 12); it.moreFiles = Math.max(0, f.length - 12); it.program = f.some(x => !/^data\//.test(x.path)); }
      catch (e) { it.files = []; }
    }
    if (!items.length && newer.length) { w.lastSeen = headSha; await kvSet(watchKey(), w); }
    return { items, overflow: !found, headSha };
  }
  async function acknowledgeActivity(headSha) {
    const w = await getWatch();
    w.lastSeen = headSha; await kvSet(watchKey(), w);
  }
  /** 최근 변경 기록(최신순) + 누가 했는지 구분 */
  async function recentActivity(n) {
    const c = GH.client(state.github);
    const w = await getWatch();
    const mine = new Set(w.mine || []);
    return (await c.listCommits(n || 20)).map(cm => ({
      sha: cm.sha, date: cm.date, author: cm.author, title: cm.message.split('\n')[0].slice(0, 120),
      who: mine.has(cm.sha) ? 'mine' : /Sas-Admin-Client:/.test(cm.message) ? 'tool' : 'other'
    }));
  }

  // ---------- 저장소 폴더 (예비) ----------
  const fsSupported = () => typeof root.showDirectoryPicker === 'function';
  async function dirAt(base, parts, create) { let d = base; for (const p of parts) d = await d.getDirectoryHandle(p, { create: !!create }); return d; }
  async function readText(base, path) { const parts = path.split('/'); const name = parts.pop(); const d = await dirAt(base, parts, false); return await (await (await d.getFileHandle(name)).getFile()).text(); }
  async function writeText(base, path, text) { const parts = path.split('/'); const name = parts.pop(); const d = await dirAt(base, parts, true); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(text); await w.close(); }
  async function removePath(base, path) { const parts = path.split('/'); const name = parts.pop(); try { const d = await dirAt(base, parts, false); await d.removeEntry(name); return true; } catch (e) { return false; } }
  async function listFiles(dir, prefix, out) { for await (const [name, h] of dir.entries()) { const p = prefix ? prefix + '/' + name : name; if (h.kind === 'directory') await listFiles(h, p, out); else out.push(p); } return out; }
  async function verifyPermission(handle) {
    if (typeof handle.queryPermission !== 'function') return true;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }
  async function loadFolder(handle, onProgress) {
    if (!(await verifyPermission(handle))) throw new Error('폴더 쓰기 권한이 허용되지 않았습니다.');
    let existing = [];
    try { existing = await listFiles(await handle.getDirectoryHandle('data'), 'data', []); } catch (e) { existing = []; }
    const shas = new Map(), docs = [];
    let generatedAt = null;
    if (existing.includes('data/documents.json')) {
      const listText = await readText(handle, 'data/documents.json');
      const list = parseDocList(listText);
      for (let i = 0; i < list.length; i++) {
        const p = `data/documents/${list[i].id}.json`;
        try { docs.push(JSON.parse(await readText(handle, p))); } catch (e) { throw new Error(`${p} 파일을 읽지 못했습니다.`); }
        if (onProgress) onProgress(i + 1, list.length);
      }
      for (const p of existing.filter(p => DATA_RE.test(p))) {
        const t = await readText(handle, p);
        shas.set(p, await GH.gitBlobSha(t));
        if (p === 'data/manifest.json') { try { generatedAt = JSON.parse(t).generated_at; } catch (e) { /* 무시 */ } }
      }
    }
    state.folder = handle;
    await kvSet('folder', handle);
    setLoaded('folder', '📁 ' + handle.name, docs, shas, generatedAt);
    return { count: docs.length, isRepo: existing.length > 0 };
  }
  async function pickFolder(onProgress) {
    if (!fsSupported()) throw new Error('이 브라우저는 폴더 저장을 지원하지 않습니다. 웨일·크롬·엣지를 사용해 주세요.');
    return loadFolder(await root.showDirectoryPicker({ id: 'sas-repo', mode: 'readwrite' }), onProgress);
  }
  async function saveToFolder(outputs, onProgress) {
    if (!state.folder) throw new Error('저장소 폴더를 먼저 열어 주세요.');
    if (!(await verifyPermission(state.folder))) throw new Error('폴더 쓰기 권한이 없습니다.');
    const { changed, deletions } = await diffOutputs(outputs);
    let done = 0;
    for (const p of changed) { const t = outputs.files.get(p); await writeText(state.folder, p, t); state.savedShas.set(p, await GH.gitBlobSha(t)); if (onProgress) onProgress(++done, changed.length + deletions.length); }
    for (const p of deletions) { await removePath(state.folder, p); state.savedShas.delete(p); if (onProgress) onProgress(++done, changed.length + deletions.length); }
    for (const id of pendingPdfIds()) {
      const doc = getDoc(id); if (!doc || !doc.pdf) continue;
      const parts = doc.pdf.path.split('/'); const name = parts.pop(); const d = await dirAt(state.folder, parts, true);
      const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(pendingPdfs.get(id)); await w.close();
      await dropPendingPdf(id);
    }
    state.generatedAt = outputs.manifest.generated_at;
    state.changedIds = new Set(); state.status = 'exported';
    await clearDraft(); emit();
    return { written: changed.length, deleted: deletions.length };
  }

  // ---------- ZIP (예비) ----------
  async function buildZip(outputs, changedOnly) {
    if (!root.JSZip) throw new Error('ZIP 도구를 불러오지 못했습니다.');
    const zip = new root.JSZip();
    let paths = [...outputs.files.keys()], deletions = [];
    if (changedOnly) { const d = await diffOutputs(outputs); paths = d.changed; deletions = d.deletions; }
    paths.forEach(p => zip.file(p, outputs.files.get(p)));
    for (const id of pendingPdfIds()) { const doc = getDoc(id); if (doc && doc.pdf) { zip.file(doc.pdf.path, pendingPdfs.get(id)); paths.push(doc.pdf.path); } }
    if (deletions.length) zip.file('삭제할_파일_목록.txt', '저장소에서 아래 파일을 직접 삭제해 주세요.\n\n' + deletions.join('\n'));
    return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), count: paths.length, deletions: deletions.length };
  }
  function markExported() { state.status = 'exported'; state.changedIds = new Set(); clearDraft(); emit(); }
  function markPublished() { state.status = state.docs.length ? 'clean' : 'empty'; emit(); }
  async function loadZip(file) {
    if (!root.JSZip) throw new Error('ZIP 도구를 불러오지 못했습니다.');
    const zip = await root.JSZip.loadAsync(file);
    const names = Object.keys(zip.files).filter(n => /(^|\/)data\/documents\/doc-[^/]+\.json$/.test(n));
    if (!names.length) throw new Error('ZIP 안에서 data/documents/ 자료를 찾지 못했습니다.');
    const docs = [];
    for (const n of names) docs.push(JSON.parse(await zip.file(n).async('string')));
    setLoaded('zip', '🗜 ' + file.name, docs, new Map(), null);
    return docs.length;
  }

  // ---------- 임시 보관 ----------
  async function getDraft() { return kvGet('draft'); }
  async function restoreDraft(draft) { state.docs = draft.docs || []; state.status = 'unsaved'; draft.docs.forEach(d => state.changedIds.add(d.id)); await restorePendingPdfs(); emit(); }
  async function discardDraft() { await clearDraft(); for (const k of await kvKeys('pdf:')) await kvDel(k); pendingPdfs.clear(); }
  async function lastFolderName() { const h = await kvGet('folder'); return h ? h.name : ''; }
  async function reopenLastFolder(onProgress) { const h = await kvGet('folder'); if (!h) throw new Error('지난번에 연 폴더 기록이 없습니다.'); return loadFolder(h, onProgress); }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  root.SASStore = {
    setPendingPdf, readPending, dropPendingPdf, pendingPdfIds, pdfPath, orphanPdfs, planPendingStorage, checkStorage, publishStorage, attachOriginals, pendingTooBig, docsWithoutOriginal,
    STATUS, state, onChange, dataDigest, markChanged, getDoc, addDocs, replaceDoc, removeDoc, touch, allIds, diffOutputs,
    kvGet, kvSet, loadGithubConfig, connectGithub, setExpiry, forgetToken, checkActivity, acknowledgeActivity, recentActivity, loadFromGithub, publishToGithub,
    fsSupported, pickFolder, reopenLastFolder, saveToFolder, buildZip, markExported, markPublished, loadZip,
    getDraft, restoreDraft, discardDraft, lastFolderName, download
  };
})(typeof self !== 'undefined' ? self : this);
