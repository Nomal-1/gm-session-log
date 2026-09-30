/**
 * 기능 1: 화면 사건 기록
 *
 * 세션 중 화면 관련 사건이 생기면 GM에게만 보이는 귓속말 한 줄을 남긴다.
 * - 사건을 일으킨 GM의 화면에서만 실행한다(userId === game.user.id). 그래서 줄이 두 번 생기지 않는다.
 * - 이미지·저널 "Show Players"에는 Hook이 없어서(v12 API 문서) 해당 함수를 감싼다.
 *   감싼 함수는 원래 함수를 먼저 그대로 실행하고, 기록은 그 뒤에 한다. 기록에서 오류가 나도 원래 동작은 영향을 받지 않는다.
 */

import {
  getSetting, isRecording, postGmLog, describeTargets, targetLabel, targetUsers, playerUsers, displayName
} from "./common.js";
import { snapshotJournal, pageVisibilityMap, effectiveLevel } from "./journal-snapshot.js";

/** "백룡 / 1쪽". 저널과 페이지 이름이 같으면 한 번만: "백룡" */
function journalTitle(entryName, pageName) {
  return !pageName || pageName === entryName ? entryName : `${entryName} / ${pageName}`;
}

function shouldLog(settingKey) {
  if (!game.user.isGM) return false;
  if (!getSetting(settingKey)) return false;
  if (getSetting("onlyWhileRecording") && !isRecording()) return false;
  return true;
}

function safely(label, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(err => console.error(`gm-session-log | ${label} 기록 실패`, err));
  } catch (err) {
    console.error(`gm-session-log | ${label} 기록 실패`, err);
  }
}

const ALL = { all: true, userIds: [], names: [] };

/* ---------------- 장면 전환 ---------------- */

function onUpdateScene(scene, changes, options, userId) {
  if (userId !== game.user.id || changes.active !== true) return;
  if (!shouldLog("logScene")) return;
  safely("장면 전환", () => postGmLog(`장면 전환: ${scene.name}`, {
    kind: "event",
    type: "scene",
    title: scene.name,
    uuid: scene.uuid,
    img: scene.background?.src ?? null,
    targets: ALL
  }));
}

/* ---------------- 이미지 보여주기 ---------------- */

// v12의 foundry.js는 클래스를 "전역 식별자"로 선언해서 window.ImagePopout으로는 안 보일 수 있다.
// 그래서 식별자 이름으로 먼저 찾고, 없으면 window(globalThis)에서 찾는다. (v0.1.0 테스트에서 감지 실패 → 수정)
function imagePopoutClass() {
  // eslint-disable-next-line no-undef
  return typeof ImagePopout !== "undefined" ? ImagePopout : globalThis.ImagePopout;
}
function journalClass() {
  // eslint-disable-next-line no-undef
  return typeof Journal !== "undefined" ? Journal : globalThis.Journal;
}

function wrapShareImage() {
  const cls = imagePopoutClass();
  if (!cls?.prototype?.shareImage) {
    console.warn("gm-session-log | ImagePopout.shareImage를 찾지 못해 이미지 공개 기록을 건너뜁니다.");
    return;
  }
  console.info("gm-session-log | 이미지 공개 감지 준비 완료");
  const original = cls.prototype.shareImage;
  cls.prototype.shareImage = function (options = {}) {
    const result = original.call(this, options);
    safely("이미지 공개", () => {
      if (!shouldLog("logImage")) return;
      const image = options.image ?? this.object ?? null;
      if (!image) return;
      const title = options.title || this.options?.title || this.title || String(image).split("/").pop();
      const targets = describeTargets(options.users);
      return postGmLog(`이미지 공개 → ${targetLabel(targets)}: ${title}`, {
        kind: "event",
        type: "image",
        title,
        uuid: options.uuid ?? this.options?.uuid ?? null,
        img: image,
        targets
      });
    });
    return result;
  };
}

/* ---------------- 저널 보여주기 ---------------- */

function wrapJournalShow() {
  const cls = journalClass();
  if (typeof cls?.show !== "function") {
    console.warn("gm-session-log | Journal.show를 찾지 못해 저널 공개 기록을 건너뜁니다.");
    return;
  }
  console.info("gm-session-log | 저널 공개 감지 준비 완료");
  const original = cls.show;
  cls.show = async function (doc, options = {}) {
    const result = await original.call(this, doc, options);
    safely("저널 공개", () => {
      if (!shouldLog("logJournalShow") || !doc?.documentName) return;
      const targets = describeTargets(options.users);
      // v0.1.0 테스트: Show Players는 권한이 없어도(강제 옵션 없이도) 플레이어에게 보여준다.
      // 그래서 권한으로 페이지를 거르지 않는다. 공개 안 된 비밀 블록은 여전히 뺀다.
      const snap = snapshotJournal(doc, targetUsers(targets), { filterByPermission: false });
      const title = snap.pageName ? journalTitle(snap.entryName, snap.pageName) : snap.entryName;
      return postGmLog(`저널 공유 → ${targetLabel(targets)}: ${title}`, {
        kind: "event",
        type: "journal-show",
        title,
        uuid: doc.uuid,
        img: null,
        force: !!options.force,
        targets,
        journal: snap
      });
    });
    return result;
  };
}

/* ---------------- 저널 권한 변경 ---------------- */

// 바꾸기 직전에 "누가 어떤 페이지를 볼 수 있었나"를 적어 둔다. 같은 GM 화면 안에서만 쓰인다.
const beforeVisibility = new Map();

function touchesOwnership(changes) {
  return Object.keys(changes ?? {}).some(k => k === "ownership" || k.startsWith("ownership."));
}

/**
 * 저장 전: 볼 수 있던 사람을 적어 둔다.
 * 감지 경로가 둘(저장 단계 감싸기 + Hook)이라 먼저 온 쪽만 적는다(5초 안의 같은 문서는 건너뜀).
 */
function beforeOwnershipChange(doc, changes, userId, via) {
  if (userId !== game.user.id || !touchesOwnership(changes)) return;
  if (!shouldLog("logJournalPerm")) return;
  const entry = doc.documentName === "JournalEntryPage" ? doc.parent : doc;
  if (!entry) return;
  const prev = beforeVisibility.get(doc.uuid);
  if (prev && Date.now() - prev.at < 5000) return;
  beforeVisibility.set(doc.uuid, { at: Date.now(), map: pageVisibilityMap(entry, playerUsers()) });
  console.info(`gm-session-log | 권한 변경 감지(저장 전, ${via}): ${doc.name}`);
}

const LEVEL_NAME = { 1: "제한", 2: "관찰자", 3: "소유자" };

/** "관찰자" 처럼 새로 볼 수 있게 된 사람들의 권한 단계 이름 */
function levelLabel(doc, userIds) {
  const names = new Set(userIds.map(id => {
    const u = game.users.get(id);
    return u ? LEVEL_NAME[effectiveLevel(doc, u)] : null;
  }).filter(Boolean));
  return names.size ? [...names].join("/") : "관찰자";
}

/**
 * 권한 설정 창은 저장할 때 Hook을 부르지 않는 옵션(noHook)을 쓸 수 있어서, Hook 대신
 * 저널 문서 클래스의 저장 전(_preUpdate)·저장 후(_onUpdate) 단계를 감싼다. (v0.1.0 테스트에서 감지 실패 → 수정)
 * - 원래 함수를 같은 인자로 그대로 부르고, 그 결과를 그대로 돌려준다(저장을 막거나 바꾸지 않음).
 */
function wrapJournalOwnership() {
  for (const name of ["JournalEntry", "JournalEntryPage"]) {
    const cls = CONFIG[name]?.documentClass;
    if (!cls?.prototype?._preUpdate || !cls.prototype._onUpdate) {
      console.warn(`gm-session-log | ${name} 저장 단계를 찾지 못해 권한 변경 기록을 건너뜁니다.`);
      continue;
    }
    const pre = cls.prototype._preUpdate;
    cls.prototype._preUpdate = function (changed, options, user) {
      try {
        beforeOwnershipChange(this, changed, user?.id ?? user, "저장 단계");
      } catch (err) {
        console.error("gm-session-log | 권한 변경 준비 실패", err);
      }
      return pre.call(this, changed, options, user);
    };
    const on = cls.prototype._onUpdate;
    cls.prototype._onUpdate = function (changed, options, userId) {
      const result = on.call(this, changed, options, userId);
      onUpdateJournal(this, changed, options, userId);
      return result;
    };
  }
  // 두 번째 경로: Hook. 저장 단계 감싸기가 어떤 이유로 불리지 않는 경우를 대비한다(v0.1.1 테스트: 저널 전체 권한 변경 누락).
  // pre... Hook에서 false를 돌려주면 저장이 취소되므로, 아래 함수는 항상 아무것도 돌려주지 않는다.
  const preHook = (doc, changes, options, userId) => {
    try {
      beforeOwnershipChange(doc, changes, userId, "Hook");
    } catch (err) {
      console.error("gm-session-log | 권한 변경 준비 실패", err);
    }
  };
  Hooks.on("preUpdateJournalEntry", preHook);
  Hooks.on("preUpdateJournalEntryPage", preHook);
  Hooks.on("updateJournalEntry", onUpdateJournal);
  Hooks.on("updateJournalEntryPage", onUpdateJournal);
  console.info("gm-session-log | 저널 권한 변경 감지 준비 완료");
}

function onUpdateJournal(doc, changes, options, userId) {
  if (userId !== game.user.id) return;
  const saved = beforeVisibility.get(doc.uuid);
  if (!saved) return;
  // 먼저 온 경로가 처리하고 지운다. 두 번째 경로는 여기서 멈춘다(중복 기록 없음).
  beforeVisibility.delete(doc.uuid);
  const before = saved.map;

  safely("저널 권한", () => {
    const isPage = doc.documentName === "JournalEntryPage";
    const entry = isPage ? doc.parent : doc;
    const after = pageVisibilityMap(entry, playerUsers());

    const newPageIds = new Set();
    const newUserIds = new Set();
    for (const [pageId, nowSet] of after) {
      if (isPage && pageId !== doc.id) continue;
      const beforeSet = before.get(pageId) ?? new Set();
      for (const uid of nowSet) {
        if (!beforeSet.has(uid)) {
          newPageIds.add(pageId);
          newUserIds.add(uid);
        }
      }
    }
    if (!newPageIds.size) {
      // 진단용: 무엇을 비교했는지 콘솔에 남긴다(플레이어 화면과 무관, GM 콘솔에만)
      const fmt = m => [...m].map(([id, s]) => `${entry.pages.get(id)?.name ?? id}:[${[...s].map(u => game.users.get(u)?.name).join(",")}]`).join(" ");
      console.info(`gm-session-log | 권한 변경 감지(저장 후): ${doc.name} — 새로 볼 수 있게 된 플레이어 없음. 전: ${fmt(before)} / 후: ${fmt(after)}`);
      return;
    }

    const players = playerUsers();
    const allNow = players.length > 0 && players.every(u => newUserIds.has(u.id));
    const targets = allNow ? ALL : describeTargets([...newUserIds]);
    const snap = snapshotJournal(entry, targetUsers(targets), { onlyPageIds: newPageIds });
    const title = isPage ? journalTitle(entry.name, doc.name) : entry.name;
    // 누구에게 어떤 권한이 생겼는지 보이게: "저널 권한 공개(관찰자) → 전체(캐릭터): 제목"
    const who = allNow
      ? `전체(${players.map(u => displayName(u)).join(", ")})`
      : targetLabel(targets);
    const level = levelLabel(doc, [...newUserIds]);
    return postGmLog(`저널 권한 공개(${level}) → ${who}: ${title}`, {
      kind: "event",
      type: "journal-perm",
      title,
      uuid: doc.uuid,
      img: null,
      targets,
      journal: snap
    });
  });
}

/* ---------------- NPC 토큰 ---------------- */

function logToken(tokenDoc, how) {
  if (!shouldLog("logToken")) return;
  const actor = tokenDoc.actor;
  if (actor?.type !== "npc") return;
  // 플레이어가 보고 있는 활성 장면의 토큰만
  if (!tokenDoc.parent?.active) return;
  const tokenImg = tokenDoc.texture?.src ?? null;
  const portrait = actor.img && actor.img !== tokenImg ? actor.img : null;
  safely("NPC 토큰", () => postGmLog(`NPC 등장${how} → 전체: ${tokenDoc.name}`, {
    kind: "event",
    type: "token",
    title: tokenDoc.name,
    uuid: tokenDoc.uuid,
    actorUuid: actor.uuid,
    img: tokenImg,
    portrait,
    targets: ALL
  }));
}

function onCreateToken(tokenDoc, options, userId) {
  if (userId !== game.user.id || tokenDoc.hidden) return;
  logToken(tokenDoc, "");
}

function onUpdateToken(tokenDoc, changes, options, userId) {
  if (userId !== game.user.id || changes.hidden !== false) return;
  logToken(tokenDoc, "(숨김 해제)");
}

/* ---------------- 시작 ---------------- */

/** ready 시점에 GM 화면에서만 호출된다. */
export function initEventLog() {
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("createToken", onCreateToken);
  Hooks.on("updateToken", onUpdateToken);
  wrapShareImage();
  wrapJournalShow();
  wrapJournalOwnership();
}
