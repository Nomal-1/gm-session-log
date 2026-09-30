/**
 * 저널을 보여준 "그 순간" 플레이어가 볼 수 있던 모습만 추려 낸다.
 *
 * - 공개(revealed) 처리된 비밀 블록: 남긴다.
 * - 공개되지 않은 비밀 블록: 여기서 지우고 개수만 센다.
 *   (Foundry v12 문서 EnrichmentOptions.secrets: "unrevealed secret blocks will be removed")
 * - 대상 플레이어 중 아무도 OBSERVER 권한이 없는 페이지: 넣지 않고 개수만 센다.
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

/** 대상 플레이어 중 한 명이라도 볼 수 있는가 */
export function canAnyObserve(doc, users) {
  return users.some(u => {
    try {
      return doc.testUserPermission(u, OBSERVER);
    } catch (err) {
      console.warn("gm-session-log | 권한 확인 실패", err);
      return false;
    }
  });
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
 */
export function snapshotJournal(doc, users, { onlyPageIds } = {}) {
  const isPage = doc.documentName === "JournalEntryPage";
  const entry = isPage ? doc.parent : doc;
  let candidates = isPage ? [doc] : entry.pages.contents.slice().sort((a, b) => a.sort - b.sort);
  if (onlyPageIds) candidates = candidates.filter(p => onlyPageIds.has(p.id));

  const pages = [];
  let pagesExcluded = 0;
  for (const page of candidates) {
    // 🧪 강제로 보여주기(force)일 때 권한 없는 페이지도 보이는지는 확인 전이다.
    //    확인 전까지는 권한이 있는 페이지만 넣는다.
    if (!canAnyObserve(page, users)) {
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
    for (const u of users) {
      try {
        if (page.testUserPermission(u, OBSERVER)) set.add(u.id);
      } catch { /* 무시 */ }
    }
    map.set(page.id, set);
  }
  return map;
}
