// relay 입력 상한 — 앱 로컬 상수.
// 값의 참조 소스는 relay 스펙 루트의 x-relay-limits (GET {RELAY_URL}/api/openapi.json).
// 동기화 파이프라인은 없다 — 값이 어긋나도 /api/chat의 400(history-budget) 재시도 경로가
// 런타임에 흡수한다. (확인일: 2026-08-14)

/** 메시지 1건 content 글자 수 상한 (x-relay-limits.maxMessageContentChars) */
export const MAX_MESSAGE_CONTENT_CHARS = 20_000;

/** messages 배열 개수 상한 (x-relay-limits.maxMessages) */
export const MAX_MESSAGES = 100;

/** messages content 합산 UTF-8 바이트 상한 (x-relay-limits.maxTotalContentBytes) */
export const MAX_TOTAL_CONTENT_BYTES = 100_000;

/** systemPrompt 글자 수 상한 (x-relay-limits.maxCustomPromptChars) */
export const MAX_CUSTOM_PROMPT_CHARS = 20_000;

/**
 * 앱이 실제 전송에 사용하는 합산 바이트 예산 — 상한 대비 10% 안전 마진.
 * 경계값 오차·상수 드리프트로 인한 400을 예방한다.
 */
export const OUTGOING_BUDGET_BYTES = 90_000;

/**
 * 400(history-budget) 재시도 시 유지할 최대 메시지 수 — 2왕복 + 현재 user 턴.
 * 바이트 절반 축소만으로는 짧은 메시지 다수(개수 상한 드리프트) 시나리오를
 * 복구하지 못하므로 개수도 함께 조인다.
 */
export const RETRY_MAX_MESSAGES = 5;
