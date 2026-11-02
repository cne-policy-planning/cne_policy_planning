/*
 * 관리자 도구 · 아주 작은 엑셀(xlsx)·CSV 읽기/쓰기 (브라우저 전용, JSZip 사용)
 *  - write(sheets) → Blob : sheets = [{ name, rows: [[칸,…],…], widths: [글자 수,…], textCols: [0,…] }]
 *    첫 줄은 굵게, textCols 칸은 '텍스트' 서식(엑셀이 숫자로 바꾸지 않게)
 *  - read(file, preferName) → [[칸,…],…] : 이름이 preferName인 시트(없으면 첫 시트). CSV도 읽는다(UTF-8 · 한국어 Windows 기본 CP949)
 */
(function (root) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

  function sheetXml(sh) {
    const cols = (sh.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${(sh.textCols || []).includes(i) ? ' style="2"' : ''}/>`).join('');
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      if (v == null || v === '') return '';
      const ref = colName(ci) + (ri + 1);
      const st = ri === 0 ? ' s="1"' : (sh.textCols || []).includes(ci) ? ' s="2"' : '';
      if (typeof v === 'number' && isFinite(v) && !(sh.textCols || []).includes(ci)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('') + '</row>').join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData></worksheet>`;
  }

  async function write(sheets) {
    const Z = new root.JSZip();
    Z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    Z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    Z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    Z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    Z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FC"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    sheets.forEach((s, i) => Z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
    return Z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }

  // ---------- 읽기 ----------
  const parseXml = t => new DOMParser().parseFromString(t, 'application/xml');
  const kids = (el, name) => [...el.getElementsByTagName('*')].filter(e => e.localName === name);
  const textOf = el => kids(el, 't').map(t => t.textContent).join('') || '';

  async function readXlsx(buf, preferName) {
    const Z = await root.JSZip.loadAsync(buf);
    const wb = parseXml(await Z.file('xl/workbook.xml').async('string'));
    const relsFile = Z.file('xl/_rels/workbook.xml.rels');
    const rels = relsFile ? parseXml(await relsFile.async('string')) : null;
    const sheets = kids(wb, 'sheet').map(s => ({ name: s.getAttribute('name'), rid: s.getAttribute('r:id') || [...s.attributes].find(a => a.localName === 'id').value }));
    const pick = sheets.find(s => s.name === preferName) || sheets[0];
    if (!pick) throw new Error('엑셀에 시트가 없습니다.');
    let target = 'worksheets/sheet1.xml';
    if (rels) { const r = kids(rels, 'Relationship').find(x => x.getAttribute('Id') === pick.rid); if (r) target = r.getAttribute('Target'); }
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const shared = [];
    const ss = Z.file('xl/sharedStrings.xml');
    if (ss) kids(parseXml(await ss.async('string')), 'si').forEach(si => shared.push(textOf(si)));
    const sh = parseXml(await Z.file(path).async('string'));
    const out = [];
    kids(sh, 'row').forEach(row => {
      const ri = Number(row.getAttribute('r')) - 1;
      const arr = out[ri] = out[ri] || [];
      kids(row, 'c').forEach((c, k) => {
        const ref = c.getAttribute('r'); const ci = ref ? colIndex(ref) : k;
        const t = c.getAttribute('t'); const v = kids(c, 'v')[0];
        let val = '';
        if (t === 's') val = shared[Number(v && v.textContent)] || '';
        else if (t === 'inlineStr') val = textOf(c);
        else if (v) val = t === 'b' ? (v.textContent === '1') : (t === 'str' || t === 'e' ? v.textContent : (isFinite(Number(v.textContent)) ? Number(v.textContent) : v.textContent));
        arr[ci] = val;
      });
    });
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
    return out;
  }

  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('euc-kr').decode(u8); }   // 엑셀 「CSV(쉼표로 분리)」 저장(한국어 Windows)
  }
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  async function read(file, preferName) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 2));
    if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(buf, preferName);   // PK: xlsx
    if (/\.xls$/i.test(file.name)) throw new Error('예전 엑셀 형식(.xls)은 읽을 수 없습니다. 엑셀에서 「다른 이름으로 저장 → Excel 통합 문서(.xlsx)」로 저장해 주세요.');
    return parseCsv(decodeText(buf));
  }

  root.SASXlsx = { write, read, parseCsv };
})(typeof self !== 'undefined' ? self : this);
