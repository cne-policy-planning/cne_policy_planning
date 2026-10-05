/*
 * 데이터 스키마 v2 · 문서 생성 · v1 JSON 변환
 */
(function (root, factory) {
  const deps = root.SAS || (typeof require === 'function'
    ? Object.assign({}, require('./normalize.js'), require('./textlayout.js'), require('./sectionizer.js')) : {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAS = Object.assign(root.SAS || {}, api);
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  const SCHEMA_VERSION = '2.0';
  const LEVELS = [
    { name: '유아', slug: 'kindergarten' },
    { name: '초등', slug: 'elementary' },
    { name: '중등', slug: 'middle' },
    { name: '특수', slug: 'special' }
  ];
  const TEXT_FORMATS = ['pdf', 'hwpx'];
  const ORIGIN_SITES = ['학교업무자료실', '부서별자료실', '학교업무최적화자료실'];

  function levelSlug(name) { const l = LEVELS.find(x => x.name === name); return l ? l.slug : null; }
  function levelName(slug) { const l = LEVELS.find(x => x.slug === slug); return l ? l.name : null; }

  function formatOf(filename) {
    const m = String(filename || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return m ? m[1] : 'etc';
  }
  function kindOf(format) { return TEXT_FORMATS.includes(format) ? 'text' : 'link'; }

  /** 바뀌지 않는 문서 ID: doc-연도-무작위6자 */
  function newDocId(existing, year) {
    const used = new Set(existing || []);
    const y = /^\d{4}$/.test(String(year)) ? year : new Date().getFullYear();
    for (;;) {
      const r = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
      const id = `doc-${y}-${r}`;
      if (!used.has(id)) return id;
    }
  }

  function titleFromFilename(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/[+_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * 추출 결과(blocks)와 메타데이터로 v2 문서를 만든다.
   * meta: {id,title,school_levels,category,year,filename,format,works_url,origin,search_keywords}
   */
  function createDocument(meta, blocks, existingIds) {
    const format = meta.format || formatOf(meta.filename);
    const now = new Date().toISOString();
    const doc = {
      schema_version: SCHEMA_VERSION,
      id: meta.id || newDocId(existingIds, meta.year),
      title: (meta.title || titleFromFilename(meta.filename) || '제목 없음').trim(),
      school_levels: (meta.school_levels || []).filter(levelSlug),
      category: (meta.category || '').trim(),
      year: meta.year ? Number(meta.year) : null,
      format,
      kind: kindOf(format),
      filename: meta.filename || '',
      works_url: (meta.works_url || '').trim(),
      origin: { site: (meta.origin && meta.origin.site) || '', url: (meta.origin && meta.origin.url) || '', note: (meta.origin && meta.origin.note) || '' },
      search_keywords: N.splitList(meta.search_keywords),
      created_at: meta.created_at || now,
      updated_at: now,
      blocks: (blocks || []).map((b, i) => ({
        n: i,
        pdf_page: b.pdf_page == null ? null : b.pdf_page,
        printed_page: b.printed_page == null ? null : b.printed_page,
        footer_label: b.footer_label || '',
        text: b.text || '',
        lines: b.lines,
        links: b.links || []
      })),
      sections: [],
      links: [],
      forms_bundle: Object.assign({ works_url: '', filename: '', page_count: null, matched_at: null }, meta.forms_bundle || {}),
      extraction: { toc_found: false, warnings: [], extracted_at: now }
    };
    if (doc.kind === 'text') {
      const r = N.sectionize(doc);
      doc.sections = r.sections;
      doc.links = N.attachLinks(doc);
      numberForms(doc);
      doc.extraction.toc_found = !!r.toc_found;
      doc.extraction.warnings = r.warnings || [];
      if (!doc.blocks.some(b => N.norm(b.text).length > 20)) doc.extraction.warnings.unshift('추출된 글자가 거의 없습니다. 스캔 PDF(이미지)일 수 있으며 OCR은 지원하지 않습니다.');
    }
    return finalizeDocument(doc);
  }

  /**
   * 서식 번호 매기기: 내려받기 서식(file 링크)에 업무 순서대로 1번부터 번호를 준다.
   * 같은 주소의 서식은 한 번만 번호를 받는다(서식 모음에 한 번만 들어가므로).
   */
  function numberForms(doc) {
    const byUrl = new Map();
    let no = 0;
    (doc.links || []).forEach(l => {
      if (l.kind !== 'file') { l.form_no = null; return; }
      if (!byUrl.has(l.url)) byUrl.set(l.url, ++no);
      l.form_no = byUrl.get(l.url);
      if (l.bundle_page === undefined) l.bundle_page = null;
    });
    return no;
  }

  /** 서식 목록(번호순, 중복 제거) */
  function formList(doc) {
    const seen = new Set();
    return (doc.links || []).filter(l => l.form_no != null).sort((a, b) => a.form_no - b.form_no)
      .filter(l => !seen.has(l.form_no) && seen.add(l.form_no));
  }

  /**
   * 완성된 서식 모음(PDF 또는 HWPX에서 추출한 blocks)에서 각 서식의 위치를 찾는다.
   * 번호 순서대로 앞에서부터 찾으므로 같은 이름의 서식도 순서가 맞으면 구분된다.
   * 반환 { found, missing:[form_no...] } — PDF는 bundle_page(쪽)를 채운다.
   */
  function matchBundle(doc, blocks) {
    const forms = formList(doc);
    // '(예시)' 표기는 서식 모음에서 빠지는 경우가 많아 양쪽에서 모두 지우고 비교한다
    const strip = t => N.norm(t).replace(/예시\d*/g, '');
    const pages = blocks.map(b => strip(b.text));
    const hasPages = blocks.some(b => b.pdf_page != null);
    let from = 0, found = 0;
    const missing = [];
    const keyOf = t => strip(t).slice(0, 14);
    forms.forEach(f => {
      const key = keyOf(f.text);
      let hit = -1;
      if (key.length >= 3) {
        for (let i = from; i < pages.length; i++) if (pages[i].includes(key)) { hit = i; break; }
        if (hit < 0) for (let i = 0; i < from; i++) if (pages[i].includes(key)) { hit = i; break; }
      }
      const page = hit >= 0 ? (hasPages ? (blocks[hit].pdf_page || hit + 1) : null) : null;
      (doc.links || []).filter(l => l.form_no === f.form_no).forEach(l => { l.bundle_page = page; l.bundle_found = hit >= 0; });
      if (hit >= 0) { found++; from = hit; } else missing.push(f.form_no);
    });
    doc.forms_bundle = Object.assign(doc.forms_bundle || {}, { page_count: hasPages ? blocks.length : null, matched_at: new Date().toISOString() });
    return { found, total: forms.length, missing, hasPages };
  }

  /** 자료 교체 시 서식 모음 정보와 쪽수를 주소 기준으로 옮긴다 */
  function carryForms(oldDoc, newDoc) {
    newDoc.forms_bundle = Object.assign({}, oldDoc.forms_bundle || {});
    const byUrl = new Map((oldDoc.links || []).filter(l => l.form_no != null).map(l => [l.url, l]));
    let kept = 0;
    (newDoc.links || []).forEach(l => { const o = byUrl.get(l.url); if (o && o.bundle_page != null) { l.bundle_page = o.bundle_page; kept++; } });
    return kept;
  }

  /** 저장 전 정리: 작업용 필드 제거, 섹션 쪽수 계산 */
  function finalizeDocument(doc) {
    doc.blocks = (doc.blocks || []).map(b => ({ n: b.n, pdf_page: b.pdf_page, printed_page: b.printed_page, footer_label: b.footer_label || '', text: b.text }));
    doc.sections = (doc.sections || []).map(s => Object.assign({}, s, N.sectionPages(doc, s), { keywords: N.splitList(s.keywords) }));
    return doc;
  }

  /** 기존 섹션 검색어를 새 섹션으로 옮긴다(자료 교체·재분할 시). 업무명이 같은 것끼리 연결 */
  function carryKeywords(oldDoc, newDoc) {
    const map = new Map((oldDoc.sections || []).map(s => [N.norm(s.heading), s]));
    let carried = 0;
    (newDoc.sections || []).forEach(s => {
      const o = map.get(N.norm(s.heading));
      if (o && o.keywords && o.keywords.length) { s.keywords = o.keywords.slice(); carried++; }
      if (o && o.auto === false) { s.heading = o.heading; s.parent_heading = o.parent_heading; }
    });
    return carried;
  }

  /** v1 조각을 페이지 텍스트로 되돌린다(겹친 부분 제거) */
  function v1Pages(doc) {
    const m = new Map();
    for (const c of doc.chunks || []) {
      const n = Number(c.location) || 0;
      if (!m.has(n)) m.set(n, []);
      m.get(n).push(c);
    }
    return [...m].sort((a, b) => a[0] - b[0]).map(([n, cs]) => {
      cs.sort((a, b) => (a.part || 0) - (b.part || 0));
      let t = '';
      for (const c of cs) {
        const x = N.clean(c.text);
        let overlap = 0;
        for (let i = Math.min(t.length, x.length, 600); i >= 20; i--) if (t.slice(-i) === x.slice(0, i)) { overlap = i; break; }
        t += (t && !overlap ? '\n' : '') + x.slice(overlap);
      }
      return { location: n, type: (cs[0] && cs[0].location_type) || 'page', text: t };
    });
  }

  /** v1 JSON(schema 1.0) → v2 문서 배열 */
  function migrateV1(json, existingIds) {
    if (!json || !Array.isArray(json.documents)) throw new Error('v1 형식이 아닙니다(documents 배열 없음).');
    const ids = new Set(existingIds || []);
    return json.documents.map(d => {
      const pages = v1Pages(d);
      const isPdf = (d.format || '').toLowerCase() === 'pdf';
      let blocks;
      if (isPdf) {
        // 빈 페이지 번호도 자리를 유지해야 쪽수가 맞는다
        const max = Math.max(d.section_count || 0, ...pages.map(p => p.location));
        const texts = Array.from({ length: max }, (_, i) => (pages.find(p => p.location === i + 1) || { text: '' }).text);
        blocks = N.analyzeTextPages(texts);
      } else {
        blocks = pages.flatMap(p => N.clean(p.text).split('\n').filter(Boolean).map(t => ({ pdf_page: null, printed_page: null, text: t })));
      }
      const levels = d.school_level === '공통' ? LEVELS.map(l => l.name) : [d.school_level].filter(Boolean);
      const year = (String(d.title || '').match(/(20\d{2})/) || [])[1];
      const doc = createDocument({
        title: titleFromFilename(d.title || d.filename),
        school_levels: levels,
        category: d.category,
        year,
        filename: d.filename,
        format: (d.format || '').toLowerCase(),
        works_url: d.source_url,
        search_keywords: d.search_keywords
      }, blocks, [...ids]);
      ids.add(doc.id);
      doc.legacy_id = d.id;
      // v1 페이지별 검색어 → 해당 페이지를 포함하는 업무의 검색어로
      const pk = d.page_keywords || {};
      Object.keys(pk).forEach(page => {
        const bi = doc.blocks.findIndex(b => b.pdf_page === Number(page));
        const owners = doc.sections.filter(s => bi >= s.block_start && bi <= s.block_end);
        const target = owners[owners.length - 1];
        if (target) target.keywords = N.splitList([...(target.keywords || []), ...N.splitList(pk[page])]);
      });
      doc.extraction.warnings.push('v1 JSON에서 변환했습니다. 원본 파일로 다시 추출하면 띄어쓰기와 서식 링크가 더 정확해집니다.');
      return doc;
    });
  }

  /** 문서 하나의 형식 검사. 문제 목록을 반환 */
  function validateDocument(doc) {
    const errors = [], warnings = [];
    if (!doc.id || !/^doc-[a-z0-9-]+$/.test(doc.id)) errors.push('문서 ID 형식 오류');
    if (!doc.title) errors.push('자료명이 비어 있습니다');
    if (!doc.school_levels || !doc.school_levels.length) errors.push('학교급이 선택되지 않았습니다');
    if (!doc.works_url) warnings.push('웍스 링크가 없습니다(내려받기 버튼이 비활성화됩니다)');
    else if (!/^https?:\/\//i.test(doc.works_url)) errors.push('웍스 링크가 http(s)로 시작하지 않습니다');
    const nb = (doc.blocks || []).length;
    (doc.sections || []).forEach(s => {
      if (!s.heading) errors.push(`${s.id}: 업무명이 비어 있습니다`);
      if (!(s.block_start >= 0 && s.block_end >= s.block_start && s.block_end < nb)) errors.push(`${s.id}: 쪽 범위가 잘못됐습니다`);
    });
    const sids = new Set((doc.sections || []).map(s => s.id));
    if (sids.size !== (doc.sections || []).length) errors.push('업무 ID가 중복됩니다');
    if (doc.kind === 'text' && !(doc.sections || []).length) warnings.push('업무 구간이 없습니다(본문 검색 불가)');
    const forms = (doc.links || []).filter(l => l.form_no != null);
    if (forms.length && !(doc.forms_bundle && doc.forms_bundle.works_url)) warnings.push(`서식 ${formList(doc).length}개가 있지만 서식 모음 웍스 링크가 없습니다`);
    else if (doc.forms_bundle && doc.forms_bundle.works_url && !/^https?:\/\//i.test(doc.forms_bundle.works_url)) errors.push('서식 모음 링크가 http(s)로 시작하지 않습니다');
    return { errors, warnings };
  }

  return { SCHEMA_VERSION, LEVELS, TEXT_FORMATS, ORIGIN_SITES, levelSlug, levelName, formatOf, kindOf, newDocId, titleFromFilename, createDocument, finalizeDocument, carryKeywords, carryForms, numberForms, formList, matchBundle, migrateV1, validateDocument };
});
