import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("@/lib/ai/context", () => ({
    buildSystemPrompt: vi.fn().mockReturnValue("mock system prompt"),
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
        mockFetch.mockResolvedValueOnce(new Response("data: {\"type\":\"done\"}\n\n", { status: 200 }));
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
        const res = await POST(
            makeReq({ ...VALID_BODY, context: { ...VALID_BODY.context, heightCm: 30 } }),
        );
        expect(res.status).toBe(400);
    });

    it("잘못된 mealPlanMode에 400 반환", async () => {
        const { POST } = await import("./route");
        const res = await POST(
            makeReq({ ...VALID_BODY, context: { ...VALID_BODY.context, mealPlanMode: "invalid" } }),
        );
        expect(res.status).toBe(400);
    });

    it("model 필드를 relay body에 그대로 전달", async () => {
        mockFetch.mockResolvedValueOnce(new Response("data: {\"type\":\"done\"}\n\n", { status: 200 }));
        vi.resetModules();
        const { POST } = await import("./route");
        await POST(makeReq({ ...VALID_BODY, model: "opus" }));

        const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(options.body as string);
        expect(body.model).toBe("opus");
    });

    it("model 미지정 시 relay body에 model을 포함하지 않음", async () => {
        mockFetch.mockResolvedValueOnce(new Response("data: {\"type\":\"done\"}\n\n", { status: 200 }));
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
});
