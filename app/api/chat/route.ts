import type { ChatRequest, ErrorResponse, SSEError } from "@gugbab/relay-types";
import { fitMessagesToBudget, isHistoryValidationError, isPlainObject, toSSELine } from "@gugbab/utils";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { buildSystemPrompt, trimContextForPrompt } from "@/lib/ai/context";
import { BODY_LIMITS, MESSAGE_LIMITS } from "@/lib/ai/limits";
import { OUTGOING_BUDGET_BYTES, RETRY_MAX_MESSAGES } from "@/lib/relay-limits";

export const runtime = "nodejs";
export const maxDuration = 60;

// 숫자 범위를 BODY_LIMITS로 고정 — 무제한 숫자는 직렬화가 24자까지 길어져
// systemPrompt 상한(trimContextForPrompt) 보장을 깨뜨린다
const MetricSchema = z.object({
    date: z.string(),
    weight: z.number().min(BODY_LIMITS.weightKg.min).max(BODY_LIMITS.weightKg.max),
    bodyFatPct: z.number().min(BODY_LIMITS.bodyFatPct.min).max(BODY_LIMITS.bodyFatPct.max).optional(),
    skeletalMuscleMass: z
        .number()
        .min(BODY_LIMITS.skeletalMuscleKg.min)
        .max(BODY_LIMITS.skeletalMuscleKg.max)
        .optional(),
});

const IngredientSchema = z.object({
    name: z.string(),
});

const UserContextSchema = z.object({
    gender: z.enum(["male", "female"]),
    goals: z.array(z.enum(["lose-weight", "gain-weight", "maintain-weight", "lean-mass", "health"])),
    heightCm: z.number().min(BODY_LIMITS.heightCm.min).max(BODY_LIMITS.heightCm.max).optional(),
    weightKg: z.number().min(BODY_LIMITS.weightKg.min).max(BODY_LIMITS.weightKg.max).optional(),
    recentMetrics: z.array(MetricSchema),
    ingredients: z.array(IngredientSchema),
    recentMealSummaries: z.array(z.string()),
    mealPlanMode: z.enum(["pantry-only", "free"]).optional(),
});

const ChatRequestSchema = z.object({
    messages: z
        .array(
            z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string().min(1).max(MESSAGE_LIMITS.maxContentLength),
            }),
        )
        .min(1)
        .max(MESSAGE_LIMITS.maxCount)
        // relay 계약 미러링(첫·마지막 role=user): 기형 이력을 사전 가드가
        // 조용히 재작성(꼬리 assistant 제거로 직전 질문에 중복 답변)하지 않도록 명시적으로 거부한다
        .refine((msgs) => msgs[0]?.role === "user" && msgs.at(-1)?.role === "user"),
    context: UserContextSchema,
    // 형식만 검증하고 그대로 relay에 전달 — 모델 유효성의 단일 소스는 relay
    model: z.string().min(1).max(64).optional(),
});

// model은 문자열 그대로 전달 — 값 유효성의 단일 소스는 relay이므로 alias union으로 좁히지 않는다
type RelayChatBody = Omit<ChatRequest, "model"> & { model?: string };

const SSE_HEADERS = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
};

function sseErrorResponse(message = "릴레이 서버 오류가 발생했어요"): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const event: SSEError = { type: "error", message };
            controller.enqueue(encoder.encode(toSSELine(event)));
            controller.close();
        },
    });
    return new Response(stream, { headers: SSE_HEADERS });
}

// history-budget 400 재시도 시 적용하는 더 공격적인 예산 — 상수와 relay 실측 상한이
// 어긋난(drift) 경우도 이 경로가 런타임에 흡수한다
const RETRY_BUDGET_BYTES = Math.floor(OUTGOING_BUDGET_BYTES / 2);

/** relay 에러 응답 body 파싱 — JSON이 아니거나 형태가 다르면 null */
async function readRelayErrorBody(res: Response): Promise<Partial<ErrorResponse> | null> {
    try {
        const body = (await res.json()) as unknown;
        return isPlainObject(body) ? (body as Partial<ErrorResponse>) : null;
    } catch {
        return null;
    }
}

export async function POST(req: NextRequest): Promise<Response> {
    let parsed: z.infer<typeof ChatRequestSchema>;
    try {
        const body = (await req.json()) as unknown;
        parsed = ChatRequestSchema.parse(body);
    } catch {
        return new Response(JSON.stringify({ error: "입력을 확인해주세요" }), {
            status: 400,
            headers: { "content-type": "application/json" },
        });
    }

    const relayUrl = process.env.RELAY_URL;
    const relaySecret = process.env.RELAY_SECRET;

    if (!relayUrl || !relaySecret) {
        return new Response(JSON.stringify({ error: "릴레이 서버가 설정되지 않았어요" }), {
            status: 503,
            headers: { "content-type": "application/json" },
        });
    }

    // 가드 통과 후 값 고정 — TS 좁힘이 중첩 함수 안까지 전파되지 않는 것 대응
    const relayChatUrl = `${relayUrl}/api/chat`;
    const relaySecretHeader = relaySecret;

    // systemPrompt 상한(20,000자) 초과는 재시도로 복구 불가한 400 — 컨텍스트를 상한 내로 잘라 사전 방어
    const systemPrompt = buildSystemPrompt(trimContextForPrompt(parsed.context));

    function postToRelay(messages: typeof parsed.messages): Promise<Response> {
        return fetch(relayChatUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Relay-Secret": relaySecretHeader,
            },
            body: JSON.stringify({
                app: "health",
                systemPrompt,
                messages,
                // done 이벤트에 답변 요약을 실어달라는 요청 — 클라이언트 이력 압축에 사용
                wantSummary: true,
                ...(parsed.model ? { model: parsed.model } : {}),
            } satisfies RelayChatBody),
            signal: req.signal,
        });
    }

    // 사전 가드 — 클라이언트가 이미 압축해 보내지만, 구버전 클라이언트·상수 드리프트에 대비해
    // 프록시에서도 예산(마진 포함)을 한 번 더 맞춰 relay 400 자체를 줄인다
    const guarded = fitMessagesToBudget(parsed.messages, OUTGOING_BUDGET_BYTES, MESSAGE_LIMITS.maxCount);
    if (guarded.length === 0) {
        return sseErrorResponse();
    }

    let relayRes: Response;
    try {
        relayRes = await postToRelay(guarded);
    } catch {
        // 네트워크 단절·타임아웃 등 transport 실패 — 클라이언트가 처리 가능한 SSE error로 변환
        return sseErrorResponse();
    }

    if (relayRes.status === 400) {
        const errorBody = await readRelayErrorBody(relayRes);
        if (errorBody && isHistoryValidationError(errorBody)) {
            // history-budget: 이력 트림으로 복구 가능한 유형 — 절반 예산으로 다시 맞춰 1회 재시도
            const refitted = fitMessagesToBudget(guarded, RETRY_BUDGET_BYTES, RETRY_MAX_MESSAGES);
            if (refitted.length === 0) return sseErrorResponse();
            try {
                relayRes = await postToRelay(refitted);
            } catch {
                return sseErrorResponse();
            }
        } else if (errorBody?.violation === "message-size") {
            // 개별 메시지 길이 초과 — 트림으로 복구 불가, 재시도 없이 안내
            return sseErrorResponse("메시지가 너무 길어요. 내용을 줄여서 다시 보내주세요.");
        }
    }

    if (!relayRes.ok || !relayRes.body) {
        return sseErrorResponse();
    }

    return new Response(relayRes.body, { headers: SSE_HEADERS });
}
