import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("@/lib/ai/context", () => ({
    buildSystemPrompt: vi.fn().mockReturnValue("mock system prompt"),
    trimContextForPrompt: vi.fn((ctx: unknown) => ctx),
}));

const VALID_BODY = {
    messages: [{ role: "user", content: "오늘 식단 추천해줘" }],
    context: {
        gender: "male",
        goals: ["lose-weight"],
        recentMetrics: [],
        ingredients: [],
        recentMealSummaries: [],
    },
};

function makeReq(body: unknown): NextRequest {
    return new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }) as unknown as NextRequest;
}

describe("POST /api/chat (health relay proxy)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.RELAY_URL = "https://relay.example.com";
        process.env.RELAY_SECRET = "test-secret";
    });

    it("유효하지 않은 바디에 400 반환", async () => {
        const { POST } = await import("./route");
        const res = await POST(makeReq({ invalid: true }));
        expect(res.status).toBe(400);
    });

    it("assistant로 끝나는 기형 이력에 400 반환 (relay 계약 미러링: 첫·마지막 user)", async () => {
        const { POST } = await import("./route");
        const res = await POST(
            makeReq({
                ...VALID_BODY,
                messages: [
                    { role: "user", content: "질문" },
                    { role: "assistant", content: "답변" },
                ],
            }),
        );
        expect(res.status).toBe(400);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("범위 밖 metric 숫자(weight 1e308)에 400 반환 — systemPrompt 상한 보장의 전제", async () => {
        const { POST } = await import("./route");
        const res = await POST(
            makeReq({
                ...VALID_BODY,
                context: {
                    ...VALID_BODY.context,
                    recentMetrics: [{ date: "2026-08-14", weight: -1.7976931348623157e308 }],
                },
            }),
        );
        expect(res.status).toBe(400);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("빈 메시지 배열에 400 반환", async () => {
        const { POST } = await import("./route");
        const res = await POST(makeReq({ ...VALID_BODY, messages: [] }));
        expect(res.status).toBe(400);
    });

    it("RELAY_URL 미설정 시 503 반환", async () => {
        delete process.env.RELAY_URL;
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));
        expect(res.status).toBe(503);
    });

    it("relay에 올바른 payload 전송 및 SSE 스트리밍 헤더 반환", async () => {
        mockFetch.mockResolvedValueOnce(
            new Response('data: {"type":"chunk","text":"안녕"}\n\ndata: {"type":"done"}\n\n', {
                status: 200,
                headers: { "content-type": "text/event-stream" },
            }),
        );
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");

        const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://relay.example.com/api/chat");
        const body = JSON.parse(options.body as string);
        expect(body.app).toBe("health");
        expect(body.systemPrompt).toBe("mock system prompt");
        expect(body.wantSummary).toBe(true);
        expect((options.headers as Record<string, string>)["X-Relay-Secret"]).toBe("test-secret");
    });

    it("heightCm·weightKg·mealPlanMode 포함 컨텍스트를 수용한다", async () => {
        mockFetch.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', { status: 200 }));
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(
            makeReq({
                ...VALID_BODY,
                context: { ...VALID_BODY.context, heightCm: 178, weightKg: 78, mealPlanMode: "pantry-only" },
            }),
        );
        expect(res.status).toBe(200);
    });

    it("범위 밖 heightCm(30)에 400 반환", async () => {
        const { POST } = await import("./route");
        const res = await POST(makeReq({ ...VALID_BODY, context: { ...VALID_BODY.context, heightCm: 30 } }));
        expect(res.status).toBe(400);
    });

    it("잘못된 mealPlanMode에 400 반환", async () => {
        const { POST } = await import("./route");
        const res = await POST(makeReq({ ...VALID_BODY, context: { ...VALID_BODY.context, mealPlanMode: "invalid" } }));
        expect(res.status).toBe(400);
    });

    it("model 필드를 relay body에 그대로 전달", async () => {
        mockFetch.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', { status: 200 }));
        vi.resetModules();
        const { POST } = await import("./route");
        await POST(makeReq({ ...VALID_BODY, model: "opus" }));

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(options.body as string);
        expect(body.model).toBe("opus");
    });

    it("model 미지정 시 relay body에 model을 포함하지 않음", async () => {
        mockFetch.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', { status: 200 }));
        vi.resetModules();
        const { POST } = await import("./route");
        await POST(makeReq(VALID_BODY));

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(options.body as string);
        expect("model" in body).toBe(false);
    });

    it("빈 문자열 model에 400 반환", async () => {
        const { POST } = await import("./route");
        const res = await POST(makeReq({ ...VALID_BODY, model: "" }));
        expect(res.status).toBe(400);
    });

    it("relay fetch 자체가 실패해도 error 이벤트 SSE 반환", async () => {
        mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");
        expect(await res.text()).toContain('"type":"error"');
    });

    it("relay 오류 시 error 이벤트 SSE 반환", async () => {
        mockFetch.mockResolvedValueOnce(new Response("Server Error", { status: 500 }));
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));
        const text = await res.text();
        expect(text).toContain('"type":"error"');
    });

    function relay400(violation?: string): Response {
        return new Response(
            JSON.stringify({
                status: 400,
                error: "Bad Request",
                errorCode: "VALIDATION_ERROR",
                message: "요청 데이터가 올바르지 않습니다.",
                ...(violation ? { violation } : {}),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
        );
    }

    const MULTI_TURN_BODY = {
        ...VALID_BODY,
        messages: [
            { role: "user", content: "어제 식단 알려줘" },
            { role: "assistant", content: "어제는 닭가슴살 샐러드였어요" },
            { role: "user", content: "오늘 식단 추천해줘" },
        ],
    };

    it("history-budget 400이면 이력을 다시 맞춰 1회 자동 재시도한다", async () => {
        mockFetch.mockResolvedValueOnce(relay400("history-budget")).mockResolvedValueOnce(
            new Response('data: {"type":"done"}\n\n', {
                status: 200,
                headers: { "content-type": "text/event-stream" },
            }),
        );
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(MULTI_TURN_BODY));

        expect(res.status).toBe(200);
        expect(await res.text()).toContain('"type":"done"');
        expect(mockFetch).toHaveBeenCalledTimes(2);
        // 재시도 body도 relay 계약(첫·마지막 user, 개수·바이트 예산)을 만족하는 messages를 담는다
        const [, retryOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
        const retryBody = JSON.parse(retryOptions.body as string);
        expect(retryBody.messages.length).toBeGreaterThan(0);
        // 재시도는 최근 왕복만 유지 — 바이트뿐 아니라 개수 드리프트도 흡수
        expect(retryBody.messages.length).toBeLessThanOrEqual(5);
        expect(retryBody.messages[0].role).toBe("user");
        expect(retryBody.messages.at(-1).role).toBe("user");
    });

    it("재시도도 실패하면 error 이벤트 SSE 반환 (재시도는 1회뿐)", async () => {
        mockFetch.mockResolvedValueOnce(relay400("history-budget")).mockResolvedValueOnce(relay400("history-budget"));
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(MULTI_TURN_BODY));

        expect(await res.text()).toContain('"type":"error"');
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("message-size 400이면 재시도 없이 입력 축소 안내를 SSE error로 반환한다", async () => {
        mockFetch.mockResolvedValueOnce(relay400("message-size"));
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));
        const text = await res.text();

        expect(text).toContain('"type":"error"');
        expect(text).toContain("메시지가 너무 길어요");
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("violation 없는 400(구버전 응답)은 재시도 없이 일반 오류로 처리한다", async () => {
        mockFetch.mockResolvedValueOnce(relay400());
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));

        expect(await res.text()).toContain('"type":"error"');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("JSON이 아닌 400 응답도 일반 오류로 처리한다", async () => {
        mockFetch.mockResolvedValueOnce(new Response("Bad Request", { status: 400 }));
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));

        expect(await res.text()).toContain('"type":"error"');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("사전 가드: 예산 초과 이력은 relay 전송 전에 오래된 왕복부터 드롭한다", async () => {
        mockFetch.mockResolvedValueOnce(
            new Response('data: {"type":"done"}\n\n', {
                status: 200,
                headers: { "content-type": "text/event-stream" },
            }),
        );
        vi.resetModules();
        const { POST } = await import("./route");
        // 4,000자(≈12KB) × 33개 ≈ 396KB — 전송 예산(90KB)의 4배 이상
        const long = "가".repeat(4000);
        const messages = Array.from({ length: 33 }, (_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant",
            content: long,
        }));
        const res = await POST(makeReq({ ...VALID_BODY, messages }));

        expect(res.status).toBe(200);
        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(options.body as string);
        expect(body.messages.length).toBeLessThan(33);
        const totalBytes = body.messages.reduce(
            (sum: number, m: { content: string }) => sum + new TextEncoder().encode(m.content).length,
            0,
        );
        expect(totalBytes).toBeLessThanOrEqual(90_000);
        expect(body.messages[0].role).toBe("user");
        expect(body.messages.at(-1).role).toBe("user");
    });

    it("relay body 키 집합은 계약된 필드만 담는다 (model 미지정 시)", async () => {
        mockFetch.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', { status: 200 }));
        vi.resetModules();
        const { POST } = await import("./route");
        await POST(makeReq(VALID_BODY));

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(options.body as string);
        expect(Object.keys(body).sort()).toEqual(["app", "messages", "systemPrompt", "wantSummary"]);
    });

    it("__proto__ 주입이 relay 전달 body를 오염시키지 않는다", async () => {
        mockFetch.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', { status: 200 }));
        vi.resetModules();
        const { POST } = await import("./route");
        const raw = `${JSON.stringify(VALID_BODY).slice(0, -1)},"__proto__":{"admin":true},"extra":"x"}`;
        const req = new Request("http://localhost/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: raw,
        }) as unknown as NextRequest;
        const res = await POST(req);

        expect(res.status).toBe(200);
        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(options.body as string) as Record<string, unknown>;
        // zod 파싱된 필드만 전달 — 주입 키는 미포함, 전역 프로토타입 미오염
        expect(Object.keys(body).sort()).toEqual(["app", "messages", "systemPrompt", "wantSummary"]);
        expect(({} as Record<string, unknown>).admin).toBeUndefined();
    });

    it("400 응답이 기술 스택 정보를 노출하지 않는다", async () => {
        const { POST } = await import("./route");
        const req = new Request("http://localhost/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "깨진 JSON {{{",
        }) as unknown as NextRequest;
        const res = await POST(req);
        const text = await res.text();
        expect(res.status).toBe(400);
        expect(text).not.toMatch(/zod|ZodError|stack|SyntaxError/i);
    });

    it("relay 오류 시 에러 스트림에 시크릿·내부 URL을 노출하지 않는다", async () => {
        mockFetch.mockResolvedValueOnce(new Response("internal boom", { status: 500 }));
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeReq(VALID_BODY));
        const text = await res.text();
        expect(text).not.toContain("test-secret");
        expect(text).not.toContain("relay.example.com");
        expect(text).not.toContain("internal boom");
    });
});
