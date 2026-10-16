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
    return { nodes: sortNodes(nodes), stats: { tasks: secs.length, detailed, items } };
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

  return { buildOutline, linkType, isSuspectUrl, suggestUrl, applyOutlineEdits, sortOutline: sortNodes };
});
