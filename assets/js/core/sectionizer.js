/*
 * 목차 인식과 업무(섹션) 분할
 * 입력 blocks: [{n, pdf_page, printed_page, footer_label, text, lines?, links?}]
 *   - PDF는 블록 1개 = 1페이지, HWPX는 블록 1개 = 1문단
 * 출력 sections: [{id, heading, parent_heading, block_start, block_end, keywords, auto}]
 */
(function (root, factory) {
  const api = factory(root.SAS || (typeof require === 'function' ? Object.assign({}, require('./normalize.js'), require('./textlayout.js')) : {}));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAS = Object.assign(root.SAS || {}, api);
})(typeof self !== 'undefined' ? self : this, function (N) {
  'use strict';

  const ROMAN = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ';
  const LEADER = /(?:[·・‧.…]\s*){4,}|…{2,}/;
  const TOC_LINE = /^(\d(?: ?\d)?)\s*[.．]\s*(.+?)\s*(?:[·・‧.…]\s*){3,}\s*(\d(?: ?\d){0,3})\s*$/;
  const PART_LINE = new RegExp('^\\s*([' + ROMAN + ']|[IVX]{1,4})\\s*[.．]?\\s*([^·・.…\\d][^·・…]{0,30})$');
  const HEADING_LINE = /^(\d(?: ?\d)?)\s*[.．]\s*([^\d\s].{0,60})$/;
  const ROMAN_ONLY = new RegExp('^\\s*([' + ROMAN + ']|[IVX]{1,4})\\s*[.．]?\\s*$');
  const num = s => Number(String(s).replace(/\s/g, ''));

  function pad(n) { return String(n).padStart(3, '0'); }

  /** 목차 페이지를 찾아 [{num,title,printed,parent}] 반환 */
  function parseToc(blocks) {
    const entries = [], tocBlocks = [];
    blocks.forEach((b, bi) => {
      const lines = String(b.text || '').split('\n').map(s => s.trim()).filter(Boolean);
      const leaderLines = lines.filter(l => LEADER.test(l) && /\d\s*$/.test(l));
      if (leaderLines.length < 3) return;
      tocBlocks.push(bi);
      let parent = '';
      // 줄이 잘려 다음 줄로 넘어간 항목("7." / "···· 9")을 이어 붙인다
      const joined = [];
      for (const l of lines) {
        const prev = joined[joined.length - 1];
        if (prev && /^\d{1,2}\s*[.．]?\s*$/.test(prev)) { joined[joined.length - 1] = prev + ' ' + l; continue; }
        if (prev && ROMAN_ONLY.test(prev)) { joined[joined.length - 1] = prev.trim() + ' ' + l; continue; }
        if (prev && !TOC_LINE.test(prev) && /^\d{1,2}\s*[.．]/.test(prev) && /^(?:[·・‧.…]\s*){3,}\d+$/.test(l.replace(/\s/g, ''))) { joined[joined.length - 1] = prev + ' ' + l; continue; }
        joined.push(l);
      }
      for (const l of joined) {
        const m = l.match(TOC_LINE);
        if (m) {
          const title = cleanTitle(m[2]);
          if (/[가-힣A-Za-z]/.test(title)) entries.push({ num: num(m[1]), title, printed: num(m[3]), parent });
          continue;
        }
        const p = l.match(PART_LINE);
        if (p && !LEADER.test(l)) parent = cleanTitle(p[2]);
      }
    });
    return { entries, tocBlocks };
  }

  function cleanTitle(t) {
    return String(t || '').replace(LEADER, '').replace(/\s*업무개요.*$/, '').replace(/\s{2,}.*$/, '').replace(/\s*[‧·・ㆍ]\s*/g, '·').replace(/\s+/g, ' ').trim();
  }

  /** 본문 블록 상단에서 업무 제목 줄을 찾는다 */
  function headingIn(block, maxLines) {
    const lines = String(block.text || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, maxLines || 4);
    for (const l of lines) {
      const m = l.match(HEADING_LINE);
      if (m) return { num: num(m[1]), title: cleanTitle(m[2]) };
    }
    return null;
  }

  function similar(a, b) {
    const x = N.norm(a), y = N.norm(b);
    if (!x || !y) return false;
    if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
    const k = Math.min(4, x.length, y.length);
    return x.slice(0, k) === y.slice(0, k);
  }

  /** '현 장 체 험'처럼 글자마다 띄어진 제목인지 */
  function looksBroken(t) {
    const tok = String(t).split(/\s+/).filter(Boolean);
    return tok.length >= 4 && tok.filter(x => x.length === 1).length / tok.length > 0.5;
  }

  function stripPart(label) {
    return String(label || '').replace(new RegExp('^\\s*([' + ROMAN + ']|[IVX]{1,4})\\s*[.．]?\\s*'), '').trim();
  }

  function isEmptyBlock(b) { return N.norm(b.text).length < 15; }

  /** 인쇄 쪽수 → 블록 위치 */
  function blockForPrinted(blocks, printed) {
    const exact = blocks.findIndex(b => b.printed_page === printed);
    if (exact >= 0) return exact;
    const diffs = new Map();
    blocks.forEach((b, i) => { if (b.printed_page != null) diffs.set(i - b.printed_page, (diffs.get(i - b.printed_page) || 0) + 1); });
    let off = null, best = 0;
    diffs.forEach((n, d) => { if (n > best) { best = n; off = d; } });
    if (off == null) return -1;
    const i = printed + off;
    return i >= 0 && i < blocks.length ? i : -1;
  }

  /** 목차 기반 분할 */
  function sectionsFromToc(blocks, toc) {
    const warnings = [];
    const starts = [];
    const firstBody = Math.max(...toc.tocBlocks) + 1;
    for (const e of toc.entries) {
      let bi = blockForPrinted(blocks, e.printed);
      if (bi < 0) { warnings.push(`목차 "${e.title}"(${e.printed}쪽)의 위치를 찾지 못했습니다.`); continue; }
      // 제목이 실제로 있는지 앞뒤 1쪽까지 확인
      let found = null;
      for (const d of [0, 1, -1, 2]) {
        const j = bi + d;
        if (j < firstBody || j >= blocks.length) continue;
        const h = headingIn(blocks[j]);
        if (h && similar(h.title, e.title)) { found = { j, h }; break; }
      }
      if (found) bi = found.j;
      else warnings.push(`"${e.title}": 본문 ${blocks[bi].pdf_page || bi + 1}쪽에서 제목을 확인하지 못해 목차 쪽수로 연결했습니다.`);
      const heading = found && !looksBroken(found.h.title) ? found.h.title : cleanTitle(e.title);
      starts.push({ bi, heading, toc_title: e.title, parent: cleanTitle(e.parent) || stripPart(blocks[bi].footer_label) });
    }
    starts.sort((a, b) => a.bi - b.bi);
    const sections = starts.map((s, i) => {
      const next = starts[i + 1];
      let end = next ? Math.max(s.bi, next.bi - 1) : blocks.length - 1;
      if (next && next.bi === s.bi) end = s.bi;
      // 끝쪽의 빈 간지 페이지 제거
      while (end > s.bi && isEmptyBlock(blocks[end])) end--;
      // 마지막 업무: 단원 꼬리말이 끊기는 지점(판권면 등)에서 멈춘다
      if (!next && blocks[s.bi].footer_label) {
        while (end > s.bi && blocks[end].footer_label !== blocks[s.bi].footer_label) end--;
      }
      return { id: 'sec-' + pad(i + 1), heading: s.heading, parent_heading: s.parent, block_start: s.bi, block_end: end, keywords: [], auto: true };
    });
    return { sections, warnings };
  }

  /** 목차가 없을 때: 큰 글씨 또는 번호 제목으로 페이지 시작점을 찾는다 */
  function sectionsFromHeadings(blocks, docTitle) {
    const sizes = [];
    blocks.forEach(b => (b.lines || []).forEach(l => sizes.push(l.size)));
    sizes.sort((a, b) => a - b);
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    const starts = [];
    blocks.forEach((b, bi) => {
      if (isEmptyBlock(b)) return;
      let title = null;
      if (b.lines && median) {
        const big = b.lines.slice(0, 4).find(l => l.size >= median * 1.3 && l.text.length <= 60 && !N.isSectionMarker(l.text));
        if (big) title = cleanTitle(big.text.replace(/^\d{1,2}\s*[.．]\s*/, ''));
      }
      if (!title) { const h = headingIn(b, 3); if (h) title = h.title; }
      if (title) starts.push({ bi, heading: title });
    });
    if (!starts.length) {
      // 제목을 전혀 찾지 못하면 페이지(또는 일정 길이)별로 나눈다
      return { sections: blocks.map((b, bi) => ({ bi, b })).filter(x => !isEmptyBlock(x.b)).map((x, i) => ({
        id: 'sec-' + pad(i + 1), heading: x.b.pdf_page ? `${docTitle} ${x.b.pdf_page}쪽` : `${docTitle} 구간 ${i + 1}`,
        parent_heading: stripPart(x.b.footer_label), block_start: x.bi, block_end: x.bi, keywords: [], auto: true, untitled: true })),
        warnings: ['목차와 업무 제목을 찾지 못해 페이지 단위로 나눴습니다. 관리 화면에서 업무명을 보정해 주세요.'] };
    }
    if (starts[0].bi > 0 && blocks.slice(0, starts[0].bi).some(b => !isEmptyBlock(b))) {
      // 첫 제목 앞의 내용(표지·머리말)은 별도 구간
      starts.unshift({ bi: blocks.findIndex(b => !isEmptyBlock(b)), heading: docTitle + ' (앞부분)' });
    }
    const sections = starts.map((s, i) => {
      const next = starts[i + 1];
      let end = next ? Math.max(s.bi, next.bi - 1) : blocks.length - 1;
      while (end > s.bi && isEmptyBlock(blocks[end])) end--;
      return { id: 'sec-' + pad(i + 1), heading: s.heading, parent_heading: stripPart(blocks[s.bi].footer_label), block_start: s.bi, block_end: end, keywords: [], auto: true };
    });
    return { sections, warnings: ['목차를 찾지 못해 본문 제목으로 나눴습니다. 결과를 확인해 주세요.'] };
  }

  /** HWPX(문단 블록): 목차 제목과 같은 문단을 찾고, 없으면 길이 기준으로 묶는다 */
  function sectionsForParagraphs(blocks, docTitle) {
    const toc = parseToc([{ text: blocks.map(b => b.text).join('\n') }]);
    const starts = [];
    if (toc.entries.length >= 3) {
      let from = 0;
      for (const e of toc.entries) {
        for (let i = from; i < blocks.length; i++) {
          const t = blocks[i].text.trim();
          if (t.length <= 70 && !LEADER.test(t)) {
            const m = t.match(HEADING_LINE);
            if (m && similar(m[2], e.title)) { starts.push({ bi: i, heading: cleanTitle(m[2]), parent: e.parent }); from = i + 1; break; }
          }
        }
      }
    }
    if (starts.length >= 2) {
      return { sections: starts.map((s, i) => ({ id: 'sec-' + pad(i + 1), heading: s.heading, parent_heading: s.parent || '', block_start: s.bi,
        block_end: starts[i + 1] ? starts[i + 1].bi - 1 : blocks.length - 1, keywords: [], auto: true })), warnings: [], toc_found: true };
    }
    const sections = []; let cur = null, len = 0;
    blocks.forEach((b, i) => {
      if (!cur || len > 1800) {
        cur = { id: 'sec-' + pad(sections.length + 1), heading: (b.text.split('\n')[0] || '').slice(0, 40) || `${docTitle} 구간 ${sections.length + 1}`, parent_heading: '', block_start: i, block_end: i, keywords: [], auto: true, untitled: true };
        sections.push(cur); len = 0;
      }
      cur.block_end = i; len += b.text.length;
    });
    return { sections, warnings: ['HWPX에서 목차를 찾지 못해 길이 기준으로 나눴습니다. 업무명을 보정해 주세요.'], toc_found: false };
  }

  /** 문서 블록 → 업무 분할 결과 */
  function sectionize(doc) {
    const blocks = doc.blocks || [];
    if (!blocks.length) return { sections: [], warnings: [], toc_found: false };
    if (doc.format === 'hwpx') return sectionsForParagraphs(blocks, doc.title);
    const toc = parseToc(blocks);
    if (toc.entries.length >= 3) {
      const r = sectionsFromToc(blocks, toc);
      if (r.sections.length >= Math.ceil(toc.entries.length * 0.6)) return Object.assign(r, { toc_found: true });
    }
    return Object.assign(sectionsFromHeadings(blocks, doc.title), { toc_found: false });
  }

  /** 섹션 본문(블록 결합) */
  function sectionText(doc, sec) {
    return (doc.blocks || []).slice(sec.block_start, sec.block_end + 1).map(b => b.text).join('\n\n');
  }

  /** 미리보기용 업무 시작 문장 */
  function sectionLead(doc, sec, max) {
    const lines = sectionText(doc, sec).split('\n').map(s => s.trim()).filter(Boolean);
    const h = N.norm(sec.heading);
    const body = lines.filter((l, i) => !(i < 3 && (N.norm(l).includes(h) || h.includes(N.norm(l)))) && !/^업무\s*개요$/.test(l));
    const s = body.join(' ').replace(/\s+/g, ' ').trim();
    max = max || 120;
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  /** 섹션이 걸친 PDF·인쇄 쪽 */
  function sectionPages(doc, sec) {
    const bs = (doc.blocks || []).slice(sec.block_start, sec.block_end + 1);
    return {
      pdf_pages: bs.map(b => b.pdf_page).filter(v => v != null),
      printed_pages: bs.map(b => b.printed_page).filter(v => v != null)
    };
  }

  function linkKind(url) {
    if (/fileDown|download|filedown|atchFile|attach/i.test(url)) return 'file';
    if (/law\.go\.kr/i.test(url)) return 'law';
    return 'site';
  }

  /**
   * 업무명이 진짜 제목이 아닌 구간인지(목차 없이 쪽·길이로 나눈 구간).
   * 관리자가 업무명을 고치면(auto=false) 제목으로 본다. 예전 자료는 형식으로 추정한다.
   */
  function isUntitled(doc, s) {
    if (s.auto === false) return false;
    if (s.untitled) return true;
    if (doc.extraction && doc.extraction.toc_found) return false;
    if (doc.format === 'hwpx') return true;
    return /\s\d+쪽$|\s구간 \d+$/.test(s.heading || '');
  }

  /** 블록별 링크를 섹션에 배정하고 중복을 정리한다 */
  function attachLinks(doc) {
    const out = [];
    const seen = new Set();
    (doc.blocks || []).forEach((b, bi) => {
      (b.links || []).forEach(l => {
        const owners = (doc.sections || []).filter(s => bi >= s.block_start && bi <= s.block_end);
        const sec = owners.length ? owners[owners.length - 1] : null;
        const key = (sec ? sec.id : '-') + '|' + l.url;
        if (seen.has(key)) {
          const prev = out.find(o => o.key === key);
          if (prev && l.text && l.text.length > prev.text.length && !/[」』]/.test(l.text)) prev.text = l.text;
          return;
        }
        seen.add(key);
        out.push({ key, text: l.text || l.url, url: l.url, kind: linkKind(l.url), block: bi, section_id: sec ? sec.id : null });
      });
    });
    return out.map((o, i) => ({ id: 'lnk-' + String(i + 1).padStart(4, '0'), text: o.text.replace(/^[「『」』\s]+|[「『」』\s,]+$/g, ''), url: o.url, kind: o.kind, block: o.block, section_id: o.section_id }));
  }

  return { parseToc, isUntitled, sectionize, sectionText, sectionLead, sectionPages, attachLinks, linkKind, cleanTitle };
});
