import { totalContentBytes } from "@gugbab/utils";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/db/types";
import { OUTGOING_BUDGET_BYTES } from "@/lib/relay-limits";
import { toOutgoingMessages } from "./history";
import { MESSAGE_LIMITS } from "./limits";

function turns(count: number, contentFor?: (i: number) => string): ChatMessage[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: contentFor?.(i) ?? `메시지 ${i}`,
    }));
}

describe("toOutgoingMessages", () => {
    it("짧은 이력은 원문 그대로 전달한다", () => {
        const messages = turns(5);
        expect(toOutgoingMessages(messages)).toEqual(messages.map(({ role, content }) => ({ role, content })));
    });

    it("출력 메시지에서 summary 필드를 제거한다", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "식단 짜줘" },
            { role: "assistant", content: "식단입니다", summary: "요약" },
            { role: "user", content: "고마워" },
        ];
        for (const out of toOutgoingMessages(messages)) {
            expect(out).not.toHaveProperty("summary");
        }
    });

    it("오래된 assistant 답변은 요약으로 대체한다", () => {
        const long = "가".repeat(5000);
        const messages: ChatMessage[] = [
            { role: "user", content: "일주일 식단 짜줘" },
            { role: "assistant", content: long, summary: "일주일 저녁 식단 제안" },
            ...turns(7), // 요약 대상이 최근 보존 왕복 밖으로 밀려나도록 (user로 끝나는 이력)
        ];
        const out = toOutgoingMessages(messages);
        expect(out[1].content).toBe("[이전 답변 요약] 일주일 저녁 식단 제안");
    });

    it("요약이 없는 오래된 답변은 원문을 유지하되 글자 상한으로 잘라낸다", () => {
        const long = "가".repeat(5000);
        const messages: ChatMessage[] = [
            { role: "user", content: "일주일 식단 짜줘" },
            { role: "assistant", content: long },
            ...turns(7),
        ];
        const out = toOutgoingMessages(messages);
        expect(out[1].content.length).toBeLessThanOrEqual(MESSAGE_LIMITS.maxContentLength);
        expect(out[1].content).toContain("…(이하 생략)");
    });

    it("요약이 원문보다 길면 원문을 유지한다 (교체 이득 없음)", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "식단 짜줘" },
            { role: "assistant", content: "네", summary: "짧은 답변에 대한 훨씬 긴 요약 문장" },
            ...turns(7),
        ];
        const out = toOutgoingMessages(messages);
        expect(out[1].content).toBe("네");
    });

    it("최근 메시지는 요약이 있어도 원문을 유지한다", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "식단 짜줘" },
            { role: "assistant", content: "오늘의 식단", summary: "요약" },
            { role: "user", content: "고마워" },
        ];
        const out = toOutgoingMessages(messages);
        expect(out[1].content).toBe("오늘의 식단");
    });

    it("모든 메시지가 글자수 상한을 넘지 않는다", () => {
        const long = "가".repeat(MESSAGE_LIMITS.maxContentLength + 500);
        const messages: ChatMessage[] = [
            { role: "user", content: long },
            { role: "assistant", content: long },
            { role: "user", content: long },
        ];
        for (const out of toOutgoingMessages(messages)) {
            expect(out.content.length).toBeLessThanOrEqual(MESSAGE_LIMITS.maxContentLength);
        }
    });

    it("개수 상한을 넘으면 최근 것만 남긴다", () => {
        const messages = turns(81); // user로 끝나는 긴 이력
        const out = toOutgoingMessages(messages);
        expect(out.length).toBeLessThanOrEqual(MESSAGE_LIMITS.maxCount);
        expect(out.at(-1)?.content).toBe("메시지 80");
    });

    it("합산 바이트 예산을 넘으면 오래된 왕복부터 드롭한다", () => {
        // 요약 없는 4,000자(≈12KB) 메시지 30개 = 약 360KB — 예산(100KB)의 3배 이상
        const long = "가".repeat(MESSAGE_LIMITS.maxContentLength);
        const messages = turns(31, () => long);
        const out = toOutgoingMessages(messages);
        expect(totalContentBytes(out)).toBeLessThanOrEqual(OUTGOING_BUDGET_BYTES);
        expect(out.length).toBeLessThan(31);
        // 가장 최근 user 턴은 드롭되지 않는다
        expect(out.at(-1)?.role).toBe("user");
    });

    it("잘라낸 뒤에도 relay 규약(첫·마지막 메시지는 user)을 지킨다", () => {
        // 짝수 인덱스가 user인 80개 — assistant로 끝나는 이력도 계약을 만족해야 한다
        const messages = turns(80);
        const out = toOutgoingMessages(messages);
        expect(out[0].role).toBe("user");
        expect(out.at(-1)?.role).toBe("user");
    });

    it("빈 content 메시지는 전송에서 제외한다 (API 검증 거부로 인한 방 브릭 방지)", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "식단 짜줘" },
            { role: "assistant", content: "", summary: "빈 응답에 붙은 요약" },
            { role: "user", content: "다시 알려줘" },
        ];
        const out = toOutgoingMessages(messages);
        expect(out.every((m) => m.content.length > 0)).toBe(true);
        expect(out.length).toBe(2);
    });

    it("transient 메시지(에러 안내 버블)는 전송에서 제외한다", () => {
        const messages: ChatMessage[] = [
            { role: "user", content: "식단 짜줘" },
            { role: "assistant", content: "오류가 발생했어요", transient: true },
            { role: "user", content: "다시" },
        ];
        const out = toOutgoingMessages(messages);
        expect(out.map((m) => m.content)).toEqual(["식단 짜줘", "다시"]);
    });

    it("빈 이력은 빈 배열을 반환한다", () => {
        expect(toOutgoingMessages([])).toEqual([]);
    });
});
