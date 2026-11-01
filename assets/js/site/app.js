/*
 * 교무업무 통합검색 · 사용자 화면
 *  - 첫 화면: 학교급 카드 5개(유아 · 초등 · 중등 · 특수 · 공통)
 *  - 학교급 첫 화면: 그 학교급 자료 + 공통 자료(부서별 묶음, 가나다순). 공통은 공통 자료만 부서별로
 *  - 자료 화면(충교위키식 3단): 왼쪽 자료 목록 · 가운데 번호 목차(또는 검색 결과) · 오른쪽 원문 쪽 보기
 *  - 검색: 첫 화면에서 찾으면 모든 학교급(유아·초등·중등·특수·공통) 자료에서,
 *          학교급 화면에서 찾으면 그 학교급과 공통 자료에서(공통 화면은 공통 자료만) 찾는다.
 *          검색 중에는 왼쪽 자료 칸을 숨기고 가운데 칸의 결과 목록(자료별 묶음)으로 고른다
 *          목차 검색은 data/toc/<학교급>.json(목차 제목만 모은 가벼운 색인)을 쓴다. 없으면 자료 상세를 받아 찾는다
 *  - 주소: #/학교급  ·  #/학교급/자료ID  ·  #/학교급/자료ID/목차번호  ·  #/학교급?q=검색어&t=서식  ·  #/all?q=검색어(첫 화면 검색)
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
  const COMMON = 'common';
  const ALL = 'all';                                  // 첫 화면에서 검색할 때의 주소(학교급 없이 전체)
  const LV = SAS.LEVELS.map(l => l.slug);

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
    const slug = parts[0] === ALL || SAS.levelName(parts[0]) ? parts[0] : null;
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
  $('homeSearch').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('hq').value.trim();
    if (!v) { $('hq').focus(); return; }
    location.hash = hashFor({ slug: ALL, q: v });
  });
  function renderHome() {
    document.title = '교무업무 통합검색';
    $('hq').value = '';
    document.body.classList.remove('viewing');
    $('home').classList.remove('hidden'); $('level').classList.add('hidden'); $('levelNav').classList.add('hidden');
    const levels = (manifest && manifest.levels) || {};
    const nOf = slug => (levels[slug] && levels[slug].documents) || 0;
    const common = nOf(COMMON);
    $('levelCards').replaceChildren(...SAS.LEVELS.map(l => {
      const own = nOf(l.slug);
      // 학교급 카드는 그 학교급 자료 수와 함께 볼 수 있는 공통 자료 수를 보여 준다
      const count = l.slug === COMMON ? (own ? `자료 ${own}건` : '자료 준비 중')
        : own || common ? [own ? `자료 ${own}건` : '', common ? `공통 ${common}건` : ''].filter(Boolean).join(' + ') : '자료 준비 중';
      return h('a', { class: `level-card ${l.slug}` + (own || (l.slug !== COMMON && common) ? '' : ' no-docs'), href: `#/${l.slug}` },
        h('img', { src: `assets/img/level-${l.slug}.png`, alt: '', width: 104, height: 104 }),
        h('span', { class: 'name' }, l.name),
        h('span', { class: 'count' }, count));
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
    own: [], com: [], all: [], meta: new Map(),  // 이 학교급 자료 · 공통 자료 · 둘을 합친 목록 · 자료ID → 목록 정보
    doc: null, nodes: [], by: {}, kids: {}, open: new Set(), cur: null,
    q: '', t: '', mode: 'home', zoom: 1, pdf: null, pdfTask: null, renderToken: 0, observer: null
  };
  try { V.zoom = Number(localStorage.getItem('sas-zoom')) || 1; } catch (e) { /* 무시 */ }

  async function openLevel(r) {
    // 전체 검색 주소인데 검색어가 없으면: 자료가 있으면 그 자료의 학교급으로, 없으면 첫 화면으로
    if (r.slug === ALL && !r.q && !r.t) {
      if (!r.doc) { location.replace('#/'); return; }
      const meta = await ensureMeta().catch(() => null);
      const d = meta && meta.get(r.doc);
      location.replace(hashFor(Object.assign({}, r, { slug: (d && d._lv) || LV[0] })));
      return;
    }
    const name = r.slug === ALL ? '전체' : SAS.levelName(r.slug);
    document.body.classList.add('viewing');
    $('home').classList.add('hidden'); $('level').classList.remove('hidden');
    renderNav(r.slug);
    if (V.slug !== r.slug) {
      V.slug = r.slug; V.index = null; V.doc = null;
      $('docList').replaceChildren(h('div', { class: 'v-empty' }, h('span', { class: 'spinner' }), ' 자료 목록을 불러오는 중…'));
      $('tree').replaceChildren(); $('pages').replaceChildren(); $('crumb').replaceChildren(); $('docTitle').textContent = ''; $('docStats').replaceChildren();
      // 학교급 화면은 그 학교급 색인과 공통 색인을 함께 불러온다. 공통 화면은 공통 색인만
      const want = r.slug === ALL ? [] : r.slug === COMMON ? [COMMON] : [r.slug, COMMON];
      const got = await Promise.all(want.map(s => loader.level(s).catch(e => (e.status === 404 ? { docs: [], sections: [] } : Promise.reject(e))))).catch(() => null);
      if (!got) {
        V.index = { docs: [], sections: [] }; V.own = []; V.com = []; V.all = []; V.meta = new Map();
        const msg = '자료 목록을 불러오지 못했습니다. 새로고침해 주세요.';
        $('docList').replaceChildren(h('div', { class: 'v-empty' }, msg));
        $('tree').replaceChildren(h('div', { class: 'v-empty' }, msg));
        $('homeHead').replaceChildren(); $('homeDocs').replaceChildren(h('div', { class: 'v-empty' }, msg));
        setMode('home');
        return;
      }
      if (parseHash().slug !== r.slug) return;
      if (r.slug === ALL) { V.index = { docs: [], sections: [] }; V.own = []; V.com = []; V.all = []; V.meta = new Map(); }
      else setLists(r.slug, got);
    }
    $('docsLabel').textContent = r.slug === ALL ? '← 처음 화면' : `← ${name} 자료 목록`;
    $('docsLabel').href = r.slug === ALL ? '#/' : `#/${r.slug}`;
    V.q = r.q; V.t = r.t;
    if ($('q').value !== r.q) $('q').value = r.q;
    $('q').placeholder = `${scopeName()} 자료에서 업무·서식·법령 검색 (예: 졸업식, 현장체험학습)`;
    // 검색 중에는 왼쪽 자료 칸을 숨긴다(가운데 결과 목록이 자료별로 묶여 있음)
    $('cols').classList.toggle('searching', !!(r.q || r.t));
    // 다른 학교급 자료(검색 결과에서 연 자료)는 전체 목록에서 찾는다
    if (r.doc && !metaOf(r.doc)) await ensureMeta().catch(() => null);
    if (parseHash().slug !== r.slug) return;
    // 학교급 첫 화면: 자료 목록과 검색(문서를 바로 열지 않는다)
    if (!r.doc || !metaOf(r.doc)) { setMode('home'); return renderLevelHome(r); }
    setMode('doc');
    if (!V.doc || V.doc.id !== r.doc) await selectDoc(r.doc);
    else renderDocList(V.doc.id);   // 검색을 넣거나 지웠을 때 왼쪽 목록(찾은 자료만 ↔ 학교급 전체)을 다시 그린다
    if (!V.doc) return;
    renderStats(); renderChips(V.nodes);
    document.title = (r.q ? `${r.q} - ` : '') + `${V.doc.title} · ${srcName(V.doc.id)} · 교무업무 통합검색`;
    if (r.code && V.by[r.code] && (!V.cur || V.cur.c !== r.code)) go(r.code, { fromHash: true });
    else {
      renderToc();
      if (r.p != null && pageEl(r.p)) { lockSpy = 0; requestAnimationFrame(() => scrollToPos(r.p, 0, false)); if (isNarrow()) show('doc', true); }
    }
  }

  /** 색인을 받아 이 학교급 자료(own)와 공통 자료(com)로 나눈다. 공통 자료는 부서별(가나다순)로 정렬 */
  function setLists(slug, got) {
    const own = slug === COMMON ? [] : (got[0].docs || []);
    const com = (slug === COMMON ? got[0].docs : (got[1] && got[1].docs)) || [];
    com.forEach(d => { d._c = true; d._lv = COMMON; d._g = SAS.deptGroup(d.dp, deptCounts()); });
    own.forEach(d => { d._c = false; d._lv = d._lv || slug; });
    V.index = got[0];
    V.own = own;
    V.com = byDept(com).flatMap(([, list]) => list);
    V.all = V.own.concat(V.com);
    V.meta = new Map(V.all.map(d => [d.id, d]));
  }
  function deptCounts() { return (manifest && manifest.departments) || {}; }
  /** [[부서 묶음 이름, 자료 목록], …] 가나다순 */
  function byDept(list) {
    const m = new Map();
    list.forEach(d => { const g = d._g || SAS.deptGroup(d.dp, deptCounts()); if (!m.has(g)) m.set(g, []); m.get(g).push(d); });
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  }
  /** 자료 여러 건을 동시에 몇 개씩 불러온다(못 불러온 자료는 건너뜀) */
  async function loadMany(list, limit) {
    const out = new Array(list.length); let next = 0;
    async function worker() { while (next < list.length) { const i = next++; try { out[i] = await loadDoc(list[i].id); } catch (e) { out[i] = null; } } }
    await Promise.all(Array.from({ length: Math.min(limit || 6, list.length) }, worker));
    return out.filter(Boolean);
  }
  /** 자료 목록 정보: 이 학교급 목록 → 전체 학교급 목록 순서로 찾는다 */
  const metaOf = id => V.meta.get(id) || (G.meta && G.meta.get(id)) || null;
  const isCommonDoc = id => { const d = metaOf(id); return !!(d && d._c); };
  /** 자료가 속한 학교급 slug */
  const lvOf = id => { const d = metaOf(id); return d && d._c ? COMMON : (d && d._lv) || (V.slug === ALL ? '' : V.slug); };
  /** 자료가 속한 학교급 이름(공통 자료면 '공통') */
  const srcName = id => SAS.levelName(lvOf(id)) || '';

  // ---------- 전체 학교급 목록 · 목차 검색 색인 ----------
  const G = { meta: null, metaP: null, toc: null, tocP: null };
  /** 다섯 학교급 색인을 모두 불러와 자료ID → 목록 정보(_lv: 학교급, _c: 공통 여부)를 만든다 */
  function ensureMeta() {
    if (!G.metaP) {
      G.metaP = Promise.all(LV.map(s => loader.level(s).then(ix => [s, ix]).catch(e => (e.status === 404 ? [s, { docs: [] }] : Promise.reject(e)))))
        .then(list => {
          const m = new Map();
          list.forEach(([s, ix]) => (ix.docs || []).forEach(d => {
            if (m.has(d.id)) return;
            d._lv = s;
            if (s === COMMON) { d._c = true; d._g = d._g || SAS.deptGroup(d.dp, deptCounts()); } else if (d._c == null) d._c = false;
            m.set(d.id, d);
          }));
          G.meta = m;
          return m;
        })
        .catch(e => { G.metaP = null; throw e; });
    }
    return G.metaP;
  }
  const TOC_KIND = { c: 'ch', t: 'task', p: 'part', g: 'group', i: 'item', l: 'link' };
  /** 목차 검색 색인(data/toc). 예전 데이터라 없으면 null → 자료 상세를 받아 찾는다 */
  function ensureToc() {
    if (!G.tocP) {
      G.tocP = Promise.all(LV.map(s => loader.fetchJSON(`data/toc/${s}.json`).catch(e => (e.status === 404 ? null : Promise.reject(e)))))
        .then(files => {
          if (files.some(f => !f)) return null;
          const m = new Map();
          files.forEach(f => (f.docs || []).forEach(([id, rows]) => { if (!m.has(id)) m.set(id, tocPrep(id, rows)); }));
          G.toc = m;
          return m;
        })
        .catch(e => { G.tocP = null; throw e; });
    }
    return G.tocP;
  }
  function tocPrep(id, rows) {
    const prep = { id, nodes: [], by: {}, toc: true };
    rows.forEach((r, i) => {
      const n = { c: r[0], k: TOC_KIND[r[1]] || 'item', t: r[2], pg: r[3] || '', ty: r[4] || '', url: r[5] || '', i };
      n.p = n.c.includes('.') ? n.c.slice(0, n.c.lastIndexOf('.')) : '';
      prep.nodes.push(n); prep.by[n.c] = n;
    });
    return prep;
  }
  /** 검색 결과에 보일 학교급 순서: 지금 학교급 → 공통 → 다른 학교급 (첫 화면 검색은 유아·초등·중등·특수 → 공통) */
  function levelOrder() {
    const rest = LV.filter(s => s !== COMMON && s !== V.slug);
    if (V.slug === COMMON) return [COMMON, ...rest];
    if (V.slug && V.slug !== ALL) return [V.slug, COMMON, ...rest];
    return [...rest, COMMON];
  }
  /** 검색 범위: 첫 화면 검색은 모든 학교급, 학교급 화면은 그 학교급 + 공통, 공통 화면은 공통만 */
  function searchScope() {
    if (!V.slug || V.slug === ALL) return LV.slice();
    return V.slug === COMMON ? [COMMON] : [V.slug, COMMON];
  }
  const scopeName = () => (!V.slug || V.slug === ALL ? '모든 학교급' : V.slug === COMMON ? '공통' : `${SAS.levelName(V.slug)}·공통`);
  /** 검색 범위 자료의 목차 검색 준비물(학교급 순서대로) */
  async function searchPreps() {
    const meta = await ensureMeta();
    const toc = await ensureToc().catch(() => null);
    const order = levelOrder();
    const scope = new Set(searchScope());
    const list = [...meta.values()].filter(d => scope.has(lvOf(d.id))).sort((a, b) => order.indexOf(lvOf(a.id)) - order.indexOf(lvOf(b.id)));
    if (toc) return list.map(d => { const p = toc.get(d.id) || { id: d.id, nodes: [], by: {} }; p.title = d.t; return p; });
    return loadMany(list, 8);
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
  // 학교급: ① 그 학교급 자료(카드) ② 공통 자료(부서별 묶음, 가나다순) · 공통: 공통 자료만 부서별
  async function renderLevelHome(r) {
    const name = r.slug === ALL ? '전체' : SAS.levelName(r.slug);
    const isCommon = r.slug === COMMON;
    const own = V.own, com = V.com;
    document.title = (r.q ? `${r.q} - ` : '') + `${name} 자료 · 교무업무 통합검색`;
    if (!own.length && !com.length && r.slug !== ALL && !(V.q || V.t)) {
      $('homeHead').replaceChildren(h('h1', {}, `${name} 자료`));
      $('homeDocs').replaceChildren(h('div', { class: 'v-empty' }, `${name} 자료는 아직 준비 중입니다. 다른 학교급을 골라 보세요.`));
      $('homeDocs').classList.remove('hidden');
      $('homeResults').replaceChildren(); $('docStats').replaceChildren(); $('typeChips').replaceChildren(); return;
    }
    $('homeHead').replaceChildren(
      h('h1', {}, isCommon ? `공통 자료 ${com.length}건` : `${name} 자료 ${own.length}건` + (com.length ? ` · 공통 자료 ${com.length}건` : '')),
      h('p', {}, isCommon ? '모든 학교급에 해당하는 자료를 부서별로 모았습니다. 위 검색창에서 모든 공통 자료의 목차·서식을 한꺼번에 찾을 수 있습니다.'
        : `${name} 자료 아래에 모든 학교급에 해당하는 공통 자료를 부서별로 함께 보여 줍니다. 위 검색창은 ${name} 자료와 공통 자료를 함께 찾습니다. 모든 학교급에서 찾으려면 처음 화면의 검색창을 쓰세요.`));
    // 검색하면 3단 화면으로: 찾은 항목이 가장 많은 자료를 열고 가운데에 검색 결과를 보여 준다
    if (V.q || V.t) {
      if (r.slug === ALL) $('homeHead').replaceChildren(h('h1', {}, '모든 학교급에서 찾기'));
      $('homeDocs').classList.add('hidden');
      $('docStats').replaceChildren(); $('typeChips').replaceChildren();
      $('homeResults').innerHTML = `<div class="v-empty"><span class="spinner"></span> ${scopeName()} 자료에서 찾는 중…</div>`;
      let res;
      try { res = await runSearch(); } catch (e) { $('homeResults').innerHTML = '<div class="v-empty">자료 목록을 불러오지 못했습니다. 새로고침해 주세요.</div>'; return; }
      if (parseHash().doc || V.mode !== 'home' || !(V.q || V.t)) return;
      if (res.best) { location.replace(hashFor({ slug: r.slug, doc: res.best, q: V.q, t: V.t })); return; }
      $('homeResults').innerHTML = res.head + res.body;
      return;
    }
    // 이 학교급 자료는 카드에 목차 요약을 보여 주려고 미리 불러온다(공통 자료는 목록 정보만)
    const preps = await loadMany(own);
    if (parseHash().doc || V.mode !== 'home' || V.q || V.t) return;
    const all = preps.flatMap(p => p.nodes);
    const count = (list, f) => list.filter(f).length;
    $('docStats').replaceChildren(...[
      !isCommon ? [`${name} 자료`, own.length + '건'] : null,
      com.length ? ['공통 자료', com.length + '건'] : null,
      all.length ? ['업무', count(all, x => x.k === 'task')] : null,
      all.length ? ['세부 항목', count(all, x => ['group', 'item', 'bullet'].includes(x.k))] : null
    ].filter(Boolean).map(([a, b]) => h('span', { class: 'st' }, a, ' ', h('b', {}, b))));
    renderChips(all);
    $('homeDocs').classList.remove('hidden');
    $('homeResults').replaceChildren();
    const parts = [];
    if (!isCommon) {
      parts.push(h('div', { class: 'lv-sec' }, h('h2', {}, `${name} 자료`, h('i', {}, own.length + '건'))));
      parts.push(own.length ? h('div', { class: 'lv-docs' }, ...own.map(d => docCard(r.slug, d, preps.find(x => x.id === d.id))))
        : h('div', { class: 'v-empty lv-none' }, `${name} 자료는 아직 준비 중입니다. 아래 공통 자료를 확인해 보세요.`));
    }
    if (com.length) {
      const groups = byDept(com);
      const open = isCommon ? com.length <= 40 : com.length <= 12;   // 적으면 펼쳐 두고, 많으면 부서 이름만
      parts.push(h('div', { class: 'lv-sec' + (isCommon ? ' first' : '') },
        isCommon ? null : h('h2', {}, '공통 자료', h('i', {}, com.length + '건'), h('span', { class: 'lv-tag' }, '모든 학교급')),
        h('p', {}, `부서별로 묶었습니다(가나다순). 자료가 1~${SAS.OTHER_DEPT_MAX}건인 부서는 「${SAS.OTHER_DEPT}」에 모았습니다.`),
        groups.length > 1 ? h('div', { class: 'lv-tools' },
          h('button', { type: 'button', class: 'small', onclick: () => document.querySelectorAll('#homeDocs details.lv-dept').forEach(x => { x.open = true; }) }, '모두 펼치기'),
          h('button', { type: 'button', class: 'small', onclick: () => document.querySelectorAll('#homeDocs details.lv-dept').forEach(x => { x.open = false; }) }, '모두 접기')) : null));
      parts.push(h('div', { class: 'lv-depts' }, ...groups.map(([g, list]) => h('details', { class: 'lv-dept', open: open || groups.length === 1 },
        h('summary', {}, h('b', {}, g), h('i', {}, list.length + '건')),
        h('div', { class: 'lv-rows' }, ...list.map(d => h('a', { class: 'lv-row', href: hashFor({ slug: r.slug, doc: d.id }) },
          h('b', {}, d.t),
          h('span', {}, [d.y ? d.y + '년' : '', (d.f || '').toUpperCase(), d.f === 'pdf' && d.n ? d.n + '쪽' : '', g === SAS.OTHER_DEPT && d.dp ? d.dp : '', d.o ? '출처 ' + d.o : ''].filter(Boolean).join(' · ')))))))));
    } else if (isCommon) parts.push(h('div', { class: 'v-empty' }, '공통 자료는 아직 준비 중입니다.'));
    $('homeDocs').replaceChildren(...parts);
  }
  /** 이 학교급 자료 카드(목차 요약 포함) */
  function docCard(slug, d, p) {
    const n = p ? p.nodes : [];
    const count = f => n.filter(f).length;
    const chs = n.filter(x => x.k === 'ch').map(x => x.t).slice(0, 6);
    const raw = p ? p.raw : {};
    return h('a', { class: 'lv-doc', href: hashFor({ slug, doc: d.id }) },
      h('div', { class: 'lv-doc-top' }, h('span', { class: 'lv-fmt' }, (d.f || '').toUpperCase()), d.c ? h('span', { class: 'lv-cat' }, d.c) : null),
      h('h2', {}, d.t),
      h('div', { class: 'lv-meta' }, [d.y ? d.y + '년' : '', d.f === 'pdf' && d.n ? d.n + '쪽' : '', raw.origin && raw.origin.site ? '출처 ' + raw.origin.site : ''].filter(Boolean).join(' · ')),
      n.length ? h('div', { class: 'lv-counts' }, ...[['업무', count(x => x.k === 'task')], ['서식', count(x => x.ty === '서식')], ['참고', count(x => x.ty === '참고')], ['법령', count(x => x.ty === '법령')]]
        .filter(([, v]) => v).map(([a, v]) => h('span', {}, a, ' ', h('b', {}, v)))) : null,
      chs.length ? h('div', { class: 'lv-chs' }, ...chs.map(c => h('span', {}, c))) : null,
      h('span', { class: 'lv-open' }, '목차와 원문 보기 →'));
  }
  // 첫 화면 검색 결과에서 고르면 그 자료의 그 위치로 연다
  $('homeResults').addEventListener('click', e => {
    if (e.target.closest('a.open')) return;
    if (e.target.id === 'clearSearch') { setRoute({ q: '', t: '' }); return; }
    const rd = e.target.closest('.row-doc');
    if (rd) { location.hash = hashFor({ slug: V.slug, doc: rd.dataset.d, q: V.q, t: V.t }); return; }
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
    const searching = !!(V.q || V.t);
    const item = (d, hits) => h('a', { class: 'v-doc' + (d.id === activeId ? ' on' : ''), href: hashFor({ slug: V.slug, doc: d.id, q: searching ? V.q : '', t: searching ? V.t : '' }), 'aria-current': d.id === activeId ? 'true' : null },
      h('b', {}, d.t), h('span', {}, searching && hits ? h('span', { class: 'hits' }, `${hits}건 · `) : null,
        [d.y ? d.y + '년' : '', d.f === 'pdf' && d.n ? d.n + '쪽' : '', (d.f || '').toUpperCase(), d.f === 'pdf' && !d.p ? '쪽 보기 준비 중' : ''].filter(Boolean).join(' · ')));
    const out = [];
    // 검색 중: 찾은 자료만 학교급별로(지금 학교급 → 공통 → 다른 학교급)
    if (searching) {
      const key = V.q + '\u0001' + V.t + '\u0001' + V.slug;
      if (!V.res || V.res.key !== key) { $('docList').replaceChildren(h('div', { class: 'v-empty' }, h('span', { class: 'spinner' }), ' 찾는 중…')); return; }
      const label = (V.t ? `[${V.t}] ` : '') + V.q;
      out.push(h('div', { class: 'v-label v-label-q' }, `‘${cut(label, 16)}’ 관련 자료 ${V.res.docs.length}`));
      let last = null;
      V.res.docs.forEach(x => {
        const d = metaOf(x.id); if (!d) return;
        if (x.lv !== last) { last = x.lv; out.push(h('div', { class: 'v-dept' }, SAS.levelName(x.lv) || '')); }
        out.push(item(d, x.hits));
      });
      if (!V.res.docs.length) out.push(h('div', { class: 'v-empty' }, '찾은 자료가 없습니다.'));
      $('docList').replaceChildren(...out);
      const on = $('docList').querySelector('.v-doc.on'); if (on) on.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (V.slug !== COMMON) { out.push(h('div', { class: 'v-label' }, `${SAS.levelName(V.slug)} 자료 ${V.own.length}`)); out.push(...V.own.map(item)); }
    if (V.com.length) {
      out.push(h('div', { class: 'v-label v-label-com' }, `공통 자료 ${V.com.length}`));
      byDept(V.com).forEach(([g, list]) => { out.push(h('div', { class: 'v-dept' }, g)); out.push(...list.map(item)); });
    }
    $('docList').replaceChildren(...out);
    const on = $('docList').querySelector('.v-doc.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  /** 검색창 아래 줄: 이 자료의 업무·세부 항목 수와 출처 (서식·참고·법령·사이트 수는 옆의 종류 단추에) */
  function renderStats() {
    const n = V.nodes, raw = V.doc.raw;
    const count = f => n.filter(f).length;
    if (raw.kind === 'link') {
      $('docStats').replaceChildren(h('span', { class: 'st st-doc' }, '이 자료'), h('span', { class: 'st' }, `${((raw.original && raw.original.format) || raw.format || '').toUpperCase()} 원본 파일`),
        raw.origin && raw.origin.site ? h('span', { class: 'st muted' }, `출처 ${raw.origin.site}${raw.year ? ' · ' + raw.year : ''}`) : '');
      return;
    }
    $('docStats').replaceChildren(h('span', { class: 'st st-doc' }, '이 자료'),
      ...[['업무', count(x => x.k === 'task')], ['세부 항목', count(x => ['group', 'item', 'bullet'].includes(x.k))]].map(([a, b]) => h('span', { class: 'st' }, a, ' ', h('b', {}, b))),
      raw.origin && raw.origin.site ? h('span', { class: 'st muted' }, `출처 ${raw.origin.site}${raw.year ? ' · ' + raw.year : ''}`) : '');
  }

  // ---------- 가운데: 목차 / 검색 결과 ----------
  const ancIn = (by, n) => { const a = []; while (n) { a.unshift(n); n = by[n.p]; } return a; };
  const anc = n => ancIn(V.by, n);
  function pp(raw, b) { const bl = raw && raw.blocks && raw.blocks[b]; return bl ? (bl.printed_page != null ? bl.printed_page + 'p' : (bl.pdf_page ? bl.pdf_page + '쪽' : '')) : ''; }

  function rowHTML(n, raw, opts) {
    opts = opts || {};
    const has = !opts.flat && !!V.kids[n.c];
    const isOpen = V.open.has(n.c);
    const tg = has ? `<button class="tg" data-tg="${n.c}" aria-label="${isOpen ? '접기' : '펼치기'}" aria-expanded="${isOpen}">${isOpen ? '−' : '+'}</button>` : '<span class="tg sp"></span>';
    const badge = n.ty ? `<span class="badge b-${n.ty}">${TYPE_SHORT[n.ty]}</span>` : '';
    const url = SS.safeUrl(n.link ? n.link.url : n.url);
    const open = url ? `<a class="open o-${n.ty}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="새 탭에서 열기">${n.ty === '법령' ? '법령 ↗' : n.ty === '사이트' ? '열기 ↗' : '받기 ⤓'}</a>` : '';
    const t = opts.hl ? opts.hl(n.t) : esc(n.t);
    const cur = V.cur && V.cur.c === n.c && (!opts.doc || opts.doc === V.doc.id);
    // 번호는 단원(1)과 업무(1.1)까지만 보이고, 그 아래는 들여쓰기 + '-'
    const depth = n.c.split('.').length;
    const label = depth <= 2 ? n.c : '-';
    const ind = depth > 2 && !opts.flat ? `<span class="ind" style="width:${(depth - 3) * 14 + 6}px"></span>` : '';
    return `<div class="row k-${n.k} d${Math.min(depth, 6)}${cur ? ' cur' : ''}" data-c="${n.c}"${opts.doc ? ` data-d="${opts.doc}"` : ''}><span class="pg">${pgOf(raw, n)}</span><span class="code">${ind}${tg}<span class="num">${label}</span></span><span class="ttl">${badge}${t}${open}</span></div>`;
  }
  function renderToc() {
    if (!V.doc) return;
    if (V.q || V.t) return renderResults();
    const out = [];
    (function walk(list) { (list || []).forEach(n => { out.push(rowHTML(n, V.doc.raw)); if (V.open.has(n.c)) walk(V.kids[n.c]); }); })(V.kids['']);
    $('tree').innerHTML = out.join('') || `<div class="v-empty">${emptyTocMsg(V.doc.raw)}</div>`;
    markCur();
  }
  /** 목차가 없는 까닭 */
  function emptyTocMsg(raw) {
    if (raw.kind === 'link') return `이 자료는 ${String((raw.original && raw.original.format) || raw.format || '').toUpperCase()} 파일이라 목차·본문을 읽지 않고 원본 파일로만 제공합니다. 오른쪽에서 내려받으세요.`;
    const w = (raw.extraction && raw.extraction.warnings) || [];
    if (w.some(x => /스캔|글자가 거의 없/.test(x))) return '이 PDF는 글자가 그림으로 되어 있어(스캔본이거나 글자를 도형으로 바꾼 파일) 목차를 만들지 못했습니다. 오른쪽에서 원문 쪽은 볼 수 있습니다.';
    return '목차가 없습니다.';
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
  const MAX_ROWS = 1500;   // 결과가 아주 많을 때 화면이 느려지지 않도록 가운데 칸에 보이는 줄 수 제한
  const normT = n => (n._n != null ? n._n : (n._n = SAS.norm(n.t)));
  /** 위로 올라가며 실제로 있는 부모 목차(▸ 세부 줄은 검색 색인에 없어서 건너뛴다) */
  function parentIn(by, n) { let c = n.p; while (c && !by[c]) c = c.includes('.') ? c.slice(0, c.lastIndexOf('.')) : ''; return c ? by[c] : null; }
  const pgOf = (raw, n) => (n.pg != null ? n.pg : pp(raw, n.b));
  /**
   * 여러 자료에서 목차 제목·자료(서식 등) 이름과 자료명을 찾아 결과 HTML을 만든다
   * 반환: { head, body, total, byDoc, docs: [{id, hits, title}] (보여 줄 순서), best }
   */
  function buildResults(preps, rawQ, rawT) {
    const { words, f } = parseQuery(rawQ, rawT);
    const lw = words.map(w => SAS.norm(w)).filter(Boolean);
    const marks = words.length ? new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi') : null;
    const hl = s => marks ? esc(s).replace(marks, '<mark>$1</mark>') : esc(s);
    const order = levelOrder();
    const found = [];
    preps.forEach(p => {
      // 목차 제목에서만 찾는다: 업무·부분·◆ 묶음·번호 항목·자료(서식 등) 이름. ▸ 세부 줄과 본문은 찾지 않는다
      const hits = p.nodes.filter(n => SEARCH_KINDS.has(n.k) && (!f || n.ty === f) && (!lw.length || lw.every(w => normT(n).includes(w))));
      const m = metaOf(p.id) || {};
      // 자료 이름(과 자료 검색어)이 맞는 자료도 함께: 목차가 없는 HWP·엑셀 자료도 찾을 수 있게
      const named = !f && lw.length && lw.every(w => SAS.norm([m.t || p.title || '', ...(m.k || [])].join(' ')).includes(w));
      if (hits.length || named) found.push({ p, m, hits, named, lv: lvOf(p.id) });
    });
    // 학교급 순서 → 찾은 항목 수 → 자료 이름만 맞은 자료
    found.sort((a, b) => order.indexOf(a.lv) - order.indexOf(b.lv) || b.hits.length - a.hits.length || (b.named - a.named));
    let total = 0, html = '', rows = 0, cut = false, lastLv = null;
    const byDoc = {};
    found.forEach(x => {
      const { p, m, hits } = x;
      byDoc[p.id] = hits.length;
      total += hits.length;
      if (x.lv !== lastLv) {
        lastLv = x.lv;
        const n = found.filter(y => y.lv === x.lv).length;
        html += `<div class="lv-grp">${esc(SAS.levelName(x.lv) || '')} 자료 ${n}건</div>`;
      }
      const tag = m._c ? `<span class="lv-tag">공통 · ${esc(m._g || '')}</span> ` : '';
      html += `<div class="doc-grp row-doc" data-d="${esc(p.id)}" title="이 자료 열기">${tag}${hl(p.title || m.t || '')}<span class="cnt">${hits.length ? hits.length + '건' : ''}</span></div>`;
      if (!hits.length) {
        html += `<div class="doc-only">자료 이름에서 찾았습니다${m.f && !['pdf', 'hwpx'].includes(m.f) ? ` · ${esc(String(m.f).toUpperCase())} 원본 파일` : ''}</div>`;
        return;
      }
      if (rows >= MAX_ROWS) { cut = true; html += '<div class="res-more">이 자료를 열면 결과를 볼 수 있습니다.</div>'; return; }
      const taskOf = n => { let y = n; while (y && y.k !== 'task') y = parentIn(p.by, y); return y || n; };
      const rank = n => n.k === 'task' ? 0 : (lw.length && lw.every(w => normT(n).includes(w)) ? 1 : 2);
      const groups = new Map();
      hits.forEach(n => { const tk = taskOf(n); if (!groups.has(tk.c)) groups.set(tk.c, { task: tk, list: [], self: false }); if (n === tk) groups.get(tk.c).self = true; else groups.get(tk.c).list.push(n); });
      [...groups.values()].sort((a, b) => Math.min(a.self ? 0 : 9, ...a.list.map(rank)) - Math.min(b.self ? 0 : 9, ...b.list.map(rank)) || a.task.i - b.task.i).forEach(g => {
        const ch = parentIn(p.by, g.task);
        html += `<div class="grp row-go" data-c="${g.task.c}" data-d="${esc(p.id)}"><span>${esc(ch ? ch.t : '')} ›</span> <b>${g.task.c} ${hl(g.task.t)}</b> <span class="pg">${pgOf(p.raw, g.task)}</span></div>`;
        rows++;
        g.list.sort((a, b) => rank(a) - rank(b) || a.i - b.i).slice(0, 80).forEach(n => { html += rowHTML(n, p.raw, { hl, flat: true, doc: p.id }); rows++; });
      });
    });
    const label = (f ? `[${f}] ` : '') + (words.join(' ') || '전체');
    const nDocs = found.length;
    const head = `<div class="res-h"><span>‘${esc(label)}’ ${scopeName()} 자료 <b>${nDocs}</b>개 · 목차 <b>${total}</b>건</span><button type="button" class="linkbtn" id="clearSearch">검색 지우기</button></div>`;
    const body = nDocs ? html + (cut ? '<div class="v-empty">결과가 많아 일부만 보여 줍니다. 낱말을 더 넣어 좁혀 보세요.</div>' : '')
      : '<div class="v-empty">' + scopeName() + ' 자료의 목차와 자료 이름에서 찾지 못했습니다. 낱말을 줄이거나 바꿔 보세요(예: 입학식 → 입학). 여러 낱말을 띄어 쓰면 모두 들어 있는 항목만 보여 줍니다.</div>';
    // 처음 열 자료: 찾은 항목이 가장 많은 자료(같으면 지금 학교급 먼저) → 없으면 자료 이름만 맞은 첫 자료
    const pick = found.filter(x => x.hits.length).sort((a, b) => b.hits.length - a.hits.length || order.indexOf(a.lv) - order.indexOf(b.lv))[0] || found[0];
    return { head, body, total, byDoc, docs: found.map(x => ({ id: x.p.id, hits: x.hits.length, lv: x.lv })), best: pick ? pick.p.id : '' };
  }
  /** 지금 검색어로 모든 학교급을 찾는다(같은 검색어는 다시 계산하지 않는다) */
  async function runSearch() {
    const key = V.q + '\u0001' + V.t + '\u0001' + V.slug;
    if (V.res && V.res.key === key) return V.res;
    const preps = await searchPreps();
    const res = buildResults(preps, V.q, V.t);
    res.key = key;
    V.res = res;
    return res;
  }
  async function renderResults() {
    const seq = ++searchSeq;
    const cached = V.res && V.res.key === V.q + '\u0001' + V.t + '\u0001' + V.slug;
    if (!cached) $('tree').innerHTML = `<div class="v-empty"><span class="spinner"></span> ${scopeName()} 자료에서 찾는 중…</div>`;
    let r;
    try { r = await runSearch(); } catch (e) { if (seq === searchSeq) $('tree').innerHTML = '<div class="v-empty">자료 목록을 불러오지 못했습니다. 새로고침해 주세요.</div>'; return; }
    if (seq !== searchSeq || !(V.q || V.t)) return;
    renderDocList(V.doc && V.doc.id);
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
    if (!TYPES.some(cnt) && !V.t) { $('typeChips').replaceChildren(); return; }
    $('typeChips').replaceChildren(
      h('button', { type: 'button', 'aria-pressed': String(!V.t), onclick: () => setRoute({ t: '' }) }, '전체'),
      ...TYPES.filter(t => cnt(t)).map(t => h('button', { type: 'button', 'aria-pressed': String(V.t === t), onclick: () => setRoute({ t: V.t === t ? '' : t }) }, t, h('i', {}, cnt(t)))));
  }
  function setRoute(patch) {
    const r = Object.assign(parseHash(), { slug: V.slug, doc: V.mode === 'doc' && V.doc ? V.doc.id : '', p: null }, patch);
    // 첫 화면 검색에서 검색을 지우면: 보던 자료의 학교급으로(자료가 없으면 첫 화면)
    if (r.slug === ALL && !r.q && !r.t) { if (!r.doc) { location.hash = '#/'; return; } r.slug = lvOf(r.doc) || LV[0]; }
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
    // 원본 내려받기: 따로 넣은 링크 → 창고의 원본 파일 → 사이트의 PDF 순서
    const orig = raw.original && raw.original.path ? SAS.fileUrl(raw.original) : '';
    const pdfUrl = SAS.fileUrl(raw.pdf);
    const down = SS.safeUrl(raw.works_url) || orig || pdfUrl;
    const btn = $('btnDown');
    btn.classList.toggle('hidden', !down);
    if (down) {
      btn.href = down;
      const fmt = (raw.original && raw.original.format) || (raw.pdf ? 'pdf' : '');
      btn.textContent = raw.works_url ? '원본 내려받기' : `${fmt ? fmt.toUpperCase() + ' ' : ''}원본 내려받기`;
      // 같은 주소 아래(github.io)라 원래 파일 이름으로 저장된다
      if (raw.works_url) btn.removeAttribute('download'); else btn.setAttribute('download', (raw.original && raw.original.name) || '');
    }
    // PDF 쪽 보기는 PDF 자료만: HWPX 등은 블록이 쪽이 아니라 문단이라 PDF와 맞지 않는다(예전 PDF가 남아 있어도 글자로 보여 준다)
    const hasPdf = !!pdfUrl && raw.format === 'pdf';
    const linksBy = new Map();
    (raw.links || []).forEach(l => { if (l.box && l.block != null) { if (!linksBy.has(l.block)) linksBy.set(l.block, []); linksBy.get(l.block).push(l); } });
    $('viewer').scrollTop = 0;
    document.querySelector('.v-pager').classList.toggle('no-pages', raw.format !== 'pdf');
    if (raw.kind === 'link' || (!blocks.length && raw.format !== 'pdf')) {
      // HWP·엑셀 등: 본문을 읽지 않는 자료 → 원본 파일 내려받기 안내
      $('pages').replaceChildren(h('div', { class: 'v-filecard' },
        h('div', { class: 'v-fileicon' }, ((raw.original && raw.original.format) || raw.format || '').toUpperCase()),
        h('b', {}, (raw.original && raw.original.name) || raw.title),
        h('p', {}, '이 자료는 본문 미리보기 없이 원본 파일로 제공됩니다.'),
        down ? h('a', { class: 'btn primary', href: down, download: raw.works_url ? null : ((raw.original && raw.original.name) || ''), target: raw.works_url ? '_blank' : null, rel: 'noopener' }, '원본 파일 내려받기') : h('p', { class: 'muted' }, '아직 내려받을 파일이 준비되지 않았습니다.')));
      return;
    }
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
      V.pdfTask = lib.getDocument({ url: pdfUrl + (raw.updated_at ? '?v=' + encodeURIComponent(raw.updated_at) : ''), cMapUrl: VENDOR + 'cmaps/', cMapPacked: true, isEvalSupported: false, disableAutoFetch: true, rangeChunkSize: 262144 });
      V.pdf = await V.pdfTask.promise;
    } catch (e) {
      if (token !== V.renderToken) return;
      // 원문 PDF를 못 받으면(창고 저장소 Pages 꺼짐·배포 중·주소 잘못) 빈 쪽 대신 추출한 글자를 보여 주고, 맨 위에 늘 보이게 알린다
      console.warn('[교무업무 통합검색] PDF를 불러오지 못했습니다:', pdfUrl, e && e.message);
      document.querySelectorAll('#pages .v-page').forEach(el => {
        const b = blocks[Number(el.dataset.b)] || {};
        el.classList.add('text'); el.style.aspectRatio = '';
        el.append(h('div', { class: 'v-text' }, b.text || '(이 쪽에서 읽은 글자가 없습니다)'));
      });
      $('pages').prepend(h('div', { class: 'v-note v-note-err' }, '원문 PDF를 불러오지 못해 추출한 글자만 보여 줍니다. 잠시 뒤 새로고침하거나 「원본 내려받기」로 열어 주세요.'));
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
    } catch (e) { console.warn('[교무업무 통합검색] 쪽을 그리지 못했습니다:', el.dataset.b, e && e.message); }
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
    $('crumb').replaceChildren(h('span', { class: 'src' + (V.doc && isCommonDoc(V.doc.id) ? ' com' : '') }, (V.doc ? srcName(V.doc.id) : SAS.levelName(V.slug)) || ''),
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
    const rd = e.target.closest('.row-doc');
    if (rd) { location.hash = hashFor({ slug: V.slug, doc: rd.dataset.d, q: V.q, t: V.t }); return; }
    const r = e.target.closest('.row, .row-go'); if (!r) return;
    const docId = r.dataset.d;
    if (docId && (!V.doc || docId !== V.doc.id)) { await selectDoc(docId); if (!V.doc || V.doc.id !== docId) return; renderStats(); renderChips(V.nodes); renderToc(); }
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
