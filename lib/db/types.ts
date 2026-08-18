export type Gender = "male" | "female";

export type Goal = "lose-weight" | "gain-weight" | "maintain-weight" | "lean-mass" | "health";

export type IngredientCategory = "vegetable-fruit" | "protein" | "grain" | "dairy" | "seasoning" | "etc";

export interface UserProfile {
    id: string;
    gender: Gender;
    goals: Goal[];
    heightCm?: number;
    weightKg?: number;
    createdAt: string;
    updatedAt: string;
}

export interface Ingredient {
    id: string;
    name: string;
    category: IngredientCategory;
    addedAt: string;
}

export interface BodyMetric {
    id: string;
    date: string;
    weight: number;
    bodyFatPct?: number;
    skeletalMuscleMass?: number;
    recordedAt: string;
}

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    /** relay가 내려준 답변 요약 — 오래된 턴을 압축 전송할 때 원문 대신 사용 (assistant 전용) */
    summary?: string;
    /** UI 전용 임시 메시지(에러 안내 버블 등) — DB 저장·relay 전송에서 제외 */
    transient?: boolean;
}

export type MealPlanMode = "pantry-only" | "free";

export interface Conversation {
    id: string;
    title: string;
    messages: ChatMessage[];
    mealPlanMode?: MealPlanMode;
    createdAt: string;
    updatedAt: string;
}

/** v1 mealHistory 스토어 레코드 — v2 마이그레이션 전용 */
export interface LegacyMealHistory {
    id: string;
    date: string;
    messages: ChatMessage[];
    summary?: string;
    createdAt: string;
    updatedAt: string;
}
