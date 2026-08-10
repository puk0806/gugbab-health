import { useEffect, useRef } from "react";
import type { MealPlanMode } from "@/lib/ai/types";
import styles from "./MealPlanModeSheet.module.css";

interface MealPlanModeSheetProps {
    onSelect: (mode: MealPlanMode) => void;
}

/** 식재료 부족 시 추천 방식 선택 강제 시트 — 선택 전에는 닫을 수 없다 (ESC·백드롭 닫기 없음) */
export default function MealPlanModeSheet({ onSelect }: MealPlanModeSheetProps) {
    const firstBtnRef = useRef<HTMLButtonElement>(null);
    const lastBtnRef = useRef<HTMLButtonElement>(null);

    // 강제 선택 다이얼로그 — 뒤 화면 조작을 막기 위해 포커스를 시트 안으로 가둔다
    useEffect(() => {
        firstBtnRef.current?.focus();
    }, []);

    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        if (e.key !== "Tab") return;
        e.preventDefault();
        const target = e.shiftKey
            ? document.activeElement === firstBtnRef.current
                ? lastBtnRef.current
                : firstBtnRef.current
            : document.activeElement === lastBtnRef.current
              ? firstBtnRef.current
              : lastBtnRef.current;
        target?.focus();
    }

    return (
        <div
            className={styles.sheetBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="추천 방식 선택"
            onKeyDown={handleKeyDown}
        >
            <div className={styles.sheet}>
                <p className={styles.sheetTitle}>추천 방식을 선택해주세요</p>
                <p className={styles.sheetText}>등록된 식재료가 부족해요. 어떻게 추천해드릴까요?</p>
                <div className={styles.chips}>
                    <button
                        ref={firstBtnRef}
                        type="button"
                        className={styles.chip}
                        onClick={() => onSelect("pantry-only")}
                    >
                        보유 재료로만
                    </button>
                    <button ref={lastBtnRef} type="button" className={styles.chip} onClick={() => onSelect("free")}>
                        자유롭게 추천
                    </button>
                </div>
            </div>
        </div>
    );
}
