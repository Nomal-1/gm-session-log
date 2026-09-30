/**
 * 기능 1: 화면 사건 기록
 *
 * 세션 중 화면 관련 사건이 생기면 GM에게만 보이는 귓속말 한 줄을 남긴다.
 * - 사건을 일으킨 GM의 화면에서만 실행한다(userId === game.user.id). 그래서 줄이 두 번 생기지 않는다.
 * - 이미지·저널 "Show Players"에는 Hook이 없어서(v12 API 문서) 해당 함수를 감싼다.
 *   감싼 함수는 원래 함수를 먼저 그대로 실행하고, 기록은 그 뒤에 한다. 기록에서 오류가 나도 원래 동작은 영향을 받지 않는다.
 */

import {
  getSetting, isRecording, postGmLog, describeTargets, targetLabel, targetUsers, playerUsers
} from "./common.js";
import { snapshotJournal, pageVisibilityMap } from "./journal-snapshot.js";

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

function wrapShareImage() {
  const cls = globalThis.ImagePopout;
  if (!cls?.prototype?.shareImage) {
    console.warn("gm-session-log | ImagePopout.shareImage를 찾지 못해 이미지 공개 기록을 건너뜁니다.");
    return;
  }
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
  const cls = globalThis.Journal;
  if (typeof cls?.show !== "function") {
    console.warn("gm-session-log | Journal.show를 찾지 못해 저널 공개 기록을 건너뜁니다.");
    return;
  }
  const original = cls.show;
  cls.show = async function (doc, options = {}) {
    const result = await original.call(this, doc, options);
    safely("저널 공개", () => {
      if (!shouldLog("logJournalShow") || !doc?.documentName) return;
      const targets = describeTargets(options.users);
      const snap = snapshotJournal(doc, targetUsers(targets));
      const title = snap.pageName ? `${snap.entryName} / ${snap.pageName}` : snap.entryName;
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

// 주의: pre... Hook에서 false를 돌려주면 변경이 취소된다. 이 함수는 항상 아무것도 돌려주지 않는다.
function onPreUpdateJournal(doc, changes, options, userId) {
  if (userId !== game.user.id || !touchesOwnership(changes)) return;
  if (!shouldLog("logJournalPerm")) return;
  const entry = doc.documentName === "JournalEntryPage" ? doc.parent : doc;
  if (!entry) return;
  beforeVisibility.set(doc.uuid, pageVisibilityMap(entry, playerUsers()));
}

function onUpdateJournal(doc, changes, options, userId) {
  if (userId !== game.user.id) return;
  const before = beforeVisibility.get(doc.uuid);
  if (!before) return;
  beforeVisibility.delete(doc.uuid);

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
    if (!newPageIds.size) return;

    const players = playerUsers();
    const allNow = players.length > 0 && players.every(u => newUserIds.has(u.id));
    const targets = allNow ? ALL : describeTargets([...newUserIds]);
    const snap = snapshotJournal(entry, targetUsers(targets), { onlyPageIds: newPageIds });
    const title = isPage ? `${entry.name} / ${doc.name}` : entry.name;
    return postGmLog(`저널 권한 공개 → ${targetLabel(targets)}: ${title}`, {
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
  Hooks.on("preUpdateJournalEntry", onPreUpdateJournal);
  Hooks.on("preUpdateJournalEntryPage", onPreUpdateJournal);
  Hooks.on("updateJournalEntry", onUpdateJournal);
  Hooks.on("updateJournalEntryPage", onUpdateJournal);
  Hooks.on("createToken", onCreateToken);
  Hooks.on("updateToken", onUpdateToken);
  wrapShareImage();
  wrapJournalShow();
}
