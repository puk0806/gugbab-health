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
