import type { Gender, Goal } from "@/lib/db/types";

// relay API 계약 타입 — 단일 소스는 @gugbab/relay-types (OpenAPI 생성)
export type { ModelAlias, ModelInfo, ModelsResponse } from "@gugbab/relay-types";

export interface MetricContext {
    date: string;
    weight: number;
    bodyFatPct?: number;
    skeletalMuscleMass?: number;
}

export interface IngredientContext {
    name: string;
}

export type MealPlanMode = "pantry-only" | "free";

export interface UserContext {
    gender: Gender;
    goals: Goal[];
    heightCm?: number;
    weightKg?: number;
    recentMetrics: MetricContext[];
    ingredients: IngredientContext[];
    recentMealSummaries: string[];
    mealPlanMode?: MealPlanMode;
}
