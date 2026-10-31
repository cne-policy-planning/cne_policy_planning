/*
 * 데이터 스키마 v2 · 문서 생성 · v1 JSON 변환
 */
(function (root, factory) {
  const deps = root.SAS || (typeof require === 'function'
    ? Object.assign({}, require('./normalize.js'), require('./textlayout.js'), require('./sectionizer.js'), require('./outline.js')) : {});
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
    { name: '특수', slug: 'special' },
    // 공통: 모든 학교급에 해당하는 자료. 다른 학교급과 함께 고르지 않는다.
    // 사용자 화면에서 각 학교급을 누르면 그 학교급 자료 아래에 공통 자료가 함께 나온다.
    { name: '공통', slug: 'common' }
  ];
  const COMMON_LEVEL = '공통';
  const TEXT_FORMATS = ['pdf', 'hwpx'];
  const ORIGIN_SITES = ['학교업무자료실', '기본계획나눔방', '부서별자료실', '학교업무최적화자료실'];
  // 부서(자료를 만든 도교육청 부서). 관리자 도구 드롭다운에 이 순서(가나다순)로 나옵니다.
  // 조직개편으로 이름이 바뀌면 이 목록만 고치면 됩니다. 목록에 없는 기존 값은 "목록에 없음"으로 표시됩니다.
  // 학교업무자료실의 교무학사 도움자료는 부서 대신 '교무학사 공통자료'로 묶습니다.
  const ACADEMIC_COMMON = '교무학사 공통자료';
  const OTHER_DEPT = '기타 부서';
  const OTHER_DEPT_MAX = 2;   // 전체 자료가 이 수 이하인 부서는 사용자 화면에서 '기타 부서'로 묶는다
  // 원본 파일 창고: GitHub Pages는 사이트 하나에 1GB까지라, 원본 파일(PDF·HWP·엑셀…)은 연도별 창고 저장소에 나눠 담는다.
  // 창고 이름 = <STORAGE_PREFIX>_<연도>_<번호> (예: cne_files_2026_1). 같은 계정(조직) 아래에 만들어 같은 주소로 열린다.
  const STORAGE_PREFIX = 'cne_files';
  const STORAGE_MAX = 900 * 1024 * 1024;     // 창고 하나에 담을 최대 크기(1GB 한도보다 여유 있게)
  const FILE_MAX = 95 * 1024 * 1024;         // 파일 하나 최대(GitHub 한 파일 100MB 한도)
  const DEPARTMENTS = [ACADEMIC_COMMON, '감사관', '교원인사과', '교육과정평가지원부', '미래인재과', '미래학교추진단', '민주시민교육과', '소통담당관',
    '안전총괄과', '예산과', '유아교육복지과', '재무과', '정책기획과', '중등교육과', '진로융합부', '체육건강과', '초등특수교육과', '총무과', '학교지원과']
    .sort((a, b) => a.localeCompare(b, 'ko'));
  // 업무 분류(고정 목록). 관리자 도구의 드롭다운과 사용자 화면에서 이 순서대로 씁니다.
  // 바꿀 때는 이 목록만 고치면 됩니다. 이미 등록된 자료의 분류가 목록에 없으면 "목록에 없음"으로 표시됩니다.
  const CATEGORIES = ['교무학사실무'];

  function levelSlug(name) { const l = LEVELS.find(x => x.name === name); return l ? l.slug : null; }
  function levelName(slug) { const l = LEVELS.find(x => x.slug === slug); return l ? l.name : null; }
  /**
   * 사이트에서 파일을 여는 주소. ref = { repo, path }.
   * 창고에 있으면 '../<창고>/<경로>'(같은 github.io 주소 아래), 예전처럼 본 저장소에 있으면 그 경로 그대로.
   */
  function fileUrl(ref) {
    if (!ref || !ref.path) return '';
    return ref.repo ? `../${ref.repo}/${ref.path}` : ref.path;
  }
  /** 원본 파일 정보(창고 배정 전): 모든 형식 */
  function makeOriginal(id, filename, bytes, format) {
    const ext = String(format || formatOf(filename) || 'bin').toLowerCase();
    return { name: String(filename || '').replace(/\+/g, ' ').trim(), bytes: bytes || 0, format: ext, repo: null, path: `files/${id}.${ext}` };
  }
  /**
   * 반영할 원본 파일을 연도별 창고에 배정한다(문서 객체를 고친다).
   * docs: 전체 자료, ids: 이번에 올릴 자료 ID, opts: { prefix, max, year(기본 연도) }
   * 반환 { repos: [이번에 쓰는 창고 이름], assigned: Map(id → repo) }
   * - 올리는 해(opts.year, 기본 올해)의 창고에 담는다(자료 연도가 아니라 올리는 해: 2025·2018년판 자료도 올해 창고에).
   *   이미 같은 해 창고에 있으면 그 자리를 그대로 쓴다(덮어쓰기). 다음 해에 새 판으로 바꾸면 다음 해 창고로 간다.
   * - 창고가 차면(max) 다음 번호 창고로.
   */
  function planStorage(docs, ids, opts) {
    opts = opts || {};
    const prefix = opts.prefix || STORAGE_PREFIX, max = opts.max || STORAGE_MAX, thisYear = opts.year || new Date().getFullYear();
    const want = new Set(ids);
    const used = new Map();
    const add = (repo, n) => used.set(repo, (used.get(repo) || 0) + n);
    docs.forEach(d => { if (!want.has(d.id) && d.original && d.original.repo) add(d.original.repo, d.original.bytes || 0); });
    const assigned = new Map(), repos = new Set();
    const yearOf = repo => (String(repo).match(/_(\d{4})_\d+$/) || [])[1];
    docs.filter(d => want.has(d.id)).forEach(d => {
      if (!d.original) {
        if (!d.pdf) return;
        d.original = makeOriginal(d.id, d.filename || `${d.id}.pdf`, d.pdf.bytes, 'pdf');
      }
      const o = d.original, y = String(thisYear), bytes = o.bytes || 0;
      let repo = o.repo && yearOf(o.repo) === y && (used.get(o.repo) || 0) + bytes <= max ? o.repo : null;
      for (let n = 1; !repo; n++) { const name = `${prefix}_${y}_${n}`; if ((used.get(name) || 0) + bytes <= max || n > 50) repo = name; }
      o.repo = repo; o.path = `files/${d.id}.${o.format}`;
      if (o.format === 'pdf') d.pdf = { repo, path: o.path, bytes };
      add(repo, bytes); assigned.set(d.id, repo); repos.add(repo);
    });
    return { repos: [...repos].sort(), assigned };
  }
  /** 창고별로 지금 쓰고 있는 크기 */
  function storageUsage(docs) {
    const m = new Map();
    docs.forEach(d => { if (d.original && d.original.repo) m.set(d.original.repo, (m.get(d.original.repo) || 0) + (d.original.bytes || 0)); });
    return m;
  }

  /** 학교급 정리: 목록에 있는 값만, 공통은 다른 학교급과 함께 쓰지 않는다(공통이 있으면 공통만) */
  function cleanLevels(list) {
    const v = [...new Set((list || []).filter(levelSlug))];
    return v.includes(COMMON_LEVEL) ? [COMMON_LEVEL] : LEVELS.map(l => l.name).filter(n => v.includes(n));
  }
  /** 원 출처로 짐작한 부서(학교업무자료실 → 교무학사 공통자료) */
  function defaultDepartment(meta) {
    return meta && meta.origin && meta.origin.site === '학교업무자료실' ? ACADEMIC_COMMON : '';
  }
  /**
   * 사용자 화면에서 묶을 부서 이름. counts = 전체 자료의 부서별 건수.
   * 부서가 비었거나 전체 자료가 OTHER_DEPT_MAX건 이하이면 '기타 부서'.
   */
  function deptGroup(dept, counts) {
    const d = String(dept || '').trim();
    if (!d) return OTHER_DEPT;
    if (d === ACADEMIC_COMMON) return d;
    return counts && (counts[d] || 0) > OTHER_DEPT_MAX ? d : OTHER_DEPT;
  }

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
      school_levels: cleanLevels(meta.school_levels),
      category: (meta.category || '').trim(),
      department: (meta.department || defaultDepartment(meta) || '').trim(),
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
        w: b.w, h: b.h,
        links: b.links || []
      })),
      sections: [],
      links: [],
      forms_bundle: Object.assign({ works_url: '', filename: '', page_count: null, matched_at: null }, meta.forms_bundle || {}),
      // 원본 PDF(사이트에 함께 올려 쪽 보기에 쓴다): { path: 'pdf/<id>.pdf', bytes, sha }
      pdf: meta.pdf || null,
      outline: null,
      outline_edits: {},
      extraction: { toc_found: false, warnings: [], extracted_at: now }
    };
    if (doc.kind === 'text') {
      const r = N.sectionize(doc);
      doc.sections = r.sections;
      doc.links = N.attachLinks(doc);
      doc.links.forEach(l => { l.type = N.linkType(l.text, l.url); });
      numberForms(doc);
      const o = N.buildOutline(doc);
      doc.outline = { nodes: o.nodes, built_at: now, stats: o.stats };
      doc.extraction.toc_found = !!r.toc_found;
      doc.extraction.warnings = r.warnings || [];
      if (!doc.blocks.some(b => N.norm(b.text).length > 20)) doc.extraction.warnings.unshift('추출된 글자가 거의 없습니다. 스캔 PDF(이미지)일 수 있으며 OCR은 지원하지 않습니다.');
    }
    return finalizeDocument(doc);
  }

  /**
   * 서식 번호 매기기: 내려받기 서식(file 링크)에 업무 순서대로 1번부터 번호를 준다.
   * 같은 주소의 서식은 한 번만 번호를 받는다(서식 모음에 한 번만 들어가므로).
   * 관리자가 직접 추가한 서식(manual)은 자동으로 찾은 서식 뒤에 추가한 순서대로 번호를 받는다.
   * 그래서 직접 추가해도 기존 번호가 바뀌지 않고, 서식 모음 파일 끝에 이어 붙이면 된다.
   */
  function numberForms(doc) {
    const byKey = new Map();
    let no = 0;
    const links = doc.links || [];
    [...links.filter(l => !l.manual), ...links.filter(l => l.manual)].forEach(l => {
      if (l.kind !== 'file') { l.form_no = null; return; }
      const key = l.url ? l.url : 'manual:' + l.id;
      if (!byKey.has(key)) byKey.set(key, ++no);
      l.form_no = byKey.get(key);
      if (l.bundle_page === undefined) l.bundle_page = null;
    });
    return no;
  }

  /** 서식 직접 추가: names(여러 개 가능)를 업무 secId에 붙인다. 추가된 링크 목록을 반환 */
  function addManualForms(doc, secId, names, url) {
    const sec = (doc.sections || []).find(s => s.id === secId);
    if (!sec) throw new Error('업무를 선택해 주세요.');
    doc.links = doc.links || [];
    const used = new Set(doc.links.map(l => l.id));
    let n = 1;
    const added = N.splitList(names).map(text => {
      while (used.has('man-' + String(n).padStart(4, '0'))) n++;
      const id = 'man-' + String(n).padStart(4, '0'); used.add(id);
      const l = { id, text, url: (url || '').trim(), kind: 'file', block: sec.block_start, section_id: secId, manual: true, form_no: null, bundle_page: null };
      doc.links.push(l);
      return l;
    });
    numberForms(doc);
    return added;
  }

  /** 직접 추가한 서식 삭제(자동으로 찾은 서식은 지우지 않는다) */
  function removeManualForm(doc, linkId) {
    const before = (doc.links || []).length;
    doc.links = (doc.links || []).filter(l => !(l.manual && l.id === linkId));
    numberForms(doc);
    return before !== doc.links.length;
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

  /** 자료 교체 시 서식 모음 정보와 쪽수를 주소 기준으로 옮긴다. 직접 추가한 서식은 같은 이름의 업무로 옮긴다 */
  function carryForms(oldDoc, newDoc) {
    newDoc.forms_bundle = Object.assign({}, oldDoc.forms_bundle || {});
    const byUrl = new Map((oldDoc.links || []).filter(l => l.form_no != null && !l.manual).map(l => [l.url, l]));
    let kept = 0;
    (newDoc.links || []).forEach(l => { const o = byUrl.get(l.url); if (o && o.bundle_page != null) { l.bundle_page = o.bundle_page; kept++; } });
    const secByName = new Map((newDoc.sections || []).map(s => [N.norm(s.heading), s]));
    (oldDoc.links || []).filter(l => l.manual).forEach(l => {
      const os = (oldDoc.sections || []).find(s => s.id === l.section_id);
      const ns = os ? secByName.get(N.norm(os.heading)) : null;
      if (!ns) return;
      newDoc.links = newDoc.links || [];
      newDoc.links.push(Object.assign({}, l, { section_id: ns.id, block: ns.block_start }));
      if (l.bundle_page != null) kept++;
    });
    numberForms(newDoc);
    return kept;
  }

  /** 저장 전 정리: 작업용 필드 제거, 섹션 쪽수 계산 */
  function finalizeDocument(doc) {
    // 예전 자료(부서 칸이 생기기 전)는 원 출처로 부서를 채운다
    if (doc.department == null) doc.department = defaultDepartment(doc);
    doc.blocks = (doc.blocks || []).map(b => {
      const o = { n: b.n, pdf_page: b.pdf_page, printed_page: b.printed_page, footer_label: b.footer_label || '', text: b.text };
      if (b.w) { o.w = b.w; o.h = b.h; }
      return o;
    });
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
      const levels = [d.school_level].filter(Boolean);
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
    else if (doc.school_levels.includes(COMMON_LEVEL) && doc.school_levels.length > 1) errors.push('공통은 다른 학교급과 함께 고를 수 없습니다(공통만 고르거나 해당 학교급만 고르세요)');
    if (!doc.department && (doc.school_levels || []).includes(COMMON_LEVEL)) warnings.push('부서가 비어 있습니다. 사용자 화면에서 「기타 부서」로 묶입니다');
    if (doc.works_url && !/^https?:\/\//i.test(doc.works_url)) errors.push('원본 내려받기 링크가 http(s)로 시작하지 않습니다');
    if (doc.format === 'pdf' && !doc.pdf) warnings.push('원본 PDF가 사이트에 없습니다. 「파일 교체」로 PDF를 다시 넣으면 쪽 보기가 됩니다');
    if (doc.pdf && !/^(pdf|files)\/[a-z0-9-]+\.pdf$/.test(doc.pdf.path || '')) errors.push('원본 PDF 경로 형식 오류');
    if (doc.original && !/^files\/[a-z0-9-]+\.[a-z0-9]+$/.test(doc.original.path || '')) errors.push('원본 파일 경로 형식 오류');
    if (doc.original && doc.original.repo && !/^[A-Za-z0-9._-]+$/.test(doc.original.repo)) errors.push('원본 파일 창고 이름 오류');
    if (!doc.works_url && !doc.pdf && !doc.original) warnings.push('사이트에서 내려받을 원본 파일이 없습니다. 「③ 점검·반영 → 원본 파일 다시 연결」로 넣을 수 있습니다');
    if (doc.kind === 'text' && doc.format === 'pdf' && !doc.outline) warnings.push('번호 목차가 없습니다. 「파일 교체」로 PDF를 다시 분석해 주세요');
    const suspect = (doc.links || []).filter(l => N.isSuspectUrl(l.url)).length;
    if (suspect) warnings.push(`주소가 잘린 것으로 보이는 링크 ${suspect}개(누르면 찾을 수 없다고 나올 수 있음) — 「링크 점검」에서 고칠 수 있습니다`);
    // PDF 안 링크 중 웹 주소가 아닌 것(이메일·작성자 PC의 파일·글자만 있는 링크)은 사용자 화면에서 열리지 않을 뿐이라 반영은 막지 않는다
    const badLinks = (doc.links || []).filter(l => l.url && !/^https?:\/\//i.test(String(l.url).trim()));
    if (badLinks.length) warnings.push(`웹 주소가 아닌 링크 ${badLinks.length}개는 사용자 화면에서 열리지 않습니다(예: ${badLinks.slice(0, 2).map(l => l.text).join(', ')}) — 「링크 점검」에서 올바른 주소로 고칠 수 있습니다`);
    const nb = (doc.blocks || []).length;
    (doc.sections || []).forEach(s => {
      if (!s.heading) errors.push(`${s.id}: 업무명이 비어 있습니다`);
      if (!(s.block_start >= 0 && s.block_end >= s.block_start && s.block_end < nb)) errors.push(`${s.id}: 쪽 범위가 잘못됐습니다`);
    });
    const sids = new Set((doc.sections || []).map(s => s.id));
    if (sids.size !== (doc.sections || []).length) errors.push('업무 ID가 중복됩니다');
    if (doc.kind === 'text' && !(doc.sections || []).length) warnings.push('업무 구간이 없습니다(본문 검색 불가)');
    if (doc.forms_bundle && doc.forms_bundle.works_url && !/^https?:\/\//i.test(doc.forms_bundle.works_url)) errors.push('서식 모음 링크가 http(s)로 시작하지 않습니다');
    return { errors, warnings };
  }

  /** 링크 주소 고치기: 처음 주소는 url_orig에 남긴다(빈 값이면 처음 주소로 되돌림) */
  function setLinkUrl(doc, id, url) {
    const l = (doc.links || []).find(x => x.id === id);
    if (!l) return null;
    const v = String(url || '').trim();
    if (!l.url_orig) l.url_orig = l.url;
    l.url = v || l.url_orig;
    if (l.url === l.url_orig) delete l.url_orig;
    l.kind = N.linkKind(l.url);
    return l;
  }
  /** 링크 이름·종류 고치기 */
  function setLinkInfo(doc, id, info) {
    const l = (doc.links || []).find(x => x.id === id);
    if (!l) return null;
    if (info.text != null && String(info.text).trim()) { if (!l.text_orig) l.text_orig = l.text; l.text = String(info.text).trim(); }
    if (info.type) { l.type = info.type; l.type_set = true; }
    return l;
  }
  /** 자료 교체 시 관리자가 고친 링크(주소·이름·종류)를 처음 주소가 같은 링크로 옮긴다 */
  function carryLinkEdits(oldDoc, newDoc) {
    const byOrig = new Map();
    (oldDoc.links || []).forEach(l => { if (l.url_orig || l.text_orig || l.type_set) byOrig.set(l.url_orig || l.url, l); });
    let n = 0;
    (newDoc.links || []).forEach(l => {
      const o = byOrig.get(l.url);
      if (!o) return;
      if (o.url_orig) { l.url_orig = l.url; l.url = o.url; l.kind = N.linkKind(l.url); }
      if (o.text_orig) { l.text_orig = l.text; l.text = o.text; }
      if (o.type_set) { l.type = o.type; l.type_set = true; }
      n++;
    });
    // 새 파일의 원본이 따로 있으면(창고 방식) 예전 PDF를 이어 쓰지 않는다
    if (oldDoc.pdf && !newDoc.pdf && !newDoc.original) newDoc.pdf = oldDoc.pdf;
    return n;
  }
  /** 업무명을 고치면 목차의 업무 제목도 같이 */
  function syncOutline(doc) {
    if (!doc.outline || !doc.outline.nodes) return;
    const byId = new Map((doc.sections || []).map(s => [s.id, s]));
    doc.outline.nodes.forEach(n => { if (n.k === 'task' && n.s && byId.has(n.s)) n.t = byId.get(n.s).heading; });
  }

  return { STORAGE_PREFIX, STORAGE_MAX, FILE_MAX, fileUrl, makeOriginal, planStorage, storageUsage, COMMON_LEVEL, ACADEMIC_COMMON, OTHER_DEPT, OTHER_DEPT_MAX, DEPARTMENTS, cleanLevels, defaultDepartment, deptGroup, setLinkUrl, setLinkInfo, carryLinkEdits, syncOutline, SCHEMA_VERSION, LEVELS, TEXT_FORMATS, ORIGIN_SITES, CATEGORIES, levelSlug, levelName, formatOf, kindOf, newDocId, titleFromFilename, createDocument, finalizeDocument, carryKeywords, carryForms, numberForms, addManualForms, removeManualForm, formList, matchBundle, migrateV1, validateDocument };
});
