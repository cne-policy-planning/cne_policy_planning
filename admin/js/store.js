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
  const DATA_RE = /^data\/(documents|indexes|search)\/|^data\/(documents|manifest)\.json$/;

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
      const list = JSON.parse(await read('data/documents.json')).documents || [];
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
    // GitHub Pages가 data 폴더를 그대로 내보내도록(.nojekyll) 처음 한 번 만든다
    const hasNoJekyll = latest.files.has('.nojekyll');
    if (!hasNoJekyll) files.push({ path: '.nojekyll', content: '' });
    if (!files.length && !deletions.length) return { written: 0, deleted: 0, unchanged: true };
    const r = await c.commit({ files, deletions, message, parent: latest, onProgress });
    // 반영 결과를 기준으로 지문 갱신
    for (const p of changed) {
      const text = outputs.files.get(p), sha = await GH.gitBlobSha(text);
      state.savedShas.set(p, sha);
      // 다음에 불러올 때 다시 받지 않도록 자료 파일은 캐시에 넣어 둔다
      if (/^data\/documents(\/|\.json$)|^data\/manifest\.json$/.test(p)) await kvSet('blob:' + sha, text);
    }
    deletions.forEach(p => state.savedShas.delete(p));
    state.head = { commitSha: r.commitSha, treeSha: r.treeSha };
    state.generatedAt = outputs.manifest.generated_at;
    state.changedIds = new Set();
    state.status = 'published';
    await clearDraft();
    emit();
    return { written: changed.length, deleted: deletions.length, commitSha: r.commitSha };
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
      const list = JSON.parse(listText).documents || [];
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
  async function restoreDraft(draft) { state.docs = draft.docs || []; state.status = 'unsaved'; draft.docs.forEach(d => state.changedIds.add(d.id)); emit(); }
  async function discardDraft() { await clearDraft(); }
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
    STATUS, state, onChange, dataDigest, markChanged, getDoc, addDocs, replaceDoc, removeDoc, touch, allIds, diffOutputs,
    kvGet, kvSet, loadGithubConfig, connectGithub, forgetToken, loadFromGithub, publishToGithub,
    fsSupported, pickFolder, reopenLastFolder, saveToFolder, buildZip, markExported, markPublished, loadZip,
    getDraft, restoreDraft, discardDraft, lastFolderName, download
  };
})(typeof self !== 'undefined' ? self : this);
