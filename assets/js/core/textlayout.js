/*
 * PDF 글자 조각 → 줄 복원, 반복 머리말·꼬리말 판별, 인쇄 쪽수 추출, 링크 글자 연결
 * 입력 형식은 pdf.js getTextContent()/getAnnotations() 결과와 같다.
 *   page = { width, height, items:[{str, transform:[a,b,c,d,x,y], width, hasEOL}], annotations:[{subtype,url,rect}] }
 */
(function (root, factory) {
  const api = factory(root.SAS || (typeof require === 'function' ? require('./normalize.js') : {}));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAS = Object.assign(root.SAS || {}, api);
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  const JUNK_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f-�]/g;
  const MARGIN = 0.075; // 페이지 위·아래 7.5%를 머리말·꼬리말 영역으로 본다

  /** 한 페이지의 글자 조각을 줄 단위로 묶는다 */
  function buildLines(page) {
    const lines = [];
    let cur = null;
    for (const it of page.items || []) {
      const str = String(it.str || '').replace(JUNK_RE, '');
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const size = Math.hypot(t[0], t[1]) || Math.abs(t[3]) || 10;
      const x = t[4], y = t[5];
      // 공백만 있는 조각은 pdf.js가 너비를 크게 잡는 경우가 있어 너비를 무시한다
      const w = /^\s+$/.test(str) ? Math.min(Number(it.width) || 0, size * 0.5) : (Number(it.width) || 0);
      if (!str) { if (it.hasEOL && cur) cur.eol = true; continue; }
      const newLine = !cur || cur.eol || Math.abs(y - cur.y) > Math.max(cur.size, size) * 0.5 || x < cur.xe - Math.max(cur.size, size) * 2;
      if (newLine) {
        cur = { parts: [str], y, x, xe: x + w, size, eol: false };
        lines.push(cur);
      } else {
        const gap = x - cur.xe;
        const last = cur.parts[cur.parts.length - 1];
        if (gap > Math.min(cur.size, size) * 0.2 && !/\s$/.test(last) && !/^\s/.test(str)) cur.parts.push(' ');
        cur.parts.push(str);
        cur.xe = Math.max(cur.xe, x + w);
        cur.size = Math.max(cur.size, size);
      }
      if (it.hasEOL) cur.eol = true;
    }
    const H = page.height || 842;
    return lines.map(l => ({
      text: l.parts.join('').replace(/\s+/g, ' ').trim(),
      x: l.x, xe: l.xe, y: l.y, size: l.size,
      marginal: l.y < H * MARGIN || l.y > H * (1 - MARGIN)
    })).filter(l => l.text);
  }

  /** 링크 주석에 걸린 글자를 찾아 [{text,url}]로. 같은 주소의 연속 영역은 하나로 합친다 */
  function linkTexts(page) {
    // 너비·높이가 거의 0인 링크 영역(제작 오류)은 버린다
    const anns = (page.annotations || []).filter(a => (a.subtype === 'Link' || a.annotationType === 2) && a.url && a.rect &&
      Math.abs(a.rect[2] - a.rect[0]) >= 3 && Math.abs(a.rect[3] - a.rect[1]) >= 3);
    if (!anns.length) return [];
    // 조각 하나가 여러 링크에 걸칠 수 있으므로 글자 단위로 위치를 나눈다
    const items = [];
    (page.items || []).forEach(it => {
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const size = Math.hypot(t[0], t[1]) || 10;
      const str = String(it.str || '').replace(JUNK_RE, '');
      if (!str.trim()) return;
      const chars = [...str], cw = (Number(it.width) || size * chars.length) / chars.length;
      chars.forEach((ch, k) => items.push({ str: ch, x: t[4] + cw * k, y: t[5], w: cw, size }));
    });
    const pieces = anns.map(a => {
      const [x1, y1, x2, y2] = a.rect;
      const L = Math.min(x1, x2) - 1, R = Math.max(x1, x2) + 1, B = Math.min(y1, y2) - 2, T = Math.max(y1, y2) + 2;
      const inside = items.filter(i => { const cx = i.x + i.w / 2, cy = i.y + i.size * 0.35; return cx >= L - i.w * 0.5 && cx <= R + i.w * 0.5 && cy >= B && cy <= T; });
      inside.sort((a, b) => (b.y - a.y) || (a.x - b.x));
      let text = '', last = null;
      for (const i of inside) {
        if (last && Math.abs(i.y - last.y) > last.size * 0.5) text += ' ';
        else if (last && i.x - (last.x + last.w) > i.size * 0.2 && i.str !== ' ') text += ' ';
        text += i.str; last = i;
      }
      return { url: String(a.url).trim(), text: N.clean(text).replace(/\s+/g, ' '), top: Math.max(y1, y2) };
    });
    // 같은 주소가 바로 아래 줄로 이어지면(여러 줄 서식명) 합친다
    const merged = [];
    pieces.forEach((p, idx) => {
      const a = anns[idx];
      const box = { L: Math.min(a.rect[0], a.rect[2]), R: Math.max(a.rect[0], a.rect[2]), B: Math.min(a.rect[1], a.rect[3]) };
      const prev = merged[merged.length - 1];
      // 같은 주소라도 다른 칸(가로로 떨어진 곳)이면 별개의 서식명이다
      if (prev && prev.url === p.url && prev.lastTop - p.top < 30 && prev.lastTop >= p.top && Math.abs((prev.L + prev.R) / 2 - (box.L + box.R) / 2) < 60) {
        if (p.text && !prev.text.endsWith(p.text)) prev.text = (prev.text + ' ' + p.text).trim();
        prev.lastTop = p.top; prev.L = Math.min(prev.L, box.L); prev.R = Math.max(prev.R, box.R); prev.B = Math.min(prev.B, box.B);
      } else merged.push({ url: p.url, text: p.text, lastTop: p.top, L: box.L, R: box.R, B: box.B });
    });
    // 링크 영역이 서식명의 마지막 줄을 덮지 않은 경우: 바로 아래, 같은 열의 줄을 이어 붙인다
    const lines = buildLines(page);
    const inAnyRect = l => anns.some(a => {
      const L = Math.min(a.rect[0], a.rect[2]) - 1, R = Math.max(a.rect[0], a.rect[2]) + 1, B = Math.min(a.rect[1], a.rect[3]) - 2, T = Math.max(a.rect[1], a.rect[3]) + 2;
      const cx = (l.x + l.xe) / 2, cy = l.y + l.size * 0.35;
      return cx >= L && cx <= R && cy >= B && cy <= T;
    });
    const used = new Set();
    for (const m of merged) {
      let bottom = m.B;
      for (let k = 0; k < 3; k++) {
        // 서식명은 칸 안에서 가운데 정렬되는 경우가 많다: 가운데가 가깝고 칸 너비(약 160pt) 안이면 이어지는 줄로 본다
        const mc = (m.L + m.R) / 2, half = Math.max(25, (m.R - m.L) / 2 + 20);
        const next = lines.find(l => !used.has(l) && !l.marginal && l.y < bottom && bottom - (l.y + l.size) < l.size * 0.9 &&
          Math.abs((l.x + l.xe) / 2 - mc) <= half && l.xe - l.x <= Math.max((m.R - m.L) + 30, 170) && !inAnyRect(l));
        if (!next) break;
        used.add(next);
        m.text = (m.text + ' ' + next.text).trim();
        bottom = next.y;
      }
    }
    return merged.map(m => ({ url: m.url, text: m.text.replace(/\s+/g, ' ').replace(/[,，]\s*$/, '').trim() }));
  }

  /**
   * 문서 전체 페이지에서 반복 머리말·꼬리말을 찾아 본문에서 분리하고 인쇄 쪽수를 읽는다.
   * 반환: [{pdf_page, printed_page, footer_label, text, lines, links}]
   */
  function analyzePages(pages) {
    const perPage = pages.map(p => buildLines(p));
    // 여백 영역 줄을 숫자 제거 후 세어 반복되는 것을 찾는다
    const count = new Map();
    perPage.forEach(lines => {
      const seen = new Set();
      lines.filter(l => l.marginal).forEach(l => {
        const k = N.norm(l.text.replace(/\d+/g, ''));
        if (k && !seen.has(k)) { seen.add(k); count.set(k, (count.get(k) || 0) + 1); }
      });
    });
    const minRepeat = Math.max(3, Math.ceil(pages.length * 0.15));
    const repeated = new Set([...count].filter(([, n]) => n >= minRepeat).map(([k]) => k));

    // 반복 머리말에 붙은 숫자를 인쇄 쪽수로 본다
    const result = perPage.map((lines, i) => {
      let printed = null, footer = '', running = '';
      const body = [];
      for (const l of lines) {
        const key = N.norm(l.text.replace(/\d+/g, ''));
        if (l.marginal && repeated.has(key)) {
          const m = l.text.match(/(?:^|\s)(\d{1,4})(?:\s|$)/);
          if (m && printed == null) printed = Number(m[1]);
          else if (!footer && isSectionMarker(l.text)) footer = l.text;
          if (!running && !isSectionMarker(l.text)) running = l.text.replace(/\d+/g, '').trim();
          continue;
        }
        if (l.marginal && /^\d{1,4}$/.test(l.text)) {
          // 머리말과 따로 떨어진 쪽수 숫자
          if (printed == null && lines.some(o => o !== l && o.marginal && repeated.has(N.norm(o.text.replace(/\d+/g, ''))) && Math.abs(o.y - l.y) < 3)) printed = Number(l.text);
          continue;
        }
        body.push(l);
      }
      // 반복되는 단원 표시(예: "Ⅰ. 교무‧연구 업무")는 여백 밖에 있어도 단원 꼬리말로 처리
      return { pdf_page: i + 1, printed_page: printed, footer_label: footer, running_header: running, lines: body };
    });

    // 본문 마지막 줄에 반복되는 단원 표시가 있으면 꼬리말로 분리
    const tailCount = new Map();
    result.forEach(r => { const t = r.lines[r.lines.length - 1]; if (t && isSectionMarker(t.text)) tailCount.set(N.norm(t.text), (tailCount.get(N.norm(t.text)) || 0) + 1); });
    result.forEach(r => {
      while (r.lines.length) {
        const t = r.lines[r.lines.length - 1];
        if (isSectionMarker(t.text) && (tailCount.get(N.norm(t.text)) || 0) >= 2) { if (!r.footer_label) r.footer_label = t.text; r.lines.pop(); }
        else break;
      }
      r.footer_label = r.footer_label ? r.footer_label.replace(/\s*([.．])\s*/, '$1 ').replace(/\s*([‧·・])\s*/g, '$1').replace(/\s+/g, ' ').trim() : '';
    });

    // 인쇄 쪽수 검증: 다수와 다른 차이를 보이는 값은 버린다
    const diffs = new Map();
    result.forEach(r => { if (r.printed_page != null) { const d = r.pdf_page - r.printed_page; diffs.set(d, (diffs.get(d) || 0) + 1); } });
    let offset = null, best = 0;
    diffs.forEach((n, d) => { if (n > best) { best = n; offset = d; } });
    result.forEach(r => { if (r.printed_page != null && r.pdf_page - r.printed_page !== offset && best >= 3) r.printed_page = null; });

    return result.map((r, i) => ({
      pdf_page: r.pdf_page,
      printed_page: r.printed_page,
      footer_label: r.footer_label,
      running_header: r.running_header,
      text: N.clean(r.lines.map(l => l.text).join('\n')),
      lines: r.lines.map(l => ({ text: l.text, size: Math.round(l.size * 10) / 10 })),
      links: linkTexts(pages[i])
    }));
  }

  function isSectionMarker(t) {
    return /^\s*(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|[IVX]{1,4})\s*[.．]\s*\S.{0,25}$/.test(t);
  }

  /**
   * 좌표 없이 텍스트만 있는 페이지(v1 JSON 등)의 머리말·꼬리말 처리
   * texts: 페이지별 문자열 배열
   */
  function analyzeTextPages(texts) {
    const pages = texts.map(t => N.clean(N.repairSpacing(N.clean(t))).split('\n').map(s => s.trim()).filter(Boolean));
    const edgeKey = l => N.norm(l.replace(/\d+/g, ''));
    const count = new Map();
    pages.forEach(lines => {
      const seen = new Set();
      [...lines.slice(0, 2), ...lines.slice(-2)].forEach(l => { const k = edgeKey(l); if (k && !seen.has(k)) { seen.add(k); count.set(k, (count.get(k) || 0) + 1); } });
    });
    const minRepeat = Math.max(3, Math.ceil(texts.length * 0.15));
    const repeated = k => (count.get(k) || 0) >= minRepeat;
    // 단원 표시는 단원 쪽수만큼만 반복되므로 2회 이상이면 꼬리말로 본다
    const tail = new Map();
    pages.forEach(lines => { const l = lines[lines.length - 1]; if (l && isSectionMarker(l)) tail.set(edgeKey(l), (tail.get(edgeKey(l)) || 0) + 1); });
    const out = pages.map((lines, i) => {
      let printed = null, footer = '', running = '';
      // 앞쪽: 반복 머리말과 쪽수
      for (let k = 0; k < 3 && lines.length; k++) {
        const l = lines[0];
        if (repeated(edgeKey(l)) && !isSectionMarker(l)) {
          running = running || l.replace(/\d+/g, '').trim();
          const m = l.match(/(\d{1,4})/); if (m && printed == null) printed = Number(m[1]);
          lines.shift();
        } else if (/^\d{1,4}$/.test(l)) { if (running && printed == null) printed = Number(l); lines.shift(); }
        else break;
      }
      // 뒤쪽: 반복 단원 표시
      while (lines.length && isSectionMarker(lines[lines.length - 1]) && (tail.get(edgeKey(lines[lines.length - 1])) || 0) >= 2) {
        footer = footer || lines[lines.length - 1]; lines.pop();
      }
      footer = footer.replace(/\s*([.．])\s*/, '$1 ').replace(/\s*([‧·・])\s*/g, '$1').replace(/\s+/g, ' ').trim();
      return { pdf_page: i + 1, printed_page: printed, footer_label: footer, running_header: running, text: lines.join('\n'), links: [] };
    });
    const diffs = new Map();
    out.forEach(r => { if (r.printed_page != null) diffs.set(r.pdf_page - r.printed_page, (diffs.get(r.pdf_page - r.printed_page) || 0) + 1); });
    let off = null, best = 0; diffs.forEach((n, d) => { if (n > best) { best = n; off = d; } });
    out.forEach(r => { if (r.printed_page != null && best >= 3 && r.pdf_page - r.printed_page !== off) r.printed_page = null; });
    return out;
  }

  return { buildLines, linkTexts, analyzePages, analyzeTextPages, isSectionMarker };
});
