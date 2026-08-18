import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_PROMPT_CHARS } from "@/lib/relay-limits";
import { buildSystemPrompt, PROMPT_CONTEXT_LIMITS, trimContextForPrompt } from "./context";
import type { UserContext } from "./types";

const BASE: UserContext = {
    gender: "male",
    goals: ["lose-weight", "lean-mass"],
    recentMetrics: [{ date: "2026-06-27", weight: 74, bodyFatPct: 21.5, skeletalMuscleMass: 35.2 }],
    ingredients: [
        { name: "닭가슴살", category: "protein" },
        { name: "브로콜리", category: "vegetable-fruit" },
    ],
    recentMealSummaries: [],
};

describe("buildSystemPrompt", () => {
    it("성별·목표를 포함한다", () => {
        const p = buildSystemPrompt(BASE);
        expect(p).toContain("남성");
        expect(p).toContain("체중 감량");
        expect(p).toContain("근육량 증가");
    });

    it("신체 지표를 포함한다", () => {
        const p = buildSystemPrompt(BASE);
        expect(p).toContain("74kg");
        expect(p).toContain("21.5%");
        expect(p).toContain("35.2kg");
    });

    it("식재료를 카테고리별로 포함한다", () => {
        const p = buildSystemPrompt(BASE);
        expect(p).toContain("닭가슴살");
        expect(p).toContain("브로콜리");
        expect(p).toContain("단백질");
        expect(p).toContain("채소·과일");
    });

    it("식재료 없으면 없음 메시지", () => {
        const p = buildSystemPrompt({ ...BASE, ingredients: [] });
        expect(p).toContain("등록된 식재료 없음");
    });

    it("신체 지표 없으면 없음 메시지", () => {
        const p = buildSystemPrompt({ ...BASE, recentMetrics: [] });
        expect(p).toContain("기록 없음");
    });

    it("여성 프로필", () => {
        const p = buildSystemPrompt({ ...BASE, gender: "female" });
        expect(p).toContain("여성");
    });

    it("체지방률·골격근량 없는 지표도 처리", () => {
        const p = buildSystemPrompt({
            ...BASE,
            recentMetrics: [{ date: "2026-06-27", weight: 70 }],
        });
        expect(p).toContain("70kg");
        expect(p).not.toContain("체지방률");
    });

    it("최근 식단 이력을 포함한다", () => {
        const p = buildSystemPrompt({ ...BASE, recentMealSummaries: ["2026-06-26: 닭가슴살 샐러드"] });
        expect(p).toContain("닭가슴살 샐러드");
    });

    it("키를 프로필에 포함한다", () => {
        const p = buildSystemPrompt({ ...BASE, heightCm: 178 });
        expect(p).toContain("178cm");
    });

    it("지표 기록이 없으면 기본 몸무게를 사용한다", () => {
        const p = buildSystemPrompt({ ...BASE, recentMetrics: [], weightKg: 78 });
        expect(p).toContain("78kg");
        expect(p).toContain("기본 몸무게");
    });

    it("지표 기록이 있으면 기본 몸무게는 표기하지 않는다", () => {
        const p = buildSystemPrompt({ ...BASE, weightKg: 78 });
        expect(p).not.toContain("기본 몸무게");
    });

    it("pantry-only 모드는 보유 재료 강제 지침을 포함한다", () => {
        const p = buildSystemPrompt({ ...BASE, mealPlanMode: "pantry-only" });
        expect(p).toContain("보유 식재료 목록에 있는 재료만");
        expect(p).toContain("절대 포함하지 마세요");
    });

    it("free 모드는 자유 추천 지침 + 구매 목록 안내를 포함한다", () => {
        const p = buildSystemPrompt({ ...BASE, mealPlanMode: "free" });
        expect(p).toContain("자유롭게 추천");
        expect(p).toContain("구매 목록");
    });

    it("모드 미지정 시 기존 지침을 유지한다", () => {
        const p = buildSystemPrompt(BASE);
        expect(p).toContain("현재 식재료로 만들 수 있는 실제 식단");
        expect(p).not.toContain("절대 포함하지 마세요");
    });
});

describe("trimContextForPrompt", () => {
    it("상한 내 컨텍스트는 그대로 유지한다", () => {
        expect(trimContextForPrompt(BASE)).toEqual(BASE);
    });

    it("배열·문자열을 상한 내로 잘라낸다", () => {
        const L = PROMPT_CONTEXT_LIMITS;
        const bloated: UserContext = {
            ...BASE,
            recentMetrics: Array.from({ length: 200 }, (_, i) => ({
                date: `2026-06-27-비정상적으로-긴-날짜-문자열-${i}`,
                weight: 74,
            })),
            ingredients: Array.from({ length: 500 }, (_, i) => ({
                name: `식재료-${"가".repeat(100)}-${i}`,
                category: "etc" as const,
            })),
            recentMealSummaries: Array.from({ length: 50 }, () => "요약 ".repeat(500)),
        };
        const trimmed = trimContextForPrompt(bloated);
        expect(trimmed.recentMetrics.length).toBe(L.maxRecentMetrics);
        expect(trimmed.goals.length).toBeLessThanOrEqual(5);
        expect(trimmed.ingredients.length).toBe(L.maxIngredients);
        expect(trimmed.recentMealSummaries.length).toBe(L.maxRecentMealSummaries);
        for (const m of trimmed.recentMetrics) expect(m.date.length).toBeLessThanOrEqual(L.maxMetricDateLength);
        for (const i of trimmed.ingredients) expect(i.name.length).toBeLessThanOrEqual(L.maxIngredientNameLength);
        for (const s of trimmed.recentMealSummaries) expect(s.length).toBeLessThanOrEqual(L.maxSummaryLength);
    });

    it("직렬화가 긴 숫자는 소수 2자리로 반올림한다 (프롬프트 길이 통제)", () => {
        const trimmed = trimContextForPrompt({
            ...BASE,
            recentMetrics: [{ date: "2026-08-14", weight: 74.99999999999994, bodyFatPct: 21.550000000000001 }],
        });
        expect(trimmed.recentMetrics[0].weight).toBe(75);
        expect(trimmed.recentMetrics[0].bodyFatPct).toBe(21.55);
        expect(String(trimmed.recentMetrics[0].weight).length).toBeLessThanOrEqual(6);
    });

    it("식재료는 최신 항목(뒤쪽)을 보존한다 — addedAt 오름차순 입력", () => {
        const L = PROMPT_CONTEXT_LIMITS;
        const ingredients = Array.from({ length: 500 }, (_, i) => ({
            name: `재료${i}`,
            category: "etc" as const,
        }));
        const trimmed = trimContextForPrompt({ ...BASE, ingredients });
        expect(trimmed.ingredients.length).toBe(L.maxIngredients);
        // 가장 최근에 추가된 항목이 남고, 가장 오래된 항목이 잘려나간다
        expect(trimmed.ingredients.at(-1)?.name).toBe("재료499");
        expect(trimmed.ingredients[0]?.name).toBe(`재료${500 - L.maxIngredients}`);
    });

    it("상한까지 채운 최악 케이스에서도 systemPrompt가 relay 상한을 넘지 않는다", () => {
        const L = PROMPT_CONTEXT_LIMITS;
        const worst: UserContext = {
            gender: "female",
            goals: ["lose-weight", "gain-weight", "maintain-weight", "lean-mass", "health"],
            heightCm: 200.55,
            weightKg: 499.99,
            recentMetrics: Array.from({ length: L.maxRecentMetrics }, () => ({
                date: "가".repeat(L.maxMetricDateLength),
                weight: 499.99,
                bodyFatPct: 69.99,
                skeletalMuscleMass: 99.99,
            })),
            ingredients: Array.from({ length: L.maxIngredients }, (_, i) => ({
                name: "가".repeat(L.maxIngredientNameLength),
                // 카테고리를 분산시켜 그룹 라벨 줄 수를 최대로
                category: (["vegetable-fruit", "protein", "grain", "dairy", "seasoning", "etc"] as const)[i % 6],
            })),
            recentMealSummaries: Array.from({ length: L.maxRecentMealSummaries }, () =>
                "가".repeat(L.maxSummaryLength),
            ),
            mealPlanMode: "pantry-only",
        };
        const p = buildSystemPrompt(trimContextForPrompt(worst));
        expect(p.length).toBeLessThanOrEqual(MAX_CUSTOM_PROMPT_CHARS);
    });
});
