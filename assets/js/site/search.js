/*
 * 교무행정 통합검색 · 검색 엔진 (사용자 화면용)
 * 브라우저(window.SASSearch)와 Node.js(require) 양쪽에서 동작합니다. 데이터는 fetchJSON(path)로 받습니다.
 *
 * 검색 순위
 *   1 업무명 정확 일치 → 2 업무명 포함 → 3 업무 검색어 → 4 자료명·자료 전체 검색어 → 5 본문 일치
 * 같은 업무는 가장 높은 순위로 한 번만 나옵니다. 4는 자료 단위 결과입니다.
 */
(function (root, factory) {
  const N = root.SAS || (typeof require === 'function'
    ? Object.assign({}, require('../core/normalize.js'), require('../core/textlayout.js'), require('../core/sectionizer.js'), require('../core/schema.js'), require('../core/indexer.js')) : {});
  const api = factory(N);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SASSearch = api;
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  const TIER = { EXACT: 1, TITLE: 2, KEYWORD: 3, DOC: 4, BODY: 5 };
  const TIER_LABEL = { 1: '업무명 일치', 2: '업무명', 3: '업무 검색어', 4: '자료명·자료 검색어', 5: '본문' };

  /** 검색어 → { raw, nq(전체 정규화), terms(띄어쓰기 단위 정규화) } */
  function parseQuery(q) {
    const raw = String(q || '').trim();
    const terms = [...new Set(raw.split(/\s+/).map(N.norm).filter(Boolean))];
    return { raw, nq: N.norm(raw), terms, rawTerms: raw.split(/\s+/).filter(t => N.norm(t)) };
  }

  /** 필드 목록 중 하나라도 검색어를 포함하거나(검색어가 필드를 포함하면 2글자 이상일 때만) 일치 */
  function fieldHit(fields, q) {
    return fields.some(f => f && (f.includes(q.nq) || (f.length >= 2 && q.nq.includes(f))));
  }
  /** 여러 단어 검색: 모든 단어가 필드들 어딘가에 있음 */
  function allTerms(fields, q) {
    return q.terms.length > 1 && q.terms.every(t => fields.some(f => f && f.includes(t)));
  }

  /** 학교급 색인에 비교용 정규화 값을 붙인다(한 번만) */
  function prepareIndex(index) {
    if (index._ready) return index;
    index.docs.forEach((d, i) => { d._i = i; d._t = N.norm(d.t); d._k = (d.k || []).map(N.norm); });
    index.sections.forEach(s => { s._h = N.norm(s.h); s._k = (s.k || []).map(N.norm); s._ref = s.d * index.sec_base + s.s; });
    index._byRef = new Map(index.sections.map(s => [s._ref, s]));
    index._ready = true;
    return index;
  }

  /**
   * 업무명·검색어·자료명 검색(색인만으로 즉시). 본문 검색은 bodySearch로 이어서 한다.
   * opts.category: 업무 분류 필터
   * 반환: { sections:[{tier, sec, doc}], docs:[{tier:4, doc}], seen:Set<ref> }
   */
  function metaSearch(index, query, opts) {
    prepareIndex(index);
    const q = typeof query === 'string' ? parseQuery(query) : query;
    const cat = opts && opts.category;
    const docOk = d => !cat || d.c === cat;
    const sections = [], seen = new Set();
    if (!q.nq) return { sections, docs: [], seen, q };
    for (const s of index.sections) {
      const doc = index.docs[s.d];
      if (!docOk(doc)) continue;
      let tier = 0;
      const hh = s.u ? '' : s._h; // 목차 없이 나눈 구간의 이름은 제목이 아니므로 업무명 검색에서 뺀다
      if (hh && hh === q.nq) tier = TIER.EXACT;
      else if (hh && (hh.includes(q.nq) || allTerms([hh], q))) tier = TIER.TITLE;
      else if (fieldHit(s._k, q) || (allTerms([hh, ...s._k], q) && s._k.length)) tier = TIER.KEYWORD;
      if (tier) { sections.push({ tier, sec: s, doc }); seen.add(s._ref); }
    }
    sections.sort((a, b) => a.tier - b.tier || a.sec.d - b.sec.d || a.sec.s - b.sec.s);
    const docs = index.docs.filter(d => docOk(d) && (fieldHit([d._t, ...d._k], q) || allTerms([d._t, ...d._k], q)))
      .map(doc => ({ tier: TIER.DOC, doc }));
    return { sections, docs, seen, q };
  }

  /**
   * 본문 검색 준비: 2글자 조각 색인에서 모든 단어를 포함할 수 있는 업무 후보를 고른다.
   * 1글자 단어만 있으면 본문 검색을 하지 않는다(null).
   */
  async function bodyCandidates(index, slug, q, fetchJSON, opts, exclude) {
    prepareIndex(index);
    const grams = [...new Set(q.terms.flatMap(t => t.length >= 2 ? N.bigrams(t) : []))];
    if (!grams.length) return null;
    const files = [...new Set(grams.map(g => N.shardOf(g, index.shard_count)))];
    const shards = new Map(await Promise.all(files.map(async f => [f, await fetchJSON(`data/search/${slug}/${String(f).padStart(3, '0')}.json`)])));
    let set = null;
    for (const g of grams) {
      const enc = (shards.get(N.shardOf(g, index.shard_count)).b || {})[g];
      const list = new Set(N.decodeList(enc));
      set = set ? new Set([...set].filter(v => list.has(v))) : list;
      if (!set.size) break;
    }
    const cat = opts && opts.category;
    return [...set].sort((a, b) => a - b)
      .map(r => index._byRef.get(r))
      .filter(s => s && !(exclude && exclude.has(s._ref)) && (!cat || index.docs[s.d].c === cat));
  }

  /** 여러 단어를 한 번에 강조할 정규식 */
  function termsRegex(rawTerms, flags) {
    const parts = rawTerms.map(t => N.looseRegex(t)).filter(Boolean).map(r => r.source);
    return parts.length ? new RegExp(parts.join('|'), flags || 'gi') : null;
  }
  function highlightTerms(text, rawTerms) {
    const s = String(text || '');
    const re = termsRegex(rawTerms || [], 'gi');
    if (!re) return N.esc(s);
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += N.esc(s.slice(last, m.index)) + '<mark>' + N.esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    return out + N.esc(s.slice(last));
  }

  /** 업무 본문에서 모든 단어가 실제로 있는지 확인하고, 첫 일치 위치의 쪽과 미리보기를 만든다 */
  function verifySection(detail, secId, q) {
    const s = (detail.sections || []).find(x => x.id === secId);
    if (!s) return null;
    const blocks = (detail.blocks || []).slice(s.block_start, s.block_end + 1);
    const text = blocks.map(b => b.text).join('\n\n');
    for (const t of q.rawTerms) { const re = N.looseRegex(t, 'i'); if (!re || !re.test(text)) return null; }
    const first = q.rawTerms[0];
    const hitBlock = blocks.find(b => N.looseRegex(first, 'i').test(b.text)) || blocks[0];
    const snip = N.snippet(text, first, 50, 150);
    return { snippet: snip.text, page: hitBlock ? hitBlock.pdf_page : null, printed: hitBlock ? hitBlock.printed_page : null };
  }

  /** 업무 상세: 본문(쪽 표시 포함)과 서식 목록 */
  function sectionDetail(detail, secId) {
    const s = (detail.sections || []).find(x => x.id === secId);
    if (!s) return null;
    const blocks = (detail.blocks || []).slice(s.block_start, s.block_end + 1).map(b => ({ pdf_page: b.pdf_page, printed_page: b.printed_page, text: b.text }));
    const seen = new Set();
    const forms = (detail.links || []).filter(l => l.section_id === secId && l.form_no != null)
      .sort((a, b) => a.form_no - b.form_no).filter(l => !seen.has(l.form_no) && seen.add(l.form_no))
      .map(l => ({ no: l.form_no, name: l.text, page: l.bundle_page == null ? null : l.bundle_page }));
    return { section: s, blocks, forms, bundle: detail.forms_bundle || {}, works_url: detail.works_url || '' };
  }

  /** 쪽 표시: "PDF 26쪽(인쇄 22쪽)", 범위는 "PDF 23~24쪽(인쇄 19~20쪽)" */
  function pageLabel(pdf, printed) {
    const range = a => !a || !a.length ? '' : a.length === 1 || a[0] === a[a.length - 1] ? String(a[0]) : `${a[0]}~${a[a.length - 1]}`;
    const p = range(pdf), pp = range(printed);
    if (!p) return '';
    return pp ? `PDF ${p}쪽(인쇄 ${pp}쪽)` : `PDF ${p}쪽`;
  }

  /** 안전한 링크 주소(http/https만) */
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }

  /**
   * 데이터 불러오기 도우미. base: 사이트 주소(끝에 /), fetchImpl: fetch
   * manifest는 매번 새로 받고, 나머지는 manifest 생성 시각을 붙여 캐시를 안전하게 쓴다.
   */
  function createLoader(fetchImpl, base) {
    base = base || '';
    const cache = new Map();
    let version = '';
    async function get(path, fresh) {
      const url = base + path + (fresh ? `?t=${Date.now()}` : version ? `?v=${encodeURIComponent(version)}` : '');
      const r = await fetchImpl(url, fresh ? { cache: 'no-store' } : undefined);
      if (!r.ok) { const e = new Error(`${path}: ${r.status}`); e.status = r.status; throw e; }
      return r.json();
    }
    return {
      async manifest() { const m = await get('data/manifest.json', true); version = m.generated_at || ''; return m; },
      fetchJSON(path) {
        if (!cache.has(path)) cache.set(path, get(path).catch(e => { cache.delete(path); throw e; }));
        return cache.get(path);
      },
      level(slug) { return this.fetchJSON(`data/indexes/${slug}.json`).then(prepareIndex); },
      doc(id) { return this.fetchJSON(`data/documents/${id}.json`); }
    };
  }

  return { TIER, TIER_LABEL, parseQuery, prepareIndex, metaSearch, bodyCandidates, verifySection, sectionDetail, highlightTerms, pageLabel, safeUrl, createLoader };
});
