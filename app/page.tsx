"use client";

import { useSSEChat } from "@gugbab/hooks";
import { capitalize } from "@gugbab/utils";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ChatInputBar from "@/components/chat/ChatInputBar";
import ConversationListSheet from "@/components/chat/ConversationListSheet";
import MealPlanModeSheet from "@/components/chat/MealPlanModeSheet";
import ModelSheet from "@/components/chat/ModelSheet";
import BottomNav from "@/components/layout/BottomNav";
import { toOutgoingMessages } from "@/lib/ai/history";
import { BODY_LIMITS, isInRange, MESSAGE_LIMITS, type NumberRange } from "@/lib/ai/limits";
import type { ModelInfo, ModelsResponse, UserContext } from "@/lib/ai/types";
import { copyToClipboard } from "@/lib/clipboard";
import { getLatestBodyMetrics } from "@/lib/db/bodyMetrics";
import {
    deleteConversation,
    getConversation,
    getLatestConversation,
    listConversations,
    saveConversation,
} from "@/lib/db/conversations";
import { getAllIngredients } from "@/lib/db/ingredients";
import type { ChatMessage, Conversation, MealPlanMode } from "@/lib/db/types";
import { getUserProfile } from "@/lib/db/userProfile";
import { useLongPress } from "@/lib/hooks/useLongPress";
import styles from "./page.module.css";

const MODEL_STORAGE_KEY = "gugbab-health:model";
// 활성 대화방 참조 — 방 id 또는 "new"(빈 새 대화). 새로고침해도 보던 방/새 대화 상태 유지
const ACTIVE_CONVERSATION_KEY = "gugbab-health:conversation";
const NEW_CONVERSATION_REF = "new";
const FALLBACK_MODEL = "sonnet";
const GENERIC_ERROR = "오류가 발생했어요. 잠시 후 다시 시도해주세요.";
// 이 개수 미만이면 "보유 재료로만 vs 자유 추천" 선택을 강제한다 (대화방당 1회)
const SCARCE_INGREDIENT_THRESHOLD = 3;
// 시스템 프롬프트 "최근 식단 이력"에 넣을 다른 방 요약 최대 개수
const RECENT_SUMMARY_COUNT = 5;
// 하단에서 이만큼 이상 올라가면 자동 스크롤을 멈추고 최하단 이동 버튼을 띄운다
const JUMP_BUTTON_THRESHOLD = 160;

// 과거 규칙으로 저장된 범위 밖 값이 채팅 400을 유발하지 않도록 컨텍스트에서 제외
function sanitizeBodyValue(value: number | undefined, range: NumberRange): number | undefined {
    return value !== undefined && isInRange(value, range) ? value : undefined;
}

function loadStoredModel(): string {
    if (typeof window === "undefined") return FALLBACK_MODEL;
    try {
        return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? FALLBACK_MODEL;
    } catch {
        return FALLBACK_MODEL;
    }
}

function loadConversationRef(): string | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    } catch {
        return null;
    }
}

function storeConversationRef(ref: string): void {
    try {
        window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, ref);
    } catch {
        // 저장 실패는 무시 — 세션 내 상태는 유지된다
    }
}

export default function ChatPage() {
    const router = useRouter();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    // null = 아직 저장되지 않은 새 대화방
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [listOpen, setListOpen] = useState(false);
    const [context, setContext] = useState<UserContext | null>(null);
    const [input, setInput] = useState("");
    const [models, setModels] = useState<ModelInfo[] | null>(null);
    const [model, setModel] = useState<string>(loadStoredModel);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [mealPlanMode, setMealPlanMode] = useState<MealPlanMode | null>(null);
    // 롱프레스로 연 복사 메뉴 — null이면 닫힘. 대상 메시지 내용과 표시 좌표를 담는다
    const [copyMenu, setCopyMenu] = useState<{ content: string; x: number; y: number } | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const bindLongPress = useLongPress();
    const bottomRef = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    // 하단 근접 여부 — 자동 스크롤 유지 조건. 렌더와 무관하게 스크롤마다 갱신되므로 ref
    const nearBottomRef = useRef(true);
    const [showJumpBtn, setShowJumpBtn] = useState(false);
    // 방 전환 신호 — 새 방 첫 저장의 id 부여(null→id)를 방 전환으로 오인하지 않도록 명시적으로 올린다
    const [roomSwitchKey, setRoomSwitchKey] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    // 전송 후 완료 시점에 확정할 메시지 목록 — null이면 대기 중인 응답 없음
    const pendingRef = useRef<ChatMessage[] | null>(null);
    // done 이벤트로 수신한 답변 요약 — 확정 시 assistant 메시지에 부착
    const summaryRef = useRef<string | undefined>(undefined);
    // 방별 최신 답변 요약 — 다른 방 요약을 recentMealSummaries로 전달 (최신순)
    const [roomSummaries, setRoomSummaries] = useState<Array<{ id: string; summary: string }>>([]);
    // 방 전환 세대 — 늦게 끝난 저장 콜백이 이전 방으로 상태를 되돌리는 것 방지
    const roomEpochRef = useRef(0);

    // 응답을 받지 못한 요청의 마무리 — 방금 보낸 user 턴을 transient로 전환(화면 유지,
    // 저장·전송 제외)하고 안내 버블을 붙인다. 미응답 질문이 다음 전송 이력에 끼어
    // 연속 user 턴으로 relay에 전달되는 것을 방지한다
    const settleFailedTurn = useCallback((notice: string) => {
        pendingRef.current = null;
        setMessages((prev) => [
            ...prev.map((m, i) => (i === prev.length - 1 && m.role === "user" ? { ...m, transient: true } : m)),
            { role: "assistant", content: notice, transient: true },
        ]);
        inputRef.current?.focus();
    }, []);

    const handleError = useCallback(
        (err: Error | { type: "error"; message: string }) => {
            settleFailedTurn(err instanceof Error ? GENERIC_ERROR : err.message);
        },
        [settleFailedTurn],
    );

    const handleDone = useCallback((event?: { type: "done"; summary?: string }) => {
        // relay 계약상 문자열이지만 런타임 방어 — 비문자열·빈 문자열은 없는 것으로 취급 (원문 유지 폴백)
        const summary = event?.summary;
        summaryRef.current = typeof summary === "string" && summary ? summary : undefined;
    }, []);

    const { text, status, send, abort } = useSSEChat({ url: "/api/chat", onDone: handleDone, onError: handleError });
    const streaming = status === "streaming";

    useEffect(() => {
        async function init() {
            let profile: Awaited<ReturnType<typeof getUserProfile>>;
            try {
                profile = await getUserProfile();
            } catch {
                router.replace("/onboarding");
                return;
            }
            if (!profile) {
                router.replace("/onboarding");
                return;
            }
            // 저장된 활성 방 참조 복원 — "new"면 빈 새 대화 유지, id면 그 방, 없으면 최근 방
            const ref = loadConversationRef();
            async function restoreConversation() {
                if (ref === NEW_CONVERSATION_REF) return undefined;
                if (ref) {
                    const found = await getConversation(ref).catch(() => undefined);
                    if (found) return found;
                }
                return getLatestConversation().catch(() => undefined);
            }

            // 프로필 확인 후 추가 DB 읽기 — 실패해도 온보딩으로 보내지 않고 빈 값으로 처리
            const [ingredients, metrics, latest, allConversations] = await Promise.all([
                getAllIngredients().catch(() => []),
                getLatestBodyMetrics(7).catch(() => []),
                restoreConversation(),
                listConversations().catch(() => []),
            ]);
            // 방별 마지막 답변 요약 수집 (목록은 최근 수정순)
            setRoomSummaries(
                allConversations.flatMap((c) => {
                    const summary = c.messages.findLast((m) => m.role === "assistant" && m.summary)?.summary;
                    return summary ? [{ id: c.id, summary }] : [];
                }),
            );
            setContext({
                gender: profile.gender,
                goals: profile.goals,
                heightCm: sanitizeBodyValue(profile.heightCm, BODY_LIMITS.heightCm),
                weightKg: sanitizeBodyValue(profile.weightKg, BODY_LIMITS.weightKg),
                // 범위 밖 레거시 지표 방어 — API zod가 BODY_LIMITS로 거부하므로,
                // weight가 범위 밖이면 항목을 제외하고 선택 필드는 범위 밖 값만 제거한다
                recentMetrics: [...metrics]
                    .reverse()
                    .filter((m) => isInRange(m.weight, BODY_LIMITS.weightKg))
                    .map((m) => ({
                        date: m.date,
                        weight: m.weight,
                        bodyFatPct: sanitizeBodyValue(m.bodyFatPct, BODY_LIMITS.bodyFatPct),
                        skeletalMuscleMass: sanitizeBodyValue(m.skeletalMuscleMass, BODY_LIMITS.skeletalMuscleKg),
                    })),
                ingredients: ingredients.map((i) => ({ name: i.name, category: i.category })),
                recentMealSummaries: [],
            });
            if (latest) {
                setConversationId(latest.id);
                setMessages(latest.messages);
                setMealPlanMode(latest.mealPlanMode ?? null);
                setRoomSwitchKey((k) => k + 1);
            }
        }
        init().catch(() => router.replace("/onboarding"));
    }, [router]);

    useEffect(() => {
        let cancelled = false;
        async function loadModels() {
            try {
                const res = await fetch("/api/models");
                if (!res.ok || cancelled) return;
                const data = (await res.json()) as ModelsResponse;
                if (cancelled) return;
                setModels(data.models);
                // 저장된 alias가 목록에 없으면(모델 폐기 등) 기본값으로 폴백
                setModel((prev) => {
                    const next = data.models.some((m) => m.alias === prev) ? prev : data.default;
                    try {
                        window.localStorage.setItem(MODEL_STORAGE_KEY, next);
                    } catch {
                        // 저장 실패는 무시 — 세션 내 선택은 유지된다
                    }
                    return next;
                });
            } catch {
                // 목록 로드 실패 — 칩 비활성 유지, 채팅은 저장값으로 계속 동작
            }
        }
        loadModels();
        return () => {
            cancelled = true;
        };
    }, []);

    // 스트리밍 완료 시 어시스턴트 메시지 확정 + 대화방 저장
    useEffect(() => {
        if (status !== "done" || !pendingRef.current) return;
        const summary = summaryRef.current;
        summaryRef.current = undefined;
        // 빈 응답(chunk 없이 done)은 확정·저장하지 않고 에러 경로와 동일하게 처리한다.
        // 빈 content가 저장되면 이후 모든 전송이 API 검증(min 1)에 걸려 방이 영구 전송 불가가 된다
        if (!text) {
            settleFailedTurn("응답을 받지 못했어요. 다시 시도해주세요.");
            return;
        }
        const finalMessages: ChatMessage[] = [
            ...pendingRef.current,
            { role: "assistant", content: text, ...(summary ? { summary } : {}) },
        ];
        pendingRef.current = null;
        setMessages(finalMessages);
        const epoch = roomEpochRef.current;
        // transient(에러 안내 버블)는 화면에만 남기고 DB에는 저장하지 않는다
        const persistable = finalMessages.filter((m) => !m.transient);
        saveConversation({ id: conversationId, messages: persistable, mealPlanMode })
            .then((saved) => {
                // 저장 중 방이 전환됐으면 이전 방으로 재바인딩하지 않는다
                if (roomEpochRef.current !== epoch) return;
                setConversationId(saved.id);
                storeConversationRef(saved.id);
                if (summary) {
                    setRoomSummaries((prev) => [{ id: saved.id, summary }, ...prev.filter((r) => r.id !== saved.id)]);
                }
            })
            .catch(() => undefined);
        inputRef.current?.focus();
    }, [status, text, conversationId, mealPlanMode, settleFailedTurn]);

    // 하단 근처일 때만 자동 스크롤 — 위로 올려 과거 메시지를 읽는 중에는 방해하지 않는다
    // biome-ignore lint/correctness/useExhaustiveDependencies: messages·text는 새 내용 도착 시점을 잡는 트리거 의존성 (본문은 ref만 읽음)
    useEffect(() => {
        if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, text]);

    // 방 전환·초기 로드 시에는 항상 최하단에서 시작
    // biome-ignore lint/correctness/useExhaustiveDependencies: roomSwitchKey는 방 전환 시점을 잡는 트리거 의존성
    useEffect(() => {
        nearBottomRef.current = true;
        setShowJumpBtn(false);
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }, [roomSwitchKey]);

    function handleMessagesScroll() {
        const el = messagesRef.current;
        if (!el) return;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < JUMP_BUTTON_THRESHOLD;
        nearBottomRef.current = near;
        setShowJumpBtn(!near);
    }

    function scrollToBottom() {
        nearBottomRef.current = true;
        setShowJumpBtn(false);
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    // 토스트는 잠깐 보여주고 자동으로 사라진다
    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 1600);
        return () => clearTimeout(timer);
    }, [toast]);

    async function handleCopy(content: string) {
        setCopyMenu(null);
        const ok = await copyToClipboard(content);
        setToast(ok ? "복사됨" : "복사에 실패했어요");
    }

    const ingredientsScarce = context !== null && context.ingredients.length < SCARCE_INGREDIENT_THRESHOLD;
    // 식재료 부족 시 추천 방식 선택은 강제 — 대화방당 1회, 선택 전에는 전송 불가
    const needsModeChoice = ingredientsScarce && mealPlanMode === null;

    function handleSend() {
        if (!input.trim() || streaming || !context || needsModeChoice) return;

        const userMsg: ChatMessage = { role: "user", content: input.trim() };
        const nextMessages = [...messages, userMsg];
        pendingRef.current = nextMessages;
        summaryRef.current = undefined;
        // 전송 시에는 위로 올려둔 상태여도 최신 메시지로 따라간다
        nearBottomRef.current = true;
        setShowJumpBtn(false);
        setMessages(nextMessages);
        setInput("");
        // 현재 방 요약은 메시지 이력으로 이미 전달되므로 다른 방 요약만 담는다
        const recentMealSummaries = roomSummaries
            .filter((r) => r.id !== conversationId)
            .map((r) => r.summary)
            .slice(0, RECENT_SUMMARY_COUNT);
        const contextWithMode: UserContext = {
            ...(ingredientsScarce && mealPlanMode ? { ...context, mealPlanMode } : context),
            recentMealSummaries,
        };
        // 긴 답변이 쌓여도 API 한도를 넘지 않도록 오래된 턴은 요약·절삭해 전송
        // 목록으로 검증된 경우에만 model 전달 — 미로드 시 relay 기본값에 위임 (폐기된 alias 전송 방지)
        send({ messages: toOutgoingMessages(nextMessages), context: contextWithMode, ...(models ? { model } : {}) });
    }

    function handleNewChat() {
        abort();
        pendingRef.current = null;
        roomEpochRef.current += 1;
        setConversationId(null);
        setMessages([]);
        setMealPlanMode(null);
        setRoomSwitchKey((k) => k + 1);
        storeConversationRef(NEW_CONVERSATION_REF);
    }

    async function handleOpenList() {
        try {
            setConversations(await listConversations());
        } catch {
            setConversations([]);
        }
        setListOpen(true);
    }

    function handleSelectConversation(conversation: Conversation) {
        abort();
        pendingRef.current = null;
        roomEpochRef.current += 1;
        setConversationId(conversation.id);
        setMessages(conversation.messages);
        setMealPlanMode(conversation.mealPlanMode ?? null);
        setRoomSwitchKey((k) => k + 1);
        storeConversationRef(conversation.id);
        setListOpen(false);
    }

    async function handleDeleteConversation(id: string) {
        const deletingActive = id === conversationId;
        if (deletingActive) {
            // 진행 중 스트림·대기 중 저장이 삭제된 방을 되살리지 않도록 삭제 전에 무효화
            abort();
            pendingRef.current = null;
            roomEpochRef.current += 1;
        }
        try {
            await deleteConversation(id);
        } catch {
            return;
        }
        setConversations((prev) => prev.filter((c) => c.id !== id));
        setRoomSummaries((prev) => prev.filter((r) => r.id !== id));
        if (deletingActive) {
            // 현재 열려 있던 방을 지우면 새 대화 상태로 초기화
            handleNewChat();
        }
    }

    function handleSelectMode(mode: MealPlanMode) {
        setMealPlanMode(mode);
        // 강제 선택 시트가 포커스를 가져갔으므로, 닫힌 뒤 바로 입력할 수 있게 되돌린다
        inputRef.current?.focus();
        // 이미 저장된 방이면 선택 즉시 영속화 (새 방은 첫 저장 시 함께 기록)
        // transient(에러 안내 버블)는 확정 저장 경로와 동일하게 제외한다
        if (conversationId) {
            saveConversation({
                id: conversationId,
                messages: messages.filter((m) => !m.transient),
                mealPlanMode: mode,
            }).catch(() => undefined);
        }
    }

    function handleSelectModel(alias: string) {
        setModel(alias);
        try {
            window.localStorage.setItem(MODEL_STORAGE_KEY, alias);
        } catch {
            // 저장 실패는 무시 — 세션 내 선택은 유지된다
        }
        setSheetOpen(false);
    }

    if (!context) return null;

    const streamingText = streaming ? text : "";

    return (
        <main className={styles.main}>
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <button type="button" className={styles.listBtn} onClick={handleOpenList} aria-label="대화 목록">
                        ☰
                    </button>
                    <span className={styles.headerTitle}>식단 채팅</span>
                    <button
                        type="button"
                        className={styles.modelChip}
                        onClick={() => setSheetOpen(true)}
                        disabled={streaming || !models}
                        aria-haspopup="dialog"
                    >
                        {models ? capitalize(model) : "모델"} <span aria-hidden>▾</span>
                    </button>
                </div>
                <button type="button" className={styles.newChatBtn} onClick={handleNewChat}>
                    새 대화
                </button>
            </header>

            <div className={styles.messages} ref={messagesRef} onScroll={handleMessagesScroll}>
                {messages.length === 0 && !streaming && (
                    <div className={styles.empty}>
                        <p>
                            안녕하세요! 오늘 어떤 식단을 원하시나요?
                            <br />
                            보유한 식재료와 신체 지표를 바탕으로 추천해드릴게요.
                        </p>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: 메시지는 방 안에서 append-only라 순서가 안정적 (id 없음)
                        key={i}
                        className={msg.role === "user" ? styles.userBubble : styles.assistantBubble}
                        {...bindLongPress(({ x, y }) => setCopyMenu({ content: msg.content, x, y }))}
                    >
                        {msg.content}
                    </div>
                ))}
                {streaming && streamingText && <div className={styles.assistantBubble}>{streamingText}</div>}
                {streaming && !streamingText && (
                    <div className={styles.typing} role="status" aria-label="입력 중">
                        <span />
                        <span />
                        <span />
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {showJumpBtn && (
                <button
                    type="button"
                    className={styles.jumpToBottom}
                    onClick={scrollToBottom}
                    aria-label="최신 메시지로 이동"
                >
                    ↓
                </button>
            )}

            {sheetOpen && models && (
                <ModelSheet
                    models={models}
                    selected={model}
                    onSelect={handleSelectModel}
                    onClose={() => setSheetOpen(false)}
                />
            )}

            {listOpen && (
                <ConversationListSheet
                    conversations={conversations}
                    activeId={conversationId}
                    onSelect={handleSelectConversation}
                    onDelete={handleDeleteConversation}
                    onClose={() => setListOpen(false)}
                />
            )}

            {needsModeChoice && <MealPlanModeSheet onSelect={handleSelectMode} />}

            <ChatInputBar
                value={input}
                onChange={setInput}
                onSend={handleSend}
                disabled={streaming}
                sendBlocked={needsModeChoice}
                maxLength={MESSAGE_LIMITS.maxContentLength}
                inputRef={inputRef}
            />

            {copyMenu && (
                // biome-ignore lint/a11y/useKeyWithClickEvents: 백드롭 탭으로 닫기 (ESC·바깥 클릭, 복사 버튼 별도 제공)
                <div
                    className={styles.copyMenuBackdrop}
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setCopyMenu(null);
                    }}
                    role="dialog"
                    aria-modal="true"
                    aria-label="복사 메뉴"
                >
                    <div
                        className={styles.copyMenu}
                        // 롱프레스 지점에 맞춰 위치 — 동적 좌표라 CSS로 표현 불가
                        style={{ left: copyMenu.x, top: copyMenu.y }}
                    >
                        <button
                            type="button"
                            className={styles.copyMenuItem}
                            onClick={() => handleCopy(copyMenu.content)}
                        >
                            복사
                        </button>
                    </div>
                </div>
            )}

            {toast && (
                <div className={styles.toast} role="status">
                    {toast}
                </div>
            )}

            <BottomNav active="chat" />
        </main>
    );
}
