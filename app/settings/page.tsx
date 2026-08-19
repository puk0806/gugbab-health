"use client";

import { useEffect, useState } from "react";
import { InstallSection } from "@/components/install/InstallSection";
import BottomNav from "@/components/layout/BottomNav";
import { BODY_LIMITS, floor1, isInRange, rangeErrorMessage } from "@/lib/ai/limits";
import type { Gender, Goal, UserProfile } from "@/lib/db/types";
import { getUserProfile, saveUserProfile } from "@/lib/db/userProfile";
import styles from "./page.module.css";

const GOAL_LABELS: Record<Goal, string> = {
    "lose-weight": "체중 감량",
    "gain-weight": "체중 증량",
    "maintain-weight": "체중 유지",
    "lean-mass": "근육 증가",
    health: "건강 유지",
};

const GOALS = Object.entries(GOAL_LABELS) as [Goal, string][];

// 소수점 첫째 자리까지만 저장 — 측정기 표기 정밀도를 넘는 잡값은 버린다
function parseValidated(value: string): number | undefined {
    return value.trim() === "" ? undefined : floor1(Number(value));
}

export default function SettingsPage() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [gender, setGender] = useState<Gender>("male");
    const [goals, setGoals] = useState<Goal[]>([]);
    const [height, setHeight] = useState("");
    const [weight, setWeight] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getUserProfile()
            .then((p) => {
                if (p) {
                    setProfile(p);
                    setGender(p.gender);
                    setGoals(p.goals);
                    // 과거 규칙으로 저장된 범위 밖 값은 비워서 로드 — 저장 버튼이 영구 비활성되는 것 방지
                    setHeight(
                        p.heightCm !== undefined && isInRange(p.heightCm, BODY_LIMITS.heightCm)
                            ? String(p.heightCm)
                            : "",
                    );
                    setWeight(
                        p.weightKg !== undefined && isInRange(p.weightKg, BODY_LIMITS.weightKg)
                            ? String(p.weightKg)
                            : "",
                    );
                }
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
    }, []);

    function toggleGoal(goal: Goal) {
        setGoals((prev) => (prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]));
    }

    const heightError = rangeErrorMessage(height, BODY_LIMITS.heightCm);
    const weightError = rangeErrorMessage(weight, BODY_LIMITS.weightKg);

    async function handleSave() {
        if (goals.length === 0 || heightError || weightError) return;
        setSaving(true);
        try {
            const updated = await saveUserProfile({
                gender,
                goals,
                heightCm: parseValidated(height),
                weightKg: parseValidated(weight),
            });
            setProfile(updated);
        } finally {
            setSaving(false);
        }
    }

    return (
        <main className={styles.main}>
            <header className={styles.header}>
                <h1 className={styles.title}>설정</h1>
            </header>

            {loading ? (
                <p className={styles.loading}>불러오는 중...</p>
            ) : profile === null ? (
                <p className={styles.empty}>프로필이 없습니다. 온보딩을 완료해주세요.</p>
            ) : (
                <div className={styles.form}>
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>성별</h2>
                        <div className={styles.chipGroup}>
                            {(["male", "female"] as const).map((g) => (
                                <button
                                    key={g}
                                    type="button"
                                    className={`${styles.chip} ${gender === g ? styles.selected : ""}`}
                                    onClick={() => setGender(g)}
                                >
                                    {g === "male" ? "남성" : "여성"}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>목표</h2>
                        <div className={styles.chipGroup}>
                            {GOALS.map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    className={`${styles.chip} ${goals.includes(value) ? styles.selected : ""}`}
                                    onClick={() => toggleGoal(value)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>신체 정보</h2>
                        <div className={styles.bodyFields}>
                            <div className={styles.fieldGroup}>
                                <label className={styles.fieldLabel} htmlFor="height-input">
                                    키 (cm)
                                    <input
                                        id="height-input"
                                        type="number"
                                        inputMode="decimal"
                                        min={BODY_LIMITS.heightCm.min}
                                        max={BODY_LIMITS.heightCm.max}
                                        step="0.1"
                                        className={styles.fieldInput}
                                        value={height}
                                        onChange={(e) => setHeight(e.target.value)}
                                        placeholder="예: 175"
                                        aria-invalid={heightError !== ""}
                                    />
                                </label>
                                {heightError && <span className={styles.fieldError}>{heightError}</span>}
                            </div>
                            <div className={styles.fieldGroup}>
                                <label className={styles.fieldLabel} htmlFor="weight-input">
                                    몸무게 (kg)
                                    <input
                                        id="weight-input"
                                        type="number"
                                        inputMode="decimal"
                                        min={BODY_LIMITS.weightKg.min}
                                        max={BODY_LIMITS.weightKg.max}
                                        step="0.1"
                                        className={styles.fieldInput}
                                        value={weight}
                                        onChange={(e) => setWeight(e.target.value)}
                                        placeholder="예: 70"
                                        aria-invalid={weightError !== ""}
                                    />
                                </label>
                                {weightError && <span className={styles.fieldError}>{weightError}</span>}
                            </div>
                        </div>
                        <p className={styles.fieldHint}>신체 지표 기록이 없을 때 식단 추천의 기준으로 사용돼요.</p>
                    </section>

                    <button
                        type="button"
                        className={styles.saveBtn}
                        onClick={handleSave}
                        disabled={goals.length === 0 || saving || heightError !== "" || weightError !== ""}
                    >
                        {saving ? "저장 중..." : "저장"}
                    </button>

                    <InstallSection title="앱 설치" description="홈 화면에 추가하면 앱처럼 빠르게 실행할 수 있어요." />
                </div>
            )}

            <BottomNav active="settings" />
        </main>
    );
}
