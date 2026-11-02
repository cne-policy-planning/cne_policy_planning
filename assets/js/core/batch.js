/*
 * 폴더 일괄 등록: 폴더·파일 이름으로 학교급·연도·분류·출처 짐작, 기존 자료와 짝 맞추기(교체 후보)
 * 브라우저·Node 공용 (화면 코드 없음)
 */
(function (root, factory) {
  const deps = root.SAS || (typeof require === 'function'
    ? Object.assign({}, require('./normalize.js'), require('./schema.js')) : {});
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAS = Object.assign(root.SAS || {}, api);
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  // 폴더·파일 이름에서 학교급을 알아보는 낱말 (위에서부터 검사)
  const LEVEL_WORDS = [
    { name: '유아', re: /유치원|유아|병설유/ },
    { name: '초등', re: /초등|초교/ },
    { name: '중등', re: /중등|중학|고등|중고/ },
    { name: '특수', re: /특수/ },
    // 공통: 폴더(또는 파일) 이름 전체가 '공통'·'공통자료'·'학교급공통'·'전학교급'일 때만 (예: "공통교육과정"은 아님)
    { name: '공통', re: /^(공통|공통자료|학교급공통|전학교급)$/ }
  ];
  // 등록하지 않는 파일: 숨김·임시·시스템 파일
  const IGNORE_FILE = /^(\.|~\$|thumbs\.db$|desktop\.ini$)/i;
  const YEAR_RE = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/;

  const nfc = s => String(s == null ? '' : s).normalize('NFC');
  const segments = path => nfc(path).split(/[\\/]+/).filter(Boolean);
  const baseName = path => { const s = segments(path); return s[s.length - 1] || ''; };
  const folderParts = path => segments(path).slice(0, -1);
  const stripExt = s => String(s).replace(/\.[a-z0-9]{2,5}$/i, '');

  function shouldIgnore(path, size) {
    const name = baseName(path);
    if (!name || IGNORE_FILE.test(name)) return true;
    if (segments(path).some(s => s.startsWith('.') || s === '__MACOSX')) return true;
    return size === 0;
  }

  function levelsIn(text) {
    const t = nfc(text).replace(/\s+/g, '');
    // "유·초 이음"처럼 두 학교급이 이어진 업무 이름은 학교급 표시가 아니다
    const cleaned = t.replace(/유[·ㆍ.\-]?초(이음|연계)/g, '');
    const found = LEVEL_WORDS.filter(w => w.re.test(cleaned)).map(w => w.name);
    return N.cleanLevels ? N.cleanLevels(found) : found;   // 공통은 다른 학교급과 함께 쓰지 않는다
  }

  /** 학교급 짐작: 가장 안쪽 폴더부터 바깥으로, 없으면 파일 이름 */
  function guessLevels(path) {
    const folders = folderParts(path);
    // 부서 이름 폴더(초등특수교육과·유아교육복지과·중등교육과 등)는 학교급 낱말이 들어 있어도 학교급으로 보지 않는다
    const depts = new Set((N.DEPARTMENTS || []).map(N.norm));
    for (let i = folders.length - 1; i >= 0; i--) {
      if (depts.has(N.norm(folders[i]))) continue;
      const lv = levelsIn(folders[i]);
      if (lv.length) return { levels: lv, from: 'folder', where: folders[i] };
    }
    const lv = levelsIn(stripExt(baseName(path)));
    return lv.length ? { levels: lv, from: 'file', where: baseName(path) } : { levels: [], from: '', where: '' };
  }

  /** 연도 짐작: 파일 이름 → 안쪽 폴더 순 */
  function guessYear(path) {
    const tries = [stripExt(baseName(path))].concat(folderParts(path).reverse());
    for (const t of tries) { const m = nfc(t).match(YEAR_RE); if (m) return Number(m[1]); }
    return null;
  }

  /** 폴더 이름이 목록의 값과 같으면 그 값 (예: 분류·원 출처 폴더) */
  function folderMatch(path, list) {
    const parts = folderParts(path).map(N.norm);
    for (let i = parts.length - 1; i >= 0; i--) {
      const hit = (list || []).find(v => N.norm(v) === parts[i]);
      if (hit) return hit;
    }
    return '';
  }

  function guessMeta(path) {
    const lv = guessLevels(path);
    return {
      levels: lv.levels, levelsFrom: lv.from, levelsWhere: lv.where,
      year: guessYear(path),
      category: folderMatch(path, N.CATEGORIES),
      originSite: folderMatch(path, N.ORIGIN_SITES),
      department: folderMatch(path, N.DEPARTMENTS)   // 부서 이름 폴더(예: 민주시민교육과/…)
    };
  }

  /**
   * 짝 맞추기 열쇠: 연도·확장자·판 표시·띄어쓰기를 뺀 이름.
   * "2026+유치원+교무학사+업무+도움자료.pdf"와 "2027유치원교무학사업무도움자료.pdf"가 같은 열쇠가 된다.
   */
  function matchKey(name) {
    let s = stripExt(nfc(name));
    s = s.replace(/(?:19|20)\d{2}\s*(?:학년도|년도|년|학년)?/g, ' ');
    s = s.replace(/[(\[［【]\s*(?:최종|수정|개정|확정|붙임\s*\d*|v?\d+(?:\.\d+)*)\s*[)\]］】]/gi, ' ');
    s = s.replace(/(?:[_\-\s]v\d+(?:\.\d+)*|[_\-\s](?:최종|수정본|개정본|복사본|사본))$/gi, ' ');
    s = s.replace(/\s*\(\d+\)$/, ' '); // 내려받기 중복 표시 "(1)"
    return N.norm(s).replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const A = grams(a), B = grams(b);
    let inter = 0, na = 0, nb = 0;
    A.forEach((c, g) => { na += c; inter += Math.min(c, B.get(g) || 0); });
    B.forEach(c => { nb += c; });
    return na + nb ? (2 * inter) / (na + nb) : 0;
  }

  const SIMILAR_MIN = 0.72;

  /** 가장 비슷한 기존 자료 하나: { doc, how: 'same'|'similar', score } 또는 null */
  function findMatch(item, docs) {
    const c = candidates(item, docs).sort((x, y) => y.score - x.score);
    return c[0] || null;
  }

  /** 같은 연도·같은 크기의 PDF가 이미 있으면 같은 파일로 본다 */
  function isSameFile(doc, item) {
    if (!doc || !doc.pdf || !doc.pdf.bytes || !item.size) return false;
    return doc.pdf.bytes === item.size && (!item.year || !doc.year || Number(doc.year) === Number(item.year));
  }

  /** 교체할 때 자료명의 연도를 새 연도로 바꾼다: "2026 교무학사 도움자료" → "2027 교무학사 도움자료" */
  function renewTitle(title, oldYear, newYear) {
    const t = String(title || '');
    if (!newYear || !oldYear || Number(oldYear) === Number(newYear)) return t;
    return t.replace(new RegExp('(^|[^0-9])' + oldYear + '(?![0-9])', 'g'), '$1' + newYear);
  }

  /** 짝 후보 점수: 같은 파일 > 같은 이름 > 비슷한 이름 */
  function candidates(item, docs) {
    const keys = [matchKey(item.filename || ''), matchKey(item.title || '')].filter(k => k.length >= 2);
    const lv = item.levels || [];
    const out = [];
    if (!keys.length) return out;
    for (const d of docs || []) {
      const dk = [matchKey(d.filename || ''), matchKey(d.title || '')].filter(k => k.length >= 2);
      let score = 0;
      for (const a of keys) for (const b of dk) score = Math.max(score, dice(a, b));
      // 학교급이 다르면 다른 자료로 본다. 단, 이름이 완전히 같으면 학교급 짐작(예: 「통합유치원」 → 유아)이 틀렸을 수 있으므로 짝을 지어 준다
      if (score < 1 && lv.length && (d.school_levels || []).length && !d.school_levels.some(l => lv.includes(l))) continue;
      if (score >= SIMILAR_MIN) out.push({ doc: d, score, how: score === 1 ? 'same' : 'similar', sameFile: score === 1 && isSameFile(d, item) });
    }
    return out;
  }

  /**
   * 대기 목록 전체의 처리 방법을 정한다(사용자가 직접 고른 것은 그대로 둔다).
   * items: [{ key, filename, title, levels, year, size, format, action?, targetId?, actionSet? }]
   * 각 항목에 match, action('add'|'replace'|'skip'), targetId, note를 채운다. 이름이 같은 기존 자료는 덮어쓰기(replace).
   * 기존 자료 하나는 한 파일하고만 짝지어지며, 점수가 높은 짝(같은 파일 → 같은 이름 → 비슷한 이름)부터 정한다.
   */
  function planBatch(items, docs) {
    const byId = new Map((docs || []).map(d => [d.id, d]));
    const claimed = new Set();
    const pdfKeys = new Set(items.filter(it => it.format === 'pdf').map(it => matchKey(it.filename)));
    const auto = [];
    for (const it of items) {
      it.note = ''; it.match = null;
      if (it.actionSet) {
        if (it.action === 'replace') {
          if (byId.has(it.targetId)) { claimed.add(it.targetId); it.match = { doc: byId.get(it.targetId), score: 1, how: 'chosen' }; continue; }
          it.actionSet = false; // 고른 자료가 사라졌으면 다시 짐작
        } else continue;
      }
      if (it.format !== 'pdf' && pdfKeys.has(matchKey(it.filename))) {
        it.action = 'skip'; it.targetId = null; it.note = '같은 이름의 PDF가 함께 있어 건너뜁니다. 필요하면 「새 자료로 추가」로 바꾸세요.'; continue;
      }
      it.action = 'add'; it.targetId = null;
      auto.push(it);
    }
    const pairs = [];
    auto.forEach(it => candidates(it, docs).forEach(c => pairs.push({ it, c })));
    pairs.sort((a, b) => (b.c.sameFile - a.c.sameFile) || (b.c.score - a.c.score));
    const done = new Set();
    for (const { it, c } of pairs) {
      if (done.has(it) || claimed.has(c.doc.id)) continue;
      done.add(it); claimed.add(c.doc.id);
      it.match = c; it.targetId = c.doc.id;
      // 이름이 같으면(같은 파일이어도) 덮어쓰기. 반영하기 전에 화면에서 한 번 더 확인한다.
      it.action = 'replace';
      it.note = c.sameFile ? '이미 등록된 것과 같은 파일입니다. 덮어씁니다.'
        : c.how === 'same' ? '이름이 같은 기존 자료를 덮어씁니다.'
        : '이름이 비슷한 자료를 찾았습니다. 같은 자료의 새 판인지 확인해 주세요.';
    }
    // 짝을 못 찾았지만 후보가 있었던 항목(다른 파일이 먼저 짝지어짐)
    auto.forEach(it => { if (!done.has(it) && candidates(it, docs).length) it.note = '비슷한 기존 자료가 다른 파일과 짝지어졌습니다. 새 자료로 추가합니다.'; });
    return items;
  }

  /** 교체 후보로 고를 수 있는 기존 자료(비슷한 순) */
  function rankDocs(item, docs) {
    const keys = [matchKey(item.filename || ''), matchKey(item.title || '')].filter(Boolean);
    return (docs || []).map(d => {
      const dk = [matchKey(d.filename || ''), matchKey(d.title || '')].filter(Boolean);
      let score = 0;
      for (const a of keys) for (const b of dk) score = Math.max(score, dice(a, b));
      return { doc: d, score };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * 이름이 같은 자료 묶음(띄어쓰기·기호만 다른 것 포함, 연도는 그대로 비교). 학교급이 하나라도 겹쳐야 같은 자료로 본다.
   * 반환: [[doc, doc, …], …] — 묶음 안은 등록 순서(created_at)
   */
  function findDuplicates(docs) {
    const key = t => N.norm(nfc(t || '')).replace(/[^\p{L}\p{N}]+/gu, '');
    const m = new Map();
    (docs || []).forEach(d => { const k = key(d.title); if (k.length < 2) return; if (!m.has(k)) m.set(k, []); m.get(k).push(d); });
    const out = [];
    m.forEach(list => {
      if (list.length < 2) return;
      const lv = d => d.school_levels || [];
      const shared = list.filter(a => list.some(b => b !== a && (!lv(a).length || !lv(b).length || lv(a).some(x => lv(b).includes(x)))));
      if (shared.length > 1) out.push(shared.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id)));
    });
    return out.sort((a, b) => a[0].title.localeCompare(b[0].title, 'ko'));
  }

  return { findDuplicates, LEVEL_WORDS, shouldIgnore, guessLevels, guessYear, guessMeta, matchKey, dice, findMatch, candidates, rankDocs, isSameFile, renewTitle, planBatch };
});
