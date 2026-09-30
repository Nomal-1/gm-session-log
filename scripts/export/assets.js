/**
 * 자료 수집: 화면 사건 메시지의 꼬리표(flags)를 보고, 플레이어가 실제로 본 자료를 파일로 모은다.
 * - 같은 자료는 한 번만 넣고, 보여준 시각은 모두 모은다.
 * - 저널은 "보여준 순간" 꼬리표에 저장된 공개분만 쓴다. 공개되지 않은 비밀 블록은 꼬리표에 없다.
 * - 파일은 GET으로 읽기만 한다. 서버에 쓰거나 외부로 보내지 않는다.
 */

import { moduleFlags, safeFileName, kstTime, targetLabel } from "../common.js";
import { htmlToMarkdown, collectImageSources } from "./html-to-md.js";

const KIND = { scene: "장면", image: "이미지", token: "토큰", "journal-show": "저널", "journal-perm": "저널" };
const RESIZABLE = new Set(["png", "jpg", "jpeg", "webp", "bmp", "avif"]);
const MAX_SIDE = 1600;

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function assetKey(f) {
  if (f.type === "scene" || f.type === "image") return f.img ? `${f.type}:${f.img}` : null;
  if (f.type === "token") return f.img ? `token:${f.img}|${f.portrait ?? ""}` : null;
  if (f.type === "journal-show" || f.type === "journal-perm") {
    const j = f.journal;
    if (!j) return null;
    return `journal:${j.entryUuid}:${hash(JSON.stringify(j.pages))}`;
  }
  return null;
}

/**
 * 1단계: 번호 매기기 (파일은 아직 받지 않음)
 * @returns {{entries: object[], byMessageId: Map<string, object>}}
 */
export function planAssets(messages) {
  const byKey = new Map();
  const byMessageId = new Map();
  const entries = [];
  for (const m of messages) {
    const f = moduleFlags(m);
    if (f?.kind !== "event") continue;
    const key = assetKey(f);
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        no: String(entries.length + 1).padStart(3, "0"),
        kind: KIND[f.type] ?? "자료",
        name: f.title ?? "이름없음",
        data: f,
        targets: new Set(),
        times: [],
        mainPath: null,
        extraPaths: [],
        failures: [],
        notes: []
      };
      byKey.set(key, entry);
      entries.push(entry);
    }
    entry.targets.add(targetLabel(f.targets, { suffix: "" }));
    entry.times.push(m.timestamp);
    byMessageId.set(m.id, entry);
  }
  return { entries, byMessageId };
}

/* ---------------- 파일 받기 ---------------- */

function extOf(src) {
  const clean = String(src).split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "bin";
}

/** 긴 변 1600px 이하로 줄여 webp로. keepSmallWebp면 이미 작은 webp는 null을 돌려 원본을 쓰게 한다. */
async function resizeToWebp(blob, { keepSmallWebp = false } = {}) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (keepSmallWebp && scale === 1) return null;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    const out = await new Promise(res => canvas.toBlob(res, "image/webp", 0.85));
    if (!out) throw new Error("이미지 변환 실패");
    // webp로 저장하지 못하는 브라우저는 png를 돌려준다
    const ext = out.type === "image/webp" ? "webp" : "png";
    return { bytes: new Uint8Array(await out.arrayBuffer()), ext };
  } finally {
    bitmap.close?.();
  }
}

/** 다른 사이트의 파일인가 */
function isExternal(src) {
  try {
    return new URL(src, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** 같은 추출 안에서 같은 경로를 두 번 받지 않도록 기억해 둔다. */
function makeFetcher(imageMode) {
  const cache = new Map();
  return src => {
    if (!cache.has(src)) cache.set(src, fetchMedia(src, imageMode));
    return cache.get(src);
  };
}

async function fetchMedia(src, imageMode) {
  // 읽기(GET)만 한다. 다른 사이트 파일은 쿠키와 출처 주소(referrer)를 보내지 않는다.
  const res = await fetch(src, isExternal(src)
    ? { method: "GET", credentials: "omit", referrerPolicy: "no-referrer" }
    : { method: "GET", credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = extOf(src);
  if (imageMode === "resize" && RESIZABLE.has(ext)) {
    try {
      // 이미 작은 webp는 다시 압축하지 않고 원본 그대로
      const resized = await resizeToWebp(blob, { keepSmallWebp: ext === "webp" });
      if (resized) return resized;
    } catch (err) {
      console.warn("gm-session-log | 이미지 축소 실패, 원본으로 넣음", src, err);
    }
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext };
}

/* ---------------- 2단계: 파일 만들기 ---------------- */

/**
 * @returns {Promise<{path: string, data: Uint8Array|string}[]>}
 */
export async function collectAssets(entries, { imageMode = "resize", onProgress } = {}) {
  const get = makeFetcher(imageMode);
  const files = [];

  const add = async (entry, src, baseName) => {
    try {
      const { bytes, ext } = await get(src);
      const path = `자료/${baseName}.${ext}`;
      files.push({ path, data: bytes });
      return path;
    } catch (err) {
      console.warn("gm-session-log | 자료 받기 실패", src, err);
      entry.failures.push(src);
      return null;
    }
  };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    onProgress?.(i + 1, entries.length, e.name);
    const f = e.data;
    const name = safeFileName(e.name);

    if (f.type === "scene" || f.type === "image") {
      e.mainPath = await add(e, f.img, `${e.no}_${e.kind}_${name}`);
    } else if (f.type === "token") {
      e.mainPath = await add(e, f.img, `${e.no}_토큰_${name}`);
      if (f.portrait) {
        const p = await add(e, f.portrait, `${e.no}_초상화_${name}`);
        // 초상화는 플레이어가 토큰만 보고 초상화는 못 봤을 수 있어 "참고"로 표시한다
        if (p) e.extraPaths.push({ label: "초상화(참고)", path: p });
      }
    } else if (f.journal) {
      const base = `${e.no}_저널_${name}`;
      const md = await buildJournalMd(e, base, add);
      e.mainPath = `자료/${base}.md`;
      files.push({ path: e.mainPath, data: md });
    }
  }
  return files;
}

async function buildJournalMd(entry, base, add) {
  const j = entry.data.journal;
  let n = 0;
  const srcMap = new Map();
  const fileFor = async (src, label = "그림") => {
    if (srcMap.has(src)) return srcMap.get(src);
    n++;
    const p = await add(entry, src, `${base}_${label}${n}`);
    // .md 파일도 자료/ 폴더 안에 있으므로 파일 이름만 쓰면 된다
    const rel = p ? p.replace(/^자료\//, "") : null;
    srcMap.set(src, rel);
    return rel;
  };

  const lines = [`# ${entry.name}`, ""];
  lines.push(`> 공개 대상: ${[...entry.targets].join(", ")} · 보여준 시각: ${entry.times.map(kstTime).join(", ")}`);
  const excluded = [];
  if (j.secretsHidden) excluded.push(`비밀 블록 ${j.secretsHidden}개 제외`);
  if (j.pagesExcluded) excluded.push(`권한 없는 페이지 ${j.pagesExcluded}개 제외`);
  if (excluded.length) lines.push(`> ${excluded.join(" · ")}`);
  lines.push("");

  if (!j.pages.length) {
    lines.push("(대상 플레이어가 볼 수 있는 페이지가 없었습니다.)");
    entry.notes.push("공개된 페이지 없음");
  }

  for (const page of j.pages) {
    lines.push(`## ${page.name}`, "");
    if (page.type === "text") {
      for (const src of collectImageSources(page.html)) await fileFor(src);
      lines.push(htmlToMarkdown(page.html, { mapImage: src => srcMap.get(src) ?? null }), "");
    } else if (page.type === "image" && page.src) {
      const rel = await fileFor(page.src);
      lines.push(rel ? `![${page.caption || page.name}](${rel})` : `(그림 못 넣음: ${page.src})`, "");
      if (page.caption) lines.push(page.caption, "");
    } else if ((page.type === "video" || page.type === "pdf") && page.src) {
      const rel = await fileFor(page.src, "첨부");
      lines.push(rel ? `[${page.name}](${rel})` : `(첨부 못 넣음: ${page.src})`, "");
    } else {
      lines.push(`(${page.type} 형식 페이지는 내용을 옮기지 않았습니다.)`, "");
    }
  }
  const imgCount = [...srcMap.values()].filter(Boolean).length;
  if (imgCount) entry.notes.push(`그림·첨부 ${imgCount}개`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
