# 교무행정 통합검색

여러 자료실에 흩어진 교무행정 매뉴얼·지침·서식을 한곳에서 찾아 내려받는 공개 검색 사이트입니다.
GitHub Pages에서 동작하며 서버·DB·AI·유료 API를 쓰지 않습니다.

- **관리자 도구** (`admin/`): PDF·HWPX를 브라우저 안에서 분석해 업무별로 나누고, 검색어·웍스 링크·서식 모음을 관리한 뒤 **GitHub 출입증(세분화된 개인 액세스 토큰)으로 저장소에 바로 반영**합니다.
- **사용자 검색 화면** (`index.html`): 학교급 카드 → 검색(업무명·검색어·자료명·본문 순) → 간단·상세 미리보기 → 웍스 원본·서식 모음 내려받기. 주소 `#/kindergarten?q=소풍&c=분류`로 결과를 공유할 수 있습니다.

비개발자용 사용법은 [docs/관리자_사용설명서.md](docs/관리자_사용설명서.md)를 보세요.

## 폴더 구조

```
index.html                     사용자 검색 화면
assets/css/site.css            사용자 화면 디자인
assets/img/                    첫 화면 학교급 아이콘·장식 그림
assets/js/site/search.js       검색 엔진(순위·본문 색인·미리보기, Node 테스트 가능)
assets/js/site/app.js          사용자 화면
admin/
  index.html                   관리자 도구
  css/admin.css
  js/extract.js                PDF(pdf.js)·HWPX(JSZip) 읽기 — 브라우저 전용
  js/github.js                 GitHub 연결: 저장소 자동 인식, Git Data API 커밋, 만료일·캘린더(.ics)
  js/store.js                  작업 상태, GitHub 불러오기·반영(지문 캐시·충돌 감지), 예비: 폴더·ZIP, 임시 보관
  js/app.js                    화면
assets/vendor/                 내장 라이브러리(CDN 미사용): pdf.js 6.2 legacy + 한글 CMap, JSZip 3.10
assets/js/core/                브라우저·Node 공용 모듈(사용자 화면도 같이 사용)
  normalize.js                 정규화, 강조, 2글자 조각, 색인 조각 번호
  textlayout.js                글자 조각 → 줄, 머리말·꼬리말·인쇄 쪽수, 링크 글자
  sectionizer.js               목차 인식, 업무 분할, 서식 링크 배정
  schema.js                    v2 스키마, 문서 생성, 서식 번호·모음 쪽 찾기, v1 변환, 검사
  indexer.js                   공개 데이터 파일 생성, 일관성 검사
data/                          관리자 도구가 생성(직접 고치지 마세요)
  manifest.json                생성 시각, 학교급별 개수
  documents.json               전체 자료 목록·메타데이터
  documents/<id>.json          자료별 상세(본문·업무·서식)
  indexes/<slug>.json          학교급별 목록 색인(kindergarten·elementary·middle·special)
  search/<slug>/<nnn>.json     학교급별 본문 색인 조각(128개)
tests/
  run-tests.js                 회귀 테스트: node tests/run-tests.js
  fixtures/                    실제 유치원 도움자료의 pdf.js 추출값, v1 JSON
```

## 데이터 스키마 v2 (자료별 파일)

```jsonc
{
  "schema_version": "2.0",
  "id": "doc-2026-kinder1",            // 바뀌지 않는 ID (교체해도 유지)
  "title": "2026 유치원 교무학사 업무 도움자료",
  "school_levels": ["유아"],            // 복수 가능
  "category": "교무학사실무", "year": 2026,
  "format": "pdf", "kind": "text",      // text: 본문 추출(PDF·HWPX) / link: 링크형(HWP·엑셀 등)
  "works_url": "https://…",             // 원본 내려받기(네이버 웍스)
  "origin": { "site": "학교업무자료실", "url": "", "note": "" },   // 원 출처(개정 확인용)
  "search_keywords": ["교무학사"],      // 문서 전체 검색어
  "forms_bundle": { "works_url": "https://…", "filename": "…_서식모음.hwp", "page_count": 275 },
  "blocks": [ { "n": 25, "pdf_page": 26, "printed_page": 22, "footer_label": "Ⅱ. 유아교육지원", "text": "…" } ],
  "sections": [ { "id": "sec-018", "heading": "현장체험학습 운영", "parent_heading": "유아교육지원",
                  "block_start": 25, "block_end": 25, "pdf_pages": [26], "printed_pages": [22],
                  "keywords": ["소풍", "사전답사"], "auto": true } ],
  "links": [ { "id": "lnk-0183", "text": "현장체험학습 계획서(예시)", "url": "http://www.cne.go.kr/…",
               "kind": "file", "section_id": "sec-018", "form_no": 183, "bundle_page": 198 } ]
}
```

- 명세서의 개념 예시와 달리 업무 본문을 따로 저장하지 않고 `blocks`(쪽/문단)의 범위로 가리킵니다. 같은 글을 두 번 저장하지 않아 용량이 절반이 되고, 관리자가 쪽 범위를 고치면 본문이 자동으로 따라갑니다.
- 링크로 찾지 못한 서식은 관리자 도구에서 직접 추가할 수 있습니다(`manual: true`, 주소 없어도 됨). 번호는 자동으로 찾은 서식 뒤에 이어 붙어 기존 번호가 바뀌지 않으며, 파일 교체 시 같은 이름의 업무로 옮겨집니다.
- `links.kind`: `file`(내려받기 서식), `law`(법령), `site`(누리집). 서식에는 업무 순서대로 `form_no`가 붙고, 서식 모음에서 찾은 쪽이 `bundle_page`에 들어갑니다. 교육청 원래 주소(`url`)는 출처 기록용입니다.
- 학교급 색인에는 서식 주소를 넣지 않습니다(첫 화면 용량 절약). 서식명은 본문에 인쇄돼 있어 본문 색인으로 찾고, 상세 파일에서 꺼내 보여 줍니다.

## 검색 순위

① 업무명 정확 일치 → ①-2 업무명 포함 → ② 업무 검색어 → ③ 자료명·문서 전체 검색어 → ④ 본문 일치.
같은 업무는 한 번만 표시합니다. 띄어 쓴 여러 낱말은 모두 들어 있는 업무만 찾습니다. 본문 결과는 20건씩 확인해 보여 주고 "더 보기"로 이어집니다. 본문 검색은 `search/` 조각에서 2글자 조각의 교집합으로 후보 업무를 고른 뒤, 자료 상세 파일을 받아 실제 문구를 확인하고 미리보기를 만듭니다.

## 라이브러리

`assets/vendor/`에 내장되어 외부 CDN 없이 동작합니다(학교망 차단 대비). 원본 파일은 외부로 전송되지 않습니다.
- pdf.js 6.2.108 legacy build (Apache-2.0) + 한글 CMap 24개 — ES 모듈이므로 관리자 도구는 https 주소로 열어야 합니다
- JSZip 3.10.1 (MIT)

## GitHub 반영 방식

- 저장소는 `아이디.github.io/저장소/admin/` 주소에서 자동 인식합니다.
- 출입증: Fine-grained personal access token, 이 저장소 하나, Repository permissions → Contents: Read and write. 관리자 브라우저(IndexedDB)에만 저장하며 공개 파일에는 넣지 않습니다.
- 불러오기: `git/ref → commit → tree(recursive)`로 파일 지문(blob SHA)을 받고, 자료 파일은 지문별로 캐시해 바뀐 것만 내려받습니다.
- 반영: 출력 파일의 git blob SHA를 브라우저에서 계산해 바뀐 파일만 골라, `git/trees`(내용 직접 포함, 4MB 단위로 이어 붙임) → `git/commits` → `git/refs` PATCH(force=false)로 커밋 하나를 만듭니다. 처음 반영 시 `.nojekyll`을 만듭니다.
- 충돌 방지: 반영 직전 최신 트리의 `data/` 지문이 불러올 때와 다르면 반영을 멈춥니다.
- 만료일: 브라우저에서는 `GitHub-Authentication-Token-Expiration` 헤더를 읽을 수 없는 경우가 많아, 연결할 때 관리자가 만료일을 입력합니다(헤더가 읽히면 그 값을 우선 사용). 30·7·1일 전 단계마다 알림창 1회, 경고 줄 상시 표시, `.ics` 캘린더 파일 제공.

## 테스트

```
node tests/run-tests.js
```
실제 유치원 도움자료(37쪽)로 업무 27개 분할, 쪽 범위, 인쇄 쪽수, 서식 255개 이름, v1 변환, 색인, 교체 승계를 검사합니다.

## 지원하지 않는 것 (1차 범위)

- 스캔(이미지) PDF의 OCR — 글자가 없으면 경고만 표시
- HWP(구형 바이너리)·엑셀 본문 추출 — 링크형 자료로 등록(자료명·검색어로 검색)
- HWPX 인쇄 쪽수 — 문단 번호로만 관리
- 웍스 문서의 특정 쪽 바로 열기 — 쪽 번호를 안내하고 원본 링크 제공
- 웍스 API, 사용자 로그인, 서버 DB, 개정 이력
- 공개 데이터 보호 — GitHub Pages의 `data/`는 누구나 내려받을 수 있습니다. 관리자 도구에는 비밀번호 같은 보호 기능이 없습니다.
