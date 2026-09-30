import { MODULE_ID } from "./common.js";

/**
 * 월드 설정 등록. 월드 설정은 GM만 바꿀 수 있다.
 * recordingState는 설정 창에 보이지 않는 저장용 항목(기록 중 상태를 새로고침 후에도 유지).
 */
export function registerSettings({ onRecordingStateChange } = {}) {
  const bool = (key, def, requiresReload = false) =>
    game.settings.register(MODULE_ID, key, {
      name: `GSL.Setting.${key}.name`,
      hint: `GSL.Setting.${key}.hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: def,
      requiresReload
    });

  bool("enabled", true, true);
  bool("logScene", true);
  bool("logImage", true);
  bool("logJournalShow", true);
  bool("logJournalPerm", true);
  bool("logToken", true);
  bool("onlyWhileRecording", true);

  game.settings.register(MODULE_ID, "imageMode", {
    name: "GSL.Setting.imageMode.name",
    hint: "GSL.Setting.imageMode.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      resize: "GSL.Setting.imageMode.resize",
      original: "GSL.Setting.imageMode.original"
    },
    default: "resize"
  });

  bool("includeJson", false);

  game.settings.register(MODULE_ID, "recordingState", {
    scope: "world",
    config: false,
    type: Object,
    default: { active: false },
    onChange: () => onRecordingStateChange?.()
  });
}
