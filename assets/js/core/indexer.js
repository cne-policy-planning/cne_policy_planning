/*
 * 공개 사이트용 데이터 파일 생성과 일관성 검사
 *
 * 생성 파일(모두 data/ 아래):
 *   manifest.json                 생성 시각, 학교급별 개수, 조각 수
 *   documents.json                전체 자료 목록과 메타데이터
 *   documents/<id>.json           자료별 상세(본문 블록·업무·서식 링크)
 *   indexes/<slug>.json           학교급별 목록 색인(업무명·검색어·서식명·업무 시작 문장)
 *   search/<slug>/<nn>.json       학교급별 본문 색인 조각(2글자 → 업무 번호 목록)
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
      id: d.id, title: d.title, school_levels: d.school_levels, category: d.category, year: d.year,
      format: d.format, kind: d.kind, works_url: d.works_url, origin: d.origin,
      search_keywords: d.search_keywords, forms_bundle_url: (d.forms_bundle && d.forms_bundle.works_url) || '', section_count: (d.sections || []).length,
      form_count: N.formList(d).length, updated_at: d.updated_at
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

  /** 학교급 하나의 목록 색인과 본문 조각 */
  function buildLevel(docs, level, shardCount, generatedAt) {
    const list = docs.filter(d => (d.school_levels || []).includes(level.name))
      .sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, 'ko'));
    const index = { schema_version: N.SCHEMA_VERSION, level: level.name, slug: level.slug, generated_at: generatedAt, shard_count: shardCount, sec_base: SEC_BASE, docs: [], sections: [] };
    const shards = Array.from({ length: shardCount }, () => new Map());
    list.forEach((d, di) => {
      index.docs.push({ id: d.id, t: d.title, c: d.category, y: d.year, f: d.format, w: d.works_url || '', fb: (d.forms_bundle && d.forms_bundle.works_url) || '', o: (d.origin && d.origin.site) || '', k: d.search_keywords || [] });
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
    return { index, shardFiles, docCount: list.length };
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

    const manifest = { schema_version: N.SCHEMA_VERSION, generated_at: generatedAt, shard_count: shardCount, document_count: sorted.length, levels: {} };
    const stats = { levels: {} };
    for (const level of N.LEVELS) {
      const r = buildLevel(sorted, level, shardCount, generatedAt);
      const idxText = JSON.stringify(r.index);
      files.set(`data/indexes/${level.slug}.json`, idxText);
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
      existingPaths.forEach(p => { if (/^data\/(documents|indexes|search)\//.test(p) && !outputs.files.has(p)) deletions.push(p); });
    }
    return { errors, warnings, deletions, ok: errors.length === 0 };
  }

  return { buildOutputs, checkConsistency, encodeList, decodeList, SEC_BASE, DEFAULT_SHARDS };
});
