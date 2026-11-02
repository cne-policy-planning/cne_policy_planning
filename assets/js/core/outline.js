/*
 * 목차 트리(충교위키식 번호 목차) 만들기
 *
 * 업무 분할(sectionizer) 결과와 PDF 줄 위치로 아래 같은 번호 목차를 만든다.
 *   1        교무·연구 업무            (단원: 업무의 상위 분류)
 *   1.6      유치원 평가·유치원 규칙   (업무)
 *   1.6.1    업무개요                  (부분) ─ 1.6.1.1 [법령] 「유아교육법」 제19조…
 *   1.6.2    업무의 내용 및 방법       (부분) ─ 1.6.2.1 ◆ 유치원 평가 ─ 1.6.2.1.1 1. 유치원 평가 주요 사항 ─ 1.6.2.1.1.1 ▸ …
 *   1.6.3    관련 자료 및 서식         (부분) ─ 1.6.3.1 [서식] 유치원 평가 운영 계획(예시)
 *
 * 노드: { c: 번호, k: 종류, t: 제목, b: 블록(쪽) 번호, y: 쪽 위에서부터의 위치(pt), x, d?: [딸린 줄], l?: 링크 ID }
 *   종류 k: ch(단원) · task(업무) · part(부분) · group(◆ 묶음) · item(번호 항목) · bullet(▸ 항목) · link(자료 링크)
 * 줄 위치가 없는 자료(HWPX·예전 자료)는 단원·업무·링크만 만든다.
 */
(function (root, factory) {
  const api = factory(root.SAS || (typeof require === 'function' ? require('./normalize.js') : {}));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAS = Object.assign(root.SAS || {}, api);
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  const PART_RE = [
    { key: 'overview', re: /^업\s*무\s*개\s*요$/, title: '업무개요' },
    { key: 'content', re: /^업\s*무\s*의\s*내\s*용\s*및\s*방\s*법$/, title: '업무의 내용 및 방법' },
    { key: 'related', re: /^관\s*련\s*자\s*료\s*및\s*서\s*식/, title: '관련 자료 및 서식' }
  ];
  const GROUP_RE = /^(?:[◆◇■□●]\s*(.+)|\[\s*([^\]]{2,20})\s*\]\s*$)/;
  const ITEM_RE = /^(\d{1,2})\s*[.．]\s*(\S.*)$/;
  const BULLET_RE = /^[▸▶►▷•○◦❍➢✓]\s*(.*)$/;
  const SUB_RE = /^(?:[-–※]|\(\d+\)|[가-하]\s*[.)])\s*/;

  const r1 = v => Math.round(v * 10) / 10;

  /** 링크 종류: 서식(내려받는 양식·예시) · 참고(그 밖의 내려받기 자료) · 법령 · 사이트 */
  function linkType(text, url) {
    const u = String(url || '');
    if (/law\.go\.kr/i.test(u)) return '법령';
    if (!/fileDown|download|filedown|atchFile|attach/i.test(u)) return '사이트';
    if (/예시|기안|서식|양식|신청서|동의서|계획서?|안내문|안내장|대장|서약|평가서|점검표|체크리스트|일지|보고서?|협약|설문|ppt|심의안|공고|가정통신문|통보서|확인서|결과서|회의록|협의록|시나리오/i.test(String(text || ''))) return '서식';
    return '참고';
  }

  /**
   * 주소가 잘린 충남교육청 내려받기 링크인지(게시판 정보 m=…&s=… 없이 fileSeq만 있음).
   * PDF를 만들 때 한글에서 링크가 잘려 들어간 경우로, 누르면 찾을 수 없다고 나올 수 있다.
   */
  function isSuspectUrl(url) {
    const u = String(url || '');
    return /cne\.go\.kr\/boardCnts\/fileDown\.do\?/i.test(u) && /[?&]fileSeq=/i.test(u) && !/[?&]m=/i.test(u);
  }
  /** 잘린 주소에 같은 자료의 다른 링크에서 쓰는 게시판 정보를 채워 넣은 주소(시험용 제안) */
  function suggestUrl(url, sample) {
    if (!isSuspectUrl(url)) return '';
    const m = String(sample || '').match(/[?&](m=[^&]+&s=[^&]+)/);
    const board = m ? m[1] : 'm=0104&s=manual';
    return String(url).replace(/fileDown\.do\?/, `fileDown.do?${board}&`);
  }

  function lineTop(l, h) { return r1(h - (l.y + (l.size || 10) * 0.85)); }

  /** 업무 하나의 본문 줄을 부분(업무개요·내용·관련 자료)으로 나눈다. 줄 위치가 없으면 null */
  function taskLines(doc, sec) {
    const out = [];
    for (let bi = sec.block_start; bi <= sec.block_end; bi++) {
      const b = doc.blocks[bi];
      if (!b || !Array.isArray(b.lines) || !b.lines.length || b.lines[0].y == null) return null;
      const w = b.w || 595, h = b.h || 842;
      const lines = b.lines.map(l => Object.assign({}, l, { bi, top: lineTop(l, h), col: 0 }));
      // 두 단 편집: 가운데선 오른쪽에서 시작하는 줄이 여러 개이면 오른쪽 단으로 본다
      const mid = w / 2 - 8;
      const right = lines.filter(l => l.x >= mid);
      if (right.length >= 3) lines.forEach(l => { if (l.x >= mid) l.col = 1; });
      out.push({ bi, w, h, lines });
    }
    return out;
  }

  /** 부분 경계(줄 단위)를 찾는다: 각 쪽에서 위→아래 순서로 표시 줄의 위치 */
  function markers(pages) {
    const found = [];
    pages.forEach(p => p.lines.forEach(l => {
      const t = String(l.text).replace(/※.*$/, '').trim();
      const m = PART_RE.find(x => x.re.test(t));
      if (m) found.push({ key: m.key, title: m.title, bi: p.bi, top: l.top, line: l });
    }));
    return found;
  }

  /** 위치 비교용 값: (쪽, 위치) */
  const pos = (bi, top) => bi * 100000 + top;

  /**
   * 문서 하나의 목차 트리
   * 반환 { nodes, stats: {tasks, detailed, items} }
   */
  function buildOutline(doc) {
    const nodes = [];
    const add = n => { nodes.push(n); return n; };
    const secs = doc.sections || [];
    const links = doc.links || [];
    // 단원: 업무의 상위 분류가 바뀔 때마다
    const chapters = [];
    secs.forEach(s => {
      const name = (s.parent_heading || '').replace(/\s*[‧·・ㆍ]\s*/g, '·').trim() || '본문';
      const last = chapters[chapters.length - 1];
      if (!last || last.name !== name) chapters.push({ name, secs: [s] }); else last.secs.push(s);
    });
    let detailed = 0, items = 0;
    chapters.forEach((ch, ci) => {
      const chCode = String(ci + 1);
      const first = ch.secs[0];
      add({ c: chCode, k: 'ch', t: ch.name, b: first.block_start, y: 0, x: 0 });
      ch.secs.forEach((s, si) => {
        const code = `${chCode}.${si + 1}`;
        const pages = doc.format === 'pdf' ? taskLines(doc, s) : null;
        const titleLine = pages ? findTitle(pages, s.heading) : null;
        add({ c: code, k: 'task', t: s.heading, b: s.block_start, y: titleLine ? titleLine.top : 0, x: titleLine ? r1(titleLine.x) : 0, s: s.id });
        const secLinks = links.filter(l => l.section_id === s.id);
        const mk = pages ? markers(pages) : [];
        if (!pages || !mk.length) {
          // 줄 위치나 부분 표시가 없으면 링크만 업무 아래에 둔다
          if (pages) items += buildItems(nodes, code, pages.flatMap(p => p.lines.filter(l => !titleLine || p.bi !== titleLine.bi || l.top > titleLine.top + 2)), 1);
          appendLinks(nodes, code, secLinks, nodes.filter(n => n.c.startsWith(code + '.') && n.c.split('.').length === code.split('.').length + 1).length);
          return;
        }
        detailed++;
        // 부분 순서대로: 같은 종류가 여러 번(쪽이 바뀌며 다시 나옴) 나오면 첫 번째만 쓴다
        const parts = [];
        mk.forEach(m => { if (!parts.some(p => p.key === m.key)) parts.push(m); });
        parts.sort((a, b) => pos(a.bi, a.top) - pos(b.bi, b.top));
        const ranges = parts.map((p, i) => ({ p, from: pos(p.bi, p.top), to: parts[i + 1] ? pos(parts[i + 1].bi, parts[i + 1].top) : Infinity }));
        const inRange = (r, bi, top) => { const v = pos(bi, top); return v > r.from + 1 && v < r.to - 1; };
        let n = 0;
        const used = new Set();
        ranges.forEach(r => {
          const pc = `${code}.${++n}`;
          add({ c: pc, k: 'part', t: r.p.title, b: r.p.bi, y: r.p.top, x: r1(r.p.line.x) });
          if (r.p.key === 'overview') {
            const txt = pages.flatMap(p => p.lines.filter(l => inRange(r, p.bi, l.top))).map(l => l.text).join(' ');
            nodes[nodes.length - 1].d = [N.clean(txt).replace(/\s+/g, ' ')];
            const own = secLinks.filter(l => l.box && inRange(r, l.block, l.box[1]));
            own.forEach(l => used.add(l.id));
            appendLinks(nodes, pc, own, 0);
          } else if (r.p.key === 'content') {
            const ls = pages.flatMap(p => p.lines.filter(l => inRange(r, p.bi, l.top)));
            items += buildItems(nodes, pc, ls, 1);
            const own = secLinks.filter(l => l.box && inRange(r, l.block, l.box[1]));
            own.forEach(l => used.add(l.id));
            appendLinks(nodes, pc, own, nodes.filter(x => x.c.split('.').length === pc.split('.').length + 1 && x.c.startsWith(pc + '.')).length);
          } else {
            const own = secLinks.filter(l => !used.has(l.id));
            own.forEach(l => used.add(l.id));
            appendLinks(nodes, pc, own, 0);
          }
        });
        // 부분 밖(제목과 업무개요 사이 등)에 남은 링크
        const rest = secLinks.filter(l => !used.has(l.id));
        if (rest.length) {
          const rel = nodes.find(x => x.c.startsWith(code + '.') && x.k === 'part' && x.t === '관련 자료 및 서식');
          if (rel) appendLinks(nodes, rel.c, rest, nodes.filter(x => x.c.startsWith(rel.c + '.') && x.c.split('.').length === rel.c.split('.').length + 1).length);
          else { const pc = `${code}.${++n}`; add({ c: pc, k: 'part', t: '관련 자료 및 서식', b: s.block_end, y: 0, x: 0 }); appendLinks(nodes, pc, rest, 0); }
        }
      });
    });
    // 업무에 속하지 않은 링크(목차 앞 등)는 넣지 않는다
    // 글자 사이 띄어쓰기 붙이기 · 문장처럼 긴 제목 줄이기(나머지는 설명으로)
    return { nodes: N.tidyOutline ? N.tidyOutline(sortNodes(nodes)) : sortNodes(nodes), stats: { tasks: secs.length, detailed, items } };
  }

  function findTitle(pages, heading) {
    const key = N.norm(heading).slice(0, 6);
    for (const p of pages.slice(0, 1)) {
      const hit = p.lines.slice(0, 8).find(l => key && N.norm(l.text.replace(/^\d{1,2}\s*[.．]\s*/, '')).startsWith(key));
      if (hit) return Object.assign({}, hit, { bi: p.bi });
    }
    return null;
  }

  /** 번호 항목·▸ 항목·◆ 묶음을 트리로. 반환: 만든 항목 수 */
  function buildItems(nodes, parentCode, lines, startNo) {
    // 단 순서(왼쪽 단 위→아래, 오른쪽 단 위→아래), 쪽 순서
    const ordered = lines.slice().sort((a, b) => a.bi - b.bi || a.col - b.col || a.top - b.top || a.x - b.x);
    const counters = new Map();
    const next = pc => { const v = (counters.get(pc) || (pc === parentCode ? startNo - 1 : 0)) + 1; counters.set(pc, v); return `${pc}.${v}`; };
    let group = null, item = null, last = null, made = 0;
    for (const l of ordered) {
      const t = String(l.text).trim();
      if (!t || /^※\s*파일명을/.test(t)) continue;
      let m;
      if ((m = t.match(GROUP_RE)) && t.length <= 40) {
        group = { c: next(parentCode), k: 'group', t: N.clean(m[1] || m[2]).trim(), b: l.bi, y: l.top, x: r1(l.x), col: l.col };
        nodes.push(group); item = null; last = group; made++;
      } else if ((m = t.match(ITEM_RE)) && !/^\d+\s*[.．]\s*\d/.test(t)) {
        const pc = group ? group.c : parentCode;
        item = { c: next(pc), k: 'item', t: N.clean(m[2]).trim(), b: l.bi, y: l.top, x: r1(l.x), col: l.col };
        nodes.push(item); last = item; made++;
      } else if ((m = t.match(BULLET_RE))) {
        const pc = item ? item.c : group ? group.c : parentCode;
        last = { c: next(pc), k: 'bullet', t: N.clean(m[1]).trim(), b: l.bi, y: l.top, x: r1(l.x), col: l.col };
        nodes.push(last); made++;
      } else if (SUB_RE.test(t) && last && (last.k === 'bullet' || last.k === 'item')) {
        (last.d = last.d || []).push(N.clean(t));
      } else if (last && last.k !== 'group' && last.col === l.col) {
        // 앞 줄에서 이어지는 글
        if (last.d && last.d.length) last.d[last.d.length - 1] = joinText(last.d[last.d.length - 1], t);
        else last.t = joinText(last.t, t);
      } else if (!last) {
        last = { c: next(parentCode), k: 'bullet', t: N.clean(t), b: l.bi, y: l.top, x: r1(l.x), col: l.col };
        nodes.push(last); made++;
      }
    }
    nodes.forEach(n => { delete n.col; });
    return made;
  }

  function joinText(a, b) {
    // 줄 끝이 낱말 중간에서 끊긴 경우(한글 + 한글)는 띄어 쓴다. 괄호·쉼표 뒤는 그대로
    return (String(a) + ' ' + String(b)).replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  }

  function appendLinks(nodes, parentCode, list, startAt) {
    // 쪽 → 줄(위치가 12pt 안쪽이면 같은 줄) → 왼쪽부터
    const sorted = list.slice().sort((a, b) => (a.block - b.block) || ((a.box ? a.box[1] : 0) - (b.box ? b.box[1] : 0)));
    let row = -1, rowTop = -1e9, rowBlock = -1;
    sorted.forEach(l => { const t = l.box ? l.box[1] : 0; if (l.block !== rowBlock || t - rowTop > 12) { row++; rowTop = t; rowBlock = l.block; } l._row = row; });
    sorted.sort((a, b) => a._row - b._row || ((a.box ? a.box[0] : 0) - (b.box ? b.box[0] : 0)));
    sorted.forEach(l => { delete l._row; });
    sorted.forEach((l, i) => nodes.push({ c: `${parentCode}.${startAt + i + 1}`, k: 'link', t: l.text || l.url, b: l.block, y: l.box ? l.box[1] : 0, x: l.box ? l.box[0] : 0, l: l.id }));
  }

  /** 번호 순서로 정렬(1.2 < 1.10) */
  function sortNodes(nodes) {
    const key = c => c.split('.').map(Number);
    return nodes.slice().sort((a, b) => {
      const x = key(a.c), y = key(b.c);
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (x[i] == null) return -1;
        if (y[i] == null) return 1;
        if (x[i] !== y[i]) return x[i] - y[i];
      }
      return 0;
    });
  }

  /** 노드 제목을 관리자가 고친 값으로 덮는다(edits: {번호: 제목}) */
  function applyOutlineEdits(nodes, edits) {
    if (!edits) return nodes;
    return nodes.map(n => edits[n.c] ? Object.assign({}, n, { t: edits[n.c] }) : n);
  }

  // ---------- 사람이 만든 목차(엑셀로 내려받기·올리기) ----------
  // 엑셀 칸: 단계(1 단원 · 2 업무 · 3~6 세부) | 제목 | 쪽 | 종류(서식·참고·법령·사이트, 비우면 목차 줄) | 주소(서식 등의 내려받기 주소)
  // 번호(1.2.3)는 단계와 순서로 자동으로 붙인다(엑셀이 1.10을 1.1로 바꾸는 문제·줄 끼워 넣기 번호 고침을 피한다).
  const TOC_COLS = ['단계', '제목', '쪽', '종류', '주소'];
  const MAX_DEPTH = 6;
  const LINK_KINDS = ['서식', '참고', '법령', '사이트'];
  const isPdfDoc = doc => doc.format === 'pdf';
  /** 블록 번호 → 엑셀에 적을 쪽(PDF는 PDF 쪽, 그 밖은 문단 번호) */
  function pageOfBlock(doc, b) { const bl = (doc.blocks || [])[b]; return !bl ? '' : isPdfDoc(doc) ? (bl.pdf_page || b + 1) : b + 1; }
  /** 엑셀 쪽 → 블록 번호(없으면 -1) */
  function blockOfPage(doc, p) {
    const n = Number(p); if (!Number.isInteger(n) || n < 1) return -1;
    const blocks = doc.blocks || [];
    if (isPdfDoc(doc)) { const i = blocks.findIndex(b => Number(b.pdf_page) === n); return i >= 0 ? i : (n <= blocks.length ? n - 1 : -1); }
    return n <= blocks.length ? n - 1 : -1;
  }

  /** 지금 목차 → 엑셀 줄 [{단계, 제목, 쪽, 종류, 주소, 번호}] (▸ 세부 줄은 뺀다, 제목은 정리된 것) */
  function outlineToRows(doc) {
    const raw = doc.outline && doc.outline.nodes ? doc.outline.nodes : [];
    const nodes = N.tidyOutline ? N.tidyOutline(raw) : raw;
    const links = new Map((doc.links || []).map(l => [l.id, l]));
    const kept = nodes.filter(n => n.k !== 'bullet');
    const keptCodes = new Set(kept.map(n => n.c));
    const depthOf = new Map();
    const rows = [];
    kept.forEach(n => {
      // 가장 가까운 남은 조상의 단계 + 1 (빠진 세부 줄 때문에 단계가 건너뛰지 않게)
      let p = n.c, pd = 0;
      while (p.includes('.')) { p = p.slice(0, p.lastIndexOf('.')); if (keptCodes.has(p)) { pd = depthOf.get(p) || 0; break; } }
      const depth = Math.min(MAX_DEPTH, pd + 1);
      depthOf.set(n.c, depth);
      const l = n.l ? links.get(n.l) : null;
      rows.push({ 단계: depth, 제목: l && !(doc.outline && doc.outline.manual) ? (l.text || n.t) : n.t, 쪽: pageOfBlock(doc, n.b), 종류: l ? (l.type || '서식') : (n.ty || ''), 주소: l ? l.url || '' : '', 번호: n.c });
    });
    return rows;
  }

  /**
   * 엑셀 줄 → 목차. rows: [[칸, …], …] (첫 줄들 중 '단계'·'제목'이 있는 줄을 머리글로 본다)
   * 반환 { nodes, newLinks, errors: [{row, msg}], warnings: [{row, msg}], count }
   */
  function rowsToOutline(doc, rows) {
    const errors = [], warnings = [];
    const hi = (rows || []).findIndex(r => r && r.some(c => String(c).trim() === '단계') && r.some(c => String(c).trim() === '제목'));
    if (hi < 0) return { nodes: [], newLinks: [], errors: [{ row: 0, msg: '머리글 줄(단계 · 제목 · 쪽 · 종류 · 주소)을 찾지 못했습니다. 내려받은 목차 엑셀 양식을 써 주세요.' }], warnings, count: 0 };
    const head = rows[hi].map(c => String(c == null ? '' : c).trim());
    const col = name => head.indexOf(name);
    const ci = { d: col('단계'), t: col('제목'), p: col('쪽'), k: col('종류'), u: col('주소') };
    if (ci.p < 0) errors.push({ row: hi + 1, msg: '「쪽」 칸이 없습니다.' });
    const links = doc.links || [];
    const byUrl = new Map(links.filter(l => l.url).map(l => [String(l.url).trim(), l]));
    const byText = new Map(links.map(l => [N.norm(l.text), l]));
    const counters = [];   // 단계별 번호
    const codes = [];      // 단계별 현재 번호 문자열
    const nodes = [], newLinks = [];
    let prevDepth = 0, prevBlock = 0, mseq = 0;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || [], rn = i + 1;
      const cell = k => (ci[k] >= 0 && r[ci[k]] != null ? String(r[ci[k]]).trim() : '');
      const title = cell('t'), dRaw = cell('d');
      if (!title && !dRaw) continue;                           // 빈 줄
      if (/^#/.test(dRaw)) continue;                          // 메모 줄
      const depth = Number(dRaw);
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) { errors.push({ row: rn, msg: `단계는 1~${MAX_DEPTH} 숫자로 적어 주세요(지금 「${dRaw}」).` }); continue; }
      if (!title) { errors.push({ row: rn, msg: '제목이 비었습니다.' }); continue; }
      if (depth > prevDepth + 1) { errors.push({ row: rn, msg: `단계가 ${prevDepth}에서 ${depth}로 건너뜁니다. 한 단계씩만 내려갈 수 있습니다.` }); continue; }
      let b = prevBlock;
      const pRaw = cell('p');
      if (pRaw) { b = blockOfPage(doc, pRaw); if (b < 0) { errors.push({ row: rn, msg: `쪽 「${pRaw}」이(가) 자료에 없습니다(1~${(doc.blocks || []).length}${isPdfDoc(doc) ? '쪽' : '문단'}).` }); continue; } }
      else warnings.push({ row: rn, msg: '쪽이 비어 앞 줄과 같은 쪽으로 했습니다.' });
      counters.length = depth; counters[depth - 1] = (counters[depth - 1] || 0) + 1;
      codes.length = depth; codes[depth - 1] = String(counters[depth - 1]);
      const c = codes.join('.');
      const node = { c, k: depth === 1 ? 'ch' : depth === 2 ? 'task' : 'item', t: title, b, y: 0, x: 0 };
      const kind = cell('k').replace(/\s/g, ''), url = cell('u');
      if (kind) {
        if (!LINK_KINDS.includes(kind)) warnings.push({ row: rn, msg: `종류 「${kind}」는 서식·참고·법령·사이트 중 하나여야 합니다. 목차 줄로 넣었습니다.` });
        else {
          let l = (url && byUrl.get(url)) || (!url && byText.get(N.norm(title))) || null;
          if (!l && url) {
            if (!/^https?:\/\//i.test(url)) warnings.push({ row: rn, msg: '주소가 http로 시작하지 않습니다. 확인해 주세요.' });
            l = { id: `toc-${Date.now().toString(36)}${++mseq}`, text: title, url, type: kind, kind: N.linkKind ? N.linkKind(url) : (kind === '법령' ? 'law' : kind === '사이트' ? 'site' : 'file'), block: b, section_id: null, manual: true };
            newLinks.push(l); byUrl.set(url, l);
          }
          if (l) { node.k = 'link'; node.l = l.id; node.ty = kind; }
          else { node.ty = kind; warnings.push({ row: rn, msg: `「${kind}」인데 주소가 없고 같은 이름의 링크도 없습니다. 목차 줄로만 넣었습니다.` }); }
        }
      }
      if (node.k === 'link' && depth < 2) { node.k = 'ch'; delete node.l; warnings.push({ row: rn, msg: '단원(단계 1)은 서식이 될 수 없어 목차 줄로 넣었습니다.' }); }
      nodes.push(node);
      prevDepth = depth; prevBlock = b;
    }
    if (!nodes.length && !errors.length) errors.push({ row: hi + 1, msg: '목차 줄이 하나도 없습니다.' });
    return { nodes, newLinks, errors, warnings, count: nodes.length };
  }

  /** 사람이 만든 목차를 자료에 넣는다(자동 목차는 outline_auto로 보관 → 되돌리기) */
  function applyManualOutline(doc, result, meta) {
    if (!doc.outline_auto && doc.outline && !doc.outline.manual) doc.outline_auto = doc.outline;
    doc.links = (doc.links || []).concat(result.newLinks || []);
    const nodes = result.nodes;
    doc.outline = { nodes, manual: true, built_at: new Date().toISOString(), by: (meta && meta.by) || '', file: (meta && meta.file) || '',
      stats: { tasks: nodes.filter(n => n.k === 'task').length, detailed: 0, items: nodes.length } };
    return doc;
  }
  /** 자동 목차로 되돌리기(사람이 넣은 링크 중 목차에서만 쓰던 것은 뺀다) */
  function revertManualOutline(doc) {
    if (!doc.outline || !doc.outline.manual) return false;
    doc.outline = doc.outline_auto || null;
    delete doc.outline_auto;
    doc.links = (doc.links || []).filter(l => !/^toc-/.test(l.id));
    return true;
  }
  /**
   * 파일 교체 때 사람이 만든 목차를 이어받는다(새 자동 목차는 outline_auto로).
   * 새 판은 쪽이 달라졌을 수 있어 stale 표시를 남기고, 쪽이 자료 밖이면 마지막 쪽으로 맞춘다. 반환: 이어받았으면 true
   */
  function carryManualOutline(oldDoc, newDoc) {
    if (!oldDoc || !oldDoc.outline || !oldDoc.outline.manual) return false;
    const last = Math.max(0, (newDoc.blocks || []).length - 1);
    newDoc.outline_auto = newDoc.outline;
    newDoc.outline = JSON.parse(JSON.stringify(oldDoc.outline));
    newDoc.outline.nodes.forEach(n => { if (n.b > last) n.b = last; });
    newDoc.outline.stale = true;
    const ids = new Set(newDoc.outline.nodes.filter(n => n.l).map(n => n.l));
    const have = new Set((newDoc.links || []).map(l => l.id));
    (oldDoc.links || []).filter(l => l.manual && ids.has(l.id) && !have.has(l.id)).forEach(l => newDoc.links.push(Object.assign({}, l, { block: Math.min(l.block || 0, last) })));
    return true;
  }

  return { buildOutline, linkType, isSuspectUrl, suggestUrl, applyOutlineEdits, sortOutline: sortNodes,
    TOC_COLS, outlineToRows, rowsToOutline, applyManualOutline, revertManualOutline, carryManualOutline, pageOfBlock, blockOfPage };
});
