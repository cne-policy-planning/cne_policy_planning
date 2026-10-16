/*
 * 교무업무 통합검색 · 사용자 화면
 *  - 첫 화면: 학교급 카드
 *  - 학교급 화면(충교위키식 3단): 왼쪽 자료 목록 · 가운데 번호 목차(또는 검색 결과) · 오른쪽 원문 쪽 보기
 *  - 주소: #/학교급  ·  #/학교급/자료ID  ·  #/학교급/자료ID/목차번호  ·  #/학교급?q=검색어&t=서식
 */
(function () {
  'use strict';
  const SAS = window.SAS, SS = window.SASSearch;
  const $ = id => document.getElementById(id);
  const TYPES = ['서식', '참고', '법령', '사이트'];
  const TYPE_SHORT = { 서식: '서', 참고: '참', 법령: '법', 사이트: '누리' };
  const TYPE_PREFIX = { 서: '서식', 참: '참고', 법: '법령', 사: '사이트' };
  const VENDOR = 'assets/vendor/pdfjs/';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isNarrow = () => matchMedia('(max-width: 900px)').matches;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const esc = s => SAS.esc(String(s == null ? '' : s));
  const cut = (s, n) => (s = String(s || '')).length > n ? s.slice(0, n) + '…' : s;
  let toastTimer;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3600); }

  const loader = SS.createLoader(window.fetch.bind(window), '');
  let manifest = null;

  // ---------- 주소 ----------
  function parseHash() {
    const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const slug = SAS.levelName(parts[0]) ? parts[0] : null;
    const p = new URLSearchParams(query || '');
    return { slug, doc: parts[1] || '', code: parts[2] || '', q: p.get('q') || '', t: TYPES.includes(p.get('t')) ? p.get('t') : '', p: /^\d+$/.test(p.get('p') || '') ? Number(p.get('p')) : null };
  }
  function hashFor(r) {
    let s = `#/${r.slug}`;
    if (r.doc) s += '/' + encodeURIComponent(r.doc) + (r.code ? '/' + r.code : '');
    const p = new URLSearchParams();
    if (r.q) p.set('q', r.q);
    if (r.t) p.set('t', r.t);
    if (r.p != null && r.doc && !r.code) p.set('p', r.p);
    const qs = p.toString();
    return s + (qs ? '?' + qs : '');
  }
  /** 주소만 바꾸고 다시 그리지 않는다(스크롤에 따른 현재위치 표시용) */
  function quietHash(r) { const nh = hashFor(r); if (location.hash !== nh) history.replaceState(null, '', nh); }

  // ---------- 시작 ----------
  async function init() {
    try { manifest = await loader.manifest(); }
    catch (e) { manifest = { levels: {} }; }
    window.addEventListener('hashchange', route);
    route();
  }

  function route() {
    const r = parseHash();
    if (!r.slug) return renderHome();
    openLevel(r);
  }

  // ---------- 첫 화면 ----------
  function renderHome() {
    document.title = '교무업무 통합검색';
    document.body.classList.remove('viewing');
    $('home').classList.remove('hidden'); $('level').classList.add('hidden'); $('levelNav').classList.add('hidden');
    $('levelCards').replaceChildren(...SAS.LEVELS.map(l => {
      const info = (manifest && manifest.levels && manifest.levels[l.slug]) || { documents: 0 };
      return h('a', { class: `level-card ${l.slug}` + (info.documents ? '' : ' no-docs'), href: `#/${l.slug}` },
        h('img', { src: `assets/img/level-${l.slug}.png`, alt: '', width: 104, height: 104 }),
        h('span', { class: 'name' }, l.name),
        h('span', { class: 'count' }, info.documents ? `자료 ${info.documents}건` : '자료 준비 중'));
    }));
  }
  function renderNav(slug) {
    const nav = $('levelNav');
    nav.replaceChildren(...SAS.LEVELS.map(l => h('a', { href: `#/${l.slug}`, class: l.slug === slug ? 'active' : null, 'aria-current': l.slug === slug ? 'page' : null }, l.name)));
    nav.classList.remove('hidden');
  }

  // ---------- 학교급 화면 상태 ----------
  const V = {
    slug: null, index: null, docs: new Map(),   // 자료ID → 목차가 준비된 상세
    doc: null, nodes: [], by: {}, kids: {}, open: new Set(), cur: null,
    q: '', t: '', mode: 'home', zoom: 1, pdf: null, pdfTask: null, renderToken: 0, observer: null
  };
  try { V.zoom = Number(localStorage.getItem('sas-zoom')) || 1; } catch (e) { /* 무시 */ }

  async function openLevel(r) {
    const name = SAS.levelName(r.slug);
    document.body.classList.add('viewing');
    $('home').classList.add('hidden'); $('level').classList.remove('hidden');
    renderNav(r.slug);
    if (V.slug !== r.slug) {
      V.slug = r.slug; V.index = null; V.doc = null;
      $('docList').replaceChildren(h('div', { class: 'v-empty' }, h('span', { class: 'spinner' }), ' 자료 목록을 불러오는 중…'));
      $('tree').replaceChildren(); $('pages').replaceChildren(); $('crumb').replaceChildren(); $('docTitle').textContent = ''; $('docStats').replaceChildren();
      try { V.index = await loader.level(r.slug); }
      catch (e) {
        V.index = { docs: [], sections: [] };
        const msg = e.status === 404 ? `${name} 자료는 아직 준비 중입니다.` : '자료 목록을 불러오지 못했습니다. 새로고침해 주세요.';
        $('docList').replaceChildren(h('div', { class: 'v-empty' }, msg));
        $('tree').replaceChildren(h('div', { class: 'v-empty' }, msg));
        return;
      }
      if (parseHash().slug !== r.slug) return;
    }
    const docs = V.index.docs || [];
    $('docsLabel').textContent = `← ${name} 자료 ${docs.length}건`;
    $('docsLabel').href = `#/${r.slug}`;
    V.q = r.q; V.t = r.t;
    if ($('q').value !== r.q) $('q').value = r.q;
    // 학교급 첫 화면: 자료 목록과 검색(문서를 바로 열지 않는다)
    if (!r.doc || !docs.some(d => d.id === r.doc)) { setMode('home'); return renderLevelHome(r); }
    setMode('doc');
    if (!V.doc || V.doc.id !== r.doc) await selectDoc(r.doc);
    if (!V.doc) return;
    renderStats(); renderChips(V.nodes);
    document.title = (r.q ? `${r.q} - ` : '') + `${V.doc.title} · ${name} · 교무업무 통합검색`;
    if (r.code && V.by[r.code] && (!V.cur || V.cur.c !== r.code)) go(r.code, { fromHash: true });
    else {
      renderToc();
      if (r.p != null && pageEl(r.p)) { lockSpy = 0; requestAnimationFrame(() => scrollToPos(r.p, 0, false)); if (isNarrow()) show('doc', true); }
    }
  }

  function setMode(mode) {
    V.mode = mode;
    $('levelHome').classList.toggle('hidden', mode !== 'home');
    $('cols').classList.toggle('hidden', mode !== 'doc');
    document.querySelector('.v-tabs').classList.toggle('hidden', mode !== 'doc');
    document.body.classList.toggle('level-home', mode === 'home');
    if (mode !== 'home') $('homeResults').replaceChildren();
  }

  // ---------- 학교급 첫 화면 ----------
  async function renderLevelHome(r) {
    const name = SAS.levelName(r.slug);
    const docs = V.index.docs || [];
    document.title = (r.q ? `${r.q} - ` : '') + `${name} 자료 · 교무업무 통합검색`;
    if (!docs.length) {
      $('homeHead').replaceChildren(h('h1', {}, `${name} 자료`));
      $('homeDocs').replaceChildren(h('div', { class: 'v-empty' }, `${name} 자료는 아직 준비 중입니다. 다른 학교급을 골라 보세요.`));
      $('homeResults').replaceChildren(); $('docStats').replaceChildren(); $('typeChips').replaceChildren(); return;
    }
    $('homeHead').replaceChildren(h('h1', {}, `${name} 자료 ${docs.length}건`), h('p', {}, '자료를 누르면 왼쪽 목차와 오른쪽 원문이 함께 열립니다. 위 검색창에서 모든 자료의 목차·서식·본문을 한꺼번에 찾을 수 있습니다.'));
    const preps = [];
    for (const d of docs) { try { preps.push(await loadDoc(d.id)); } catch (e) { /* 못 불러온 자료는 목록 정보만 */ } }
    if (parseHash().doc || V.mode !== 'home') return;
    const all = preps.flatMap(p => p.nodes);
    const count = (list, f) => list.filter(f).length;
    $('docStats').replaceChildren(...[[`${name} 자료`, docs.length + '건'], ['업무', count(all, x => x.k === 'task')], ['세부 항목', count(all, x => ['group', 'item', 'bullet'].includes(x.k))]]
      .map(([a, b]) => h('span', { class: 'st' }, a, ' ', h('b', {}, b))));
    renderChips(all);
    if (V.q || V.t) {
      // 검색하면 3단 화면으로: 찾은 항목이 가장 많은 자료를 열고 가운데에 검색 결과를 보여 준다
      const res = buildResults(preps, V.q, V.t, true);
      const best = Object.entries(res.byDoc).sort((a, b) => b[1] - a[1])[0];
      if (res.total && best) { location.replace(hashFor({ slug: r.slug, doc: best[0], q: V.q, t: V.t })); return; }
      $('homeDocs').classList.add('hidden');
      $('homeResults').innerHTML = res.head + res.body;
      return;
    }
    $('homeDocs').classList.remove('hidden');
    $('homeResults').replaceChildren();
    $('homeDocs').replaceChildren(...docs.map(d => {
      const p = preps.find(x => x.id === d.id);
      const n = p ? p.nodes : [];
      const chs = n.filter(x => x.k === 'ch').map(x => x.t).slice(0, 6);
      const raw = p ? p.raw : {};
      return h('a', { class: 'lv-doc', href: hashFor({ slug: r.slug, doc: d.id }) },
        h('div', { class: 'lv-doc-top' }, h('span', { class: 'lv-fmt' }, (d.f || '').toUpperCase()), d.c ? h('span', { class: 'lv-cat' }, d.c) : null),
        h('h2', {}, d.t),
        h('div', { class: 'lv-meta' }, [d.y ? d.y + '년' : '', d.f === 'pdf' && d.n ? d.n + '쪽' : '', raw.origin && raw.origin.site ? '출처 ' + raw.origin.site : ''].filter(Boolean).join(' · ')),
        n.length ? h('div', { class: 'lv-counts' }, ...[['업무', count(n, x => x.k === 'task')], ['서식', count(n, x => x.ty === '서식')], ['참고', count(n, x => x.ty === '참고')], ['법령', count(n, x => x.ty === '법령')]]
          .filter(([, v]) => v).map(([a, v]) => h('span', {}, a, ' ', h('b', {}, v)))) : null,
        chs.length ? h('div', { class: 'lv-chs' }, ...chs.map(c => h('span', {}, c))) : null,
        h('span', { class: 'lv-open' }, '목차와 원문 보기 →'));
    }));
  }
  // 첫 화면 검색 결과에서 고르면 그 자료의 그 위치로 연다
  $('homeResults').addEventListener('click', e => {
    if (e.target.closest('a.open')) return;
    if (e.target.id === 'clearSearch') { setRoute({ q: '', t: '' }); return; }
    const r = e.target.closest('.row, .row-go'); if (!r || !r.dataset.d) return;
    location.hash = r.dataset.page != null ? hashFor({ slug: V.slug, doc: r.dataset.d, p: Number(r.dataset.page) }) : hashFor({ slug: V.slug, doc: r.dataset.d, code: r.dataset.c });
  });

  // ---------- 자료 불러오기와 목차 준비 ----------
  async function loadDoc(id) {
    if (V.docs.has(id)) return V.docs.get(id);
    const d = await loader.doc(id);
    const nodes = d.outline && d.outline.nodes ? d.outline.nodes.map(n => Object.assign({}, n)) : fallbackOutline(d);
    const links = new Map((d.links || []).map(l => [l.id, l]));
    const prep = { id: d.id, title: d.title, raw: d, nodes, by: {}, kids: {} };
    nodes.forEach((n, i) => {
      n.i = i;
      if (n.l && links.has(n.l)) { const l = links.get(n.l); n.link = l; n.t = l.text || n.t; n.ty = l.type || typeFromKind(l); }
      prep.by[n.c] = n;
      n.p = n.c.includes('.') ? n.c.slice(0, n.c.lastIndexOf('.')) : '';
      (prep.kids[n.p] = prep.kids[n.p] || []).push(n);
    });
    V.docs.set(id, prep);
    return prep;
  }
  function typeFromKind(l) { return l.kind === 'law' ? '법령' : l.kind === 'site' ? '사이트' : '서식'; }
  /** 번호 목차가 없는 예전 자료: 업무 목록과 링크로 간단한 목차를 만든다 */
  function fallbackOutline(d) {
    const nodes = [];
    let ch = null, ci = 0, ti = 0;
    (d.sections || []).forEach(s => {
      const name = s.parent_heading || '본문';
      if (!ch || ch.t !== name) { ch = { c: String(++ci), k: 'ch', t: name, b: s.block_start, y: 0 }; nodes.push(ch); ti = 0; }
      const tc = `${ch.c}.${++ti}`;
      // 목차 없이 길이로 나눈 구간은 제목이 아니므로 구간 번호를 붙여 구분한다
      const untitled = SAS.isUntitled ? SAS.isUntitled(d, s) : false;
      nodes.push({ c: tc, k: 'task', t: untitled ? `구간 ${ti} · ${s.heading}` : s.heading, b: s.block_start, y: 0 });
      (d.links || []).filter(l => l.section_id === s.id).forEach((l, i) => nodes.push({ c: `${tc}.${i + 1}`, k: 'link', t: l.text, b: l.block, y: 0, l: l.id }));
    });
    return nodes;
  }

  async function selectDoc(id) {
    renderDocList(id);
    $('tree').replaceChildren(h('div', { class: 'v-empty' }, h('span', { class: 'spinner' }), ' 목차를 불러오는 중…'));
    let prep;
    try { prep = await loadDoc(id); }
    catch (e) { $('tree').replaceChildren(h('div', { class: 'v-empty' }, '자료를 불러오지 못했습니다. 새로고침해 주세요.')); return; }
    V.doc = prep; V.nodes = prep.nodes; V.by = prep.by; V.kids = prep.kids; V.cur = null;
    V.open = new Set(prep.nodes.filter(n => n.k === 'ch').map(n => n.c));
    $('docTitle').textContent = prep.title;
    renderStats();
    crumb(null);
    renderToc();
    await renderPages();
  }

  function renderDocList(activeId) {
    const docs = (V.index && V.index.docs) || [];
    $('docList').replaceChildren(...docs.map(d => h('a', { class: 'v-doc' + (d.id === activeId ? ' on' : ''), href: hashFor({ slug: V.slug, doc: d.id }), 'aria-current': d.id === activeId ? 'true' : null },
      h('b', {}, d.t), h('span', {}, [d.y ? d.y + '년' : '', d.f === 'pdf' && d.n ? d.n + '쪽' : '', (d.f || '').toUpperCase(), d.f === 'pdf' && !d.p ? '쪽 보기 준비 중' : ''].filter(Boolean).join(' · ')))));
  }
  /** 검색창 아래 줄: 이 자료의 업무·세부 항목 수와 출처 (서식·참고·법령·사이트 수는 옆의 종류 단추에) */
  function renderStats() {
    const n = V.nodes, raw = V.doc.raw;
    const count = f => n.filter(f).length;
    $('docStats').replaceChildren(h('span', { class: 'st st-doc' }, '이 자료'),
      ...[['업무', count(x => x.k === 'task')], ['세부 항목', count(x => ['group', 'item', 'bullet'].includes(x.k))]].map(([a, b]) => h('span', { class: 'st' }, a, ' ', h('b', {}, b))),
      raw.origin && raw.origin.site ? h('span', { class: 'st muted' }, `출처 ${raw.origin.site}${raw.year ? ' · ' + raw.year : ''}`) : null);
  }

  // ---------- 가운데: 목차 / 검색 결과 ----------
  const ancIn = (by, n) => { const a = []; while (n) { a.unshift(n); n = by[n.p]; } return a; };
  const anc = n => ancIn(V.by, n);
  function pp(raw, b) { const bl = raw.blocks && raw.blocks[b]; return bl ? (bl.printed_page != null ? bl.printed_page + 'p' : (bl.pdf_page ? bl.pdf_page + '쪽' : '')) : ''; }

  function rowHTML(n, raw, opts) {
    opts = opts || {};
    const has = !opts.flat && !!V.kids[n.c];
    const isOpen = V.open.has(n.c);
    const tg = has ? `<button class="tg" data-tg="${n.c}" aria-label="${isOpen ? '접기' : '펼치기'}" aria-expanded="${isOpen}">${isOpen ? '−' : '+'}</button>` : '<span class="tg sp"></span>';
    const badge = n.ty ? `<span class="badge b-${n.ty}">${TYPE_SHORT[n.ty]}</span>` : '';
    const url = n.link ? SS.safeUrl(n.link.url) : '';
    const open = url ? `<a class="open o-${n.ty}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="새 탭에서 열기">${n.ty === '법령' ? '법령 ↗' : n.ty === '사이트' ? '열기 ↗' : '받기 ⤓'}</a>` : '';
    const t = opts.hl ? opts.hl(n.t) : esc(n.t);
    const cur = V.cur && V.cur.c === n.c && (!opts.doc || opts.doc === V.doc.id);
    // 번호는 단원(1)과 업무(1.1)까지만 보이고, 그 아래는 들여쓰기 + '-'
    const depth = n.c.split('.').length;
    const label = depth <= 2 ? n.c : '-';
    const ind = depth > 2 && !opts.flat ? `<span class="ind" style="width:${(depth - 3) * 14 + 6}px"></span>` : '';
    return `<div class="row k-${n.k} d${Math.min(depth, 6)}${cur ? ' cur' : ''}" data-c="${n.c}"${opts.doc ? ` data-d="${opts.doc}"` : ''}><span class="pg">${pp(raw, n.b)}</span><span class="code">${ind}${tg}<span class="num">${label}</span></span><span class="ttl">${badge}${t}${open}</span></div>`;
  }
  function renderToc() {
    if (!V.doc) return;
    if (V.q || V.t) return renderResults();
    const out = [];
    (function walk(list) { (list || []).forEach(n => { out.push(rowHTML(n, V.doc.raw)); if (V.open.has(n.c)) walk(V.kids[n.c]); }); })(V.kids['']);
    $('tree').innerHTML = out.join('') || '<div class="v-empty">목차가 없습니다.</div>';
    markCur();
  }
  function markCur() {
    document.querySelectorAll('#tree .row.cur').forEach(r => r.classList.remove('cur'));
    if (!V.cur) return null;
    for (const a of anc(V.cur).reverse()) {
      const r = document.querySelector(`#tree .row[data-c="${CSS.escape(a.c)}"]:not([data-d]), #tree .row[data-c="${CSS.escape(a.c)}"][data-d="${CSS.escape(V.doc.id)}"]`);
      if (r) { r.classList.add('cur'); return r; }
    }
    return null;
  }

  function parseQuery(raw, t) {
    let q = String(raw || '').trim(), f = t || '';
    const m = q.match(/^(서|참|법|사)\]\s*/);
    if (m) { f = TYPE_PREFIX[m[1]]; q = q.slice(m[0].length); }
    return { words: q.split(/\s+/).filter(Boolean), f };
  }
  let searchSeq = 0;
  const SEARCH_KINDS = new Set(['task', 'part', 'group', 'item', 'link']);
  /** 여러 자료에서 목차·링크·본문을 찾아 결과 HTML을 만든다 */
  function buildResults(preps, rawQ, rawT, showDocs) {
    const { words, f } = parseQuery(rawQ, rawT);
    const lw = words.map(w => SAS.norm(w)).filter(Boolean);
    const marks = words.length ? new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi') : null;
    const hl = s => marks ? esc(s).replace(marks, '<mark>$1</mark>') : esc(s);
    let total = 0, html = '';
    const pageHits = [];
    const byDoc = {};
    preps.forEach(p => {
      // 목차 제목에서만 찾는다: 업무·부분·◆ 묶음·번호 항목·자료(서식 등) 이름. ▸ 세부 줄과 본문은 찾지 않는다
      const hits = p.nodes.filter(n => SEARCH_KINDS.has(n.k) && (!f || n.ty === f) && (!lw.length || lw.every(w => SAS.norm(n.t).includes(w))));
      byDoc[p.id] = hits.length;
      if (!hits.length) return;
      total += hits.length;
      if (showDocs || preps.length > 1) html += `<div class="doc-grp">${esc(p.title)}</div>`;
      const taskOf = n => { let x = n; while (x && x.k !== 'task') x = p.by[x.p]; return x || n; };
      const rank = n => n.k === 'task' ? 0 : (lw.length && lw.every(w => SAS.norm(n.t).includes(w)) ? 1 : 2);
      const groups = new Map();
      hits.forEach(n => { const tk = taskOf(n); if (!groups.has(tk.c)) groups.set(tk.c, { task: tk, list: [], self: false }); if (n === tk) groups.get(tk.c).self = true; else groups.get(tk.c).list.push(n); });
      [...groups.values()].sort((a, b) => Math.min(a.self ? 0 : 9, ...a.list.map(rank)) - Math.min(b.self ? 0 : 9, ...b.list.map(rank)) || a.task.i - b.task.i).forEach(g => {
        const ch = p.by[g.task.p];
        html += `<div class="grp row-go" data-c="${g.task.c}" data-d="${p.id}"><span>${esc(ch ? ch.t : '')} ›</span> <b>${g.task.c} ${hl(g.task.t)}</b> <span class="pg">${pp(p.raw, g.task.b)}</span></div>`;
        g.list.sort((a, b) => rank(a) - rank(b) || a.i - b.i).slice(0, 80).forEach(n => { html += rowHTML(n, p.raw, { hl, flat: true, doc: p.id }); });
      });
    });
    if (pageHits.length) {
      html += `<div class="doc-grp">목차에 없는 본문에서 찾은 쪽 ${pageHits.length}개</div>`;
      pageHits.slice(0, 60).forEach(x => {
        const sn = SAS.snippet(x.b.text, words[0], 24, 48).text;
        html += `<div class="row k-page" data-d="${x.p.id}" data-page="${x.bi}"><span class="pg">${pp(x.p.raw, x.bi)}</span><span class="code"><span class="tg sp"></span><span class="num">본문</span></span><span class="ttl">${preps.length > 1 ? `<span class="muted">${esc(x.p.title)} · </span>` : ''}${hl(sn)}</span></div>`;
      });
    }
    const label = (f ? `[${f}] ` : '') + (words.join(' ') || '전체');
    const head = `<div class="res-h"><span>‘${esc(label)}’ 목차에서 <b>${total}</b>건</span><button type="button" class="linkbtn" id="clearSearch">검색 지우기</button></div>`;
    const body = total ? html : '<div class="v-empty">목차에서 찾지 못했습니다. 낱말을 줄이거나 바꿔 보세요(예: 입학식 → 입학). 여러 낱말을 띄어 쓰면 모두 들어 있는 항목만 보여 줍니다.</div>';
    return { head, body, total, byDoc };
  }
  async function renderResults() {
    const seq = ++searchSeq;
    $('tree').innerHTML = '<div class="v-empty"><span class="spinner"></span> 찾는 중…</div>';
    // 같은 학교급의 모든 자료에서 찾는다
    const preps = [];
    for (const d of (V.index.docs || [])) { try { preps.push(await loadDoc(d.id)); } catch (e) { /* 못 불러온 자료는 건너뜀 */ } }
    if (seq !== searchSeq || !(V.q || V.t)) return;
    const r = buildResults(preps, V.q, V.t, false);
    $('tree').innerHTML = r.head + r.body;
    $('tocScroll').scrollTop = 0;
    markCur();
    // 새 검색이면 이 자료의 첫 결과를 오른쪽 원문에 바로 보여 준다
    const key = V.doc.id + '|' + V.q + '|' + V.t;
    if (V.autoKey !== key) {
      V.autoKey = key;
      const first = document.querySelector(`#tree .row[data-d="${CSS.escape(V.doc.id)}"], #tree .row-go[data-d="${CSS.escape(V.doc.id)}"]`);
      if (first && V.by[first.dataset.c]) { go(first.dataset.c, { scrollToc: false, toDoc: false }); first.classList.add('cur'); }
    }
  }

  function renderChips(nodes) {
    const cnt = t => (nodes || V.nodes).filter(n => n.ty === t).length;
    $('typeChips').replaceChildren(
      h('button', { type: 'button', 'aria-pressed': String(!V.t), onclick: () => setRoute({ t: '' }) }, '전체'),
      ...TYPES.filter(t => cnt(t)).map(t => h('button', { type: 'button', 'aria-pressed': String(V.t === t), onclick: () => setRoute({ t: V.t === t ? '' : t }) }, t, h('i', {}, cnt(t)))));
  }
  function setRoute(patch) {
    const r = Object.assign(parseHash(), { slug: V.slug, doc: V.mode === 'doc' && V.doc ? V.doc.id : '', p: null }, patch);
    location.hash = hashFor(r);
  }

  // ---------- 오른쪽: 쪽 보기 ----------
  function pageSize(b) { const bl = (V.doc.raw.blocks || [])[b] || {}; return { w: bl.w || 595, h: bl.h || 842 }; }

  async function renderPages() {
    const token = ++V.renderToken;
    const raw = V.doc.raw;
    if (V.pdfTask) { try { V.pdfTask.destroy(); } catch (e) { /* 무시 */ } V.pdfTask = null; V.pdf = null; }
    if (V.observer) { V.observer.disconnect(); V.observer = null; }
    const blocks = raw.blocks || [];
    $('pTotal').textContent = `/ ${blocks.length}`;
    $('pNum').value = 1;
    // 원본 내려받기: 따로 넣은 링크가 있으면 그것, 없으면 사이트의 PDF
    const down = SS.safeUrl(raw.works_url) || (raw.pdf ? raw.pdf.path : '');
    const btn = $('btnDown');
    btn.classList.toggle('hidden', !down);
    if (down) { btn.href = down; btn.textContent = raw.works_url ? '원본 내려받기' : 'PDF 내려받기'; if (raw.works_url) btn.removeAttribute('download'); else btn.setAttribute('download', ''); }
    const hasPdf = !!(raw.pdf && raw.pdf.path);
    const linksBy = new Map();
    (raw.links || []).forEach(l => { if (l.box && l.block != null) { if (!linksBy.has(l.block)) linksBy.set(l.block, []); linksBy.get(l.block).push(l); } });
    $('viewer').scrollTop = 0;
    document.querySelector('.v-pager').classList.toggle('no-pages', raw.format !== 'pdf');
    if (!hasPdf && raw.format !== 'pdf') {
      // HWPX 등 문단 자료: 한 장에 문단을 이어서 보여 준다
      $('pages').replaceChildren(h('div', { class: 'v-note' }, '이 자료는 PDF가 아니어서 추출한 글자로 보여 줍니다. 원본은 「원본 내려받기」로 받으세요.'),
        h('div', { class: 'v-page text flow' }, ...blocks.map((b, bi) => h('p', { id: 'pg' + bi, 'data-b': bi }, b.text || ''))));
      applyZoom();
      return;
    }
    $('pages').replaceChildren(...blocks.map((b, bi) => {
      const { w, h: hh } = pageSize(bi);
      const el = h('div', { class: 'v-page' + (hasPdf ? '' : ' text'), id: 'pg' + bi, 'data-b': bi, style: hasPdf ? `aspect-ratio:${w}/${hh}` : null },
        h('span', { class: 'no' }, `${b.pdf_page || bi + 1} / ${blocks.length}${b.printed_page != null ? ' · 인쇄 ' + b.printed_page + '쪽' : ''}`));
      if (!hasPdf) el.append(h('div', { class: 'v-text' }, b.text || ''));
      else (linksBy.get(bi) || []).forEach(l => {
        const url = SS.safeUrl(l.url); if (!url) return;
        const [x0, y0, x1, y1] = l.box;
        el.append(h('a', { class: 'hot', href: url, target: '_blank', rel: 'noopener noreferrer', title: `${l.type || ''} ${l.text}`.trim(), 'aria-label': `${l.text} ${l.type === '법령' ? '법령 열기' : '내려받기'}`,
          style: `left:${x0 / w * 100}%;top:${y0 / hh * 100}%;width:${(x1 - x0) / w * 100}%;height:${(y1 - y0) / hh * 100}%` }));
      });
      return el;
    }));
    applyZoom();
    if (!hasPdf) {
      if (!blocks.length) $('pages').replaceChildren(h('div', { class: 'v-empty' }, '본문이 없는 자료입니다.'));
      else $('pages').prepend(h('div', { class: 'v-note' }, '이 자료는 원본 PDF가 없어 추출한 글자로 보여 줍니다.'));
      return;
    }
    const lib = await pdfLib();
    if (token !== V.renderToken) return;
    if (!lib) { $('pages').prepend(h('div', { class: 'v-note' }, 'PDF 보기 도구를 불러오지 못했습니다. 「PDF 내려받기」로 원문을 열어 주세요.')); return; }
    try {
      V.pdfTask = lib.getDocument({ url: raw.pdf.path + (raw.updated_at ? '?v=' + encodeURIComponent(raw.updated_at) : ''), cMapUrl: VENDOR + 'cmaps/', cMapPacked: true, isEvalSupported: false, disableAutoFetch: true, rangeChunkSize: 262144 });
      V.pdf = await V.pdfTask.promise;
    } catch (e) {
      if (token !== V.renderToken) return;
      $('pages').prepend(h('div', { class: 'v-note' }, 'PDF를 불러오지 못했습니다. 관리자가 방금 올렸다면 1~2분 뒤 새로고침해 주세요.'));
      return;
    }
    if (token !== V.renderToken) return;
    V.observer = new IntersectionObserver(entries => entries.forEach(en => {
      const el = en.target;
      if (en.isIntersecting) drawPage(el, token);
      else if (el.dataset.drawn && Math.abs(en.boundingClientRect.top) > window.innerHeight * 5) { const c = el.querySelector('canvas'); if (c) c.remove(); delete el.dataset.drawn; }
    }), { root: $('viewer'), rootMargin: '1200px 0px' });
    document.querySelectorAll('#pages .v-page').forEach(el => V.observer.observe(el));
  }
  function pdfLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(res => { const t = setTimeout(() => res(null), 10000); window.addEventListener('pdfjs-ready', () => { clearTimeout(t); res(window.pdfjsLib); }, { once: true }); });
  }
  async function drawPage(el, token) {
    if (!V.pdf || el.dataset.drawn === String(V.zoom) || el.dataset.busy) return;
    el.dataset.busy = '1';
    try {
      const page = await V.pdf.getPage(Number(el.dataset.b) + 1);
      if (token !== V.renderToken) return;
      const cssW = el.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: cssW / base.width * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (token !== V.renderToken) return;
      const old = el.querySelector('canvas'); if (old) old.remove();
      el.prepend(canvas);
      el.dataset.drawn = String(V.zoom);
    } catch (e) { /* 그리지 못한 쪽은 비워 둔다 */ }
    finally { delete el.dataset.busy; }
  }
  function applyZoom() {
    $('pages').style.setProperty('--zw', Math.round(820 * V.zoom) + 'px');
    try { localStorage.setItem('sas-zoom', String(V.zoom)); } catch (e) { /* 무시 */ }
  }
  function redrawAll() {
    document.querySelectorAll('#pages .v-page').forEach(el => { delete el.dataset.drawn; });
    if (V.observer) { V.observer.disconnect(); document.querySelectorAll('#pages .v-page').forEach(el => V.observer.observe(el)); }
  }

  function pageEl(b) { return $('pg' + b); }
  /** 본문 칸 안에서 요소의 위쪽 위치(스크롤 기준) */
  function topIn(el) { const v = $('viewer'); return el.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop; }
  function scrollToPos(b, y, smooth) {
    const el = pageEl(b); if (!el) return;
    const s = el.offsetHeight / pageSize(b).h;
    const top = topIn(el) + (V.doc.raw.pdf ? Math.max(0, (y || 0) - 30) * s : 0) - 24;
    $('viewer').scrollTo({ top: Math.max(0, top), behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  }
  function flash(n) {
    const el = pageEl(n.b); if (!el || !V.doc.raw.pdf || !n.y) return;
    el.querySelectorAll('.flash').forEach(f => f.remove());
    const { w, h: hh } = pageSize(n.b);
    let x0, y0, x1, y1;
    if (n.link && n.link.box) { [x0, y0, x1, y1] = n.link.box; x0 -= 3; y0 -= 2; x1 += 3; y1 += 2; }
    else {
      const left = (n.x || 0) < w / 2 - 8;
      x0 = (n.x || 56) - 4; x1 = ['task', 'part', 'ch'].includes(n.k) ? w - 50 : (left ? w / 2 - 6 : w - 50); y0 = n.y - 3; y1 = n.y + 15;
    }
    el.append(h('div', { class: 'flash', style: `left:${x0 / w * 100}%;top:${y0 / hh * 100}%;width:${(x1 - x0) / w * 100}%;height:${(y1 - y0) / hh * 100}%` }));
  }
  function crumb(n) {
    const a = n ? anc(n).filter(x => !['bullet', 'link'].includes(x.k)) : [];
    $('crumb').replaceChildren(h('span', { class: 'src' }, SAS.levelName(V.slug) || ''),
      ...(a.length ? a.flatMap((x, i) => [i ? h('span', { class: 'sep' }, '›') : null, i === a.length - 1 ? h('b', { title: x.t }, cut(x.t, 34)) : h('span', { title: x.t }, cut(x.t, 22))]).filter(Boolean) : [h('span', {}, V.doc ? V.doc.title : '')]));
  }

  // ---------- 이동 ----------
  let lockSpy = 0;
  function go(code, opts) {
    opts = opts || {};
    const n = V.by[code]; if (!n) return;
    V.cur = n;
    anc(n).slice(0, -1).forEach(a => V.open.add(a.c));
    if (opts.openSelf && V.kids[n.c]) V.open.add(n.c);
    if (!V.q && !V.t) renderToc(); else markCur();
    crumb(n); $('pNum').value = n.b + 1;
    lockSpy = Date.now() + 1000;
    // 폰에서는 본문 칸을 먼저 보여야 위치를 잴 수 있다
    if (isNarrow() && !opts.fromHash && opts.toDoc !== false) show('doc', true);
    if (opts.fromHash) requestAnimationFrame(() => { scrollToPos(n.b, n.y, false); flash(n); });
    else { scrollToPos(n.b, n.y, !isNarrow() && opts.toDoc !== false); flash(n); }
    if (opts.scrollToc !== false) { const r = markCur(); if (r) r.scrollIntoView({ block: opts.fromHash ? 'center' : 'nearest' }); }
    if (!opts.fromHash) quietHash({ slug: V.slug, doc: V.doc.id, code, q: V.q, t: V.t });
  }

  // 스크롤에 따라 현재위치
  let spyTimer;
  $('viewer').addEventListener('scroll', () => { clearTimeout(spyTimer); spyTimer = setTimeout(spy, 100); }, { passive: true });
  function spy() {
    if (!V.doc) return;
    const top = $('viewer').scrollTop + 60;
    let b = 0;
    for (const el of document.querySelectorAll('#pages [data-b]')) { if (topIn(el) <= top) b = Number(el.dataset.b); else break; }
    $('pNum').value = b + 1;
    if (Date.now() < lockSpy) return;
    const el = pageEl(b); if (!el) return;
    const y = (top - topIn(el)) / (el.offsetHeight / pageSize(b).h);
    let best = null;
    for (const n of V.nodes) {
      if (n.y == null || n.k === 'link' || n.k === 'ch') continue;
      if (n.b < b || (n.b === b && n.y <= y + 20)) { if (!best || n.b > best.b || (n.b === best.b && n.y >= best.y)) best = n; }
    }
    if (best && best !== V.cur) { V.cur = best; crumb(best); markCur(); quietHash({ slug: V.slug, doc: V.doc.id, code: best.c, q: V.q, t: V.t }); }
  }

  // ---------- 이벤트 ----------
  $('tree').addEventListener('click', async e => {
    if (e.target.closest('a.open')) return;
    if (e.target.id === 'clearSearch') { setRoute({ q: '', t: '' }); return; }
    const tg = e.target.closest('[data-tg]');
    if (tg) { const c = tg.dataset.tg; V.open.has(c) ? V.open.delete(c) : V.open.add(c); renderToc(); return; }
    const r = e.target.closest('.row, .row-go'); if (!r) return;
    const docId = r.dataset.d;
    if (docId && (!V.doc || docId !== V.doc.id)) { await selectDoc(docId); renderChips(V.nodes); renderToc(); }
    if (r.dataset.page != null) { lockSpy = 0; if (isNarrow()) show('doc', true); scrollToPos(Number(r.dataset.page), 0, !isNarrow()); return; }
    go(r.dataset.c, { openSelf: !V.q && !V.t, scrollToc: !V.q && !V.t });
  });
  $('searchForm').addEventListener('submit', e => { e.preventDefault(); setRoute({ q: $('q').value.trim(), code: '' }); show('toc'); });
  let qTimer;
  $('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { const v = $('q').value.trim(); if (v !== V.q && (v.length >= 2 || !v)) setRoute({ q: v, code: '' }); }, 500); });
  $('btnFold').onclick = () => { V.open = new Set(V.nodes.filter(n => n.k === 'ch').map(n => n.c)); if (V.q || V.t) setRoute({ q: '', t: '' }); else renderToc(); $('tocScroll').scrollTop = 0; };
  $('btnHere').onclick = () => {
    if (!V.cur) { toast('오른쪽 본문을 움직이면 현재위치가 표시됩니다.'); return; }
    if (V.q || V.t) { setRoute({ q: '', t: '', code: V.cur.c }); return; }
    anc(V.cur).slice(0, -1).forEach(a => V.open.add(a.c)); renderToc();
    const r = markCur(); if (r) r.scrollIntoView({ block: 'center' }); show('toc');
  };
  $('btnShare').onclick = () => {
    if (!V.doc) return;
    const url = location.href.split('#')[0] + hashFor({ slug: V.slug, doc: V.doc.id, code: V.cur ? V.cur.c : '' });
    const done = () => toast('현재 위치 주소를 복사했습니다. 메신저에 붙여 넣으면 이 위치가 바로 열립니다.');
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => toast(url)); else toast(url);
  };
  const lastPage = () => (V.doc && V.doc.raw.blocks ? V.doc.raw.blocks.length : 1);
  $('pPrev').onclick = () => { lockSpy = 0; scrollToPos(Math.max(0, Number($('pNum').value) - 2), 0, true); };
  $('pNext').onclick = () => { lockSpy = 0; scrollToPos(Math.min(lastPage() - 1, Number($('pNum').value)), 0, true); };
  $('pNum').addEventListener('change', e => { const n = Math.min(lastPage(), Math.max(1, parseInt(e.target.value, 10) || 1)); lockSpy = 0; scrollToPos(n - 1, 0, false); });
  function zoomBy(d) { const b = Number($('pNum').value) - 1; V.zoom = Math.min(1.8, Math.max(0.5, Math.round((V.zoom + d) * 100) / 100)); applyZoom(); redrawAll(); requestAnimationFrame(() => scrollToPos(b, 0, false)); }
  $('zIn').onclick = () => zoomBy(0.15);
  $('zOut').onclick = () => zoomBy(-0.15);
  function show(which, quiet) {
    const was = $('cols').dataset.show;
    $('cols').dataset.show = which; $('tabToc').setAttribute('aria-selected', String(which === 'toc')); $('tabDoc').setAttribute('aria-selected', String(which === 'doc'));
    if (which === 'doc' && was !== 'doc' && isNarrow()) {
      if (V.pdf) redrawAll();
      // 목차에서 고른 위치(또는 주소로 연 위치)로 본문을 옮긴다
      if (!quiet && V.cur) { lockSpy = Date.now() + 800; requestAnimationFrame(() => { scrollToPos(V.cur.b, V.cur.y, false); flash(V.cur); }); }
    }
  }
  $('tabToc').onclick = () => show('toc');
  $('tabDoc').onclick = () => show('doc');
  let resizeTimer, lastW = window.innerWidth;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 40 && V.pdf) { lastW = window.innerWidth; redrawAll(); } }, 250); });

  init();
})();
