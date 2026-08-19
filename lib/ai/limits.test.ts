import { describe, expect, it } from "vitest";
import { BODY_LIMITS, floor1, isInRange, muscleConsistencyError, rangeErrorMessage } from "./limits";

describe("BODY_LIMITS", () => {
    it("키·몸무게 범위가 현실적인 값으로 정의되어 있다", () => {
        expect(BODY_LIMITS.heightCm.min).toBeLessThan(BODY_LIMITS.heightCm.max);
        expect(BODY_LIMITS.weightKg.min).toBeLessThan(BODY_LIMITS.weightKg.max);
    });

    it("isInRange가 경계값을 포함한다", () => {
        expect(isInRange(50, BODY_LIMITS.heightCm)).toBe(true);
        expect(isInRange(300, BODY_LIMITS.heightCm)).toBe(true);
        expect(isInRange(49.9, BODY_LIMITS.heightCm)).toBe(false);
        expect(isInRange(300.1, BODY_LIMITS.heightCm)).toBe(false);
    });

    it("isInRange가 NaN·Infinity를 거부한다", () => {
        expect(isInRange(Number.NaN, BODY_LIMITS.weightKg)).toBe(false);
        expect(isInRange(Number.POSITIVE_INFINITY, BODY_LIMITS.weightKg)).toBe(false);
    });

    it("체지방률·골격근량 범위가 정의되어 있다", () => {
        expect(isInRange(15.5, BODY_LIMITS.bodyFatPct)).toBe(true);
        expect(isInRange(80, BODY_LIMITS.bodyFatPct)).toBe(false);
        expect(isInRange(35, BODY_LIMITS.skeletalMuscleKg)).toBe(true);
        expect(isInRange(150, BODY_LIMITS.skeletalMuscleKg)).toBe(false);
    });

    it("rangeErrorMessage — 빈 값은 에러 없음, 범위 밖은 안내 문구", () => {
        expect(rangeErrorMessage("", BODY_LIMITS.heightCm)).toBe("");
        expect(rangeErrorMessage("178", BODY_LIMITS.heightCm)).toBe("");
        expect(rangeErrorMessage("301", BODY_LIMITS.heightCm)).toBe("50~300 사이 숫자로 입력해주세요");
        expect(rangeErrorMessage("abc", BODY_LIMITS.heightCm)).toBe("50~300 사이 숫자로 입력해주세요");
    });
});

describe("floor1", () => {
    it("소수 둘째 자리 이하를 버린다 (반올림 아님)", () => {
        expect(floor1(21.59)).toBe(21.5);
        expect(floor1(21.5555)).toBe(21.5);
        expect(floor1(74.98)).toBe(74.9);
    });

    it("이미 1자리거나 정수면 그대로 둔다", () => {
        expect(floor1(21.5)).toBe(21.5);
        expect(floor1(70)).toBe(70);
        expect(floor1(0.1)).toBe(0.1);
    });

    it("부동소수 오차로 한 단계 깎이지 않는다", () => {
        // 21.5 * 10 === 214.99999999999997 — 보정 없으면 21.4가 된다
        expect(floor1(21.5)).toBe(21.5);
        expect(floor1(74.99999999999994)).toBe(75);
    });

    it("유한하지 않은 값은 그대로 반환한다", () => {
        expect(floor1(Number.NaN)).toBeNaN();
        expect(floor1(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    });
});

describe("muscleConsistencyError", () => {
    it("골격근량이 체중보다 크면 에러", () => {
        expect(muscleConsistencyError(50, 90)).toBe("골격근량은 체중보다 클 수 없어요");
    });

    it("체중과 같으면 통과 (경계값)", () => {
        expect(muscleConsistencyError(50, 50)).toBe("");
    });

    it("체지방률이 있으면 제지방량을 상한으로 본다", () => {
        // 체중 70kg, 체지방률 30% → 제지방량 49kg
        expect(muscleConsistencyError(70, 55, 30)).toContain("49kg");
        expect(muscleConsistencyError(70, 49, 30)).toBe("");
        expect(muscleConsistencyError(70, 49.1, 30)).not.toBe("");
    });

    it("골격근량 미입력이면 검증 대상이 아니다", () => {
        expect(muscleConsistencyError(70, undefined, 30)).toBe("");
    });
});
