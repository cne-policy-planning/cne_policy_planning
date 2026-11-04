/*
 * 교무행정 통합검색 · 공용 텍스트 도구
 * 브라우저(window.SAS)와 Node.js(require) 양쪽에서 동작합니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SAS = Object.assign(root.SAS || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 검색 비교에서 무시할 문자: 공백, 가운뎃점류, 일부 구두점·괄호
  const IGNORE_RE = /[\s ·・‧･∙•⋅ㆍ.,，。:;'"‘’“”`´()\[\]{}<>「」『』〈〉《》【】\-–—_~!?/\\|※▸▶◆◇■□○●◎★☆]+/g;

  /** 제어문자 제거와 공백 정리. 원문 표시용(줄바꿈 유지). */
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/\u0000/g, ' ')
      .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f­​-‍﻿]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\t  - 　]/g, ' ')
      .replace(/ {2,}/g, ' ')
      .split('\n').map(l => l.trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** v1 추출기가 만든 '운영 ,' '( 근거 )' 같은 구두점 앞뒤 공백을 복구 */
  function repairSpacing(s) {
    return String(s)
      .replace(/ +([,.)\]」』〉》:;!?%])/g, '$1')
      .replace(/([(\[「『〈《]) +/g, '$1')
      .replace(/(\d) +\. +(?=\d)/g, '$1.')
      .replace(/ {2,}/g, ' ');
  }

  /** 검색 비교용 정규화: 소문자, 호환문자 통일, 공백·구두점 제거 */
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLocaleLowerCase('ko').replace(IGNORE_RE, '');
  }

  /** 2글자 단위 조각(중복 제거). 1글자 검색어는 그대로 반환 */
  function bigrams(normalized) {
    const s = String(normalized);
    if (s.length < 2) return s ? [s] : [];
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return [...set];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** 검색어 글자 사이에 공백·가운뎃점이 끼어 있어도 찾는 정규식 */
  function looseRegex(query, flags) {
    const chars = [...norm(query)];
    if (!chars.length) return null;
    const gap = '[\\s\\u00a0·・‧･ㆍ.,()\\[\\]「」『』\\-]*';
    const body = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(gap);
    return new RegExp(body, flags || 'gi');
  }

  /** 검색어 위치를 찾아 앞뒤 문맥을 잘라낸다 */
  function snippet(text, query, before, after) {
    const raw = String(text || '');
    before = before == null ? 60 : before; after = after == null ? 160 : after;
    const re = query ? looseRegex(query, 'i') : null;
    const m = re ? re.exec(raw) : null;
    if (!m) return { text: raw.slice(0, before + after).trim() + (raw.length > before + after ? '…' : ''), matched: false };
    let start = Math.max(0, m.index - before), end = Math.min(raw.length, m.index + m[0].length + after);
    // 줄 경계에 맞춰 자르면 읽기 쉽다
    const nl = raw.lastIndexOf('\n', m.index);
    if (nl >= start && m.index - nl < before) start = nl + 1;
    return { text: (start > 0 ? '…' : '') + raw.slice(start, end).trim() + (end < raw.length ? '…' : ''), matched: true };
  }

  /** HTML 이스케이프 후 검색어 강조 */
  function highlight(text, query) {
    const s = String(text || '');
    const re = query ? looseRegex(query, 'gi') : null;
    if (!re) return esc(s);
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  /** 쉼표·줄바꿈으로 구분된 입력을 목록으로 */
  function splitList(s) {
    if (Array.isArray(s)) return s.map(x => String(x).trim()).filter(Boolean);
    return String(s || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean)
      .filter((x, i, a) => a.indexOf(x) === i);
  }

  /** 본문 색인 조각 파일 번호(FNV-1a). 색인 생성기와 검색기가 같은 함수를 쓴다 */
  function shardOf(gram, count) {
    let h = 0x811c9dc5;
    for (let i = 0; i < gram.length; i++) { h ^= gram.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h % count;
  }

  // ---------- 글자 사이 띄어쓰기(균등분할·OCR) 붙이기 ----------
  const HANGUL_TOKEN = /^[가-힣]+$/;
  /** 한글 낱말 중 한 글자짜리 비율(0~1). 낱말이 적으면 0 */
  function spacedRatio(texts) {
    let all = 0, single = 0;
    (texts || []).forEach(t => String(t || '').split(/\s+/).forEach(w => { if (HANGUL_TOKEN.test(w)) { all++; if (w.length === 1) single++; } }));
    return all >= 30 ? single / all : 0;
  }
  /** 글자 사이가 벌어진 자료(OCR·균등분할 위주)로 볼 기준 */
  const SPACED_DOC = 0.5;
  /**
   * 띄어쓰기 붙이기
   * - 언제나: 한 글자 한글이 셋 이상 이어지면 붙인다("공 적 조 서" → "공적조서"), "제 5 조" → "제5조"
   * - aggressive(글자 사이가 벌어진 자료): 한 글자 한글은 옆 한글 낱말과 붙인다("유 치 원 생 활 기 록부 의" → "유치원생활기록부의")
   */
  const MAYBE_SPACED = /(?:^|\s)[(\[「『"']?[가-힣][)\]」』"',.]?(?=\s|$)|제\s+\d/;
  function joinSpaced(s, aggressive) {
    let t = String(s == null ? '' : s);
    if (!MAYBE_SPACED.test(t)) return t;   // 한 글자 낱말이 없으면 그대로(빠르게)
    t = t.replace(/제\s+(\d+)\s*(조|항|호|장|절|편)/g, '제$1$2');
    const words = t.split(/( +)/);   // 낱말과 공백을 번갈아
    const tok = [];
    for (let i = 0; i < words.length; i += 2) tok.push(words[i]);
    const H = /[가-힣]/;
    const head = w => { let n = 0; while (n < w.length && H.test(w[n])) n++; return n; };          // 앞쪽 한글 글자 수
    const tail = w => { let n = 0; while (n < w.length && H.test(w[w.length - 1 - n])) n++; return n; }; // 뒤쪽 한글 글자 수
    const pure = w => w.length === 1 && H.test(w);
    const PARTICLE = /^(?:의|은|는|을|를|에|와|과|도|로|이|가|으로|에서|에게|까지|부터|하여|한다|된다|하는|하고)$/;
    const n = tok.length;
    const glue = new Array(n).fill(false);   // glue[i]: tok[i]와 tok[i+1] 사이를 붙임
    // 한 글자씩 벌어진 구간(넷 이상): "공 적 조 서(기관)" → "공적조서(기관)". "그 외 각 호"처럼 셋은 보통 글이라 두고, '및'은 끼우지 않는다
    const STAND = /^및$/;
    const pairOk = i => tail(tok[i]) === 1 && head(tok[i + 1]) === 1 && (pure(tok[i]) || pure(tok[i + 1])) && !STAND.test(tok[i]) && !STAND.test(tok[i + 1]);
    for (let i = 0; i < n - 1;) {
      let j = i; while (j < n - 1 && pairOk(j)) j++;
      if (j - i >= 3) for (let k = i; k < j; k++) glue[k] = true;
      i = j > i ? j : i + 1;
    }
    if (aggressive) {
      // 한 글자는 뒷말에 붙이고(앞글자 조각), 조사는 앞말에 붙인다: "유 치 원 생 활 기 록부 의 법적" → "유치원생활기록부의 법적"
      for (let i = 0; i < n - 1; i++) {
        const a = tok[i], b = tok[i + 1];
        if (!tail(a) || !head(b) || STAND.test(a) || STAND.test(b)) continue;
        if (PARTICLE.test(b) && b.length <= 2) { glue[i] = true; continue; }
        if (PARTICLE.test(a)) continue;
        if (pure(a) || (tail(a) === 1 && !H.test(a[0]))) glue[i] = true;   // "기" + "록부", "(기" + "본"
      }
    }
    let out = tok[0] || '';
    for (let i = 1; i < n; i++) out += (glue[i - 1] ? '' : (words[2 * i - 1] || ' ')) + tok[i];
    return repairSpacing(out);
  }

  // ---------- 목차 제목 정리 ----------
  const TITLE_MAX = 40;
  /**
   * 목차 정리: 글자 사이 띄어쓰기를 붙이고, 문장처럼 긴 제목은 앞부분만 제목으로 두고 나머지는 설명(d)으로 옮긴다.
   * 번호(c)·종류(k)·위치는 바꾸지 않으므로 여러 번 해도 결과가 같다. 반환: 새 노드 배열
   * 단원(ch)·자료 링크(link)는 줄이지 않는다(서식 이름은 길어도 그대로).
   */
  function tidyOutline(nodes) {
    const list = nodes || [];
    const aggressive = spacedRatio(list.filter(n => n.k !== 'link').map(n => n.t)) > SPACED_DOC;
    return list.map(n => {
      if (n.k === 'link') return n;
      const raw = String(n.t == null ? '' : n.t);
      if (raw.length <= TITLE_MAX && !MAYBE_SPACED.test(raw) && !/\s{2}|[\n\t]/.test(raw)) return n;   // 고칠 것이 없으면 그대로(빠르게)
      if (/…$/.test(raw) && raw.length <= TITLE_MAX + 1) return n;   // 이미 줄인 제목(색인)은 다시 줄이지 않는다
      let t = clean(joinSpaced(raw, aggressive)).replace(/\s+/g, ' ');
      const m = Object.assign({}, n, { t });
      if (n.k !== 'ch' && t.length > TITLE_MAX) {
        // 끊을 곳: 문장 끝 → 쌍점·화살표 → 마지막 띄어쓰기 (12~40자 사이)
        const head = t.slice(0, TITLE_MAX + 1);
        let cut = -1, mm;
        const ends = /(?:다|함|음|임|요|됨)\s*[.。]\s|[:：]\s|\s[-–→]\s/g;
        while ((mm = ends.exec(head))) if (mm.index >= 12) { cut = mm.index + mm[0].trimEnd().length; break; }
        if (cut < 0) { const sp = head.lastIndexOf(' '); cut = sp >= 12 ? sp : TITLE_MAX; }
        const rest = t.slice(cut).replace(/^[\s:：.。,-]+/, '').trim();
        m.t = t.slice(0, cut).replace(/[\s:：,]+$/, '').trim();
        if (rest) { m.d = [rest].concat(n.d || []); m.cut = 1; }
      }
      if (m.d) m.d = m.d.map(x => clean(joinSpaced(x, aggressive)));
      return m;
    });
  }

  /**
   * 목차에 보일 줄만 남긴다(제목만).
   *  - ▸ 세부 줄(bullet): 본문 문장이므로 뺀다
   *  - 글자가 깨진 줄: PDF 글꼴 문제로 엉뚱한 문자(ɱ, ॹ, ߯ …)가 섞인 제목, 한두 글자뿐인 조각(「커」, 「Ⅲ」)
   *  - 문장으로 끝나는 줄(…합니다. / …한다): 제목이 아니라 본문
   * 빠진 줄 아래의 줄은 가장 가까운 남은 위 줄에 붙는다(화면에서 처리).
   */
  const OK_CH = /[가-힣ㄱ-ㆎ一-鿿 -~·°×‐-⁯⅐-⇿①-➿　-〿㈀-㏿＀-￯]/;
  function oddChars(t) { let n = 0; for (const ch of String(t || '')) if (!OK_CH.test(ch)) n++; return n; }
  function isGarbled(t) {
    const s = String(t || '').replace(/\s+/g, '');
    if (!s) return true;
    const odd = oddChars(s);
    if (odd >= 4 || (odd >= 2 && odd / s.length >= 0.15)) return true;
    const han = (s.match(/[가-힣一-鿿]/g) || []).length;
    // 한글이 하나도 없는데 기호가 섞였거나 대소문자가 뒤섞인 줄(「[[ J\?]^ GE$」, 「bb cPB$」)
    // 한글이 하나도 없는 줄은 글자가 깨진 조각으로 본다(「GG _1」, 「RSTU」, 「CONTENTS」).
    // 단, PART 1 · Chapter 2 · Q&A 같은 표지나 영어 낱말이 둘 이상인 제목은 둔다
    if (!han) {
      const raw = String(t || '').trim();
      if (/^(part|chapter|step|unit|appendix|q\s*&\s*a|faq)\b/i.test(raw)) return false;
      if ((raw.match(/\b[A-Za-z][a-z]{2,}\b/g) || []).length >= 2 && !/[\[\]^$\\{}|`~#@]/.test(raw)) return false;
      return true;
    }
    const letters = (s.match(/[가-힣A-Za-z一-鿿]/g) || []).length;
    return letters < 2;   // 「커」, 「Ⅲ」처럼 글자 한두 개뿐인 조각
  }
  const SENT_END = /(습니다|합니다|입니다|됩니다|하였으며|하며|이며|되며|한다|된다|있다|없다|하였다)\s*[.。…]?\s*$/;
  function isSentence(t) {
    const s = String(t || '').trim();
    if (/[?？]\s*$/.test(s)) return false;   // 질문(Q&A)은 제목으로 둔다
    return SENT_END.test(s) && s.replace(/\s/g, '').length >= 12;
  }
  function cleanOutline(nodes) {
    return (nodes || []).filter(n => {
      if (n.k === 'bullet') return false;
      if (n.k === 'link') return !isGarbled(n.t) || !!n.l;
      if (n.k === 'ch') return true;
      return !isGarbled(n.t) && !isSentence(n.t);
    });
  }

  /** 제목 앞에 번호·기호가 이미 있는지(1. · 1) · (1) · 1.1 · 가. · (가) · Ⅰ · ① · 제1장 · ◆ 등). 연도·수량(2026 계획, 1인 1악기)은 아니다 */
  const NUMBERED_RE = /^\s*(?:\d{1,3}(?:[.．-]\d{1,3})*[.．)](?!\d)|\d{1,3}(?:[.．-]\d{1,3})+\s|\(\s*\d{1,3}\s*\)|[가나다라마바사아자차카타파하][.．)]|\(\s*[가나다라마바사아자차카타파하]\s*\)\s|[A-Za-z][.)]\s|[Ⅰ-Ⅻⅰ-ⅻ①-⒛㉠-㉻]|제\s*\d+\s*[장절항편관부]|[◆◇■□●○◦▪▶▸►•※☞★])/;
  function isNumbered(t) { return NUMBERED_RE.test(String(t == null ? '' : t)); }

  return { isNumbered, spacedRatio, SPACED_DOC, joinSpaced, tidyOutline, cleanOutline, isGarbled, isSentence, TITLE_MAX, clean, repairSpacing, norm, bigrams, esc, looseRegex, snippet, highlight, splitList, shardOf };
});
