/**
 * 여러 기능이 함께 쓰는 작은 도구 모음.
 * 이 파일은 문서를 읽기만 하고, 새로 만드는 것은 GM 귓속말 메시지뿐이다.
 */

export const MODULE_ID = "gm-session-log";

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function isEnabled() {
  return getSetting("enabled");
}

export function isRecording() {
  return !!getSetting("recordingState")?.active;
}

/* ---------------- 한국 시간 ---------------- */

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
});
const WEEKDAY_FMT = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" });

/** 21:14:03 */
export function kstTime(ms) {
  return TIME_FMT.format(new Date(ms));
}

/** 2026-10-10 */
export function kstDate(ms) {
  return DATE_FMT.format(new Date(ms));
}

/** 토 */
export function kstWeekday(ms) {
  return WEEKDAY_FMT.format(new Date(ms));
}

/** 밀리초 → 01:02:03 */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

/** 밀리초 → 2시간 46분 46초 */
export function formatDurationKo(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h}시간`);
  if (h || m) parts.push(`${m}분`);
  parts.push(`${s}초`);
  return parts.join(" ");
}

/* ---------------- 사용자·대상 ---------------- */

export function gmUserIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

export function playerUsers() {
  return game.users.filter(u => !u.isGM);
}

/** 캐릭터 이름(없으면 사용자 이름) */
export function displayName(user) {
  if (!user) return "?";
  return user.character?.name || user.name;
}

/**
 * 공개 대상 정리. userIds가 비어 있으면 전체.
 * @returns {{all: boolean, userIds: string[], names: string[]}}
 */
export function describeTargets(userIds) {
  const ids = (userIds ?? []).filter(id => {
    const u = game.users.get(id);
    return u && !u.isGM;
  });
  if (!ids.length) return { all: true, userIds: [], names: [] };
  return { all: false, userIds: ids, names: ids.map(id => displayName(game.users.get(id))) };
}

/** 대상이 되는 플레이어 User 목록 */
export function targetUsers(targets) {
  if (!targets || targets.all) return playerUsers();
  return targets.userIds.map(id => game.users.get(id)).filter(Boolean);
}

/** "전체" 또는 "카락테르, 에일린만" */
export function targetLabel(targets, { suffix = "만" } = {}) {
  if (!targets || targets.all) return "전체";
  return `${targets.names.join(", ")}${suffix}`;
}

/* ---------------- 문자열 ---------------- */

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 파일 이름에 쓸 수 없는 문자와 공백을 뺀다. */
export function safeFileName(str, maxLen = 40) {
  const cleaned = String(str ?? "")
    .replace(/[\\/:*?"<>|#%{}^~[\]`()]/g, "")
    .replace(/\s+/g, "")
    .replace(/\.+$/, "")
    .slice(0, maxLen);
  return cleaned || "이름없음";
}

/** HTML → 순수 텍스트. DOMParser는 이미지·스크립트를 실행하거나 불러오지 않는다. */
export function htmlToText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  doc.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, tr").forEach(el => el.append("\n"));
  return (doc.body.textContent ?? "")
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join(" / ");
}

/* ---------------- GM 귓속말 ---------------- */

/**
 * GM에게만 보이는 기록 메시지를 만든다.
 * @param {string} label   "[시각] " 뒤에 붙는 본문 (예: "장면 전환: 비비안의 저택")
 * @param {object} data    flags에 저장할 숨은 꼬리표
 */
export async function postGmLog(label, data) {
  const now = Date.now();
  const text = `[${kstTime(now)}] ${label}`;
  return ChatMessage.create({
    content: `<div class="gsl-log">${escapeHtml(text)}</div>`,
    whisper: gmUserIds(),
    speaker: { alias: "세션 기록" },
    flags: { [MODULE_ID]: { ...data, label, at: now } }
  });
}

export function moduleFlags(message) {
  return message?.flags?.[MODULE_ID] ?? null;
}
