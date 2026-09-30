/**
 * 던전월드 판정 읽기.
 *
 * 던전월드 시스템(1.8.2)은 무브 굴림 결과를 ChatMessage.rolls에 넣지 않고 본문 HTML에만 그린다.
 * 근거: github.com/asacolips-projects/dungeonworld @1.8.2
 *   - src/module/rolls.js 171~375행: chatData에 rolls 없음, content만 넣어 ChatMessage.create
 *   - src/templates/chat/chat-move.html 2행: .dw.chat-card[data-roll-total], 5행: .cell__title(무브 이름),
 *     11행~: .row.result.{success|partial|failure}
 *   - src/module/config.js 23~36행: failure ≤6, partial 7~9, success ≥10
 */

export const BAND = {
  success: "10+ 성공",
  partial: "7-9 부분 성공",
  failure: "6- 실패"
};

/** 합계로 구간 계산 (일반 /r 굴림용, 시스템과 같은 기준) */
export function bandFromTotal(total) {
  const n = Number(total);
  if (!Number.isFinite(n)) return null;
  if (n >= 10) return BAND.success;
  if (n >= 7) return BAND.partial;
  return BAND.failure;
}

/**
 * @returns {null | {move: string, formula: string|null, total: string|null, result: string|null, band: string|null}}
 */
export function parseDwCard(html) {
  if (!html || !html.includes("chat-card")) return null;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const card = doc.querySelector(".dw.chat-card");
  if (!card) return null;

  const move = card.querySelector(".cell__title")?.textContent?.trim() ?? "";
  const total = card.dataset.rollTotal ?? card.querySelector(".dice-total")?.textContent?.trim() ?? null;
  const formula = card.querySelector(".dice-formula")?.textContent?.trim() ?? null;

  const resultEl = card.querySelector(".row.result");
  let result = null;
  if (resultEl) result = ["success", "partial", "failure"].find(c => resultEl.classList.contains(c)) ?? null;

  return { move, formula, total, result, band: result ? BAND[result] : null };
}

/** 한 줄 설명 */
export function describeDwCard(card) {
  const name = card.move || "무브";
  if (card.total == null) return `무브 사용: ${name}`;
  const expr = card.formula ? `${card.formula} = ${card.total}` : `합계 ${card.total}`;
  return card.band ? `${name}: ${expr} → ${card.band}` : `${name}: ${expr}`;
}

/** 일반 굴림(message.rolls) 설명. 식에 2d6(또는 3d6k 유리/불리)이 있으면 구간을 붙인다. */
export function describeRolls(rolls) {
  return rolls.map(r => {
    const formula = r.formula ?? "";
    const total = r.total;
    const band = /2d6|3d6k[hl]2/i.test(formula.replace(/\s+/g, "")) ? bandFromTotal(total) : null;
    return band ? `${formula} = ${total} → ${band}` : `${formula} = ${total}`;
  }).join(" / ");
}

/**
 * 본문 HTML에 그려진 Foundry 주사위 결과(.dice-roll 안의 .dice-formula, .dice-total)를 읽는다.
 * message.rolls가 비어 있는데 본문에 주사위 결과가 있는 경우에 쓴다. (v0.1.0 테스트: /r 굴림이 "채팅"으로 분류됨)
 * @returns {{formula: string, total: string}[]}
 */
export function parseDiceHtml(html) {
  if (!html || !html.includes("dice-")) return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = [];
  for (const roll of doc.querySelectorAll(".dice-roll")) {
    const formula = roll.querySelector(".dice-formula")?.textContent?.trim();
    const total = roll.querySelector(".dice-total")?.textContent?.trim();
    if (formula && total) out.push({ formula, total });
  }
  return out;
}
