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

  return { clean, repairSpacing, norm, bigrams, esc, looseRegex, snippet, highlight, splitList, shardOf };
});
