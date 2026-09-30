/**
 * 저널을 보여준 "그 순간" 플레이어가 볼 수 있던 모습만 추려 낸다.
 *
 * - 공개(revealed) 처리된 비밀 블록: 남긴다.
 * - 공개되지 않은 비밀 블록: 여기서 지우고 개수만 센다.
 *   (Foundry v12 문서 EnrichmentOptions.secrets: "unrevealed secret blocks will be removed")
 * - 권한 변경 기록일 때만: 대상 플레이어 중 아무도 OBSERVER 권한이 없는 페이지는 넣지 않고 개수만 센다.
 *   ("Show Players"는 권한과 관계없이 보여주므로 거르지 않는다 — v0.1.0 테스트 결과)
 *
 * 결과는 GM 귓속말의 flags에 저장되므로, 공개되지 않은 내용은 애초에 저장되지 않는다.
 * 원본 저널은 읽기만 한다.
 */

const OBSERVER = "OBSERVER";

/** 공개되지 않은 비밀 블록을 지운 HTML과 개수 */
export function stripUnrevealedSecrets(html) {
  if (!html) return { html: "", hidden: 0, revealed: 0 };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let hidden = 0;
  let revealed = 0;
  // 바깥쪽부터 처리. 지워진 블록 안의 비밀 블록은 함께 사라진다.
  for (const el of Array.from(doc.body.querySelectorAll("section.secret"))) {
    if (!el.isConnected) continue;
    if (el.classList.contains("revealed")) revealed++;
    else {
      hidden++;
      el.remove();
    }
  }
  return { html: doc.body.innerHTML, hidden, revealed };
}

/**
 * 실제 권한 단계(0 없음, 1 제한, 2 관찰자, 3 소유자). "상위 따름"(-1)이면 상위 저널을 따라간다.
 */
export function effectiveLevel(doc, user) {
  const INHERIT = CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT ?? -1;
  const own = doc.ownership ?? {};
  const level = own[user.id] ?? own.default ?? 0;
  if (level === INHERIT && doc.parent) return effectiveLevel(doc.parent, user);
  return level;
}

/**
 * 이 사용자가 문서를 볼 수 있는가.
 * 페이지 권한이 "상위 저널 권한 따름"(INHERIT, -1)이면 저널 권한으로 판단한다.
 */
export function canObserve(doc, user) {
  try {
    const INHERIT = CONST.DOCUMENT_OWNERSHIP_LEVELS.INHERIT ?? -1;
    const own = doc.ownership ?? {};
    const level = own[user.id] ?? own.default;
    if (doc.documentName === "JournalEntryPage" && level === INHERIT && doc.parent) {
      return doc.parent.testUserPermission(user, OBSERVER);
    }
    return doc.testUserPermission(user, OBSERVER);
  } catch (err) {
    console.warn("gm-session-log | 권한 확인 실패", err);
    return false;
  }
}

/** 대상 플레이어 중 한 명이라도 볼 수 있는가 */
export function canAnyObserve(doc, users) {
  return users.some(u => canObserve(doc, u));
}

/** 페이지 하나를 저장용 데이터로 */
function pageData(page) {
  const base = { id: page.id, name: page.name, type: page.type, showTitle: page.title?.show ?? true };
  if (page.type === "text") {
    const { html, hidden, revealed } = stripUnrevealedSecrets(page.text?.content ?? "");
    return { ...base, html, secretsHidden: hidden, secretsRevealed: revealed };
  }
  if (page.type === "image") return { ...base, src: page.src ?? null, caption: page.image?.caption ?? "" };
  if (page.type === "video" || page.type === "pdf") return { ...base, src: page.src ?? null };
  return { ...base, unsupported: true };
}

/**
 * @param {JournalEntry|JournalEntryPage} doc  보여준 문서
 * @param {User[]} users                        공개 대상 플레이어
 * @param {object} [opts]
 * @param {Set<string>} [opts.onlyPageIds]       이 페이지들만 대상(권한 변경 시)
 * @param {boolean} [opts.filterByPermission]    권한 없는 페이지를 뺄지. "Show Players"는 권한과 무관하게
 *                                               보여주므로 false, 권한 변경 기록은 true.
 */
export function snapshotJournal(doc, users, { onlyPageIds, filterByPermission = true } = {}) {
  const isPage = doc.documentName === "JournalEntryPage";
  const entry = isPage ? doc.parent : doc;
  let candidates = isPage ? [doc] : entry.pages.contents.slice().sort((a, b) => a.sort - b.sort);
  if (onlyPageIds) candidates = candidates.filter(p => onlyPageIds.has(p.id));

  const pages = [];
  let pagesExcluded = 0;
  for (const page of candidates) {
    if (filterByPermission && !canAnyObserve(page, users)) {
      pagesExcluded++;
      continue;
    }
    pages.push(pageData(page));
  }
  const secretsHidden = pages.reduce((n, p) => n + (p.secretsHidden ?? 0), 0);
  return {
    entryUuid: entry.uuid,
    entryName: entry.name,
    pageName: isPage ? doc.name : null,
    pages,
    pagesExcluded,
    secretsHidden
  };
}

/** 페이지별로 볼 수 있는 플레이어 id 목록: { pageId: Set<userId> } */
export function pageVisibilityMap(entry, users) {
  const map = new Map();
  for (const page of entry.pages) {
    const set = new Set();
    for (const u of users) if (canObserve(page, u)) set.add(u.id);
    map.set(page.id, set);
  }
  return map;
}
