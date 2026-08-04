import type { ChatMessage } from "@/lib/db/types";
import { MESSAGE_LIMITS } from "./limits";

/** /api/chat로 전송하는 메시지 — DB 전용 필드(summary)를 제거한 형태 */
export interface OutgoingMessage {
    role: ChatMessage["role"];
    content: string;
}

// 전송 이력 상한 — API 상한(50)보다 낮게 잡아 여유를 둔다
const MAX_OUTGOING_COUNT = 30;
// 직전 턴들은 원문 유지 — "방금 그 식단에서 점심만 바꿔줘"류 요청이 정확하려면 최근 맥락이 필요
const RECENT_FULL_COUNT = 4;
// 요약이 없는 오래된 답변의 잘라내기 길이
const OLD_CONTENT_MAX = 1000;
const TRUNCATION_MARK = "\n…(이하 생략)";
const SUMMARY_PREFIX = "[이전 답변 요약] ";

function clampContent(content: string, max: number): string {
    if (content.length <= max) return content;
    return content.slice(0, max - TRUNCATION_MARK.length) + TRUNCATION_MARK;
}

/**
 * 대화방 이력을 API 전송용으로 압축한다.
 *
 * - 최근 {@link RECENT_FULL_COUNT}개 메시지는 원문 유지 (상한 내로만 잘라냄)
 * - 그보다 오래된 assistant 답변은 요약이 있으면 요약으로 대체, 없으면 앞부분만 남김
 * - 개수·글자수는 항상 {@link MESSAGE_LIMITS} 이내를 보장한다
 * - relay 규약(첫 메시지는 user)을 위해 잘라낸 뒤 선두의 assistant 메시지는 제거
 */
export function toOutgoingMessages(messages: ChatMessage[]): OutgoingMessage[] {
    const sliced = messages.slice(-MAX_OUTGOING_COUNT);
    const firstUserIdx = sliced.findIndex((m) => m.role === "user");
    const window = firstUserIdx > 0 ? sliced.slice(firstUserIdx) : sliced;

    const recentStart = window.length - RECENT_FULL_COUNT;
    return window.map((msg, i) => {
        if (i >= recentStart) {
            return { role: msg.role, content: clampContent(msg.content, MESSAGE_LIMITS.maxContentLength) };
        }
        if (msg.role === "assistant" && msg.summary) {
            return {
                role: msg.role,
                content: clampContent(SUMMARY_PREFIX + msg.summary, MESSAGE_LIMITS.maxContentLength),
            };
        }
        return { role: msg.role, content: clampContent(msg.content, OLD_CONTENT_MAX) };
    });
}
