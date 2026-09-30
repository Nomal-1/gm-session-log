/**
 * GM 세션 기록 도우미 - 진입점
 * 기능 1(event-log) / 2(session-bar) / 3(export)은 서로 다른 파일에 있고, 여기서만 연결한다.
 * 플레이어 화면에서는 설정 등록 말고는 아무것도 하지 않는다.
 */

import { MODULE_ID, isEnabled } from "./common.js";
import { registerSettings } from "./settings.js";
import { initEventLog } from "./event-log.js";
import {
  injectBar, refreshBars, onChatCommand, setExportHandler, startRecording, stopRecording
} from "./session-bar.js";
import { runExport } from "./export/export.js";

Hooks.once("init", () => {
  registerSettings({ onRecordingStateChange: refreshBars });
  setExportHandler(runExport);

  // 두 Hook 모두 안에서 GM인지, 모듈이 켜져 있는지 확인한다.
  Hooks.on("renderChatLog", injectBar);
  Hooks.on("chatMessage", onChatCommand);
});

Hooks.once("ready", () => {
  if (!game.user.isGM || !isEnabled()) return;

  initEventLog();

  // 채팅 탭이 ready 전에 이미 그려졌을 수 있으므로 한 번 더 붙인다(중복은 막혀 있음).
  if (ui.chat?.element) injectBar(ui.chat, ui.chat.element);

  // 매크로에서 쓸 수 있게 (GM 전용 함수들)
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { startRecording, stopRecording, runExport };
});
