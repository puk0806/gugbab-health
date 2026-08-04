import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/db/types";
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
            ...turns(6), // 요약 대상이 최근 4개 창 밖으로 밀려나도록
        ];
        const out = toOutgoingMessages(messages);
        expect(out[1].content).toBe("[이전 답변 요약] 일주일 저녁 식단 제안");
    });

    it("요약이 없는 오래된 답변은 잘라낸다", () => {
        const long = "가".repeat(5000);
        const messages: ChatMessage[] = [
            { role: "user", content: "일주일 식단 짜줘" },
            { role: "assistant", content: long },
            ...turns(6),
        ];
        const out = toOutgoingMessages(messages);
        expect(out[1].content.length).toBeLessThanOrEqual(1000);
        expect(out[1].content).toContain("…(이하 생략)");
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
        const messages = turns(80);
        const out = toOutgoingMessages(messages);
        expect(out.length).toBeLessThanOrEqual(MESSAGE_LIMITS.maxCount);
        expect(out.at(-1)?.content).toBe("메시지 79");
    });

    it("잘라낸 뒤 첫 메시지가 assistant면 제거한다 (relay 규약: 첫 메시지는 user)", () => {
        // 짝수 인덱스가 user인 80개 → 뒤 30개는 assistant(51번)로 시작
        const messages = turns(80);
        const out = toOutgoingMessages(messages);
        expect(out[0].role).toBe("user");
    });

    it("빈 이력은 빈 배열을 반환한다", () => {
        expect(toOutgoingMessages([])).toEqual([]);
    });
});
