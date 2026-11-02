/*
 * 회귀 테스트 (Node.js 18 이상, 추가 설치 없음)
 *   node tests/run-tests.js
 * fixtures/kinder-2026.pdfjs.json: 「2026 유치원 교무학사 업무 도움자료」를 pdf.js로 읽은 글자 조각·링크(실제 추출값)
 * fixtures/v1-kinder-2026.json : 검색 데이터 생성기 v1 형식(목차 조각 경계 잘림 포함)
 */
'use strict';
const path = require('path');
const core = p => require(path.join(__dirname, '..', 'assets', 'js', 'core', p));
const SAS = Object.assign({}, core('normalize.js'), core('textlayout.js'), core('sectionizer.js'), core('outline.js'), core('schema.js'), core('indexer.js'), core('batch.js'));

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

console.log('\n[3-2] 번호 목차 트리(충교위키식)');
const O = doc.outline.nodes, node = c => O.find(n => n.c === c);
const lnk = n => doc.links.find(l => l.id === n.l);
test('단원 3개 · 업무 27개 모두 세부 목차', () => { eq(O.filter(n => n.k === 'ch').map(n => n.t), ['교무·연구 업무', '유아교육지원', '인사업무']); eq(doc.outline.stats.detailed, 27); });
test('1.6 = 유치원 평가·유치원 규칙, 부분 3개', () => { eq(node('1.6').t, '유치원 평가·유치원 규칙'); eq(['1.6.1', '1.6.2', '1.6.3'].map(c => node(c).t), ['업무개요', '업무의 내용 및 방법', '관련 자료 및 서식']); });
test('◆ 묶음 → 번호 항목 → ▸ 항목 (5단계)', () => { eq(node('1.6.2.1').t, '유치원 평가'); eq(node('1.6.2.1.1').t, '유치원 평가 주요 사항'); eq(node('1.6.2.1.1.2').t, '평가 주기: 1년(매년 실시)'); eq(node('1.6.2.2').t, '유치원 규칙'); });
test('두 단 편집: 오른쪽 단 항목은 왼쪽 단 다음에 이어짐', () => { eq(node('2.5.2.3.5').t, '참여 유아 파악 및 보호자 동의서 받기'); eq(node('2.5.2.6').t, '현장체험학습 완료 후 업무 처리'); });
test('줄바꿈된 항목 이어 붙이기 · "-" 줄은 딸린 줄', () => { eq(node('1.1.2.1').t, '유치원 교육과정위원회 조직 및 교육과정 편성 계획 수립'); ok(node('1.6.2.1.1.3').d.length === 3); });
test('업무개요 근거 법령 링크는 업무개요 아래', () => { eq(lnk(node('1.6.1.1')).type, '법령'); eq(node('1.6.1.1').t, '유아교육법 제19조(평가)'); });
test('관련 자료: 줄 단위로 왼쪽부터, 서식·참고 구분', () => { eq(node('1.6.3.1').t, '유치원 평가 운영 계획(예시)'); eq(lnk(node('1.6.3.1')).type, '서식'); eq(lnk(node('1.6.3.3')).type, '참고'); eq(node('2.5.3.4').t, '현장체험학습 계획서(예시)'); });
test('모든 링크에 쪽 위치(누를 자리)', () => ok(doc.links.every(l => Array.isArray(l.box) && l.box[1] < l.box[3])));
test('잘린 교육청 주소 찾기·보충 제안', () => {
  ok(SAS.isSuspectUrl('http://www.cne.go.kr/boardCnts/fileDown.do?fileSeq=abc')); ok(!SAS.isSuspectUrl('http://www.cne.go.kr/boardCnts/fileDown.do?m=0104&s=manual&fileSeq=abc'));
  eq(SAS.suggestUrl('http://www.cne.go.kr/boardCnts/fileDown.do?fileSeq=abc', 'http://www.cne.go.kr/boardCnts/fileDown.do?m=0104&s=manual&fileSeq=x'), 'http://www.cne.go.kr/boardCnts/fileDown.do?m=0104&s=manual&fileSeq=abc');
  ok(doc.links.filter(l => SAS.isSuspectUrl(l.url)).length >= 40);
});
test('저장 파일에는 줄 위치가 남지 않음(쪽 크기만)', () => { ok(!doc.blocks.some(b => b.lines)); eq([doc.blocks[11].w, doc.blocks[11].h], [595, 841]); });

test('링크 주소·이름 고치기 → 되돌리기, 교체 시 승계', () => {
  const d = JSON.parse(JSON.stringify(doc)); const l = d.links.find(x => SAS.isSuspectUrl(x.url)); const orig = l.url;
  SAS.setLinkUrl(d, l.id, 'https://example.org/a.hwp'); eq(l.url_orig, orig); eq(l.kind, 'site');
  SAS.setLinkInfo(d, l.id, { text: '고친 이름', type: '서식' });
  const nd = JSON.parse(JSON.stringify(doc)); eq(SAS.carryLinkEdits(d, nd), 1);
  const m = nd.links.find(x => x.url_orig === orig); eq([m.url, m.text, m.type], ['https://example.org/a.hwp', '고친 이름', '서식']);
  SAS.setLinkUrl(d, l.id, ''); eq(l.url, orig); ok(!l.url_orig);
});
test('업무명 고치면 목차 제목도 바뀜', () => { const d = JSON.parse(JSON.stringify(doc)); d.sections[5].heading = '유치원 평가와 규칙'; SAS.syncOutline(d); eq(d.outline.nodes.find(n => n.c === '1.6').t, '유치원 평가와 규칙'); });
test('원본 PDF 경로 검사 · 색인에 PDF 경로', () => {
  const d = JSON.parse(JSON.stringify(doc)); d.pdf = { path: 'pdf/' + d.id + '.pdf', bytes: 1 };
  ok(SAS.validateDocument(d).errors.length === 0); d.pdf.path = '../x.pdf'; ok(SAS.validateDocument(d).errors.some(e => /PDF/.test(e)));
  d.pdf.path = 'pdf/' + d.id + '.pdf'; const o = SAS.buildOutputs([d], { generatedAt: 'x' }); eq(JSON.parse(o.files.get('data/indexes/kindergarten.json')).docs[0].p, d.pdf.path);
});

console.log('\n[4] v1 JSON 변환');
let v1F = null; try { v1F = require('./fixtures/v1-kinder-2026.json'); } catch (e) { console.log('  (v1 시험 자료 없음 — 건너뜀)'); }
const v1 = v1F ? SAS.migrateV1(v1F, []) : null;
const vtest = (n, f) => v1 ? test(n, f) : null;
vtest('v1 → 업무 27개(조각 경계에서 잘린 목차 복원)', () => eq(v1[0].sections.length, 27));
vtest('v1 페이지 검색어 「소풍」 → 현장체험학습 운영', () => eq(v1[0].sections.find(s => s.heading === '현장체험학습 운영').keywords, ['소풍', '현장학습']));
vtest('ID 형식', () => ok(/^doc-2026-[a-z0-9]{6}$/.test(v1[0].id)));

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

test('실제 HWPX(탭 점선 목차·도형 단원 번호): 업무 27개, 서식 255개, 상위 분류', () => {
  const hb = require('./fixtures/kinder-2026.hwpx-blocks.json').map(b => Object.assign({ pdf_page: null, printed_page: null }, b));
  const d = SAS.createDocument({ title: 'h', school_levels: ['유아'], filename: 'k.hwpx' }, hb, []);
  ok(d.extraction.toc_found); eq(d.sections.length, 27); eq(SAS.formList(d).length, 255);
  const s = d.sections.find(x => x.heading === '현장체험학습 운영'); eq(s.parent_heading, '유아교육지원');
  eq(SAS.formList(d).filter(f => f.section_id === s.id).length, 10);
  eq(d.sections[d.sections.length - 1].parent_heading, '인사업무');
});

test('가나다·①②③ 번호 목차(점선·표 안·HWPX 칸 분리)', () => {
  const pdf = ['목 차\n가. 교육과정 운영 ······ 3\n나. 유아 모집 ······ 4\n다. 입학식 ······ 5', '표지', '가. 교육과정 운영\n내용', '나. 유아 모집\n내용', '다. 입학식\n내용'];
  const d1 = SAS.createDocument({ title: 't', school_levels: ['유아'], filename: 'a.pdf' }, pdf.map((t, i) => ({ pdf_page: i + 1, printed_page: i + 1, text: t })), []);
  eq(d1.sections.map(x => [x.heading, x.pdf_pages[0]]), [['교육과정 운영', 3], ['유아 모집', 4], ['입학식', 5]]);
  const P = t => ({ text: t });
  const d2 = SAS.createDocument({ title: 't', school_levels: ['유아'], filename: 'a.hwpx' },
    [P('목 차'), P('①'), P('교육과정 운영'), P('3'), P('②'), P('유아 모집'), P('4'), P('③'), P('입학식'), P('5'), P('① 교육과정 운영'), P('본문'), P('② 유아 모집'), P('본문'), P('③ 입학식'), P('본문')], []);
  eq(d2.sections.map(x => [x.heading, x.block_start]), [['교육과정 운영', 10], ['유아 모집', 12], ['입학식', 14]]);
  const d3 = SAS.createDocument({ title: 't', school_levels: ['유아'], filename: 'a.hwpx' },
    [P('가) 교육과정 운영 3'), P('나) 유아 모집 4'), P('다) 입학식 5'), P('목 차'), P('가) 교육과정 운영'), P('본문'), P('나) 유아 모집'), P('본문'), P('다) 입학식'), P('본문')], []);
  eq(d3.sections.map(x => x.heading), ['교육과정 운영', '유아 모집', '입학식']);
});

console.log('\n[7] 텍스트 도구');
test('정규화: 공백·가운뎃점·대소문자 무시', () => eq(SAS.norm('유·초 이음  PPT'), SAS.norm('유초이음ppt')));
test('강조: 띄어쓰기가 달라도 찾음', () => ok(SAS.highlight('현장 체험학습 운영', '현장체험학습').includes('<mark>현장 체험학습</mark>')));
test('강조 시 HTML 이스케이프', () => ok(!SAS.highlight('<script>소풍</script>', '소풍').includes('<script>')));

console.log('\n[7-1] 공통 학교급 · 부서');
test('학교급 정리: 공통은 다른 학교급과 함께 쓰지 않음', () => { eq(SAS.cleanLevels(['초등', '공통', '유아']), ['공통']); eq(SAS.cleanLevels(['중등', '유아', '없음', '유아']), ['유아', '중등']); });
test('공통 + 다른 학교급은 검사 오류', () => { const d = JSON.parse(JSON.stringify(doc)); d.school_levels = ['공통', '초등']; ok(SAS.validateDocument(d).errors.some(e => e.includes('공통'))); });
test('학교업무자료실 자료의 부서 = 교무학사 공통자료', () => { eq(SAS.defaultDepartment({ origin: { site: '학교업무자료실' } }), '교무학사 공통자료'); eq(SAS.defaultDepartment({ origin: { site: '기본계획나눔방' } }), ''); });
test('부서 묶음: 1~2건 부서·빈 부서 → 기타 부서', () => { const c = { 민주시민교육과: 37, 소통담당관: 1, 재무과: 2, 감사관: 3 }; eq(['민주시민교육과', '소통담당관', '재무과', '감사관', ''].map(d => SAS.deptGroup(d, c)), ['민주시민교육과', '기타 부서', '기타 부서', '감사관', '기타 부서']); eq(SAS.deptGroup('교무학사 공통자료', {}), '교무학사 공통자료'); });
test('부서 목록은 가나다순', () => eq(SAS.DEPARTMENTS, SAS.DEPARTMENTS.slice().sort((a, b) => a.localeCompare(b, 'ko'))));
test('공통 색인·부서별 개수 생성, 예전 자료는 원 출처로 부서 채움', () => {
  const a = JSON.parse(JSON.stringify(doc)); a.id = 'doc-2026-aaaaaa'; a.origin = { site: '학교업무자료실' }; delete a.department;
  const b = JSON.parse(JSON.stringify(doc)); b.id = 'doc-2026-bbbbbb'; b.school_levels = ['공통']; b.department = '정책기획과';
  const out = SAS.buildOutputs([a, b]);
  const com = JSON.parse(out.files.get('data/indexes/common.json'));
  eq(com.docs.map(d => [d.id, d.dp]), [['doc-2026-bbbbbb', '정책기획과']]);
  eq(JSON.parse(out.files.get('data/indexes/kindergarten.json')).docs[0].dp, '교무학사 공통자료');
  eq(out.manifest.departments, { '교무학사 공통자료': 1, 정책기획과: 1 });
  eq(out.manifest.levels.common.documents, 1);
  ok(SAS.checkConsistency([a, b], out).ok);
});

test('일괄 등록: 공통·부서 폴더 이름으로 짐작', () => {
  const g = SAS.guessMeta('2026 자료/공통/민주시민교육과/2026 충남 인성교육시행계획.pdf');
  eq(g.levels, ['공통']); eq(g.department, '민주시민교육과');
  eq(SAS.guessMeta('공통/초등/2026 교무학사 도움자료.pdf').levels, ['초등'], '안쪽 폴더 우선');
  eq(SAS.guessMeta('공통교육과정/2026 계획.pdf').levels, [], '"공통교육과정"은 공통이 아님');
  eq(SAS.guessMeta('자료_분류/공통/초등특수교육과/2026 한자교육 기본계획.hwp').levels, ['공통'], '부서 폴더 이름의 학교급 낱말은 무시');
  eq(SAS.guessMeta('자료_분류/공통/유아교육복지과/2026 교육복지 계획.pdf').department, '유아교육복지과');
});

console.log('\n[7-2] 원본 파일 창고(연도별 저장소)');
test('창고 주소: 창고면 ../창고/경로, 예전 본 저장소 PDF는 경로 그대로', () => { eq(SAS.fileUrl({ repo: 'cne_files_2026_1', path: 'files/doc-a.hwp' }), '../cne_files_2026_1/files/doc-a.hwp'); eq(SAS.fileUrl({ path: 'pdf/doc-a.pdf' }), 'pdf/doc-a.pdf'); eq(SAS.fileUrl(null), ''); });
test('올리는 해 창고에 배정 · 900MB 넘으면 다음 번호 창고 · PDF는 쪽 보기 경로도 같이', () => {
  const MB = 1048576, mk = (id, y, mb, fmt) => ({ id, year: y, original: SAS.makeOriginal(id, `${id}.${fmt}`, mb * MB, fmt) });
  const docs = [mk('doc-1', 2026, 500, 'pdf'), mk('doc-2', 2026, 300, 'hwp'), mk('doc-3', 2026, 200, 'pdf'), mk('doc-4', 2027, 10, 'xlsx')];
  const r = SAS.planStorage(docs, docs.map(d => d.id), { year: 2026 });
  eq(docs.map(d => d.original.repo), ['cne_files_2026_1', 'cne_files_2026_1', 'cne_files_2026_2', 'cne_files_2026_1'], '자료 연도와 관계없이 올리는 해 창고, 빈자리 먼저');
  eq(r.repos, ['cne_files_2026_1', 'cne_files_2026_2']);
  eq(docs[0].pdf, { repo: 'cne_files_2026_1', path: 'files/doc-1.pdf', bytes: 500 * MB }); ok(!docs[1].pdf);
});
test('다음 해에 새 판으로 바꾸면 그 해 창고로 · 같은 연도면 같은 자리에 덮어쓰기', () => {
  const d = { id: 'doc-9', year: 2027, original: Object.assign(SAS.makeOriginal('doc-9', 'a.pdf', 1000, 'pdf'), { repo: 'cne_files_2026_1' }) };
  SAS.planStorage([d], ['doc-9'], { year: 2027 }); eq(d.original.repo, 'cne_files_2027_1');
  const e = { id: 'doc-8', year: 2026, original: Object.assign(SAS.makeOriginal('doc-8', 'b.hwp', 1000, 'hwp'), { repo: 'cne_files_2026_3' }) };
  SAS.planStorage([e], ['doc-8'], { year: 2026 }); eq(e.original.repo, 'cne_files_2026_3');
});
test('예전 방식 PDF(원본 정보 없음)도 창고로 옮김 · 사이트 색인에 내려받기 주소', () => {
  const d = JSON.parse(JSON.stringify(doc)); d.id = 'doc-2026-legacy'; d.pdf = { path: 'pdf/doc-2026-legacy.pdf', bytes: 100 }; d.filename = '2026+유치원.pdf';
  SAS.planStorage([d], [d.id], { year: 2026 });
  eq(d.pdf.path, 'files/doc-2026-legacy.pdf'); eq(d.original.name, '2026 유치원.pdf');
  const out = SAS.buildOutputs([d]); const ix = JSON.parse(out.files.get('data/indexes/kindergarten.json')).docs[0];
  eq([ix.p, ix.dl, ix.fn], ['../cne_files_2026_1/files/doc-2026-legacy.pdf', '../cne_files_2026_1/files/doc-2026-legacy.pdf', '2026 유치원.pdf']);
  ok(SAS.checkConsistency([d], out).ok);
});
test('새 파일에 원본이 있으면 교체할 때 예전 PDF를 이어 쓰지 않음', () => { const o = { links: [], pdf: { path: 'pdf/x.pdf' } }, n = { links: [], original: { path: 'files/x.hwp' } }; SAS.carryLinkEdits(o, n); ok(!n.pdf); });
test('PDF → HWPX로 교체하면 예전 PDF를 이어 쓰지 않음(쪽 보기 어긋남 방지)', () => { const o = { links: [], pdf: { path: 'pdf/x.pdf' } }, n = { links: [], format: 'hwpx' }; SAS.carryLinkEdits(o, n); ok(!n.pdf); const n2 = { links: [], format: 'pdf' }; SAS.carryLinkEdits(o, n2); ok(n2.pdf); });
test('사람이 만든 목차: 엑셀 줄 → 목차(단계로 번호 자동, 쪽→블록, 서식 연결) → 되돌리기', () => {
  const d = JSON.parse(JSON.stringify(doc));
  const rows0 = SAS.outlineToRows(d);
  ok(rows0.length > 50 && rows0[0].단계 === 1 && rows0.every(r => r.단계 >= 1 && r.단계 <= 6), '내려받기 줄');
  ok(!rows0.some(r => r.단계 > 1 && false));
  // 앞 줄보다 두 단계 이상 깊어지지 않음
  ok(rows0.every((r, i) => i === 0 || r.단계 <= rows0[i - 1].단계 + 1), '단계 건너뜀 없음');
  const form = d.links.find(l => l.url && l.type === '서식');
  const rows = [['단계', '제목', '쪽', '종류', '주소'],
    [1, 'Ⅰ. 교무 업무', 5, '', ''], [2, '학교교육계획', 6, '', ''], [3, '수립 절차', 7, '', ''], [3, form.text, 7, '서식', form.url],
    [3, '새 서식(직접)', 8, '서식', 'https://example.org/a.hwp'], ['#메모', '무시', '', '', ''], [2, '현장체험학습', '', '', ''], [1, 'Ⅱ. 학사', 20, '', '']];
  const r = SAS.rowsToOutline(d, rows);
  eq(r.errors, []); eq(r.nodes.map(n => n.c), ['1', '1.1', '1.1.1', '1.1.2', '1.1.3', '1.2', '2']);
  eq(r.nodes.map(n => n.k), ['ch', 'task', 'item', 'link', 'link', 'task', 'ch']);
  eq(r.nodes[0].b, 4, 'PDF 5쪽 → 블록 4'); eq(r.nodes[5].b, r.nodes[4].b, '쪽 비면 앞 줄과 같은 쪽');
  eq(r.nodes[3].l, form.id, '이미 있는 서식은 그 링크에 연결'); eq(r.newLinks.length, 1);
  SAS.applyManualOutline(d, r, { file: 't.xlsx' });
  ok(d.outline.manual && d.outline_auto && d.outline_auto.nodes.length > 50);
  const toc = JSON.parse(SAS.buildOutputs([d], { generatedAt: 'x' }).files.get('data/toc/kindergarten.json')).docs[0][1];
  eq(toc.map(x => x[2]).slice(0, 3), ['Ⅰ. 교무 업무', '학교교육계획', '수립 절차']); ok(toc.some(x => x[2] === '새 서식(직접)' && x[5] === 'https://example.org/a.hwp'));
  // 파일 교체 때 이어받기
  const nd = JSON.parse(JSON.stringify(doc)); ok(SAS.carryManualOutline(d, nd)); ok(nd.outline.manual && nd.outline.stale && nd.links.some(l => /^toc-/.test(l.id)));
  // 되돌리기
  ok(SAS.revertManualOutline(d)); ok(!d.outline.manual && !d.outline_auto && !d.links.some(l => /^toc-/.test(l.id)));
});
test('사람이 만든 목차: 잘못된 줄은 오류로(단계 건너뜀·쪽 없음·단계 글자)', () => {
  const r = SAS.rowsToOutline(doc, [['단계', '제목', '쪽'], [1, '가', 1], [3, '나', 2], [2, '다', 99999], ['x', '라', 1], [2, '', 1]]);
  eq(r.errors.map(e => e.row), [3, 4, 5, 6]);
  eq(SAS.rowsToOutline(doc, [['아무', '거나']]).errors.length, 1, '머리글 없음');
});
test('띄어쓰기 붙이기: 균등분할 제목은 언제나, OCR 자료는 조사까지', () => {
  eq(SAS.joinSpaced('공 적 조 서(기관)'), '공적조서(기관)');
  eq(SAS.joinSpaced('공 무 원 인 사 기 록 요 약 서'), '공무원인사기록요약서');
  eq(SAS.joinSpaced('그 외 각 호의 경우'), '그 외 각 호의 경우', '보통 글은 그대로');
  eq(SAS.joinSpaced('학교 및 교육청 업무'), '학교 및 교육청 업무');
  eq(SAS.joinSpaced('제 5 조 (기 본 사 항)'), '제5조 (기본사항)');
  eq(SAS.joinSpaced('유 치 원 생 활 기 록부 의 법적 근거', true), '유치원생활기록부의 법적 근거');
  eq(SAS.joinSpaced('개 념 및 기 본 방침', true), '개념 및 기본방침');
  eq(SAS.joinSpaced('기 재 기준 한 눈 에 보기', true), '기재기준 한눈에 보기');
});
test('목차 정리: 문장처럼 긴 제목은 앞부분만, 나머지는 설명으로 · 여러 번 해도 같음 · 서식 이름은 그대로', () => {
  const long = '교육과정설명회 계획 수립: 학교교육과정 설명회는 학기별 최소 1회 실시하며 직장인 보호자 참여를 위한 일정을 반영한다.';
  const link = '2026 외국어교육(외국어교육 추진 실적, 국제교육 활성화, 올해의 영어교사상) 유공 교육감 표창 계획 서식';
  const a = SAS.tidyOutline([{ c: '1.1', k: 'item', t: long }, { c: '1.2', k: 'link', t: link }, { c: '1', k: 'ch', t: long }]);
  eq(a[0].t, '교육과정설명회 계획 수립'); ok(a[0].cut && /^학교교육과정 설명회는/.test(a[0].d[0]));
  eq(a[1].t, link); eq(a[2].t, long, '단원 이름은 줄이지 않음');
  eq(SAS.tidyOutline(a), a, '다시 해도 같음');
  ok(SAS.tidyOutline([{ c: '1', k: 'item', t: 'x'.repeat(100) }])[0].t.length <= SAS.TITLE_MAX);
});
test('일괄 등록: 이름이 같으면 파일 이름에서 짐작한 학교급이 달라도 교체로 짝짓기', () => {
  const docs = [{ id: 'doc-2025-u879gt', title: '2025 통합유치원 운영 도움자료', filename: '2025+통합유치원+운영+도움자료.pdf', school_levels: ['특수'] },
    { id: 'doc-x', title: '학교교육과정 설명회 초등', filename: 'a.pdf', school_levels: ['초등'] }];
  const items = [{ key: 1, filename: '2025 통합유치원 운영 도움자료.pdf', title: '2025 통합유치원 운영 도움자료', format: 'pdf', levels: ['유아'], levelsFrom: 'file' },
    { key: 2, filename: '학교교육과정 설명회 특수.pdf', title: '학교교육과정 설명회 특수', format: 'pdf', levels: ['특수'], levelsFrom: 'file' }];
  SAS.planBatch(items, docs);
  eq([items[0].action, items[0].targetId], ['replace', 'doc-2025-u879gt']);
  eq(items[1].action, 'add', '이름이 비슷할 뿐이고 학교급이 다르면 새 자료');
});
test('편집용 원본: HWP → PDF 교체 시 예전 HWP를 남김, 색인·창고 사용량에 반영', () => {
  const old = { id: 'doc-2026-aaaaaa', year: 2026, format: 'hwp', original: { repo: 'cne_files_2026_1', path: 'files/doc-2026-aaaaaa.hwp', name: '계획.hwp', bytes: 1000, format: 'hwp' } };
  const nd = { id: old.id, year: 2026, format: 'pdf', original: { repo: null, path: 'files/doc-2026-aaaaaa.pdf', name: '계획.pdf', bytes: 2000, format: 'pdf' } };
  const e = SAS.keepEditOriginal(old, nd);
  ok(e && nd.edit.path === 'files/doc-2026-aaaaaa.hwp' && nd.edit.repo === 'cne_files_2026_1', '편집용 원본 남김');
  eq(SAS.storageUsage([nd]).get('cne_files_2026_1'), 1000);
  // 같은 해에 PDF를 다시 바꾸면 이어받고, 다음 해 판이면 버린다
  const n2 = { id: old.id, year: 2026, format: 'pdf', original: { format: 'pdf' } }; SAS.keepEditOriginal(nd, n2); ok(n2.edit, '같은 해 이어받기');
  const n3 = { id: old.id, year: 2027, format: 'pdf', original: { format: 'pdf' } }; SAS.keepEditOriginal(nd, n3); ok(!n3.edit, '다음 해 판은 버림');
  // 새 파일이 HWP면 남기지 않는다(새 파일이 곧 편집용 원본)
  const n4 = { id: old.id, year: 2026, format: 'hwpx', original: { format: 'hwpx' } }; SAS.keepEditOriginal(nd, n4); ok(!n4.edit, 'HWPX로 교체');
  // 예전이 PDF였으면 남길 것이 없다
  const n5 = { id: old.id, year: 2026, format: 'pdf', original: { format: 'pdf' } }; ok(!SAS.keepEditOriginal({ original: { repo: 'r', path: 'files/x.pdf', format: 'pdf' } }, n5));
  // 색인과 자료 목록에 내려받기 주소
  const d = JSON.parse(JSON.stringify(doc)); d.edit = { repo: 'cne_files_2026_1', path: 'files/x-1.hwp', name: '원본.hwp', bytes: 10, format: 'hwp' };
  const o = SAS.buildOutputs([d], { generatedAt: 'x' });
  const ix = JSON.parse(o.files.get('data/indexes/kindergarten.json')).docs[0];
  eq([ix.ed, ix.en], ['../cne_files_2026_1/files/x-1.hwp', '원본.hwp']);
  ok(JSON.parse(o.files.get('data/documents.json')).documents[0].edit.url === '../cne_files_2026_1/files/x-1.hwp');
  eq(SAS.validateDocument(d).errors, []);
});
test('이름이 같은 자료 찾기: 띄어쓰기만 달라도 같은 묶음, 연도·학교급이 다르면 제외', () => {
  const D = (id, title, lv) => ({ id, title, school_levels: lv, created_at: id });
  const g = SAS.findDuplicates([D('a', '2026 원비 안정화 계획', ['유아']), D('b', '2026  원비 안정화  계획', ['유아']), D('c', '2025 원비 안정화 계획', ['유아']),
    D('d', '설명회 자료', ['중등']), D('e', '설명회 자료', ['초등']), D('f', '혼자인 자료', ['유아'])]);
  eq(g.map(x => x.map(d => d.id)), [['a', 'b']]);
});
test('목차 검색 색인(data/toc): 학교급별 생성 · 세부 줄 제외 · 서식 이름과 주소', () => {
  const o = SAS.buildOutputs([doc], { generatedAt: 'x' });
  const t = JSON.parse(o.files.get('data/toc/kindergarten.json'));
  eq(t.docs.length, 1); eq(t.docs[0][0], doc.id);
  const rows = t.docs[0][1];
  ok(rows.length > 0 && rows.every(r => 'ctpgil'.includes(r[1])), '종류 한 글자');
  ok(rows.length < doc.outline.nodes.length, '세부 줄 제외');
  const link = rows.find(r => r[1] === 'l'); ok(link && link[4] && /^https?:/.test(link[5]), '서식 줄에 종류·주소');
  ok(o.files.has('data/toc/common.json'));
});

test('웹 주소가 아닌 PDF 링크는 오류가 아니라 확인 권장', () => {
  const d = JSON.parse(JSON.stringify(doc)); d.links = d.links.concat([{ id: 'x1', text: 'vms@ssmkorea.or.kr', url: 'mailto:vms@ssmkorea.or.kr' }, { id: 'x2', text: '추진 절차.pdf', url: '추진 절차.pdf' }]);
  const v = SAS.validateDocument(d); ok(!v.errors.some(e => /링크/.test(e)), v.errors.join()); ok(v.warnings.some(w => w.includes('웹 주소가 아닌 링크 2개')));
});

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

console.log('\n[폴더 일괄 등록]');
test('학교급: 안쪽 폴더 우선, 없으면 파일 이름', () => {
  eq(SAS.guessLevels('2027 자료/중등/유치원/a.pdf').levels, ['유아']);
  eq(SAS.guessLevels('자료/2027 초등 학적 매뉴얼.pdf').levels, ['초등']);
  eq(SAS.guessLevels('중학교 자료/학적.pdf').levels, ['중등']);
  eq(SAS.guessLevels('유·초 이음교육 운영 안내.pdf').levels, []);
});
test('연도·분류·원 출처 짐작', () => {
  const g = SAS.guessMeta('2027 자료/중등/학교업무자료실/교무학사실무/중학교 학적 매뉴얼.hwpx');
  eq([g.year, g.category, g.originSite], [2027, '교무학사실무', '학교업무자료실']);
});
test('숨김·임시·빈 파일 제외', () => { ok(SAS.shouldIgnore('a/.DS_Store', 9)); ok(SAS.shouldIgnore('~$문서.hwp', 9)); ok(SAS.shouldIgnore('__MACOSX/a.pdf', 9)); ok(SAS.shouldIgnore('a.pdf', 0)); ok(!SAS.shouldIgnore('유치원/a.pdf', 9)); });
test('짝 맞추기 열쇠: 연도·띄어쓰기·+·(최종)·맥 자모 분리 무시', () => {
  const k = SAS.matchKey('2026+유치원+교무학사+업무+도움자료.pdf');
  eq(SAS.matchKey('2027유치원교무학사업무도움자료(최종).pdf'), k);
  eq(SAS.matchKey('2027학년도 유치원 교무학사 업무 도움자료 (1).pdf'), k);
  eq(SAS.matchKey('2027유치원교무학사업무도움자료.pdf'.normalize('NFD')), k);
});
const bdocs = [{ id: 'doc-a', title: '2026 교무학사 도움자료 유치원', filename: '2026+유치원+교무학사+업무+도움자료.pdf', school_levels: ['유아'], year: 2026, pdf: { bytes: 1000 } },
  { id: 'doc-b', title: '2026 초등 교무학사 도움자료', filename: '2026 초등 교무학사 도움자료.pdf', school_levels: ['초등'], year: 2026, pdf: { bytes: 2000 } }];
const bitem = (key, filename, levels, size, year, format) => ({ key, filename, title: SAS.titleFromFilename(filename), levels, size, year, format: format || 'pdf' });
test('새 판은 교체, 학교급 다른 자료와는 짝짓지 않음, 처음 보는 자료는 새 자료', () => {
  const it = SAS.planBatch([bitem(1, '2027유치원교무학사업무도움자료.pdf', ['유아'], 5000, 2027), bitem(2, '2027 중등 교무학사 도움자료.pdf', ['중등'], 5, 2027), bitem(3, '2027 특수 학급 운영.pdf', ['특수'], 5, 2027)], bdocs);
  eq(it.map(x => [x.action, x.targetId]), [['replace', 'doc-a'], ['add', null], ['add', null]]);
});
test('이름이 같은 파일은 덮어쓰기(같은 파일이 먼저 짝을 가져감)', () => {
  const it = SAS.planBatch([bitem(1, '2027유치원교무학사업무도움자료.pdf', ['유아'], 5000, 2027), bitem(2, '2026유치원교무학사업무도움자료.pdf', ['유아'], 1000, 2026)], bdocs);
  eq(it.map(x => [x.action, x.targetId]), [['add', null], ['replace', 'doc-a']]);
  const it2 = SAS.planBatch([bitem(1, '2027유치원교무학사업무도움자료.pdf', ['유아'], 5000, 2027)], bdocs);
  eq(it2[0].action, 'replace');
});
test('같은 이름 PDF가 있으면 HWP는 건너뜀 · 직접 고른 처리는 유지', () => {
  const items = [bitem(1, '2027 초등 교무학사 도움자료.pdf', ['초등'], 5, 2027), bitem(2, '2027 초등 교무학사 도움자료.hwp', ['초등'], 5, 2027, 'hwp')];
  SAS.planBatch(items, bdocs);
  eq(items.map(x => x.action), ['replace', 'skip']);
  items[0].action = 'add'; items[0].actionSet = true;
  SAS.planBatch(items, bdocs);
  eq(items[0].action, 'add');
});
test('교체할 때 자료명 연도만 바꿈', () => { eq(SAS.renewTitle('2026 교무학사 도움자료 유치원', 2026, 2027), '2027 교무학사 도움자료 유치원'); eq(SAS.renewTitle('교무학사 도움자료', 2026, 2027), '교무학사 도움자료'); });

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  }
  console.log(`\n결과: 통과 ${pass}, 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
