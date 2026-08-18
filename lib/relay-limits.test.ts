import { describe, expect, it } from "vitest";
import { MESSAGE_LIMITS } from "@/lib/ai/limits";
import {
    MAX_MESSAGE_CONTENT_CHARS,
    MAX_MESSAGES,
    MAX_TOTAL_CONTENT_BYTES,
    OUTGOING_BUDGET_BYTES,
    RETRY_MAX_MESSAGES,
} from "./relay-limits";

describe("relay-limits", () => {
    it("앱 자체 상한(MESSAGE_LIMITS)은 relay 상한보다 엄격하다 — 앱을 통과한 요청이 relay 개별 상한에 걸리지 않아야 한다", () => {
        expect(MESSAGE_LIMITS.maxContentLength).toBeLessThanOrEqual(MAX_MESSAGE_CONTENT_CHARS);
        expect(MESSAGE_LIMITS.maxCount).toBeLessThanOrEqual(MAX_MESSAGES);
    });

    it("메시지 1건 원문(한글 최악 3바이트)이 전송 예산 안에 들어간다 — 마지막 user 턴은 드롭 불가이므로 필수 조건", () => {
        expect(MESSAGE_LIMITS.maxContentLength * 3).toBeLessThanOrEqual(OUTGOING_BUDGET_BYTES);
    });

    it("전송 예산은 relay 상한보다 작다 — 안전 마진 확보", () => {
        expect(OUTGOING_BUDGET_BYTES).toBeLessThan(MAX_TOTAL_CONTENT_BYTES);
    });

    it("재시도 최대 메시지 수는 앱 개수 상한보다 훨씬 작다 (최근 왕복만 유지)", () => {
        expect(RETRY_MAX_MESSAGES).toBeLessThan(MESSAGE_LIMITS.maxCount);
    });
});
