import { compressHistory, fitMessagesToBudget } from "@gugbab/utils";
import type { ChatMessage } from "@/lib/db/types";
import { OUTGOING_BUDGET_BYTES } from "@/lib/relay-limits";
import { MESSAGE_LIMITS } from "./limits";

/** /api/chat로 전송하는 메시지 — DB 전용 필드(summary)를 제거한 형태 */
export interface OutgoingMessage {
    role: ChatMessage["role"];
    content: string;
}

// 전송 이력 개수 상한 — API 상한(50)보다 낮게 잡아 여유를 둔다
const MAX_OUTGOING_COUNT = 30;
// 원문을 그대로 보존할 최근 왕복 수 — "방금 그 식단에서 점심만 바꿔줘"류 요청이 정확하려면 최근 맥락이 필요.
// 3왕복은 리팩터링 이전의 "최근 4개 메시지" 보호 범위를 항상 포함한다 (동작 회귀 방지)
const KEEP_RECENT_TURNS = 3;
const TRUNCATION_MARK = "\n…(이하 생략)";
const SUMMARY_PREFIX = "[이전 답변 요약] ";

function clampContent(content: string, max: number): string {
    if (content.length <= max) return content;
    // 절삭 마크보다 작은 상한이 들어오면 마크 없이 순수 절삭 (음수 slice 방지)
    if (max <= TRUNCATION_MARK.length) return content.slice(0, max);
    return content.slice(0, max - TRUNCATION_MARK.length) + TRUNCATION_MARK;
}

/**
 * 대화방 이력을 API 전송용으로 압축한다.
 * 바이트 계산·요약 교체·드롭 로직은 @gugbab/utils에 위임하고,
 * 앱은 정책 값(보존 왕복 수·개수·바이트 예산)만 결정한다.
 *
 * - 최근 {@link KEEP_RECENT_TURNS} 왕복은 원문 유지, 그보다 오래된 assistant 답변은
 *   요약이 있고 원문보다 작을 때만 요약으로 교체 (compressHistory)
 * - 글자 수는 앱 API 상한({@link MESSAGE_LIMITS}) 이내로 잘라냄
 * - 바이트·개수 예산 초과 시 오래된 왕복부터 드롭하고
 *   relay 규약(첫·마지막 메시지는 user)을 보장 (fitMessagesToBudget)
 */
export function toOutgoingMessages(messages: ChatMessage[]): OutgoingMessage[] {
    // 전송 불가 메시지 제거 — 빈 content는 API zod(min 1)가 요청 전체를 거부해
    // 방이 영구 전송 불가(브릭)가 되고, transient(에러 안내 버블)는 대화 이력이 아니다
    const sendable = messages.filter((m) => !m.transient && m.content.length > 0);
    const compressed = compressHistory(sendable, {
        getSummary: (msg) => (msg.summary ? SUMMARY_PREFIX + msg.summary : undefined),
        keepRecentTurns: KEEP_RECENT_TURNS,
    });
    const clamped: OutgoingMessage[] = compressed.map((msg) => ({
        role: msg.role,
        content: clampContent(msg.content, MESSAGE_LIMITS.maxContentLength),
    }));
    return fitMessagesToBudget(clamped, OUTGOING_BUDGET_BYTES, MAX_OUTGOING_COUNT);
}
