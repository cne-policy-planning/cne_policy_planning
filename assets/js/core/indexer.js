/*
 * 공개 사이트용 데이터 파일 생성과 일관성 검사
 *
 * 생성 파일(모두 data/ 아래):
 *   manifest.json                 생성 시각, 학교급별 개수, 부서별 개수(기타 부서 묶음 판단용), 조각 수
 *   documents.json                전체 자료 목록과 메타데이터
 *   documents/<id>.json           자료별 상세(본문 블록·업무·서식 링크)
 *   indexes/<slug>.json           학교급별 목록 색인(업무명·검색어·서식명·업무 시작 문장)
 *   search/<slug>/<nn>.json       학교급별 본문 색인 조각(2글자 → 업무 번호 목록)
 *   toc/<slug>.json               학교급별 목차 검색 색인(목차 제목만 모은 가벼운 파일 — 사용자 화면 검색용)
 */
(function (root, factory) {
  const deps = root.SAS || (typeof require === 'function'
    ? Object.assign({}, require('./normalize.js'), require('./textlayout.js'), require('./sectionizer.js'), require('./schema.js')) : {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAS = Object.assign(root.SAS || {}, api);
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  const DEFAULT_SHARDS = 128;
  const SEC_BASE = 1000; // 업무 번호 = 자료번호 × 1000 + 업무순번

  function docSummary(d) {
    return {
      id: d.id, title: d.title, school_levels: d.school_levels, category: d.category, department: d.department || '', year: d.year,
      format: d.format, kind: d.kind, works_url: d.works_url, origin: d.origin,
      search_keywords: d.search_keywords, forms_bundle_url: (d.forms_bundle && d.forms_bundle.works_url) || '', section_count: (d.sections || []).length,
      form_count: N.formList(d).length, updated_at: d.updated_at,
      pdf: N.fileUrl(d.pdf), original: d.original ? { url: N.fileUrl(d.original), name: d.original.name, bytes: d.original.bytes, format: d.original.format } : null,
      edit: d.edit ? { url: N.fileUrl(d.edit), name: d.edit.name, bytes: d.edit.bytes, format: d.edit.format } : null, pages: (d.blocks || []).length, outline_count: d.outline && d.outline.nodes ? d.outline.nodes.length : 0
    };
  }

  function encodeList(nums) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    let prev = 0;
    return sorted.map(n => { const d = n - prev; prev = n; return d.toString(36); }).join(',');
  }

  function decodeList(s) {
    if (!s) return [];
    let acc = 0;
    return s.split(',').map(x => (acc += parseInt(x, 36)));
  }

  /**
   * 목차 검색용 줄: [번호, 종류 한 글자, 제목, 쪽 표시, (자료 종류, 주소)]
   * 종류: c 단원 · t 업무 · p 부분 · g 묶음 · i 항목 · l 자료(서식 등). ▸ 세부 줄(bullet)은 검색하지 않으므로 뺀다
   */
  const TOC_KIND = { ch: 'c', task: 't', part: 'p', group: 'g', item: 'i', link: 'l' };
  function tocRows(d) {
    // 예전에 만든 목차도 정리해서 색인한다(띄어쓰기 붙이기 · 긴 문장은 앞부분만 제목으로)
    const nodes = d.outline && d.outline.nodes ? (N.tidyOutline ? N.tidyOutline(d.outline.nodes) : d.outline.nodes) : [];
    const links = new Map((d.links || []).map(l => [l.id, l]));
    const blocks = d.blocks || [];
    const page = b => { const bl = blocks[b]; return !bl ? '' : bl.printed_page != null ? bl.printed_page + 'p' : bl.pdf_page ? bl.pdf_page + '쪽' : ''; };
    const rows = [];
    nodes.forEach(n => {
      const k = TOC_KIND[n.k]; if (!k) return;
      const row = [n.c, k, (n.t || '') + (n.cut ? '…' : ''), page(n.b)];
      const l = n.l && links.get(n.l);
      if (l) { row[2] = (d.outline.manual ? row[2] : l.text) || row[2]; row.push(l.type || (l.kind === 'law' ? '법령' : l.kind === 'site' ? '사이트' : '서식'), l.url || ''); }
      rows.push(row);
    });
    return rows;
  }

  /** 학교급 하나의 목록 색인과 본문 조각 */
  function buildLevel(docs, level, shardCount, generatedAt) {
    const list = docs.filter(d => (d.school_levels || []).includes(level.name))
      .sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, 'ko'));
    const index = { schema_version: N.SCHEMA_VERSION, level: level.name, slug: level.slug, generated_at: generatedAt, shard_count: shardCount, sec_base: SEC_BASE, docs: [], sections: [] };
    const shards = Array.from({ length: shardCount }, () => new Map());
    list.forEach((d, di) => {
      index.docs.push({ id: d.id, t: d.title, c: d.category, dp: d.department || '', y: d.year, f: d.format, w: d.works_url || '', fb: (d.forms_bundle && d.forms_bundle.works_url) || '', o: (d.origin && d.origin.site) || '', k: d.search_keywords || [], p: N.fileUrl(d.pdf), dl: N.fileUrl(d.original), fn: d.original ? d.original.name : '', n: (d.blocks || []).length });
      if (d.edit) Object.assign(index.docs[index.docs.length - 1], { ed: N.fileUrl(d.edit), en: d.edit.name || '' });
      (d.sections || []).forEach((s, si) => {
        if (si >= SEC_BASE) throw new Error(`${d.title}: 업무가 ${SEC_BASE}개를 넘습니다.`);
        const files = (d.links || []).filter(l => l.section_id === s.id && l.kind === 'file').length;
        const sec = { d: di, s: si, id: s.id, h: s.heading, p: s.parent_heading || '', pg: s.pdf_pages || [], pp: s.printed_pages || [], k: s.keywords || [], l: N.sectionLead(d, s, 90), n: files };
        if (N.isUntitled(d, s)) sec.u = 1; // 목차 없이 나눈 구간: 업무 목록에 안 보이고 업무명으로 검색되지 않음
        index.sections.push(sec);
        const ref = di * SEC_BASE + si;
        for (const g of N.bigrams(N.norm(N.sectionText(d, s)))) {
          if (g.length < 2) continue;
          const shard = shards[N.shardOf(g, shardCount)];
          let arr = shard.get(g);
          if (!arr) shard.set(g, (arr = []));
          arr.push(ref);
        }
      });
    });
    const shardFiles = shards.map(m => {
      const b = {};
      [...m.keys()].sort().forEach(k => { b[k] = encodeList(m.get(k)); });
      return { v: N.SCHEMA_VERSION, b };
    });
    const toc = { v: N.SCHEMA_VERSION, slug: level.slug, generated_at: generatedAt, docs: list.map(d => [d.id, tocRows(d)]) };
    return { index, shardFiles, toc, docCount: list.length };
  }

  /**
   * 전체 출력 파일 생성
   * 반환: { files: Map<path, string>, stats }
   */
  function buildOutputs(docs, opts) {
    opts = opts || {};
    const shardCount = opts.shards || DEFAULT_SHARDS;
    const generatedAt = opts.generatedAt || new Date().toISOString();
    const files = new Map();
    const finalDocs = docs.map(d => N.finalizeDocument(JSON.parse(JSON.stringify(d))));
    const sorted = finalDocs.slice().sort((a, b) => a.id.localeCompare(b.id));

    files.set('data/documents.json', JSON.stringify({ schema_version: N.SCHEMA_VERSION, generated_at: generatedAt, count: sorted.length, documents: sorted.map(docSummary) }, null, 1));
    for (const d of sorted) files.set(`data/documents/${d.id}.json`, JSON.stringify(d));

    // 부서별 전체 자료 수: 사용자 화면이 1~2건인 부서를 '기타 부서'로 묶을 때 쓴다
    const departments = {};
    sorted.forEach(d => { const k = d.department || ''; if (k) departments[k] = (departments[k] || 0) + 1; });
    const manifest = { schema_version: N.SCHEMA_VERSION, generated_at: generatedAt, shard_count: shardCount, document_count: sorted.length, levels: {}, departments };
    const stats = { levels: {} };
    for (const level of N.LEVELS) {
      const r = buildLevel(sorted, level, shardCount, generatedAt);
      const idxText = JSON.stringify(r.index);
      files.set(`data/indexes/${level.slug}.json`, idxText);
      files.set(`data/toc/${level.slug}.json`, JSON.stringify(r.toc));
      let shardBytes = 0;
      r.shardFiles.forEach((sf, i) => {
        const t = JSON.stringify(sf);
        shardBytes += t.length;
        files.set(`data/search/${level.slug}/${String(i).padStart(3, '0')}.json`, t);
      });
      manifest.levels[level.slug] = { name: level.name, documents: r.docCount, sections: r.index.sections.length };
      stats.levels[level.slug] = { documents: r.docCount, indexBytes: byteLength(idxText), shardBytes };
    }
    files.set('data/manifest.json', JSON.stringify(manifest, null, 1));
    let total = 0; files.forEach(v => { total += byteLength(v); });
    stats.totalBytes = total; stats.fileCount = files.size;
    return { files, stats, manifest };
  }

  function byteLength(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return Buffer.byteLength(s, 'utf8');
  }

  /**
   * 일관성 검사
   * docs: 작업 중인 전체 자료, existingPaths: 저장 폴더에 이미 있는 data/ 파일 경로(선택)
   */
  function checkConsistency(docs, outputs, existingPaths) {
    const errors = [], warnings = [];
    const ids = new Map();
    docs.forEach(d => {
      if (ids.has(d.id)) errors.push(`문서 ID 중복: ${d.id} (${ids.get(d.id)}, ${d.title})`);
      ids.set(d.id, d.title);
      const v = N.validateDocument(d);
      v.errors.forEach(e => errors.push(`[${d.title}] ${e}`));
      v.warnings.forEach(w => warnings.push(`[${d.title}] ${w}`));
    });
    if (outputs) {
      const list = JSON.parse(outputs.files.get('data/documents.json')).documents;
      list.forEach(d => { if (!outputs.files.has(`data/documents/${d.id}.json`)) errors.push(`상세 파일 누락: ${d.id}`); });
      N.LEVELS.forEach(l => {
        const idx = JSON.parse(outputs.files.get(`data/indexes/${l.slug}.json`));
        const expected = list.filter(d => d.school_levels.includes(l.name)).map(d => d.id).sort();
        const actual = idx.docs.map(d => d.id).sort();
        if (expected.join() !== actual.join()) errors.push(`${l.name} 색인과 자료 목록이 일치하지 않습니다.`);
      });
    }
    const deletions = [];
    if (outputs && existingPaths) {
      existingPaths.forEach(p => { if (/^data\/(documents|indexes|search|toc)\//.test(p) && !outputs.files.has(p)) deletions.push(p); });
    }
    return { errors, warnings, deletions, ok: errors.length === 0 };
  }

  return { buildOutputs, checkConsistency, tocRows, encodeList, decodeList, SEC_BASE, DEFAULT_SHARDS };
});
