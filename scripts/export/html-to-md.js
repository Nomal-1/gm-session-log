/**
 * 저널 HTML → 마크다운 (간단한 변환기).
 * DOMParser로 읽기 때문에 이미지를 불러오거나 스크립트를 실행하지 않는다.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {(src: string) => string|null} [opts.mapImage]  이미지 경로를 zip 안 상대 경로로 바꾼다
 * @param {number} [opts.headingShift]                  제목 단계를 얼마나 내릴지 (페이지 제목이 ##이므로 기본 2)
 */
export function htmlToMarkdown(html, { mapImage = s => s, headingShift = 2 } = {}) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const md = blocks(doc.body, { mapImage, headingShift, listDepth: 0 });
  // 목록·표·제목 안의 줄바꿈 표시는 공백으로
  return cleanFoundrySyntax(md.replace(/\u0000/g, " ")).replace(/\n{3,}/g, "\n\n").trim();
}

/** @UUID[...]{이름} → 이름, 이름 없는 링크·@Embed는 지운다 */
function cleanFoundrySyntax(text) {
  return text
    .replace(/@(?:UUID|Compendium|Actor|Item|JournalEntry|Scene|RollTable|Macro)\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@(?:UUID|Compendium|Actor|Item|JournalEntry|Scene|RollTable|Macro)\[[^\]]*\]/g, "")
    .replace(/@Embed\[[^\]]*\](\{[^}]*\})?/g, "");
}

const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "FIGURE", "FIGCAPTION", "MAIN",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR", "TABLE", "DETAILS", "SUMMARY"
]);

function blocks(node, ctx) {
  let out = "";
  let inline = "";
  const flush = () => {
    const t = inline.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim().replace(/\u0000/g, "  \n");
    if (t) out += `${t}\n\n`;
    inline = "";
  };
  for (const child of node.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(child.tagName)) {
      flush();
      out += block(child, ctx);
    } else {
      inline += inlineMd(child, ctx);
    }
  }
  flush();
  return out;
}

function block(el, ctx) {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const level = Math.min(6, Number(tag[1]) + ctx.headingShift);
    return `${"#".repeat(level)} ${inlineChildren(el, ctx).trim()}\n\n`;
  }
  if (tag === "HR") return "---\n\n";
  if (tag === "PRE") return "```\n" + el.textContent.replace(/\n$/, "") + "\n```\n\n";
  if (tag === "BLOCKQUOTE") {
    const inner = blocks(el, ctx).trim();
    return inner.split("\n").map(l => `> ${l}`).join("\n") + "\n\n";
  }
  if (tag === "UL" || tag === "OL") return list(el, ctx) + "\n";
  if (tag === "TABLE") return table(el, ctx);
  return blocks(el, ctx);
}

function list(el, ctx) {
  const ordered = el.tagName === "OL";
  const indent = "  ".repeat(ctx.listDepth);
  let out = "";
  let n = 1;
  for (const li of el.children) {
    if (li.tagName !== "LI") continue;
    let text = "";
    let nested = "";
    for (const c of li.childNodes) {
      if (c.nodeType === Node.ELEMENT_NODE && (c.tagName === "UL" || c.tagName === "OL")) {
        nested += list(c, { ...ctx, listDepth: ctx.listDepth + 1 });
      } else if (c.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(c.tagName)) {
        text += " " + blocks(c, ctx).replace(/\n+/g, " ");
      } else {
        text += inlineMd(c, ctx);
      }
    }
    const marker = ordered ? `${n++}.` : "-";
    out += `${indent}${marker} ${text.replace(/\s+/g, " ").trim()}\n${nested}`;
  }
  return out;
}

function table(el, ctx) {
  const rows = Array.from(el.querySelectorAll("tr")).map(tr =>
    Array.from(tr.children).map(td => inlineChildren(td, ctx).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim())
  ).filter(r => r.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map(r => r.length));
  const pad = r => [...r, ...Array(width - r.length).fill("")];
  const lines = [`| ${pad(rows[0]).join(" | ")} |`, `|${" --- |".repeat(width)}`];
  for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
  return lines.join("\n") + "\n\n";
}

function inlineChildren(el, ctx) {
  let s = "";
  for (const c of el.childNodes) s += inlineMd(c, ctx);
  return s;
}

function wrap(mark, inner) {
  const t = inner.trim();
  return t ? `${mark}${t}${mark}` : "";
}

function inlineMd(node, ctx) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName;
  switch (tag) {
    // 줄바꿈 표시. 공백 정리가 끝난 뒤 마크다운 줄바꿈("  \n")으로 바뀐다.
    case "BR": return "\u0000";
    case "STRONG": case "B": return wrap("**", inlineChildren(node, ctx));
    case "EM": case "I": return wrap("*", inlineChildren(node, ctx));
    case "S": case "DEL": case "STRIKE": return wrap("~~", inlineChildren(node, ctx));
    case "CODE": return wrap("`", node.textContent);
    case "IMG": {
      const src = node.getAttribute("src");
      if (!src) return "";
      const mapped = ctx.mapImage(src);
      const alt = (node.getAttribute("alt") || "그림").replace(/[[\]]/g, "");
      return mapped ? `![${alt}](${mapped})` : `(그림 못 넣음: ${src})`;
    }
    case "A": {
      const text = inlineChildren(node, ctx).trim();
      const href = node.getAttribute("href");
      if (href && /^https?:\/\//.test(href)) return `[${text || href}](${href})`;
      return text;
    }
    case "SCRIPT": case "STYLE": return "";
    default:
      if (BLOCK_TAGS.has(tag)) return " " + blocks(node, ctx).replace(/\n+/g, " ") + " ";
      return inlineChildren(node, ctx);
  }
}

/** HTML 안의 이미지 경로 목록 (등장 순서, 중복 제거) */
export function collectImageSources(html) {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const seen = new Set();
  for (const img of doc.querySelectorAll("img[src]")) seen.add(img.getAttribute("src"));
  return [...seen];
}
