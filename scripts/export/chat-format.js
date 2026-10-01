/**
 * 채팅 메시지 → 세션기록.md / 자료목록.md / 세션기록.json
 * 채팅 메시지는 읽기만 한다.
 */

import {
  moduleFlags, kstTime, kstDate, kstWeekday, formatDuration, formatDurationKo, htmlToText
} from "../common.js";
import { parseDwCard, describeDwCard, describeRolls, parseDiceHtml } from "./dw-roll.js";

function authorOf(m) {
  return m.author ?? m.user ?? null;
}

function whoOf(m, f) {
  const author = authorOf(m);
  const authorName = author?.name ?? "?";
  if (f) return "GM";
  const speaker = m.speaker?.alias || (m.speaker?.actor && game.actors.get(m.speaker.actor)?.name) || "";
  if (author?.isGM && (!speaker || speaker === authorName)) return `GM(${authorName})`;
  if (speaker && speaker !== authorName) return `${speaker}(${authorName})`;
  return authorName;
}

function mdEscape(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * 메시지 하나를 정리한 기록
 */
export function buildRecords(messages, session, assetByMessageId) {
  const startTs = session.start.timestamp;
  return messages.map(m => {
    const f = moduleFlags(m);
    let kind;
    let text;
    let dw = null;
    let link = null;

    let htmlDice;
    if (f?.kind === "marker") {
      kind = f.action === "start" ? "기록 시작" : "기록 종료";
      text = f.name;
    } else if (f?.kind === "event") {
      kind = "화면 사건";
      text = f.label;
      const a = assetByMessageId.get(m.id);
      if (a?.mainPath) link = `[자료 ${a.no}](${a.mainPath})`;
      else if (a) link = `(자료 ${a.no}: 받지 못함)`;
    } else if ((dw = parseDwCard(m.content))) {
      kind = "다이스";
      text = describeDwCard(dw);
    } else if (m.rolls?.length) {
      kind = "다이스";
      const rolls = describeRolls(m.rolls);
      const flavor = htmlToText(m.flavor);
      text = flavor ? `${flavor}: ${rolls}` : rolls;
    } else if ((htmlDice = parseDiceHtml(m.content)).length) {
      kind = "다이스";
      const rolls = describeRolls(htmlDice);
      const flavor = htmlToText(m.flavor);
      text = flavor ? `${flavor}: ${rolls}` : rolls;
    } else {
      kind = "채팅";
      text = htmlToText(m.content) || htmlToText(m.flavor);
    }

    // 귓속말 표시 (모듈 자신의 GM 기록은 제외)
    let whisperTo = [];
    if (!f && m.whisper?.length) {
      whisperTo = m.whisper.map(id => game.users.get(id)?.name ?? "?");
      const to = `귓속말 → ${whisperTo.join(", ")}`;
      kind = kind === "채팅" ? to : `${kind}(${to})`;
    }
    if (m.blind) kind += "(블라인드)";

    return {
      id: m.id,
      timestamp: m.timestamp,
      time: kstTime(m.timestamp),
      elapsed: formatDuration(m.timestamp - startTs),
      who: whoOf(m, f),
      author: authorOf(m)?.name ?? null,
      kind,
      whisperTo,
      text: text || "(내용 없음)",
      link,
      dw,
      moduleFlags: f ?? undefined
    };
  });
}

function participants(messages) {
  const seen = new Map();
  for (const m of messages) {
    const u = authorOf(m);
    if (!u || seen.has(u.id)) continue;
    seen.set(u.id, u.isGM ? `GM(${u.name})` : `${u.character?.name ?? "캐릭터 없음"}(${u.name})`);
  }
  return [...seen.values()];
}

export function renderSessionMd(session, messages, records, exportedAt) {
  const start = session.start.timestamp;
  const end = session.end?.timestamp ?? null;
  let endText;
  if (end) {
    endText = `${kstTime(end)} (${formatDurationKo(end - start)})`;
  } else if (session.inProgress) {
    endText = `추출 시점 ${kstTime(exportedAt)}까지 (${formatDurationKo(exportedAt - start)}, 아직 기록 중)`;
  } else if (session.rangeEnd) {
    endText = `${kstTime(session.rangeEnd)}까지 (${formatDurationKo(session.rangeEnd - start)}, 종료 표시 없음 — 다음 기록 시작 직전까지 담음)`;
  } else {
    endText = `추출 시점 ${kstTime(exportedAt)}까지 (${formatDurationKo(exportedAt - start)}, 종료 표시 없음)`;
  }

  const lines = [
    `# 세션 기록: ${session.name}`,
    "",
    `- 날짜: ${kstDate(start)} (${kstWeekday(start)})`,
    `- 기록: ${kstTime(start)} ~ ${endText}`,
    `- 참가자: ${participants(messages).join(" / ") || "-"}`,
    `- 줄 수: ${records.length}`,
    `- 줄 형식: [한국 시각] (+기록 시작 후 지난 시간) 말한 사람(사용자) · 종류 — 내용`,
    `- 판정 구간: 10+ 성공 / 7-9 부분 성공 / 6- 실패 (던전월드 기준)`,
    "",
    "## 기록",
    ""
  ];
  for (const r of records) {
    lines.push(`- [${r.time}] (+${r.elapsed}) ${r.who} · ${r.kind} — ${r.text}${r.link ? ` ${r.link}` : ""}`);
  }
  return lines.join("\n") + "\n";
}

export function renderAssetListMd(session, entries) {
  const lines = [
    `# 자료 목록: ${session.name}`,
    "",
    "플레이어에게 보여준 자료입니다. 같은 자료를 여러 번 보여줬으면 파일은 하나이고, 보여준 시각을 모두 적었습니다.",
    "",
    "| 번호 | 종류 | 이름 | 공개 대상 | 보여준 시각 | 파일 |",
    "|---|---|---|---|---|---|"
  ];
  if (!entries.length) lines.push("| - | - | (보여준 자료 없음) | - | - | - |");
  for (const e of entries) {
    const files = [];
    if (e.mainPath) files.push(`[보기](${e.mainPath})`);
    for (const x of e.extraPaths) files.push(`[${x.label}](${x.path})`);
    for (const src of e.failures) files.push(`받지 못함: ${mdEscape(src)}`);
    if (e.notes.length) files.push(e.notes.join(", "));
    lines.push(`| ${e.no} | ${e.kind} | ${mdEscape(e.name)} | ${mdEscape([...e.targets].join(", "))} | ${e.times.map(kstTime).join(", ")} | ${files.join(" · ") || "-"} |`);
  }
  return lines.join("\n") + "\n";
}

export function renderJson(session, records, entries, exportedAt) {
  return JSON.stringify({
    session: {
      name: session.name,
      sessionId: session.sessionId,
      start: session.start.timestamp,
      end: session.end?.timestamp ?? null,
      exportedAt
    },
    messages: records.map(r => {
      const { moduleFlags: mf, ...rest } = r;
      // 저널 공개분 HTML은 .md 파일로 따로 들어가므로 JSON에는 뺀다
      if (mf) rest.event = { ...mf, journal: mf.journal ? { entryName: mf.journal.entryName, pages: mf.journal.pages.length } : undefined };
      return rest;
    }),
    assets: entries.map(e => ({
      no: e.no, kind: e.kind, name: e.name, targets: [...e.targets],
      shownAt: e.times, file: e.mainPath, extra: e.extraPaths, failures: e.failures
    }))
  }, null, 2);
}

