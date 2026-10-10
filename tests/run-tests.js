/*
 * 회귀 테스트 (Node.js 18 이상, 추가 설치 없음)
 *   node tests/run-tests.js
 * fixtures/kinder-2026.pdfjs.json: 「2026 유치원 교무학사 업무 도움자료」를 pdf.js로 읽은 글자 조각·링크(실제 추출값)
 * fixtures/v1-kinder-2026.json : 검색 데이터 생성기 v1 형식(목차 조각 경계 잘림 포함)
 */
'use strict';
const path = require('path');
const core = p => require(path.join(__dirname, '..', 'assets', 'js', 'core', p));
const SAS = Object.assign({}, core('normalize.js'), core('textlayout.js'), core('sectionizer.js'), core('schema.js'), core('indexer.js'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || '조건 불충족'); }

const fx = require('./fixtures/kinder-2026.pdfjs.json');
const pages = SAS.analyzePages(fx.pages);
const doc = SAS.createDocument({ title: '2026 유치원 교무학사 업무 도움자료', school_levels: ['유아'], category: '교무학사실무', year: 2026, filename: 'kinder.pdf', works_url: 'https://works.do/x' }, pages, []);
const sec = h => doc.sections.find(s => s.heading === h);

console.log('\n[1] PDF 추출·정제');
test('NULL 문자 없음', () => ok(!doc.blocks.some(b => /\u0000/.test(b.text))));
test('반복 머리말 제거', () => ok(!doc.blocks.some(b => /교무학사업무매뉴얼/.test(b.text))));
test('인쇄 쪽수 = PDF 쪽 - 4 (본문)', () => { eq(doc.blocks[5].printed_page, 2); eq(doc.blocks[36].printed_page, 33); });
test('단원 꼬리말 → 상위 분류', () => eq(doc.blocks[25].footer_label, 'Ⅱ. 유아교육지원'));
test('구두점 앞 공백 없음', () => ok(!/ ,/.test(doc.blocks[25].text)));
test('정렬 공백으로 단어마다 줄바꿈되지 않음', () => ok(doc.blocks[1].text.split('\n').length < 25));

console.log('\n[2] 목차 기반 업무 분할');
test('목차 인식, 업무 27개', () => { ok(doc.extraction.toc_found); eq(doc.sections.length, 27); });
test('현장체험학습 운영 = PDF 26쪽(인쇄 22쪽), 유아교육지원', () => { const s = sec('현장체험학습 운영'); eq(s.pdf_pages, [26]); eq(s.printed_pages, [22]); eq(s.parent_heading, '유아교육지원'); });
test('두 쪽 업무 묶음: 생활기록부 10~11, 안전·건강 23~24', () => { eq(sec('생활기록부, 학적, 출결관리').pdf_pages, [10, 11]); eq(sec('안전·건강교육').pdf_pages, [23, 24]); });
test('간지(20·32쪽)·판권면(37쪽) 제외', () => { eq(sec('보호자 교육·상담').pdf_pages, [19]); eq(sec('정보공시').pdf_pages, [31]); eq(sec('각종 위원회 조직·운영').pdf_pages, [36]); });
test('본문 제목 우선(목차 "유·초 이음" → 본문 "유·초 이음교육")', () => ok(sec('유·초 이음교육')));
test('업무 시작 문장', () => ok(SAS.sectionLead(doc, sec('현장체험학습 운영')).startsWith('교육과정과 연계한 안전하고')));

console.log('\n[3] 서식 링크');
const forms = SAS.formList(doc);
test('서식 255개, 모두 이름 있음', () => { eq(forms.length, 255); ok(!forms.some(f => /^https?:/.test(f.text) || f.text.length < 4), forms.filter(f => f.text.length < 4).map(f => f.form_no).join()); });
test('여러 줄 서식명 연결', () => { const t = forms.map(f => f.text); ok(t.includes('현장체험학습 어린이통학버스 관련 질의응답 자료')); ok(t.includes('사전답사 계획, 결과 보고서(예시)')); ok(t.includes('생태전환 환경교육계획(예시)')); });
test('현장체험학습 업무 서식 179~188번', () => eq(forms.filter(f => f.section_id === sec('현장체험학습 운영').id).map(f => f.form_no), [179, 180, 181, 182, 183, 184, 185, 186, 187, 188]));
test('서식 모음 쪽 찾기(번호 순서, 일부 누락·2쪽 서식)', () => {
  const d = JSON.parse(JSON.stringify(doc)); const blocks = []; const skip = new Set([5, 50]);
  SAS.formList(d).forEach(f => { if (skip.has(f.form_no)) return; blocks.push({ pdf_page: blocks.length + 1, text: f.text.replace('(예시)', '') + '\n작성일' }); if (f.form_no % 10 === 0) blocks.push({ pdf_page: blocks.length + 1, text: '뒷면' }); });
  const m = SAS.matchBundle(d, blocks);
  eq(m.missing, [5, 50]); eq(SAS.formList(d).find(f => f.form_no === 11).bundle_page, 11);
});

console.log('\n[4] v1 JSON 변환');
const v1 = SAS.migrateV1(require('./fixtures/v1-kinder-2026.json'), []);
test('v1 → 업무 27개(조각 경계에서 잘린 목차 복원)', () => eq(v1[0].sections.length, 27));
test('v1 페이지 검색어 「소풍」 → 현장체험학습 운영', () => eq(v1[0].sections.find(s => s.heading === '현장체험학습 운영').keywords, ['소풍', '현장학습']));
test('ID 형식', () => ok(/^doc-2026-[a-z0-9]{6}$/.test(v1[0].id)));

console.log('\n[5] 색인·일관성');
sec('현장체험학습 운영').keywords = ['소풍', '사전답사'];
const out = SAS.buildOutputs([doc], { generatedAt: '2026-10-02T00:00:00.000Z' });
const idx = JSON.parse(out.files.get('data/indexes/kindergarten.json'));
function body(q) {
  let set = null;
  for (const g of SAS.bigrams(SAS.norm(q))) {
    const sh = JSON.parse(out.files.get(`data/search/kindergarten/${String(SAS.shardOf(g, idx.shard_count)).padStart(3, '0')}.json`));
    const l = new Set(SAS.decodeList(sh.b[g])); set = set ? new Set([...set].filter(v => l.has(v))) : l;
  }
  return [...set].map(r => idx.sections.find(s => s.d === Math.floor(r / idx.sec_base) && s.s === r % idx.sec_base).h);
}
test('학교급 색인: 유아 1건, 초등 0건', () => { eq(idx.docs.length, 1); eq(JSON.parse(out.files.get('data/indexes/elementary.json')).docs.length, 0); });
test('업무 검색어가 색인에 들어감', () => eq(idx.sections.find(s => s.h === '현장체험학습 운영').k, ['소풍', '사전답사']));
test('본문 색인: 보결수업비 → 보결수업 관리', () => eq(body('보결수업비'), ['보결수업 관리']));
test('본문 색인: "미인정 결석"(띄어쓰기 무관)', () => eq(body('미인정 결석').sort(), ['생활기록부, 학적, 출결관리', '안전·건강교육'].sort()));
test('같은 입력 → 같은 출력(불필요한 재저장 없음)', () => { const o2 = SAS.buildOutputs([doc], { generatedAt: '2026-10-02T00:00:00.000Z' }); let same = true; out.files.forEach((v, k) => { if (o2.files.get(k) !== v) same = false; }); ok(same); });
test('일관성 검사 통과 + 삭제 대상 탐지', () => { const c = SAS.checkConsistency([doc], out, ['data/documents/doc-2025-old000.json']); ok(c.ok, c.errors.join()); eq(c.deletions, ['data/documents/doc-2025-old000.json']); });
test('학교급 없는 자료는 오류', () => { const d = JSON.parse(JSON.stringify(doc)); d.school_levels = []; ok(!SAS.checkConsistency([d]).ok); });

console.log('\n[6] 자료 교체');
test('업무 검색어·서식 쪽 정보 승계', () => {
  const old = JSON.parse(JSON.stringify(doc)); old.links.find(l => l.form_no === 183).bundle_page = 198;
  const nd = SAS.createDocument({ id: old.id, title: old.title, school_levels: old.school_levels, filename: 'kinder.pdf' }, SAS.analyzePages(fx.pages), []);
  SAS.carryKeywords(old, nd); SAS.carryForms(old, nd);
  eq(nd.id, old.id); eq(nd.sections.find(s => s.heading === '현장체험학습 운영').keywords, ['소풍', '사전답사']); eq(nd.links.find(l => l.form_no === 183).bundle_page, 198);
});

test('서식 직접 추가: 기존 번호 유지, 뒤에 이어 번호, 교체 시 같은 업무로 승계', () => {
  const d = JSON.parse(JSON.stringify(doc)); const sid = d.sections.find(s => s.heading === '현장체험학습 운영').id;
  const before = SAS.formList(d).map(f => f.form_no + f.text).join();
  const add = SAS.addManualForms(d, sid, '학부모 동의서\n버스 계약서', '');
  eq(add.map(l => l.form_no), [256, 257]); eq(SAS.formList(d).slice(0, 255).map(f => f.form_no + f.text).join(), before);
  add[1].bundle_page = 300;
  const out2 = SAS.buildOutputs([d], { generatedAt: 'x' }); const idx2 = JSON.parse(out2.files.get('data/indexes/kindergarten.json'));
  eq(idx2.sections.find(s => s.id === sid).n, 12);
  const nd = SAS.createDocument({ id: d.id, title: d.title, school_levels: d.school_levels, filename: 'kinder.pdf' }, SAS.analyzePages(fx.pages), []);
  SAS.carryForms(d, nd);
  const m = nd.links.filter(l => l.manual); eq(m.map(l => [l.text, l.form_no, l.bundle_page]), [['학부모 동의서', 256, null], ['버스 계약서', 257, 300]]);
  ok(SAS.removeManualForm(d, add[0].id)); eq(d.links.find(l => l.id === add[1].id).form_no, 256);
});
test('서식 직접 추가: 링크 없는 자료(HWPX 등)도 1번부터', () => {
  const d = SAS.createDocument({ title: 't', school_levels: ['유아'], filename: 'a.hwpx', format: 'hwpx' }, [{ text: '1. 가 업무\n본문' }, { text: '2. 나 업무\n본문' }], []);
  ok(d.sections.length >= 1); const a = SAS.addManualForms(d, d.sections[0].id, ['계획서', '보고서']); eq(a.map(l => l.form_no), [1, 2]);
});

test('목차 없는 HWPX: 길이로 나눈 구간은 색인에 u 표시, 업무명 고치면 해제', () => {
  const d = SAS.createDocument({ id: 'doc-2026-hwpx01', title: 't', school_levels: ['유아'], filename: 'a.hwpx', format: 'hwpx' }, [{ text: '아이의 성장을 잇는 첫 인연' }, { text: '업무의 내용 및 방법' }], []);
  let ix = JSON.parse(SAS.buildOutputs([d], { generatedAt: 'x' }).files.get('data/indexes/kindergarten.json'));
  ok(ix.sections.every(s => s.u === 1));
  d.sections[0].heading = '교육과정 운영'; d.sections[0].auto = false;
  ix = JSON.parse(SAS.buildOutputs([d], { generatedAt: 'x' }).files.get('data/indexes/kindergarten.json'));
  ok(!ix.sections[0].u);
  ok(!JSON.parse(out.files.get('data/indexes/kindergarten.json')).sections.some(s => s.u), '목차 있는 PDF는 표시 없음');
});

test('표 안 목차(HWPX, 칸마다 문단 분리·점선 없음) → 업무 분할', () => {
  const P = t => ({ text: t });
  const toc = [P('목 차'), P('Ⅰ'), P('교무·연구 업무'), P('1'), P('교육과정 편성·운영'), P('1'), P('2'), P('유아모집·입학설명회'), P('3'), P('3'), P('입학식'), P('5'),
    P('Ⅱ'), P('유아교육지원'), P('1'), P('현장체험학습 운영'), P('7')];
  const body = [P('1. 교육과정 편성·운영'), P('업무개요'), P('유치원 교육과정을 편성한다.'), P('2'), P('유아모집·입학설명회'), P('모집 안내'), P('입학식'), P('입학식 운영'), P('1. 현장체험학습 운영'), P('소풍 계획')];
  const d = SAS.createDocument({ title: 't', school_levels: ['유아'], filename: 'a.hwpx', format: 'hwpx' }, toc.concat(body), []);
  ok(d.extraction.toc_found, d.extraction.warnings.join());
  eq(d.sections.map(x => [x.heading, x.parent_heading, x.block_start]), [['교육과정 편성·운영', '교무·연구 업무', 17], ['유아모집·입학설명회', '교무·연구 업무', 20], ['입학식', '교무·연구 업무', 23], ['현장체험학습 운영', '유아교육지원', 25]]);
  ok(!d.sections.some(x => x.untitled));
});
test('표 안 목차(HWPX, 한 칸에 "1. 업무명")', () => {
  const P = t => ({ text: t });
  const d = SAS.createDocument({ title: 't', school_levels: ['유아'], filename: 'a.hwpx', format: 'hwpx' },
    [P('1. 가나 업무'), P('3'), P('2. 다라 업무'), P('5'), P('3. 마바 업무'), P('8'), P('1. 가나 업무'), P('본문 가'), P('2. 다라 업무'), P('본문 나'), P('3. 마바 업무'), P('본문 다')], []);
  eq(d.sections.map(x => [x.heading, x.block_start]), [['가나 업무', 6], ['다라 업무', 8], ['마바 업무', 10]]);
});
test('표 안 목차(PDF, 점선 없는 "1. 업무명 12" 줄)', () => {
  const pages = ['목차\n1. 교육과정 편성 3\n2. 유아 모집 4\n3. 입학식 5', '표지', '1. 교육과정 편성\n내용', '2. 유아 모집\n내용', '3. 입학식\n내용'];
  const blocks = pages.map((t, i) => ({ pdf_page: i + 1, printed_page: i + 1, text: t }));
  const d = SAS.createDocument({ title: 't', school_levels: ['유아'], filename: 'a.pdf' }, blocks, []);
  ok(d.extraction.toc_found); eq(d.sections.map(x => [x.heading, x.pdf_pages]), [['교육과정 편성', [3]], ['유아 모집', [4]], ['입학식', [5]]]);
});

console.log('\n[7] 텍스트 도구');
test('정규화: 공백·가운뎃점·대소문자 무시', () => eq(SAS.norm('유·초 이음  PPT'), SAS.norm('유초이음ppt')));
test('강조: 띄어쓰기가 달라도 찾음', () => ok(SAS.highlight('현장 체험학습 운영', '현장체험학습').includes('<mark>현장 체험학습</mark>')));
test('강조 시 HTML 이스케이프', () => ok(!SAS.highlight('<script>소풍</script>', '소풍').includes('<script>')));

console.log('\n[8] 사용자 검색 엔진');
const SS = require(path.join(__dirname, '..', 'assets', 'js', 'site', 'search.js'));
const fetchOut = async p => { const t = out.files.get(p); if (t == null) throw new Error('없음 ' + p); return JSON.parse(t); };
const sIdx = SS.prepareIndex(JSON.parse(out.files.get('data/indexes/kindergarten.json')));
const detail = JSON.parse(out.files.get(`data/documents/${doc.id}.json`));
async function fullSearch(q, opts) {
  const m = SS.metaSearch(sIdx, q, opts);
  const cands = await SS.bodyCandidates(sIdx, 'kindergarten', m.q, fetchOut, opts, m.seen) || [];
  const body = cands.map(s => ({ s, v: SS.verifySection(detail, s.id, m.q) })).filter(x => x.v);
  return { m, body };
}
const asyncTests = [];
function atest(name, fn) { asyncTests.push([name, fn]); }
atest('「현장체험학습 운영」 → 업무명 정확 일치가 1순위', async () => { const r = await fullSearch('현장체험학습 운영'); eq(r.m.sections[0].tier, 1); eq(r.m.sections[0].sec.h, '현장체험학습 운영'); });
atest('「현장체험학습」 → 업무명 포함(2순위), 본문 결과에 중복 없음', async () => { const r = await fullSearch('현장체험학습'); eq(r.m.sections[0].tier, 2); ok(!r.body.some(b => b.s.h === '현장체험학습 운영')); });
atest('「소풍」 → 업무 검색어(3순위)로 현장체험학습 운영', async () => { const r = await fullSearch('소풍'); eq(r.m.sections.map(x => [x.tier, x.sec.h]), [[3, '현장체험학습 운영']]); });
atest('「교무학사」 → 자료 검색어(4순위) 자료 결과', async () => { const r = await fullSearch('교무학사'); eq(r.m.docs.length, 1); eq(r.m.docs[0].tier, 4); });
atest('「보결수업비」 → 본문(5순위) 보결수업 관리 + 쪽·미리보기', async () => { const r = await fullSearch('보결수업비'); eq(r.body.map(b => b.s.h), ['보결수업 관리']); ok(r.body[0].v.page > 0); ok(r.body[0].v.snippet.includes('보결')); });
atest('여러 단어: 「미인정 결석」은 띄어 써도 본문에서 찾음', async () => { const r = await fullSearch('미인정 결석'); ok(r.body.length >= 1); });
atest('분류 필터: 다른 분류면 결과 없음', async () => { const r = await fullSearch('소풍', { category: '없는분류' }); eq(r.m.sections.length + r.body.length, 0); });
atest('목차 없이 나눈 구간 이름은 업무명 검색에서 제외', async () => { const ix = SS.prepareIndex(JSON.parse(JSON.stringify(sIdx))); ix._ready = false; ix.sections.forEach(s => { if (s.h === '보결수업 관리') s.u = 1; }); SS.prepareIndex(ix); eq(SS.metaSearch(ix, '보결수업 관리').sections.length, 0); });
atest('1글자 검색은 본문 검색 생략', async () => { const m = SS.metaSearch(sIdx, '원'); eq(await SS.bodyCandidates(sIdx, 'kindergarten', m.q, fetchOut, {}, m.seen), null); });
atest('업무 상세: 현장체험학습 서식 179~188번', async () => { const d = SS.sectionDetail(detail, sec('현장체험학습 운영').id); eq(d.forms.map(f => f.no), [179, 180, 181, 182, 183, 184, 185, 186, 187, 188]); eq(d.blocks[0].pdf_page, 26); });
atest('쪽 표시·안전한 링크', async () => { eq(SS.pageLabel([23, 24], [19, 20]), 'PDF 23~24쪽(인쇄 19~20쪽)'); eq(SS.safeUrl('javascript:alert(1)'), ''); eq(SS.safeUrl('https://works.do/a'), 'https://works.do/a'); });
atest('여러 단어 강조 + 이스케이프', async () => { const h = SS.highlightTerms('<b>소풍</b> 사전 답사', ['소풍', '사전답사']); ok(h.includes('<mark>소풍</mark>') && h.includes('<mark>사전 답사</mark>') && !h.includes('<b>')); });

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  }
  console.log(`\n결과: 통과 ${pass}, 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
