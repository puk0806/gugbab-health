import { uniq } from "@gugbab/utils";
import { floor1 } from "./limits";
import type { UserContext } from "./types";

/**
 * systemPrompt가 relay 상한(MAX_CUSTOM_PROMPT_CHARS, 20,000자)을 넘지 않도록
 * 컨텍스트 배열을 프롬프트 생성 전에 잘라내는 상한.
 * systemPrompt 초과 400은 history-budget 재시도로 복구되지 않는 유형이라 사전 방어가 유일한 수단.
 * zod 거부 대신 조용한 절삭 — 데이터가 커도 채팅 자체가 막히지 않게 한다.
 */
export const PROMPT_CONTEXT_LIMITS = {
    maxRecentMetrics: 62, // 약 두 달치
    maxIngredients: 120,
    maxIngredientNameLength: 50,
    maxMetricDateLength: 32,
    maxRecentMealSummaries: 10,
    maxSummaryLength: 500, // relay 요약 계약(300자 이내)의 여유 상한
} as const;

// 소수 1자리 버림 — 앱 입력 정규화(floor1)와 동일 기준.
// JS 숫자는 직렬화가 최대 24자까지 길어질 수 있어(예: 499.99999999999994)
// 프롬프트 길이 상한 보장을 깨뜨리므로, 정규화 이전 저장분도 여기서 정리한다

/** 프롬프트 생성 전 컨텍스트 배열·문자열·숫자 정밀도를 상한 내로 잘라낸다 */
export function trimContextForPrompt(ctx: UserContext): UserContext {
    const L = PROMPT_CONTEXT_LIMITS;
    return {
        ...ctx,
        // enum 값이지만 배열 개수는 무제한 — 중복 제거로 enum 종류 수(5)를 자연 상한으로 만든다
        goals: uniq(ctx.goals),
        recentMetrics: ctx.recentMetrics.slice(0, L.maxRecentMetrics).map((m) => ({
            ...m,
            date: m.date.slice(0, L.maxMetricDateLength),
            weight: floor1(m.weight),
            ...(m.bodyFatPct !== undefined ? { bodyFatPct: floor1(m.bodyFatPct) } : {}),
            ...(m.skeletalMuscleMass !== undefined ? { skeletalMuscleMass: floor1(m.skeletalMuscleMass) } : {}),
        })),
        // ingredients는 addedAt 오름차순(오래된 것 먼저)으로 오므로 뒤에서 잘라 최신 항목을 보존한다
        ingredients: ctx.ingredients
            .slice(-L.maxIngredients)
            .map((i) => ({ ...i, name: i.name.slice(0, L.maxIngredientNameLength) })),
        recentMealSummaries: ctx.recentMealSummaries
            .slice(0, L.maxRecentMealSummaries)
            .map((s) => s.slice(0, L.maxSummaryLength)),
    };
}

const GOAL_LABELS: Record<string, string> = {
    "lose-weight": "체중 감량",
    "gain-weight": "체중 증량",
    "maintain-weight": "체중 유지",
    "lean-mass": "근육량 증가",
    health: "건강 관리",
};

const MEAL_PLAN_MODE_GUIDES: Record<string, string> = {
    "pantry-only": `- **반드시 보유 식재료 목록에 있는 재료만** 사용해 식단을 구성하세요. 목록에 없는 재료는 절대 포함하지 마세요 (소금·후추·식용유 등 기본 조미료만 예외).
- 보유 재료로 만들 수 없는 식단은 제안하지 마세요.`,
    free: `- 보유 식재료에 얽매이지 말고 목표에 가장 적합한 식단을 자유롭게 추천하세요.
- 새로 필요한 재료는 "구매 목록"으로 함께 정리해주세요.`,
};

export function buildSystemPrompt(ctx: UserContext): string {
    const gender = ctx.gender === "male" ? "남성" : "여성";
    const goals = ctx.goals.map((g) => GOAL_LABELS[g] ?? g).join(", ");

    const profileLines = [`- 성별: ${gender}`, `- 목표: ${goals}`];
    if (ctx.heightCm !== undefined) profileLines.push(`- 키: ${ctx.heightCm}cm`);
    // 지표 기록이 있으면 최신 지표의 체중을 신뢰 — 기본 몸무게는 기록이 없을 때만 사용
    if (ctx.weightKg !== undefined && ctx.recentMetrics.length === 0) {
        profileLines.push(`- 기본 몸무게: ${ctx.weightKg}kg`);
    }

    const metricsSection =
        ctx.recentMetrics.length > 0
            ? ctx.recentMetrics
                  .map((m) => {
                      const parts = [`${m.date}: 체중 ${m.weight}kg`];
                      if (m.bodyFatPct !== undefined) parts.push(`체지방률 ${m.bodyFatPct}%`);
                      if (m.skeletalMuscleMass !== undefined) parts.push(`골격근량 ${m.skeletalMuscleMass}kg`);
                      return parts.join(", ");
                  })
                  .join("\n")
            : "기록 없음";

    // 평면 나열 — 분류는 모델이 이미 알고 있어 그룹핑이 정보를 더하지 않는다
    const ingredientsSection =
        ctx.ingredients.length > 0 ? ctx.ingredients.map((i) => `- ${i.name}`).join("\n") : "등록된 식재료 없음";

    const mealHistorySection = ctx.recentMealSummaries.length > 0 ? ctx.recentMealSummaries.join("\n") : "없음";

    const mealPlanGuide = ctx.mealPlanMode
        ? MEAL_PLAN_MODE_GUIDES[ctx.mealPlanMode]
        : "- 사용자의 현재 식재료로 만들 수 있는 실제 식단을 제안하세요.";

    return `당신은 개인화된 식단 설계 전문가입니다. 사용자의 신체 정보와 보유 식재료를 바탕으로 현실적이고 실천 가능한 식단을 제안합니다.

## 사용자 프로필
${profileLines.join("\n")}

## 최근 신체 지표 (최신순)
${metricsSection}

## 보유 식재료
${ingredientsSection}

## 최근 식단 이력
${mealHistorySection}

## 대화 지침
${mealPlanGuide}
- 신체 지표 변화 추이를 반영해 목표에 맞는 식단을 설계하세요.
- 구체적인 재료와 조리법을 포함하세요.
- **[필수] 식단을 추천할 때는 반드시** 각 음식마다 그람수(g)와 칼로리(kcal)를 표기하고, 마지막에 총 칼로리를 알려주세요. 예: "닭가슴살 샐러드 (닭가슴살 150g 165kcal, 방울토마토 100g 18kcal) ... 총 칼로리: 약 520kcal". 이 규칙은 식단 추천 응답에서 절대 생략하지 마세요.
- 이전 식단과 최대한 겹치지 않게 제안하세요.
- 질문은 한 번에 하나만.

## 톤 규약
- 존댓말, 친근하고 실용적으로
- 이모지 0~1개
- 길이: 첫 응답 200~400자, 후속 응답 150~300자 (단, 식단 추천 시 그람수·칼로리 표기가 길이 제한보다 우선 — 표기를 생략하지 말 것)`;
}
