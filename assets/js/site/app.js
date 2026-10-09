/* 교무행정 통합검색 · 사용자 화면 */
(function () {
  'use strict';
  const SAS = window.SAS, SS = window.SASSearch;
  const $ = id => document.getElementById(id);
  const BODY_PAGE = 20;        // 본문 결과를 한 번에 확인·표시하는 개수

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

  const loader = SS.createLoader(window.fetch.bind(window), '');
  let manifest = null;
  let current = { slug: null, q: '', c: '' };
  let searchToken = 0;

  // ---------- 주소(#/학교급?q=검색어&c=분류) ----------
  function parseHash() {
    const m = location.hash.replace(/^#\/?/, '').split('?');
    const slug = SAS.levelName(m[0]) ? m[0] : null;
    const p = new URLSearchParams(m[1] || '');
    return { slug, q: p.get('q') || '', c: p.get('c') || '' };
  }
  function hashFor(slug, q, c) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (c) p.set('c', c);
    const s = p.toString();
    return `#/${slug}${s ? '?' + s : ''}`;
  }
  function go(slug, q, c) { const nh = hashFor(slug, q, c); if (location.hash !== nh) location.hash = nh; else route(); }

  // ---------- 상태 표시 ----------
  function showStatus(node) { $('status').replaceChildren(...(node ? [node] : [])); }
  function spinner(text) { return h('span', {}, h('span', { class: 'spinner' }), ' ', text); }

  // ---------- 시작 ----------
  async function init() {
    showStatus(h('div', { class: 'empty' }, spinner('자료 목록을 불러오는 중…')));
    try {
      manifest = await loader.manifest();
      showStatus(null);
    } catch (e) {
      manifest = { levels: {} };
      showStatus(e.status === 404
        ? h('div', { class: 'empty' }, '아직 등록된 자료가 없습니다. 관리자가 자료를 올리면 여기서 검색할 수 있습니다.')
        : h('div', { class: 'notice err' }, '자료 목록을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.', h('br'), h('span', { class: 'small' }, String(e.message))));
    }
    window.addEventListener('hashchange', route);
    route();
  }

  function route() {
    const r = parseHash();
    if (!r.slug) return renderHome();
    renderLevel(r);
  }

  // ---------- 첫 화면 ----------
  function renderHome() {
    current = { slug: null, q: '', c: '' };
    document.title = '교무행정 통합검색';
    $('home').classList.remove('hidden'); $('level').classList.add('hidden'); $('levelNav').classList.add('hidden');
    $('levelCards').replaceChildren(...SAS.LEVELS.map(l => {
      const info = (manifest && manifest.levels && manifest.levels[l.slug]) || { documents: 0, sections: 0 };
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

  // ---------- 학교급 화면 ----------
  async function renderLevel(r) {
    const name = SAS.levelName(r.slug);
    $('home').classList.add('hidden'); $('level').classList.remove('hidden');
    renderNav(r.slug);
    $('levelTitle').textContent = `${name} 자료 검색`;
    document.title = (r.q ? `${r.q} - ` : '') + `${name} · 교무행정 통합검색`;
    const levelChanged = current.slug !== r.slug;
    current = r;
    const input = $('q');
    if (input.value !== r.q) input.value = r.q;
    if (levelChanged && !r.q && matchMedia('(min-width: 760px)').matches) input.focus();

    const info = manifest && manifest.levels && manifest.levels[r.slug];
    if (!info || !info.documents) {
      $('catChips').replaceChildren(); $('hints').replaceChildren(); $('summary').textContent = '';
      $('results').replaceChildren(h('div', { class: 'empty' }, `${name} 자료는 아직 준비 중입니다.`));
      return;
    }
    let index;
    $('summary').replaceChildren(spinner('자료 목록을 불러오는 중…'));
    try { index = await loader.level(r.slug); }
    catch (e) { $('summary').textContent = ''; $('results').replaceChildren(h('div', { class: 'notice err' }, '검색 자료를 불러오지 못했습니다. 새로고침해 주세요. ', h('span', { class: 'small' }, e.message))); return; }
    if (current !== r) return;
    renderChips(index, r);
    renderHints(index, r);
    if (r.q) runSearch(index, r); else renderBrowse(index, r);
  }

  function categoriesOf(index) {
    const present = new Set(index.docs.map(d => d.c).filter(Boolean));
    const order = (SAS.CATEGORIES || []).filter(c => present.has(c));
    [...present].filter(c => !order.includes(c)).sort((a, b) => a.localeCompare(b, 'ko')).forEach(c => order.push(c));
    return order;
  }

  function renderChips(index, r) {
    const cats = categoriesOf(index);
    const box = $('catChips');
    if (cats.length < 2) { box.replaceChildren(); return; }
    box.replaceChildren(...['', ...cats].map(c => h('button', { type: 'button', 'aria-pressed': String((r.c || '') === c), onclick: () => go(r.slug, r.q, c) }, c || '전체')));
  }

  function renderHints(index, r) {
    const box = $('hints');
    if (r.q) { box.replaceChildren(); return; }
    // 관리자가 넣은 업무 검색어 중 몇 개를 예시로 보여 준다
    const kws = [...new Set(index.sections.flatMap(s => s.k || []))].slice(0, 6);
    box.replaceChildren(...(kws.length ? ['예: ', ...kws.map(k => h('button', { type: 'button', onclick: () => go(r.slug, k, r.c) }, k))] : []));
  }

  // ---------- 업무별 보기(검색어 없을 때) ----------
  function renderBrowse(index, r) {
    const docs = index.docs.filter(d => !r.c || d.c === r.c);
    $('summary').replaceChildren('자료 ', h('b', {}, `${docs.length}건`), ' · 자료를 펼치면 업무 목록이 나옵니다.');
    const out = [];
    const cats = categoriesOf(index);
    const groups = cats.map(c => [c, docs.filter(d => d.c === c)]).concat([['분류 없음', docs.filter(d => !d.c)]]).filter(g => g[1].length);
    groups.forEach(([c, list]) => {
      if (groups.length > 1) out.push(h('div', { class: 'group-title' }, c));
      list.forEach(d => out.push(docCard(index, d, r, { collapsed: true })));
    });
    $('results').replaceChildren(...out);
  }

  // ---------- 검색 ----------
  async function runSearch(index, r) {
    const token = ++searchToken;
    const opts = { category: r.c || '' };
    const meta = SS.metaSearch(index, r.q, opts);
    const q = meta.q;
    const results = $('results');
    results.replaceChildren();
    const secBox = h('div'), docBox = h('div'), bodyBox = h('div'), moreRow = h('div', { class: 'more-row' });
    results.append(secBox, docBox, bodyBox, moreRow);
    meta.sections.forEach(x => secBox.append(sectionCard(index, x, q)));
    if (meta.docs.length) {
      if (meta.sections.length) docBox.append(h('div', { class: 'group-title' }, '자료'));
      meta.docs.forEach(x => docBox.append(docCard(index, x.doc, r, { q, collapsed: true, tier: x.tier })));
    }
    let bodyCount = 0;
    const summary = searching => {
      const total = meta.sections.length + bodyCount;
      const parts = [h('b', {}, `‘${r.q}’`), ' 검색 결과: 업무 ', h('b', {}, `${total}건`)];
      if (meta.docs.length) parts.push(' · 자료 ', h('b', {}, `${meta.docs.length}건`));
      if (searching) parts.push(' · ', spinner('본문 확인 중…'));
      $('summary').replaceChildren(...parts);
    };
    summary(true);

    let cands;
    try { cands = await SS.bodyCandidates(index, r.slug, q, p => loader.fetchJSON(p), opts, meta.seen); }
    catch (e) { if (token !== searchToken) return; cands = []; moreRow.replaceChildren(h('span', { class: 'small muted' }, '본문 검색 자료를 불러오지 못했습니다. ', e.message)); }
    if (token !== searchToken) return;
    if (cands === null) {
      summary(false);
      moreRow.replaceChildren(h('span', { class: 'small muted' }, '본문 검색은 두 글자 이상일 때 합니다.'));
      return finish();
    }
    let pos = 0, headed = false;
    const untitledShown = new Set();
    async function more() {
      moreRow.replaceChildren(spinner('본문 확인 중…'));
      let shown = 0;
      while (pos < cands.length && shown < BODY_PAGE) {
        const s = cands[pos++];
        const doc = index.docs[s.d];
        if (s.u && untitledShown.has(s.d)) continue; // 목차 없는 자료는 자료당 한 번만
        let detail;
        try { detail = await loader.doc(doc.id); } catch (e) { continue; }
        if (token !== searchToken) return;
        const v = SS.verifySection(detail, s.id, q);
        if (!v) continue;
        if (s.u) untitledShown.add(s.d);
        if (!headed && (meta.sections.length || meta.docs.length)) { bodyBox.append(h('div', { class: 'group-title' }, '본문에서 찾은 업무')); headed = true; }
        bodyBox.append(sectionCard(index, { tier: SS.TIER.BODY, sec: s, doc }, q, v));
        shown++; bodyCount++;
      }
      if (token !== searchToken) return;
      summary(false);
      moreRow.replaceChildren(...(pos < cands.length ? [h('button', { type: 'button', onclick: more }, '본문 결과 더 보기')] : []));
      finish();
    }
    function finish() {
      if (!meta.sections.length && !meta.docs.length && !bodyCount) {
        results.prepend(h('div', { class: 'empty' }, h('b', {}, `‘${r.q}’에 맞는 자료를 찾지 못했습니다.`), h('br'),
          '띄어쓰기를 바꾸거나 더 짧은 낱말로 찾아보세요.', r.c ? h('span', {}, h('br'), h('a', { href: hashFor(r.slug, r.q, '') }, '모든 분류에서 다시 찾기')) : null));
      }
    }
    await more();
  }

  // ---------- 카드 ----------
  function linkBtn(url, label, primary, emptyLabel) {
    const u = SS.safeUrl(url);
    if (!u) return emptyLabel ? h('span', { class: 'btn disabled', title: '관리자가 링크를 아직 넣지 않았습니다' }, emptyLabel) : null;
    return h('a', { class: 'btn' + (primary ? ' primary' : ''), href: u, target: '_blank', rel: 'noopener noreferrer' }, label);
  }

  /** 업무 결과 카드 */
  function sectionCard(index, x, q, v) {
    const s = x.sec, d = x.doc;
    const path = [d.c, s.u ? '' : d.t, s.p].filter(Boolean).join(' › ');
    const title = s.u ? d.t : s.h; // 목차 없는 자료는 구간 이름 대신 자료명을 제목으로
    const pg = SS.pageLabel(s.pg, s.pp);
    const info = [];
    if (pg) info.push(h('span', {}, pg));
    if (v && v.page != null && (s.pg || []).length > 1) info.push(' · 일치: ', h('b', {}, SS.pageLabel([v.page], v.printed != null ? [v.printed] : [])));
    if (s.n) info.push(` · 서식 ${s.n}개`);
    const snippetHtml = v ? SS.highlightTerms(v.snippet, q.rawTerms) : SS.highlightTerms(s.l || '', q.rawTerms);
    const detail = h('div', { class: 'detail hidden' });
    const toggle = h('button', { type: 'button', class: 'toggle', 'aria-expanded': 'false' }, '상세 미리보기 ▾');
    toggle.addEventListener('click', () => toggleDetail(toggle, detail, d, s, q));
    return h('article', { class: 'result' },
      h('div', { class: 'meta-row' }, h('span', { class: 'tag' + (x.tier === SS.TIER.BODY ? ' body' : '') }, SS.TIER_LABEL[x.tier]), h('span', { class: 'path' }, path)),
      h('h3', { html: SS.highlightTerms(title, q.rawTerms) }),
      info.length ? h('div', { class: 'pages' }, ...info) : null,
      snippetHtml ? h('p', { class: 'snippet', html: snippetHtml }) : null,
      h('div', { class: 'card-actions' }, toggle,
        linkBtn(d.w, '원본 내려받기 ↗', true, '원본 링크 준비 중'),
        s.n ? linkBtn(d.fb, '서식 모음 내려받기 ↗', false, null) : null),
      detail);
  }

  async function toggleDetail(btn, box, d, s, q) {
    const open = box.classList.contains('hidden');
    box.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? '상세 미리보기 접기 ▴' : '상세 미리보기 ▾';
    if (!open || box.dataset.loaded) return;
    box.replaceChildren(spinner('본문을 불러오는 중…'));
    try {
      const detail = await loader.doc(d.id);
      const sd = SS.sectionDetail(detail, s.id);
      if (!sd) throw new Error('업무를 찾지 못했습니다');
      const kids = [];
      sd.blocks.forEach(b => {
        const lbl = SS.pageLabel(b.pdf_page != null ? [b.pdf_page] : [], b.printed_page != null ? [b.printed_page] : []);
        if (lbl && sd.blocks.length > 1) kids.push(h('div', { class: 'page-mark' }, `— ${lbl} —`));
        kids.push(h('div', { class: 'body', html: SS.highlightTerms(b.text, q ? q.rawTerms : []) }));
      });
      if (sd.forms.length) kids.push(formsBox(sd, d));
      box.replaceChildren(...kids);
      box.dataset.loaded = '1';
    } catch (e) {
      box.replaceChildren(h('div', { class: 'small muted' }, '본문을 불러오지 못했습니다. ', e.message));
    }
  }

  function formsBox(sd, d) {
    const hasBundle = !!SS.safeUrl(d.fb);
    return h('div', { class: 'forms' },
      h('h4', {}, `이 업무의 서식 ${sd.forms.length}개`),
      h('p', {}, hasBundle
        ? '서식은 자료별 「서식 모음」 한글 파일 하나에 번호 순서대로 들어 있습니다. 서식 모음을 내려받아 번호나 쪽으로 찾으세요.'
        : '서식 모음 파일은 준비 중입니다. 원본 문서에서 서식 이름으로 찾아 주세요.'),
      h('ol', {}, ...sd.forms.map(f => h('li', {},
        h('span', { class: 'no' }, `${f.no}번`),
        h('span', {}, f.name),
        h('span', { class: 'pg' }, f.page != null ? `서식 모음 ${f.page}쪽` : '')))),
      hasBundle ? h('div', { class: 'card-actions' }, linkBtn(d.fb, '서식 모음 내려받기 ↗', true)) : null);
  }

  /** 자료 카드(자료명·검색어 결과, 업무별 보기) */
  function docCard(index, d, r, o) {
    const allSecs = index.sections.filter(s => s.d === d._i);
    const secs = allSecs.filter(s => !s.u); // 목차 없이 나눈 구간은 업무 목록에 보이지 않는다
    const fmt = (d.f || '').toUpperCase();
    const meta = [d.c, d.y ? `${d.y}년` : '', fmt, d.o ? `출처: ${d.o}` : ''].filter(Boolean).join(' · ');
    const rawTerms = o.q ? o.q.rawTerms : [];
    const list = h('div', { class: 'sec-list hidden' });
    const toggle = secs.length ? h('button', { type: 'button', class: 'toggle', 'aria-expanded': 'false' }, `업무 목록 ${secs.length}개 ▾`) : null;
    if (toggle) toggle.addEventListener('click', () => {
      const open = list.classList.contains('hidden');
      list.classList.toggle('hidden', !open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? `업무 목록 접기 ▴` : `업무 목록 ${secs.length}개 ▾`;
      if (open && !list.childElementCount) list.append(...secGroups(secs, r));
    });
    const formCount = allSecs.reduce((a, s) => a + (s.n || 0), 0);
    return h('article', { class: 'doc-card' },
      h('div', { class: 'meta-row' }, o.tier ? h('span', { class: 'tag' }, SS.TIER_LABEL[o.tier]) : h('span', { class: 'tag gray' }, d.f === 'pdf' || d.f === 'hwpx' ? '자료' : '내려받기 자료'), h('span', {}, meta)),
      h('h3', { html: SS.highlightTerms(d.t, rawTerms) }),
      (d.k || []).length ? h('div', { class: 'kw' }, ...d.k.map(k => h('span', { class: 'tag gray', html: SS.highlightTerms(k, rawTerms) }))) : null,
      h('div', { class: 'card-actions' }, toggle,
        linkBtn(d.w, '원본 내려받기 ↗', true, '원본 링크 준비 중'),
        formCount ? linkBtn(d.fb, '서식 모음 내려받기 ↗', false, null) : null),
      list);
  }

  function secGroups(secs, r) {
    const groups = [];
    secs.forEach(s => { const g = groups[groups.length - 1]; if (g && g.name === s.p) g.items.push(s); else groups.push({ name: s.p, items: [s] }); });
    return groups.map(g => h('div', { class: 'sec-group' },
      g.name ? h('div', { class: 'gname' }, g.name) : null,
      h('ul', {}, ...g.items.map(s => h('li', {}, h('a', { href: hashFor(r.slug, s.h, r.c) }, s.h))))));
  }

  // ---------- 입력 ----------
  $('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('q').value.trim();
    $('q').blur();
    if (current.slug) go(current.slug, q, current.c);
  });
  $('q').addEventListener('search', () => { if (!$('q').value && current.slug && current.q) go(current.slug, '', current.c); });

  init();
})();
