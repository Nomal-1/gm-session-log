/**
 * 기능 2: 세션 구간 표시
 *
 * - 채팅 탭 맨 위에 GM에게만 보이는 막대를 붙인다. 플레이어 화면에는 아무것도 붙이지 않는다.
 * - 기록 시작/종료 시 GM 귓속말로 표시 메시지를 남기고, 상태는 월드 설정(recordingState)에 저장한다.
 * - 채팅 명령 /기록시작 /기록종료 /기록추출 (GM만).
 */

import {
  MODULE_ID, getSetting, isEnabled, isRecording, postGmLog, kstDate, formatDuration, escapeHtml
} from "./common.js";

let exportFn = null;
let timer = null;

/** 추출 기능은 다른 파일(export/export.js)에 있다. main.js에서 연결해 준다. */
export function setExportHandler(fn) {
  exportFn = fn;
}

/* ---------------- 시작 / 종료 ---------------- */

async function askSessionName() {
  const def = kstDate(Date.now());
  return new Promise(resolve => {
    new Dialog({
      title: game.i18n.localize("GSL.Dialog.startTitle"),
      content: `<form class="gsl-dialog"><div class="form-group">
          <label>${game.i18n.localize("GSL.Dialog.startLabel")}</label>
          <input type="text" name="name" placeholder="${escapeHtml(def)}" autofocus>
        </div></form>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-circle"></i>',
          label: game.i18n.localize("GSL.Dialog.startButton"),
          callback: html => resolve(String(html.find("input[name=name]").val() ?? "").trim() || def)
        },
        cancel: { label: game.i18n.localize("GSL.Dialog.cancel"), callback: () => resolve(null) }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

// 버튼을 빠르게 두 번 눌러 시작·종료가 두 번 기록되는 것을 막는다.
let pending = false;

export async function startRecording(nameArg) {
  if (!game.user.isGM || pending) return;
  if (isRecording()) return ui.notifications.warn(game.i18n.localize("GSL.Notify.alreadyRecording"));
  pending = true;
  try {
    const name = nameArg?.trim() || await askSessionName();
    if (!name || isRecording()) return;
    const sessionId = foundry.utils.randomID();
    const msg = await postGmLog(`● 기록 시작 — ${name}`, { kind: "marker", action: "start", sessionId, name });
    await game.settings.set(MODULE_ID, "recordingState", {
      active: true, sessionId, name, startedAt: msg?.timestamp ?? Date.now()
    });
  } finally {
    pending = false;
  }
}

export async function stopRecording() {
  if (!game.user.isGM || pending) return;
  const state = getSetting("recordingState");
  if (!state?.active) return ui.notifications.warn(game.i18n.localize("GSL.Notify.notRecording"));
  pending = true;
  try {
    await postGmLog(`■ 기록 종료 — ${state.name}`, {
      kind: "marker", action: "end", sessionId: state.sessionId, name: state.name
    });
    await game.settings.set(MODULE_ID, "recordingState", { active: false, lastSessionId: state.sessionId });
  } finally {
    pending = false;
  }

  const yes = await Dialog.confirm({
    title: game.i18n.localize("GSL.Dialog.exportNowTitle"),
    content: `<p>${game.i18n.localize("GSL.Dialog.exportNowContent")}</p>`,
    defaultYes: true
  });
  if (yes) exportFn?.({ sessionId: state.sessionId });
}

/* ---------------- 막대 ---------------- */

function barHtml() {
  const state = getSetting("recordingState") ?? {};
  const t = k => game.i18n.localize(k);
  if (state.active) {
    const elapsed = formatDuration(Date.now() - (state.startedAt ?? Date.now()));
    return `<button type="button" data-gsl="stop">${t("GSL.Bar.stop")}</button>
      <span class="gsl-status">${escapeHtml(state.name)} · <span class="gsl-elapsed">${elapsed}</span></span>
      <button type="button" data-gsl="export" title="${t("GSL.Bar.export")}">${t("GSL.Bar.export")}</button>`;
  }
  return `<button type="button" data-gsl="start">${t("GSL.Bar.start")}</button>
    <span class="gsl-status">${t("GSL.Bar.idle")}</span>
    <button type="button" data-gsl="export">${t("GSL.Bar.export")}</button>`;
}

function fillBar(bar) {
  bar.classList.toggle("recording", isRecording());
  bar.innerHTML = barHtml();
}

/** 모든 막대(채팅 탭, 떼어낸 채팅 창)를 새로 그린다. 플레이어 화면에는 막대가 없으므로 아무 일도 하지 않는다. */
export function refreshBars() {
  const bars = document.querySelectorAll(".gsl-bar");
  bars.forEach(fillBar);
  clearInterval(timer);
  timer = null;
  if (bars.length && isRecording()) {
    const startedAt = getSetting("recordingState")?.startedAt ?? Date.now();
    timer = setInterval(() => {
      const text = formatDuration(Date.now() - startedAt);
      document.querySelectorAll(".gsl-bar .gsl-elapsed").forEach(el => { el.textContent = text; });
    }, 1000);
  }
}

function onBarClick(event) {
  const btn = event.target.closest("button[data-gsl]");
  if (!btn || !game.user.isGM) return;
  event.preventDefault();
  const action = btn.dataset.gsl;
  if (action === "start") startRecording();
  else if (action === "stop") stopRecording();
  else if (action === "export") exportFn?.();
}

/** renderChatLog Hook. v12 ChatLog는 Application(v1)이라 html은 jQuery 객체다. */
export function injectBar(app, html) {
  if (!game.user?.isGM || !isEnabled()) return;
  const root = html?.[0] ?? html;
  if (!(root instanceof HTMLElement) || root.querySelector(":scope > .gsl-bar")) return;
  const bar = document.createElement("div");
  bar.className = "gsl-bar";
  bar.addEventListener("click", onBarClick);
  root.prepend(bar);
  refreshBars();
}

/* ---------------- 채팅 명령 ---------------- */

/** chatMessage Hook. false를 돌려주면 Foundry가 그 입력을 채팅으로 보내지 않는다. */
export function onChatCommand(chatLog, message) {
  if (!game.user?.isGM || !isEnabled()) return;
  const text = String(message ?? "").trim();
  let m;
  if ((m = text.match(/^\/기록시작(?:\s+(.+))?$/))) {
    startRecording(m[1]);
    return false;
  }
  if (/^\/기록종료\s*$/.test(text)) {
    stopRecording();
    return false;
  }
  if (/^\/기록추출\s*$/.test(text)) {
    exportFn?.();
    return false;
  }
}
