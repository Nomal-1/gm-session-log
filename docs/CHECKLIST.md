# 구현 체크리스트

완료로 표시할 때는 반드시 `근거:` 뒤에 **파일 이름과 함수(또는 부분)**를 적는다.
[로컬 시험] = FVTT 없이 이 PC에서 jsdom(가상 브라우저)으로 돌려 통과한 항목. [FVTT 시험 필요] = 5단계에서 실제로 확인할 항목.

## 0. 뼈대
- [x] module.json (id `gm-session-log`, v12 호환, 던전월드 관계, 배포 링크) — 근거: `module.json` 전체. `compatibility` minimum 12 / verified 12.331 / maximum 12, `manifest`·`download`는 dw-critical-cutin과 같은 releases/latest 방식
- [x] lang/ko.json (설정·버튼·창 문구 전부 한국어) — 근거: `lang/ko.json`. `module.json` `languages`에 ko와 en을 모두 이 파일로 연결해서, FVTT 언어가 영어여도 한국어로 나옴
- [x] 설정 등록 (4장 표의 항목 + 숨김 `recordingState`) — 근거: `scripts/settings.js` `registerSettings()`. 모든 항목이 `scope: "world"`(GM만 변경 가능)
- [x] 공통 도구: 한국 시간, GM 귓속말 만들기, 대상 이름(캐릭터 → 사용자) — 근거: `scripts/common.js` `kstTime`/`kstDate`/`formatDuration`, `postGmLog()`(whisper = `gmUserIds()`), `displayName()`/`describeTargets()`/`targetLabel()` [로컬 시험: 시각·날짜·경과·파일 이름]

## 1. 화면 사건 기록
- [x] 장면 전환 (`updateScene`, active=true, 일으킨 GM만) — 근거: `scripts/event-log.js` `onUpdateScene()`
- [x] 이미지 보여주기 (`ImagePopout.prototype.shareImage` 감싸기, 원래 동작 보장) — 근거: `event-log.js` `wrapShareImage()`, 클래스 찾기 `imagePopoutClass()`(v0.1.1: 전역 식별자 우선). 원래 함수를 먼저 실행하고, 기록은 `safely()` 안에서 해서 오류가 나도 원래 동작에 영향 없음 [FVTT 시험 필요: 액터 초상화 경유 여부]
- [x] 저널 보여주기 (`Journal.show` 감싸기, 페이지/전체 구분, 대상 반영) — 근거: `event-log.js` `wrapJournalShow()`·`journalClass()`(v0.1.1) + `scripts/journal-snapshot.js` `snapshotJournal()` [FVTT 시험 필요: showDialog 경유, force]
- [x] 저널 권한 변경 (저장 전/후 비교, 새로 볼 수 있게 된 플레이어만) — 근거: `event-log.js` `wrapJournalOwnership()`(v0.1.1: Hook 대신 문서 클래스 `_preUpdate`/`_onUpdate` 감싸기)·`beforeOwnershipChange()`·`onUpdateJournal()`, `journal-snapshot.js` `pageVisibilityMap()`·`canObserve()`(상위 따름 권한 처리) [로컬 시험 v0.1.1]
- [x] NPC 토큰 (생성 시 보임 / 숨김→보임, npc 액터만) — 근거: `event-log.js` `onCreateToken()`·`onUpdateToken()`·`logToken()`(`actor.type === "npc"`, 활성 장면만)
- [x] 저널 공개분 추리기: 공개 안 된 비밀 블록 삭제·개수, 권한 변경 기록에서만 권한 없는 페이지 제외 — 근거: `journal-snapshot.js` `stripUnrevealedSecrets()`, `snapshotJournal()`의 `filterByPermission`(Show Players는 false — v0.1.0 테스트 결과) [로컬 시험: 숨김 2개 제거·공개 1개 유지·중첩 비밀 제거]
- [x] "기록 중일 때만" 설정·사건별 켜기/끄기 반영 — 근거: `event-log.js` `shouldLog()`
- [x] 꼬리표(flags)에 uuid·이미지·대상·저널 공개분 저장 — 근거: 각 `postGmLog(..., {kind, type, title, uuid, img, targets, journal})` 호출, `common.js` `postGmLog()`가 `flags["gm-session-log"]`에 저장

## 2. 세션 구간 표시
- [x] 채팅 탭 상단 막대 (GM만, 상태별 문구·색, 경과 시간) — 근거: `scripts/session-bar.js` `injectBar()`(`game.user.isGM` 검사), `barHtml()`, `refreshBars()`(1초 타이머), `styles/gm-session-log.css` `.gsl-bar.recording`
- [x] 기록 시작: 이름 입력 창, 빈칸이면 날짜, 시작 메시지 — 근거: `session-bar.js` `askSessionName()`, `startRecording()`
- [x] 기록 종료: 종료 메시지, "지금 추출할까요?" 창 — 근거: `session-bar.js` `stopRecording()`
- [x] 상태 저장·복원 (새로고침 후 유지) — 근거: `startRecording()`/`stopRecording()`에서 `game.settings.set(..."recordingState")`, 막대는 그릴 때마다 설정에서 읽음(`barHtml()`), 다른 GM 화면은 `settings.js` `onChange` → `refreshBars()`
- [x] 채팅 명령 `/기록시작` `/기록종료` `/기록추출` (GM만) — 근거: `session-bar.js` `onChatCommand()`, `main.js`에서 `chatMessage` Hook에 연결

## 3. 추출
- [x] 범위 찾기 (시작/종료 짝짓기, 여러 개면 목록, 종료 없으면 지금까지) — 근거: `scripts/export/export.js` `findSessions()`, `pickSession()`, `runExport()`의 `endTs`
- [x] 진행 표시 창 — 근거: `export.js` `ProgressBox` (GM 브라우저의 화면에만 붙는 요소)
- [x] 세션기록.md 머리말 (이름, 날짜, 시각, 길이, 참가자, 줄 수) — 근거: `scripts/export/chat-format.js` `renderSessionMd()`, `participants()`
- [x] 메시지 줄 (시각, 경과, 누가, 종류, 귓속말 대상, 순수 텍스트) — 근거: `chat-format.js` `buildRecords()`, `whoOf()`, `common.js` `htmlToText()` [로컬 시험: HTML 벗기기]
- [x] 던전월드 판정 읽기 (무브 이름, 식, 합계, 10+/7-9/6-) + 일반 굴림 — 근거: `scripts/export/dw-roll.js` `parseDwCard()`·`describeDwCard()`·`describeRolls()`, 본문에만 있는 주사위 `parseDiceHtml()`(v0.1.1) [FVTT 시험 v0.1.0: 7회 판정 구간 모두 정확] [로컬 시험: 성공/부분/실패/피해/굴림 없는 무브/일반·유리 굴림]
- [x] 화면 사건 줄에 자료 링크 — 근거: `chat-format.js` `buildRecords()`의 `link`
- [x] 자료 수집: 장면 배경 / 이미지 / 토큰+초상화 / 저널 .md+그림 — 근거: `scripts/export/assets.js` `collectAssets()`, `buildJournalMd()`
- [x] 중복 제거와 보여준 시각 모으기 — 근거: `assets.js` `planAssets()`의 `assetKey()`(이미지 경로 또는 저널 공개분 내용 기준)
- [x] 이미지 축소(1600px webp) / 원본 설정, SVG·동영상·외부 URL 처리 — 근거: `assets.js` `fetchMedia()`·`resizeToWebp()`(축소 대상은 png/jpg/jpeg/webp/bmp/avif만, 나머지는 원본 그대로), 실패 시 `entry.failures`에 URL
- [x] 저널 HTML → 마크다운, 그림 상대 경로 — 근거: `scripts/export/html-to-md.js` `htmlToMarkdown()`, `assets.js` `buildJournalMd()`의 `fileFor()` [로컬 시험: 제목·굵게·@UUID·그림·중첩 목록·표·인용·줄바꿈]
- [x] 자료목록.md — 근거: `chat-format.js` `renderAssetListMd()`
- [x] JSON 옵션 — 근거: `chat-format.js` `renderJson()`, `export.js`의 `includeJson` 분기
- [x] zip 작성 (UTF-8 파일 이름) 및 브라우저 내려받기 — 근거: `scripts/export/zip.js` `makeZip()`·`downloadBlob()` [로컬 시험: Python 무결성(CRC) 검사 통과, Windows 압축 풀기에서 한글 이름 정상]

## 4. 자체 검수 (하지 않을 것 기준)
- [x] 플레이어에게 보이는 메시지·알림·버튼 경로 없음 — 근거: 메시지는 `common.js` `postGmLog()` 한 곳에서만 만들고 `whisper: gmUserIds()`. 막대는 `session-bar.js` `injectBar()`의 `isGM` 검사. 진행 창·알림·확인 창은 모두 `isGM` 검사를 통과한 함수(`runExport`/`startRecording`/`stopRecording`) 안에서만 뜨고, `ui.notifications`는 부른 사람 화면에만 뜸. 사건 감지·함수 감싸기는 `main.js` ready에서 GM일 때만 시작 [FVTT 시험 필요: 귓속말이 플레이어 브라우저에 전달되는지(콘솔), 설정 항목 노출]
- [x] 플레이어가 버튼·명령·추출을 실행할 경로 없음 — 근거: 모든 진입점에 `game.user.isGM` 검사: `onBarClick()`, `onChatCommand()`, `startRecording()`, `stopRecording()`, `runExport()`. 매크로용 `api`도 GM 화면에서만 등록(`main.js`). 기록 상태는 월드 설정이라 플레이어가 저장하려 하면 서버가 거부함
- [x] 공개 안 된 비밀 블록·미공개 페이지가 zip에 들어갈 경로 없음 — 근거: zip의 저널 내용은 오직 `assets.js` `buildJournalMd()`가 메시지 꼬리표(`journal.pages`)에서만 만들고, 살아 있는 저널을 다시 읽지 않음. 꼬리표는 `journal-snapshot.js` `snapshotJournal()`에서 만들 때 이미 공개 안 된 비밀 블록을 지우고(`stripUnrevealedSecrets`) 권한 없는 페이지를 뺌(`canAnyObserve`). 저널 속 그림도 지운 뒤의 HTML에서만 찾음(`collectImageSources(page.html)`)
- [x] 문서 수정·삭제 코드 없음 — 근거: 전체 검색 결과 쓰기는 `ChatMessage.create`(GM 귓속말, `common.js`)와 `game.settings.set`(모듈 자기 설정, `session-bar.js`)뿐. `update`/`delete`/`setFlag`/소켓 없음. `preUpdateJournal…` Hook은 아무 값도 돌려주지 않아 변경을 막지 않음. 감싼 `shareImage`/`Journal.show`는 원래 함수를 같은 인자로 먼저 실행하고 결과를 그대로 돌려줌
- [x] 외부 서버로 보내는 코드 없음 — 근거: 네트워크 코드는 `assets.js` `fetchMedia()`의 GET 하나. 다른 사이트 이미지는 쿠키·출처 주소 없이 받기만 함(`credentials: "omit"`, `referrerPolicy: "no-referrer"`). zip은 `zip.js` `downloadBlob()`로 GM 브라우저에 저장. 서버 파일 시스템에 쓰는 코드(FilePicker 업로드 등) 없음
- [x] 토큰 위치·전투 순서·거리 기록 없음 — 근거: `event-log.js` `logToken()`이 저장하는 것은 이름·uuid·토큰 이미지·초상화뿐. `x`/`y`/전투(combat)를 읽는 코드 없음
