// 신체 정보 허용 범위 — 설정 UI와 /api/chat zod 스키마가 반드시 이 상수를 공유한다.
// (UI는 저장되는데 API가 거부하는 정합성 함정 방지)
export const BODY_LIMITS = {
    heightCm: { min: 50, max: 300 },
    weightKg: { min: 10, max: 500 },
    bodyFatPct: { min: 1, max: 70 },
    skeletalMuscleKg: { min: 1, max: 100 },
} as const;

// 채팅 이력 전송 한도 — /api/chat zod 스키마와 클라이언트 이력 압축(history.ts)이 반드시 이 상수를 공유한다.
// (클라이언트가 통과시킨 이력을 API가 거부하는 정합성 함정 방지)
export const MESSAGE_LIMITS = {
    maxContentLength: 4000,
    maxCount: 50,
} as const;

export interface NumberRange {
    min: number;
    max: number;
}

/**
 * 소수점 첫째 자리까지 남기고 버림 (21.59 → 21.5).
 * 체중계·인바디 표기 정밀도가 0.1 단위라 그 이상은 의미 없는 잡값이다.
 * `n * 10`의 부동소수 오차(21.5 * 10 = 214.99999999999997)를 보정해
 * 정확히 떨어지는 값이 한 단계 깎이는 것을 막는다.
 */
export function floor1(value: number): number {
    if (!Number.isFinite(value)) return value;
    return Math.floor(Number((value * 10).toFixed(6))) / 10;
}

/**
 * 골격근량의 물리적 상한 — 골격근은 제지방량의 부분집합이다.
 * 체지방률을 알면 제지방량(체중 × (1 − 체지방률/100)), 모르면 체중이 상한.
 */
export function maxSkeletalMuscleKg(weightKg: number, bodyFatPct?: number): number {
    if (bodyFatPct === undefined) return weightKg;
    return floor1(weightKg * (1 - bodyFatPct / 100));
}

/**
 * 골격근량이 물리적으로 가능한 값인지 검증 — 위반 시 사용자 안내 문구, 정상이면 빈 문자열.
 * 체중이 없거나 골격근량 미입력이면 검증 대상 아님(빈 문자열).
 */
export function muscleConsistencyError(weightKg: number, muscleKg?: number, bodyFatPct?: number): string {
    if (muscleKg === undefined || !Number.isFinite(weightKg)) return "";
    if (muscleKg > weightKg) return "골격근량은 체중보다 클 수 없어요";
    if (bodyFatPct !== undefined) {
        const limit = maxSkeletalMuscleKg(weightKg, bodyFatPct);
        if (muscleKg > limit) {
            return `체지방률 ${bodyFatPct}% 기준 제지방량(${limit}kg)을 넘을 수 없어요`;
        }
    }
    return "";
}

export function isInRange(value: number, range: NumberRange): boolean {
    return Number.isFinite(value) && value >= range.min && value <= range.max;
}

/** 입력 문자열의 범위 검증 에러 문구 — 빈 값은 에러 아님(선택 입력 허용) */
export function rangeErrorMessage(value: string, range: NumberRange): string {
    if (value.trim() === "") return "";
    const n = Number(value);
    if (!isInRange(n, range)) return `${range.min}~${range.max} 사이 숫자로 입력해주세요`;
    return "";
}
