/**
 * 기능 3: 세션 기록 추출 (전체 흐름)
 * 범위 고르기 → 자료 번호 매기기 → 자료 받기 → md 만들기 → zip → GM 브라우저에서 내려받기
 * GM만 실행할 수 있다. 채팅·저널·장면·파일은 읽기만 한다.
 */

import { MODULE_ID, getSetting, moduleFlags, kstDate, kstTime, safeFileName, escapeHtml } from "../common.js";
import { planAssets, collectAssets } from "./assets.js";
import { buildRecords, renderSessionMd, renderAssetListMd, renderJson } from "./chat-format.js";
import { makeZip, downloadBlob } from "./zip.js";

let busy = false;

/* ---------------- 범위 ---------------- */

/** 기록 시작/종료 표시를 sessionId로 짝지은 목록 (최신 먼저) */
export function findSessions() {
  const map = new Map();
  const sorted = game.messages.contents.slice().sort((a, b) => a.timestamp - b.timestamp);
  for (const m of sorted) {
    const f = moduleFlags(m);
    if (f?.kind !== "marker" || !f.sessionId) continue;
    let s = map.get(f.sessionId);
    if (!s) map.set(f.sessionId, s = { sessionId: f.sessionId, name: f.name, start: null, end: null });
    if (f.action === "start" && !s.start) s.start = m;
    if (f.action === "end" && !s.end) s.end = m;
  }
  return [...map.values()].filter(s => s.start).sort((a, b) => b.start.timestamp - a.start.timestamp);
}

function sessionLabel(s) {
  const d = kstDate(s.start.timestamp).slice(5).replace("-", "/");
  const end = s.end ? kstTime(s.end.timestamp).slice(0, 5) : "진행 중";
  return `${s.name} · ${d} ${kstTime(s.start.timestamp).slice(0, 5)}~${end}`;
}

function pickSession(sessions) {
  const options = sessions.map((s, i) =>
    `<option value="${i}"${i === 0 ? " selected" : ""}>${escapeHtml(sessionLabel(s))}</option>`).join("");
  return new Promise(resolve => {
    new Dialog({
      title: game.i18n.localize("GSL.Dialog.pickTitle"),
      content: `<form class="gsl-dialog"><div class="form-group">
          <label>${game.i18n.localize("GSL.Dialog.pickLabel")}</label>
          <select name="session">${options}</select></div></form>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-file-archive"></i>',
          label: game.i18n.localize("GSL.Dialog.pickButton"),
          callback: html => resolve(sessions[Number(html.find("select[name=session]").val())] ?? null)
        },
        cancel: { label: game.i18n.localize("GSL.Dialog.cancel"), callback: () => resolve(null) }
      },
      default: "ok",
      close: () => resolve(null)
    }).render(true);
  });
}

/* ---------------- 진행 표시 (GM 화면에만 생김) ---------------- */

class ProgressBox {
  constructor(title) {
    this.el = document.createElement("div");
    this.el.className = "gsl-progress";
    this.el.innerHTML = `<div class="gsl-progress-title">${escapeHtml(title)}</div>
      <div class="gsl-progress-text"></div>
      <div class="gsl-progress-track"><div class="gsl-progress-fill"></div></div>`;
    document.body.appendChild(this.el);
  }
  set(text, ratio = null) {
    this.el.querySelector(".gsl-progress-text").textContent = text;
    if (ratio !== null) this.el.querySelector(".gsl-progress-fill").style.width = `${Math.round(ratio * 100)}%`;
  }
  finish(text, isError = false) {
    this.set(text, isError ? null : 1);
    this.el.classList.add(isError ? "error" : "done");
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "닫기";
    close.addEventListener("click", () => this.el.remove());
    this.el.appendChild(close);
    if (!isError) setTimeout(() => this.el.remove(), 15_000);
  }
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/* ---------------- 실행 ---------------- */

export async function runExport({ sessionId } = {}) {
  if (!game.user.isGM) return;
  if (busy) return ui.notifications.warn(game.i18n.localize("GSL.Notify.exportBusy"));

  const sessions = findSessions();
  if (!sessions.length) return ui.notifications.warn(game.i18n.localize("GSL.Notify.noSession"));
  let session = sessionId ? sessions.find(s => s.sessionId === sessionId) : null;
  if (!session) session = sessions.length === 1 ? sessions[0] : await pickSession(sessions);
  if (!session) return;

  busy = true;
  const progress = new ProgressBox(`세션 기록 추출: ${session.name}`);
  try {
    const exportedAt = Date.now();
    const startTs = session.start.timestamp;
    const endTs = session.end?.timestamp ?? exportedAt;
    const messages = game.messages.contents
      .filter(m => m.timestamp >= startTs && m.timestamp <= endTs)
      .sort((a, b) => a.timestamp - b.timestamp);

    progress.set(`채팅 정리 중… ${messages.length}줄`, 0);
    const plan = planAssets(messages);

    const files = await collectAssets(plan.entries, {
      imageMode: getSetting("imageMode"),
      onProgress: (i, n, name) => progress.set(`자료 수집 ${i} / ${n}: ${name}`, (i / n) * 0.8)
    });

    const records = buildRecords(messages, session, plan.byMessageId);
    const zipFiles = [
      { path: "세션기록.md", data: renderSessionMd(session, messages, records, exportedAt) },
      { path: "자료목록.md", data: renderAssetListMd(session, plan.entries) },
      ...files
    ];
    if (getSetting("includeJson")) {
      zipFiles.push({ path: "세션기록.json", data: renderJson(session, records, plan.entries, exportedAt) });
    }

    progress.set("zip 만드는 중…", 0.85);
    const blob = await makeZip(zipFiles, (i, n) => progress.set(`zip 만드는 중… ${i} / ${n}`, 0.85 + (i / n) * 0.15));
    const filename = `세션기록_${kstDate(startTs)}_${safeFileName(session.name)}.zip`;
    downloadBlob(blob, filename);

    const failed = plan.entries.reduce((n, e) => n + e.failures.length, 0);
    progress.finish(`완료: ${filename} (${formatSize(blob.size)}) · 메시지 ${records.length}줄 · 자료 ${plan.entries.length}개${failed ? ` · 받지 못한 파일 ${failed}개` : ""}`);
    ui.notifications.info(game.i18n.localize("GSL.Notify.exportDone"));
  } catch (err) {
    console.error(`${MODULE_ID} | 추출 실패`, err);
    progress.finish(`오류: ${err?.message ?? err}`, true);
    ui.notifications.error(game.i18n.localize("GSL.Notify.exportFail"));
  } finally {
    busy = false;
  }
}
