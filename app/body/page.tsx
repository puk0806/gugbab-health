"use client";

import { useEffect, useState } from "react";
import BottomNav from "@/components/layout/BottomNav";
import { BODY_LIMITS, floor1, muscleConsistencyError, rangeErrorMessage } from "@/lib/ai/limits";
import { addBodyMetric, deleteBodyMetric, getLatestBodyMetrics } from "@/lib/db/bodyMetrics";
import { getLocalDateString } from "@/lib/db/index";
import type { BodyMetric } from "@/lib/db/types";
import styles from "./page.module.css";

export default function BodyPage() {
    const [records, setRecords] = useState<BodyMetric[]>([]);
    const [loadingRecords, setLoadingRecords] = useState(true);
    const [weight, setWeight] = useState("");
    const [bodyFat, setBodyFat] = useState("");
    const [muscleMass, setMuscleMass] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getLatestBodyMetrics(7)
            .then((fetched) => {
                setRecords((current) => {
                    const fetchedIds = new Set(fetched.map((r) => r.id));
                    const pendingAdds = current.filter((r) => !fetchedIds.has(r.id));
                    return [...fetched, ...pendingAdds].slice(-7);
                });
            })
            .finally(() => setLoadingRecords(false));
    }, []);

    const weightError = rangeErrorMessage(weight, BODY_LIMITS.weightKg);
    const bodyFatError = rangeErrorMessage(bodyFat, BODY_LIMITS.bodyFatPct);
    const muscleRangeError = rangeErrorMessage(muscleMass, BODY_LIMITS.skeletalMuscleKg);
    // 필드 간 물리적 정합성 — 각 값이 개별 범위를 통과한 뒤에만 판정한다
    const muscleError =
        muscleRangeError ||
        (weightError || bodyFatError || weight.trim() === ""
            ? ""
            : muscleConsistencyError(
                  floor1(Number(weight)),
                  muscleMass.trim() ? floor1(Number(muscleMass)) : undefined,
                  bodyFat.trim() ? floor1(Number(bodyFat)) : undefined,
              ));
    const hasError = weightError !== "" || bodyFatError !== "" || muscleError !== "";

    async function handleDelete(id: string) {
        try {
            await deleteBodyMetric(id);
        } catch {
            return;
        }
        // 로컬 필터 대신 재조회 — 7개 초과 보유 시 다음 오래된 기록이 목록을 채우도록
        const fresh = await getLatestBodyMetrics(7).catch(() => null);
        if (fresh) {
            setRecords(fresh);
        } else {
            setRecords((prev) => prev.filter((r) => r.id !== id));
        }
    }

    async function handleSave() {
        if (!weight.trim() || hasError) return;
        // 소수점 첫째 자리까지만 저장 — 측정기 표기 정밀도를 넘는 잡값은 버린다
        const w = floor1(Number(weight));
        const bf = bodyFat.trim() ? floor1(Number(bodyFat)) : undefined;
        const mm = muscleMass.trim() ? floor1(Number(muscleMass)) : undefined;
        setSaving(true);
        try {
            const metric = await addBodyMetric({
                weight: w,
                ...(bf !== undefined ? { bodyFatPct: bf } : {}),
                ...(mm !== undefined ? { skeletalMuscleMass: mm } : {}),
            });
            setRecords((prev) => [...prev, metric].slice(-7));
            setWeight("");
            setBodyFat("");
            setMuscleMass("");
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className={styles.main}>
            <header className={styles.header}>
                <h1 className={styles.title}>신체 지표</h1>
            </header>

            <section className={styles.formSection}>
                <h2 className={styles.sectionTitle}>오늘 기록 — {getLocalDateString()}</h2>
                <div className={styles.inputRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label} htmlFor="weight">
                            체중 (kg)
                            <input
                                id="weight"
                                className={styles.input}
                                type="number"
                                inputMode="decimal"
                                placeholder="예: 70"
                                min={BODY_LIMITS.weightKg.min}
                                max={BODY_LIMITS.weightKg.max}
                                step="0.1"
                                value={weight}
                                onChange={(e) => setWeight(e.target.value)}
                                aria-invalid={weightError !== ""}
                            />
                        </label>
                        {weightError && <span className={styles.fieldError}>{weightError}</span>}
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label} htmlFor="body-fat">
                            체지방률 (%)
                            <input
                                id="body-fat"
                                className={styles.input}
                                type="number"
                                inputMode="decimal"
                                placeholder="선택"
                                min={BODY_LIMITS.bodyFatPct.min}
                                max={BODY_LIMITS.bodyFatPct.max}
                                step="0.1"
                                value={bodyFat}
                                onChange={(e) => setBodyFat(e.target.value)}
                                aria-invalid={bodyFatError !== ""}
                            />
                        </label>
                        {bodyFatError && <span className={styles.fieldError}>{bodyFatError}</span>}
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label} htmlFor="muscle-mass">
                            골격근량 (kg)
                            <input
                                id="muscle-mass"
                                className={styles.input}
                                type="number"
                                inputMode="decimal"
                                placeholder="선택"
                                min={BODY_LIMITS.skeletalMuscleKg.min}
                                max={BODY_LIMITS.skeletalMuscleKg.max}
                                step="0.1"
                                value={muscleMass}
                                onChange={(e) => setMuscleMass(e.target.value)}
                                aria-invalid={muscleError !== ""}
                            />
                        </label>
                        {muscleError && <span className={styles.fieldError}>{muscleError}</span>}
                    </div>
                </div>
                <button
                    type="button"
                    className={styles.saveBtn}
                    onClick={handleSave}
                    disabled={!weight || hasError || saving}
                >
                    {saving ? "저장 중..." : "저장"}
                </button>
            </section>

            <section className={styles.recordsSection}>
                <h2 className={styles.sectionTitle}>최근 기록</h2>
                {!loadingRecords && records.length === 0 ? (
                    <p className={styles.empty}>기록이 없습니다</p>
                ) : (
                    <ul className={styles.recordList}>
                        {[...records].reverse().map((r) => (
                            <li key={r.id} className={styles.record}>
                                <span className={styles.recordDate}>{r.date}</span>
                                {/* floor1 표시 — 정규화 이전에 저장된 긴 소수 기록도 일관되게 보이도록 */}
                                <span className={styles.recordWeight}>{floor1(r.weight)} kg</span>
                                {r.bodyFatPct !== undefined && (
                                    <span className={styles.recordSub}>체지방 {floor1(r.bodyFatPct)}%</span>
                                )}
                                {r.skeletalMuscleMass !== undefined && (
                                    <span className={styles.recordSub}>골격근 {floor1(r.skeletalMuscleMass)} kg</span>
                                )}
                                <button
                                    type="button"
                                    className={styles.recordDeleteBtn}
                                    onClick={() => handleDelete(r.id)}
                                    aria-label={`${r.date} 기록 삭제`}
                                >
                                    🗑
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <BottomNav active="body" />
        </main>
    );
}
