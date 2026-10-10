/*
 * 관리자 도구 · 파일 추출기 (브라우저 전용)
 * PDF: pdf.js로 글자 조각과 링크 주석을 읽어 core/textlayout.analyzePages로 넘긴다.
 * HWPX: JSZip으로 Contents/section*.xml의 문단(표 안 문단 포함)을 읽는다.
 * 원본 파일은 외부로 전송하지 않는다. 라이브러리는 assets/vendor/에 내장되어 인터넷 없이도 동작한다.
 */
(function (root) {
  'use strict';
  const SAS = root.SAS;
  const VENDOR = new URL('../assets/vendor/pdfjs/', root.location ? root.location.href : 'http://localhost/admin/').href;
  const MAX_FILE = 100 * 1024 * 1024;

  function ensureLib(name) {
    const hint = root.location && root.location.protocol === 'file:' ? ' 관리자 도구는 PC 파일이 아니라 사이트 주소(https://…/admin/)로 열어 주세요.' : ' 새로고침해 주세요.';
    if (name === 'pdf' && !root.pdfjsLib) throw new Error('PDF 읽기 도구를 불러오지 못했습니다.' + hint);
    if (name === 'zip' && !root.JSZip) throw new Error('HWPX 읽기 도구를 불러오지 못했습니다.' + hint);
  }

  async function extractPdf(file, onProgress) {
    ensureLib('pdf');
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
    // 한글 CID 글꼴(KSC·UniKS 등) 문자표를 내장 폴더에서 읽는다
    const task = root.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: VENDOR + 'cmaps/', cMapPacked: true, isEvalSupported: false });
    const pdf = await task.promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      const content = await page.getTextContent();
      let annotations = [];
      try {
        annotations = (await page.getAnnotations()).filter(a => a.subtype === 'Link' && (a.url || a.unsafeUrl))
          .map(a => ({ subtype: 'Link', url: a.url || a.unsafeUrl, rect: a.rect }));
      } catch (e) { /* 주석 읽기 실패는 본문 추출에 영향 없음 */ }
      pages.push({
        width: x1 - x0, height: y1 - y0,
        items: content.items.map(it => ({ str: it.str, transform: [it.transform[0], it.transform[1], it.transform[2], it.transform[3], it.transform[4] - x0, it.transform[5] - y0], width: it.width, hasEOL: it.hasEOL })),
        annotations: annotations.map(a => ({ subtype: a.subtype, url: a.url, rect: [a.rect[0] - x0, a.rect[1] - y0, a.rect[2] - x0, a.rect[3] - y0] }))
      });
      page.cleanup();
      if (onProgress) onProgress(n, pdf.numPages);
    }
    try { await task.destroy(); } catch (e) { /* 정리 실패는 무시 */ }
    return SAS.analyzePages(pages);
  }

  function localName(node) { return (node.localName || String(node.nodeName).split(':').pop()).toLowerCase(); }

  /** 한글 하이퍼링크 필드의 주소(http/https만) */
  function hyperlinkUrl(field) {
    let path = '', cmd = '';
    for (const el of field.getElementsByTagName('*')) {
      if (localName(el) !== 'stringparam') continue;
      const n = el.getAttribute('name');
      if (n === 'Path') path = el.textContent;
      else if (n === 'Command') cmd = el.textContent;
    }
    let url = (path || cmd.replace(/\\(.)/g, '$1').split(';')[0] || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  /** 문단 하나의 글자와 링크. 안쪽 표·문단은 따로 처리되므로 건너뛴다 */
  function paragraphText(p) {
    let s = '';
    const links = [], open = new Map();
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { if (localName(node) === 't') s += child.nodeValue; continue; }
        if (child.nodeType !== 1) continue;
        const n = localName(child);
        if (n === 'tbl' || n === 'p' || n === 'sublist') continue;
        if (n === 'linebreak' || n === 'br') s += '\n';
        else if (n === 'tab') s += ' ';
        else if (n === 'fieldbegin') {
          if ((child.getAttribute('type') || '').toUpperCase() === 'HYPERLINK') { const url = hyperlinkUrl(child); if (url) open.set(child.getAttribute('id'), { url, start: s.length }); }
        } else if (n === 'fieldend') {
          const o = open.get(child.getAttribute('beginIDRef'));
          if (o) { links.push({ url: o.url, text: s.slice(o.start) }); open.delete(child.getAttribute('beginIDRef')); }
        } else walk(child);
      }
    };
    walk(p);
    open.forEach(o => links.push({ url: o.url, text: s.slice(o.start) })); // 문단 끝까지 이어진 링크
    return { text: s, links };
  }

  async function extractHwpx(file, onProgress) {
    ensureLib('zip');
    const zip = await root.JSZip.loadAsync(file);
    const names = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/section(\d+)/i)[1]) - Number(b.match(/section(\d+)/i)[1]));
    if (!names.length) throw new Error('HWPX 본문(section XML)을 찾지 못했습니다. 한글 파일이 HWPX 형식인지 확인해 주세요.');
    const blocks = [];
    for (let i = 0; i < names.length; i++) {
      const xml = await zip.file(names[i]).async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('HWPX XML 형식 오류: ' + names[i]);
      for (const el of doc.getElementsByTagName('*')) {
        if (localName(el) !== 'p') continue;
        const r = paragraphText(el);
        const t = SAS.clean(r.text);
        const links = r.links.map(l => ({ url: l.url, text: SAS.clean(l.text).replace(/\s+/g, ' ') })).filter(l => l.text);
        if (t) blocks.push({ pdf_page: null, printed_page: null, footer_label: '', text: t, links });
      }
      if (onProgress) onProgress(i + 1, names.length);
    }
    return blocks;
  }

  /**
   * 파일 하나 분석. 반환 { format, kind, blocks, pageCount }
   * 링크형(HWP·엑셀 등)은 blocks 없이 반환
   */
  async function extractFile(file, onProgress) {
    if (file.size > MAX_FILE) throw new Error('파일당 100MB를 넘습니다.');
    const format = SAS.formatOf(file.name);
    const kind = SAS.kindOf(format);
    if (kind === 'link') return { format, kind, blocks: [], pageCount: 0 };
    const blocks = format === 'pdf' ? await extractPdf(file, onProgress) : await extractHwpx(file, onProgress);
    return { format, kind, blocks, pageCount: blocks.length };
  }

  root.SASExtract = { extractFile, extractPdf, extractHwpx };
})(typeof self !== 'undefined' ? self : this);
