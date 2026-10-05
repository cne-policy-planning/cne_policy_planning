/*
 * 관리자 도구 · GitHub 바로 올리기 (브라우저 전용)
 *
 * - 저장소: 사이트 주소(아이디.github.io/저장소/admin/)에서 자동으로 알아낸다.
 * - 출입증(세분화된 개인 액세스 토큰): 이 저장소의 Contents 읽기·쓰기 권한만 필요하다.
 *   관리자 PC 브라우저에만 보관하며, 공개 사이트 파일에는 절대 넣지 않는다.
 * - 올리기: Git Data API로 바뀐 파일만 담은 커밋 하나를 만든다(파일 내용은 트리 요청에 직접 담음).
 */
(function (root) {
  'use strict';
  const API = 'https://api.github.com';
  const TREE_CHUNK_BYTES = 4 * 1024 * 1024; // 트리 요청 하나에 담을 최대 크기

  class GitHubError extends Error {
    constructor(message, kind, status) { super(message); this.kind = kind; this.status = status; }
  }

  /** 사이트 주소에서 아이디·저장소 이름 알아내기 */
  function detectRepo(loc) {
    loc = loc || root.location;
    const m = String(loc.hostname || '').match(/^([a-z0-9-]+)\.github\.io$/i);
    if (!m) return null;
    const owner = m[1];
    const first = String(loc.pathname || '/').split('/').filter(Boolean)[0];
    const repo = !first || first === 'admin' ? `${owner}.github.io` : decodeURIComponent(first);
    return { owner, repo };
  }

  function parseRepo(text) {
    const s = String(text || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
    let m = s.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i) || s.match(/^([a-z0-9-]+)\.github\.io\/([^/\s]+)/i) || s.match(/^([a-z0-9-]+)\/([A-Za-z0-9._-]+)$/i);
    return m ? { owner: m[1], repo: m[2] } : null;
  }

  function client(cfg) {
    const base = `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
    let lastExpiry = null;

    async function api(path, opts) {
      opts = opts || {};
      let res;
      try {
        res = await fetch(path.startsWith('http') ? path : base + path, {
          method: opts.method || 'GET',
          headers: Object.assign({
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer ' + cfg.token,
            'X-GitHub-Api-Version': '2022-11-28'
          }, opts.body ? { 'Content-Type': 'application/json' } : {}),
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          cache: 'no-store'
        });
      } catch (e) {
        throw new GitHubError('GitHub에 접속하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'network', 0);
      }
      // 브라우저가 허용하는 경우에만 읽힌다(대부분 읽히지 않음)
      const exp = res.headers.get('github-authentication-token-expiration');
      if (exp) lastExpiry = exp;
      if (res.ok) return res.status === 204 ? null : res.json();
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* 무시 */ }
      if (res.status === 401) throw new GitHubError('출입증이 올바르지 않거나 만료되었습니다. 새 출입증을 발급해 연결해 주세요.', 'auth', 401);
      if (res.status === 403 && /rate limit/i.test(detail)) throw new GitHubError('GitHub 사용 한도에 잠시 걸렸습니다. 10분쯤 뒤 다시 시도해 주세요.', 'rate', 403);
      if (res.status === 403) throw new GitHubError('출입증에 이 저장소의 쓰기 권한이 없습니다. 출입증 권한에서 Contents를 "Read and write"로 설정했는지 확인해 주세요.', 'permission', 403);
      if (res.status === 404) throw new GitHubError(`저장소 ${cfg.owner}/${cfg.repo}를 찾을 수 없습니다. 저장소 이름과, 출입증을 만들 때 이 저장소를 선택했는지 확인해 주세요.`, 'notfound', 404);
      if (res.status === 409) throw new GitHubError('저장소가 비어 있습니다. GitHub에서 README 파일을 하나 만든 뒤 다시 시도해 주세요.', 'empty', 409);
      if (res.status === 422 && opts.method === 'PATCH') throw new GitHubError('그 사이 저장소가 다른 곳에서 바뀌었습니다. 새로고침한 뒤 다시 반영해 주세요.', 'conflict', 422);
      throw new GitHubError(`GitHub 오류(${res.status}): ${detail}`, 'other', res.status);
    }

    /** 현재 main의 커밋·트리와 파일 목록(path → blob sha) */
    async function getHead() {
      const ref = await api(`/git/ref/heads/${encodeURIComponent(cfg.branch || 'main')}`);
      const commit = await api(`/git/commits/${ref.object.sha}`);
      const tree = await api(`/git/trees/${commit.tree.sha}?recursive=1`);
      if (tree.truncated) throw new GitHubError('저장소 파일이 너무 많아 목록을 다 읽지 못했습니다.', 'other', 0);
      const files = new Map();
      (tree.tree || []).forEach(e => { if (e.type === 'blob') files.set(e.path, e.sha); });
      return { commitSha: ref.object.sha, treeSha: commit.tree.sha, files };
    }

    async function getBlobText(sha) {
      const b = await api(`/git/blobs/${sha}`);
      if (b.encoding !== 'base64') return b.content;
      const bin = atob(String(b.content).replace(/\s/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }

    /** 연결 확인: 저장소 읽기 + 쓰기 권한(보이지 않는 빈 조각 하나 만들기) */
    async function verify() {
      const repo = await api('');
      cfg.branch = cfg.branch || repo.default_branch || 'main';
      const head = await getHead();
      await api('/git/blobs', { method: 'POST', body: { content: '', encoding: 'utf-8' } });
      return { repo, head, expiry: lastExpiry };
    }

    /**
     * 바뀐 파일과 지울 파일로 커밋 하나를 만든다.
     * files: [{path, content}], deletions: [path], parent: {commitSha, treeSha}
     */
    async function commit({ files, deletions, message, parent, onProgress }) {
      let treeSha = parent.treeSha;
      const entries = files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }))
        .concat((deletions || []).map(p => ({ path: p, mode: '100644', type: 'blob', sha: null })));
      const enc = new TextEncoder();
      let batch = [], size = 0, done = 0;
      const flush = async () => {
        if (!batch.length) return;
        const t = await api('/git/trees', { method: 'POST', body: { base_tree: treeSha, tree: batch } });
        treeSha = t.sha; done += batch.length; batch = []; size = 0;
        if (onProgress) onProgress(done, entries.length);
      };
      for (const e of entries) {
        const n = e.content ? enc.encode(e.content).length : 100;
        if (size + n > TREE_CHUNK_BYTES && batch.length) await flush();
        batch.push(e); size += n;
      }
      await flush();
      if (treeSha === parent.treeSha) return { commitSha: parent.commitSha, treeSha, unchanged: true };
      const c = await api('/git/commits', { method: 'POST', body: { message, tree: treeSha, parents: [parent.commitSha] } });
      await api(`/git/refs/heads/${encodeURIComponent(cfg.branch || 'main')}`, { method: 'PATCH', body: { sha: c.sha, force: false } });
      return { commitSha: c.sha, treeSha };
    }

    /** 최근 커밋 목록(최신순) */
    async function listCommits(perPage) {
      const list = await api(`/commits?sha=${encodeURIComponent(cfg.branch || 'main')}&per_page=${perPage || 30}`);
      return (list || []).map(c => ({
        sha: c.sha,
        message: (c.commit && c.commit.message) || '',
        date: (c.commit && ((c.commit.committer && c.commit.committer.date) || (c.commit.author && c.commit.author.date))) || null,
        author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || '알 수 없음',
        parents: (c.parents || []).map(p => p.sha)
      }));
    }
    /** 커밋 하나에서 바뀐 파일 */
    async function commitFiles(sha) {
      const c = await api(`/commits/${sha}`);
      return (c.files || []).map(f => ({ path: f.filename, status: f.status }));
    }

    return { api, getHead, getBlobText, verify, commit, listCommits, commitFiles, get lastExpiry() { return lastExpiry; } };
  }

  /** git이 쓰는 파일 지문(blob SHA-1). 바뀐 파일만 올리기 위해 비교한다 */
  async function gitBlobSha(text) {
    const body = new TextEncoder().encode(text);
    const head = new TextEncoder().encode(`blob ${body.length}\0`);
    const all = new Uint8Array(head.length + body.length);
    all.set(head); all.set(body, head.length);
    const d = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- 출입증 만료일 ----------
  const DAY = 86400000;
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  function ymd(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }

  /** 남은 날짜와 알림 단계: ok(31일 이상) · month(30일 이하) · week(7일 이하) · day(1일 이하) · expired */
  function expiryInfo(expiresAt, now) {
    if (!expiresAt) return { level: 'unknown', days: null };
    const end = new Date(expiresAt); end.setHours(23, 59, 59, 0);
    const today = new Date(now || Date.now()); today.setHours(0, 0, 0, 0);
    const days = Math.floor((end - today) / DAY);
    const level = days < 0 ? 'expired' : days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 30 ? 'month' : 'ok';
    return { level, days, date: ymd(end) };
  }
  const LEVEL_RANK = { unknown: 0, ok: 0, month: 1, week: 2, day: 3, expired: 4 };

  /** 휴대폰 캘린더용 일정 파일(.ics): 만료 30일·7일·1일 전과 당일, 오전 9시 알림 */
  function calendarFile(expiresAt, repoLabel) {
    const end = new Date(expiresAt);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const at9kst = d => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)); return x.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); };
    const fold = s => s.replace(/[,;\\]/g, m => '\\' + m);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // 이미 지난 알림 날짜는 넣지 않는다
    const events = [[30, '만료 30일 전'], [7, '만료 1주 전'], [1, '만료 1일 전'], [0, '오늘 만료']].filter(([n]) => addDays(end, -n) >= today).map(([n, label]) => {
      const d = addDays(end, -n);
      const start = at9kst(d), finish = at9kst(d).replace(/T000000Z$/, 'T003000Z');
      return ['BEGIN:VEVENT', `UID:sas-token-${ymd(end)}-${n}@school-search`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${finish}`,
        `SUMMARY:${fold(`[통합검색] GitHub 출입증 ${label}`)}`,
        `DESCRIPTION:${fold(`${repoLabel} 관리자 도구의 GitHub 출입증이 ${ymd(end)}에 만료됩니다. GitHub에서 새 출입증을 발급해 관리자 도구에 붙여 넣으세요.`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:GitHub 출입증 만료 알림', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'].join('\r\n');
    });
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//school-search//token-reminder//KO', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }

  root.SASGitHub = { GitHubError, detectRepo, parseRepo, client, gitBlobSha, expiryInfo, LEVEL_RANK, calendarFile, addDays, ymd };
})(typeof self !== 'undefined' ? self : this);
