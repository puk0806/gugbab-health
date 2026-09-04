import type { UseSSEChatResult } from "@gugbab/hooks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { Conversation } from "@/lib/db/types";
import { getUserProfile } from "@/lib/db/userProfile";
import ChatPage from "./page";

const { sendMock, abortMock, sseState } = vi.hoisted(() => ({
    sendMock: vi.fn(),
    abortMock: vi.fn(),
    sseState: { text: "", status: "idle" as UseSSEChatResult["status"] },
}));

vi.mock("next/navigation", () => ({
    useRouter: vi.fn(),
}));

vi.mock("@/lib/db/userProfile", () => ({
    getUserProfile: vi.fn(),
}));

vi.mock("@/lib/db/ingredients", () => ({
    getAllIngredients: vi.fn(),
}));

vi.mock("@/lib/db/bodyMetrics", () => ({
    getLatestBodyMetrics: vi.fn(),
}));

vi.mock("@/lib/db/conversations", () => ({
    getConversation: vi.fn(),
    getLatestConversation: vi.fn(),
    listConversations: vi.fn(),
    saveConversation: vi.fn(),
    deleteConversation: vi.fn(),
}));

vi.mock("@/components/layout/BottomNav", () => ({
    default: ({ active }: { active: string }) => <nav data-testid="bottom-nav" data-active={active} />,
}));

vi.mock("@gugbab/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@gugbab/hooks")>()),
    useSSEChat: () => ({ ...sseState, send: sendMock, abort: abortMock }),
}));

vi.mock("@/lib/clipboard", () => ({
    copyToClipboard: vi.fn(),
}));

const MOCK_PROFILE = {
    id: "user-profile",
    gender: "male" as const,
    goals: ["lose-weight" as const],
    createdAt: "",
    updatedAt: "",
};

const MODELS_RESPONSE = {
    models: [
        { id: "claude-haiku-4-5-20251001", alias: "haiku", name: "Claude Haiku 4.5", description: "빠르고 가벼움" },
        { id: "claude-sonnet-4-6", alias: "sonnet", name: "Claude Sonnet 4.6", description: "속도·품질 균형 (기본값)" },
        { id: "claude-opus-4-8", alias: "opus", name: "Claude Opus 4.8", description: "최고 품질" },
        { id: "claude-fable-5", alias: "fable", name: "Claude Fable 5", description: "최상위 모델 — 비용 높음" },
    ],
    default: "sonnet",
};

const PLENTIFUL_INGREDIENTS = [
    { id: "i1", name: "닭가슴살", category: "protein" as const, addedAt: "" },
    { id: "i2", name: "브로콜리", category: "vegetable-fruit" as const, addedAt: "" },
    { id: "i3", name: "현미", category: "grain" as const, addedAt: "" },
];

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
    return {
        id: "conv-1",
        title: "닭가슴살로 뭐 해먹을까요?",
        messages: [
            { role: "user", content: "닭가슴살로 뭐 해먹을까요?" },
            { role: "assistant", content: "닭가슴살 샐러드를 추천드려요." },
        ],
        createdAt: "2026-07-06T08:00:00.000Z",
        updatedAt: "2026-07-06T08:10:00.000Z",
        ...overrides,
    };
}

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("ChatPage", () => {
    const mockReplace = vi.fn();

    beforeEach(() => {
        vi.mocked(useRouter).mockReturnValue({
            replace: mockReplace,
            push: vi.fn(),
        } as unknown as ReturnType<typeof useRouter>);
        mockReplace.mockClear();
        vi.mocked(getAllIngredients).mockResolvedValue([]);
        vi.mocked(getLatestBodyMetrics).mockResolvedValue([]);
        vi.mocked(getLatestConversation).mockReset();
        vi.mocked(getLatestConversation).mockResolvedValue(undefined);
        vi.mocked(getConversation).mockReset();
        vi.mocked(getConversation).mockResolvedValue(undefined);
        vi.mocked(listConversations).mockReset();
        vi.mocked(listConversations).mockResolvedValue([]);
        vi.mocked(deleteConversation).mockReset();
        vi.mocked(deleteConversation).mockResolvedValue(undefined);
        vi.mocked(saveConversation).mockReset();
        vi.mocked(saveConversation).mockImplementation(async (data) =>
            makeConversation({
                id: data.id ?? "conv-new",
                messages: data.messages,
                mealPlanMode: data.mealPlanMode ?? undefined,
            }),
        );
        sendMock.mockReset();
        abortMock.mockClear();
        sseState.text = "";
        sseState.status = "idle";
        window.localStorage.clear();
        vi.mocked(copyToClipboard).mockReset();
        vi.mocked(copyToClipboard).mockResolvedValue(true);
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify(MODELS_RESPONSE), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );
    });

    it("프로필 없으면 /onboarding으로 리다이렉트", async () => {
        vi.mocked(getUserProfile).mockResolvedValue(undefined);
        render(<ChatPage />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/onboarding"));
    });

    it("프로필 있으면 입력창·전송 버튼 표시", async () => {
        vi.mocked(getUserProfile).mockResolvedValue(MOCK_PROFILE);
        render(<ChatPage />);
        await waitFor(() => expect(screen.getByPlaceholderText("식단을 요청해보세요...")).toBeInTheDocument());
        expect(screen.getByRole("button", { name: "전송" })).toBeInTheDocument();
    });

    it("BottomNav active=chat", async () => {
        vi.mocked(getUserProfile).mockResolvedValue(MOCK_PROFILE);
        render(<ChatPage />);
        await waitFor(() => expect(screen.getByTestId("bottom-nav")).toHaveAttribute("data-active", "chat"));
    });

    it("최근 대화방이 있으면 그 메시지를 이어서 표시한다", async () => {
        vi.mocked(getUserProfile).mockResolvedValue(MOCK_PROFILE);
        vi.mocked(getLatestConversation).mockResolvedValue(makeConversation());
        render(<ChatPage />);
        await waitFor(() => expect(screen.getByText("닭가슴살로 뭐 해먹을까요?")).toBeInTheDocument());
        expect(screen.getByText("닭가슴살 샐러드를 추천드려요.")).toBeInTheDocument();
    });

    describe("모델 선택", () => {
        beforeEach(() => {
            vi.mocked(getUserProfile).mockResolvedValue(MOCK_PROFILE);
            // 식재료 풍부 상태로 두어 모드 선택 강제에 걸리지 않게 한다
            vi.mocked(getAllIngredients).mockResolvedValue(PLENTIFUL_INGREDIENTS);
        });

        async function renderAndWaitChip() {
            render(<ChatPage />);
            return waitFor(() => {
                const chip = screen.getByRole("button", { name: /Sonnet/ });
                expect(chip).toBeEnabled();
                return chip;
            });
        }

        it("모델 목록 로드 후 기본 모델 칩을 표시한다", async () => {
            const chip = await renderAndWaitChip();
            expect(chip).toBeInTheDocument();
            expect(mockFetch).toHaveBeenCalledWith("/api/models");
        });

        it("칩 탭 → 시트에서 모델 선택 시 저장·표시 갱신", async () => {
            const chip = await renderAndWaitChip();
            fireEvent.click(chip);

            expect(screen.getByRole("dialog", { name: "모델 선택" })).toBeInTheDocument();
            expect(screen.getByText("Claude Haiku 4.5")).toBeInTheDocument();
            expect(screen.getByText("Claude Fable 5")).toBeInTheDocument();

            fireEvent.click(screen.getByText("Claude Opus 4.8"));

            expect(window.localStorage.getItem("gugbab-health:model")).toBe("opus");
            expect(screen.queryByRole("dialog", { name: "모델 선택" })).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: /Opus/ })).toBeInTheDocument();
        });

        it("저장된 모델이 목록에 없으면 기본값으로 폴백한다", async () => {
            window.localStorage.setItem("gugbab-health:model", "removed-model");
            await renderAndWaitChip();
            expect(window.localStorage.getItem("gugbab-health:model")).toBe("sonnet");
        });

        it("전송 시 선택된 모델 alias를 포함해 send를 호출한다", async () => {
            await renderAndWaitChip();
            fireEvent.change(screen.getByPlaceholderText("식단을 요청해보세요..."), {
                target: { value: "저녁 추천해줘" },
            });
            fireEvent.click(screen.getByRole("button", { name: "전송" }));

            expect(sendMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: "sonnet",
                    messages: [{ role: "user", content: "저녁 추천해줘" }],
                }),
            );
        });

        it("응답 완료 시 어시스턴트 말풍선 표시 + 대화방 저장", async () => {
            sendMock.mockImplementation(() => {
                sseState.text = "연어 스테이크를 추천해요";
                sseState.status = "done";
            });
            await renderAndWaitChip();
            fireEvent.change(screen.getByPlaceholderText("식단을 요청해보세요..."), {
                target: { value: "저녁 추천해줘" },
            });
            fireEvent.click(screen.getByRole("button", { name: "전송" }));

            await waitFor(() => expect(screen.getByText("연어 스테이크를 추천해요")).toBeInTheDocument());
            expect(saveConversation).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: [
                        { role: "user", content: "저녁 추천해줘" },
                        { role: "assistant", content: "연어 스테이크를 추천해요" },
                    ],
                }),
            );
        });

        it("스트리밍 중에는 모델 칩이 비활성화된다", async () => {
            sseState.status = "streaming";
            render(<ChatPage />);
            await waitFor(() => screen.getByPlaceholderText("식단을 요청해보세요..."));
            expect(screen.getByRole("button", { name: /Sonnet/ })).toBeDisabled();
        });

        it("모델 목록 로드 실패 시 칩은 중립 라벨로 비활성, 채팅 입력은 가능", async () => {
            mockFetch.mockRejectedValue(new Error("network down"));
            render(<ChatPage />);
            await waitFor(() => screen.getByPlaceholderText("식단을 요청해보세요..."));
            // 실제 사용될 모델(relay 기본값)을 알 수 없으므로 특정 모델명을 표시하지 않는다
            expect(screen.queryByRole("button", { name: /Sonnet/ })).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: /모델/ })).toBeDisabled();
            expect(screen.getByPlaceholderText("식단을 요청해보세요...")).toBeEnabled();
        });

        it("모델 목록 로드 실패 시 검증 안 된 model은 전송하지 않는다", async () => {
            window.localStorage.setItem("gugbab-health:model", "removed-model");
            mockFetch.mockRejectedValue(new Error("network down"));
            render(<ChatPage />);
            await waitFor(() => screen.getByPlaceholderText("식단을 요청해보세요..."));

            fireEvent.change(screen.getByPlaceholderText("식단을 요청해보세요..."), {
                target: { value: "저녁 추천해줘" },
            });
            fireEvent.click(screen.getByRole("button", { name: "전송" }));

            expect(sendMock).toHaveBeenCalledTimes(1);
            const sentBody = sendMock.mock.calls[0][0] as Record<string, unknown>;
            expect("model" in sentBody).toBe(false);
        });
    });

    describe("대화방", () => {
        beforeEach(() => {
            vi.mocked(getUserProfile).mockResolvedValue(MOCK_PROFILE);
            vi.mocked(getAllIngredients).mockResolvedValue(PLENTIFUL_INGREDIENTS);
        });

        async function renderAndWaitInput() {
            render(<ChatPage />);
            await waitFor(() => screen.getByPlaceholderText("식단을 요청해보세요..."));
        }

        it("새 대화 시 스트림 중단 + 화면 초기화 (기존 방은 보존)", async () => {
            vi.mocked(getLatestConversation).mockResolvedValue(makeConversation());
            await renderAndWaitInput();
            await waitFor(() => screen.getByText("닭가슴살 샐러드를 추천드려요."));

            fireEvent.click(screen.getByRole("button", { name: "새 대화" }));

            expect(abortMock).toHaveBeenCalled();
            expect(screen.queryByText("닭가슴살 샐러드를 추천드려요.")).not.toBeInTheDocument();
            expect(screen.getByText(/안녕하세요! 오늘 어떤 식단을/)).toBeInTheDocument();
            // 새 대화는 삭제·저장을 하지 않는다 — 기존 방은 목록에 남는다
            expect(deleteConversation).not.toHaveBeenCalled();
            expect(saveConversation).not.toHaveBeenCalled();
        });

        it("목록 버튼 → 대화방 목록 표시", async () => {
            vi.mocked(listConversations).mockResolvedValue([
                makeConversation(),
                makeConversation({ id: "conv-2", title: "저녁 추천", updatedAt: "2026-07-07T01:00:00.000Z" }),
            ]);
            await renderAndWaitInput();

            fireEvent.click(screen.getByRole("button", { name: "대화 목록" }));

            await waitFor(() => expect(screen.getByRole("dialog", { name: "대화 목록" })).toBeInTheDocument());
            expect(screen.getByText("저녁 추천")).toBeInTheDocument();
        });

        it("목록에서 방 선택 시 그 방의 대화를 표시한다", async () => {
            vi.mocked(listConversations).mockResolvedValue([
                makeConversation({
                    id: "conv-2",
                    title: "저녁 추천",
                    messages: [{ role: "user", content: "저녁 추천" }],
                }),
            ]);
            await renderAndWaitInput();

            fireEvent.click(screen.getByRole("button", { name: "대화 목록" }));
            await waitFor(() => screen.getByRole("dialog", { name: "대화 목록" }));
            fireEvent.click(screen.getByText("저녁 추천"));

            expect(screen.queryByRole("dialog", { name: "대화 목록" })).not.toBeInTheDocument();
            expect(screen.getByText("저녁 추천")).toBeInTheDocument();
        });

        it("목록에서 방 삭제 시 deleteConversation 호출", async () => {
            vi.mocked(listConversations).mockResolvedValue([makeConversation({ id: "conv-2", title: "저녁 추천" })]);
            await renderAndWaitInput();

            fireEvent.click(screen.getByRole("button", { name: "대화 목록" }));
            await waitFor(() => screen.getByRole("dialog", { name: "대화 목록" }));
            fireEvent.click(screen.getByRole("button", { name: "저녁 추천 삭제" }));

            await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith("conv-2"));
        });

        it("방 전환 후 늦게 끝난 저장은 활성 방을 되돌리지 않는다", async () => {
            const saveControl: { resolve: ((c: Conversation) => void) | null } = { resolve: null };
            vi.mocked(saveConversation).mockImplementation(
                () =>
                    new Promise<Conversation>((res) => {
                        saveControl.resolve = res;
                    }),
            );
            sendMock.mockImplementation(() => {
                sseState.text = "저녁 답변";
                sseState.status = "done";
            });
            await renderAndWaitInput();

            fireEvent.change(screen.getByPlaceholderText("식단을 요청해보세요..."), {
                target: { value: "저녁 추천" },
            });
            fireEvent.click(screen.getByRole("button", { name: "전송" }));
            await waitFor(() => expect(saveConversation).toHaveBeenCalled());

            // 저장이 끝나기 전에 새 대화로 전환
            fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
            expect(window.localStorage.getItem("gugbab-health:conversation")).toBe("new");

            // 늦게 저장 완료 — 활성 방이 이전 방으로 되돌아가면 안 된다
            await waitFor(() => expect(saveControl.resolve).not.toBeNull());
            saveControl.resolve?.(makeConversation({ id: "conv-stale" }));
            await new Promise((r) => setTimeout(r, 0));
            expect(window.localStorage.getItem("gugbab-health:conversation")).toBe("new");
        });

        it("활성 방 삭제 직전의 늦은 저장도 삭제된 방을 되살리지 않는다", async () => {
            const current = makeConversation();
            vi.mocked(getLatestConversation).mockResolvedValue(current);
            vi.mocked(listConversations).mockResolvedValue([current]);
            const saveControl: { resolve: ((c: Conversation) => void) | null } = { resolve: null };
            vi.mocked(saveConversation).mockImplementation(
                () =>
                    new Promise<Conversation>((res) => {
                        saveControl.resolve = res;
                    }),
            );
            sendMock.mockImplementation(() => {
                sseState.text = "추가 답변";
                sseState.status = "done";
            });
            await renderAndWaitInput();
            await waitFor(() => screen.getByText("닭가슴살 샐러드를 추천드려요."));

            fireEvent.change(screen.getByPlaceholderText("식단을 요청해보세요..."), {
                target: { value: "한 끼 더" },
            });
            fireEvent.click(screen.getByRole("button", { name: "전송" }));
            await waitFor(() => expect(saveConversation).toHaveBeenCalled());

            // 저장이 끝나기 전에 현재 방 삭제
            fireEvent.click(screen.getByRole("button", { name: "대화 목록" }));
            await waitFor(() => screen.getByRole("dialog", { name: "대화 목록" }));
            fireEvent.click(screen.getByRole("button", { name: `${current.title} 삭제` }));
            await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith(current.id));

            // 늦은 저장 완료 — 삭제된 방으로 재바인딩되면 안 된다
            saveControl.resolve?.(makeConversation({ id: current.id }));
            await new Promise((r) => setTimeout(r, 0));
            expect(window.localStorage.getItem("gugbab-health:conversation")).toBe("new");
        });

        it("저장된 활성 방 참조가 있으면 최근 방 대신 그 방을 복원한다", async () => {
            window.localStorage.setItem("gugbab-health:conversation", "conv-old");
            vi.mocked(getConversation).mockResolvedValue(
                makeConversation({ id: "conv-old", messages: [{ role: "user", content: "옛 대화 내용" }] }),
            );
            vi.mocked(getLatestConversation).mockResolvedValue(
                makeConversation({ id: "conv-latest", messages: [{ role: "user", content: "최근 대화 내용" }] }),
            );
            await renderAndWaitInput();

            await waitFor(() => expect(screen.getByText("옛 대화 내용")).toBeInTheDocument());
            expect(getConversation).toHaveBeenCalledWith("conv-old");
            expect(screen.queryByText("최근 대화 내용")).not.toBeInTheDocument();
        });

        it("새 대화 상태('new')는 새로고침 후에도 빈 대화로 유지된다", async () => {
            window.localStorage.setItem("gugbab-health:conversation", "new");
            vi.mocked(getLatestConversation).mockResolvedValue(makeConversation());
            await renderAndWaitInput();

            expect(screen.getByText(/안녕하세요! 오늘 어떤 식단을/)).toBeInTheDocument();
            expect(screen.queryByText("닭가슴살 샐러드를 추천드려요.")).not.toBeInTheDocument();
        });

        it("현재 열려 있는 방을 삭제하면 새 대화 상태로 초기화된다", async () => {
            const current = makeConversation();
            vi.mocked(getLatestConversation).mockResolvedValue(current);
            vi.mocked(listConversations).mockResolvedValue([current]);
            await renderAndWaitInput();
            await waitFor(() => screen.getByText("닭가슴살 샐러드를 추천드려요."));

            fireEvent.click(screen.getByRole("button", { name: "대화 목록" }));
            await waitFor(() => screen.getByRole("dialog", { name: "대화 목록" }));
            fireEvent.click(screen.getByRole("button", { name: `${current.title} 삭제` }));

            await waitFor(() => expect(screen.queryByText("닭가슴살 샐러드를 추천드려요.")).not.toBeInTheDocument());
            expect(screen.getByText(/안녕하세요! 오늘 어떤 식단을/)).toBeInTheDocument();
        });
    });

    describe("식재료 부족 시 추천 방식 선택 (대화방당 1회)", () => {
        beforeEach(() => {
            vi.mocked(getUserProfile).mockResolvedValue(MOCK_PROFILE);
            // 부족 상태: 3개 미만
            vi.mocked(getAllIngredients).mockResolvedValue([
                { id: "i1", name: "계란", category: "protein", addedAt: "" },
            ]);
        });

        async function renderAndWaitInput() {
            render(<ChatPage />);
            await waitFor(() => screen.getByPlaceholderText("식단을 요청해보세요..."));
        }

        function typeAndSend(text: string) {
            fireEvent.change(screen.getByPlaceholderText("식단을 요청해보세요..."), {
                target: { value: text },
            });
            fireEvent.click(screen.getByRole("button", { name: "전송" }));
        }

        it("부족하면 선택 배너를 표시하고, 선택 전에는 전송이 차단된다", async () => {
            await renderAndWaitInput();

            expect(screen.getByText(/어떻게 추천해드릴까요/)).toBeInTheDocument();
            typeAndSend("식단 짜줘");
            expect(sendMock).not.toHaveBeenCalled();
        });

        it("보유 재료로만 선택 시 pantry-only 모드로 전송한다", async () => {
            await renderAndWaitInput();
            fireEvent.click(screen.getByRole("button", { name: "보유 재료로만" }));
            typeAndSend("식단 짜줘");

            expect(sendMock).toHaveBeenCalledTimes(1);
            const body = sendMock.mock.calls[0][0] as { context: { mealPlanMode?: string } };
            expect(body.context.mealPlanMode).toBe("pantry-only");
        });

        it("자유롭게 추천 선택 시 free 모드로 전송한다", async () => {
            await renderAndWaitInput();
            fireEvent.click(screen.getByRole("button", { name: "자유롭게 추천" }));
            typeAndSend("식단 짜줘");

            const body = sendMock.mock.calls[0][0] as { context: { mealPlanMode?: string } };
            expect(body.context.mealPlanMode).toBe("free");
        });

        it("모드가 저장된 대화방에서는 다시 묻지 않는다", async () => {
            vi.mocked(getLatestConversation).mockResolvedValue(makeConversation({ mealPlanMode: "free" }));
            await renderAndWaitInput();

            expect(screen.queryByText(/어떻게 추천해드릴까요/)).not.toBeInTheDocument();
            typeAndSend("한 끼 더 추천해줘");

            expect(sendMock).toHaveBeenCalledTimes(1);
            const body = sendMock.mock.calls[0][0] as { context: { mealPlanMode?: string } };
            expect(body.context.mealPlanMode).toBe("free");
        });

        it("모드 선택 시 저장된 방이면 즉시 영속화한다", async () => {
            vi.mocked(getLatestConversation).mockResolvedValue(makeConversation({ mealPlanMode: undefined }));
            await renderAndWaitInput();
            fireEvent.click(screen.getByRole("button", { name: "보유 재료로만" }));

            await waitFor(() =>
                expect(saveConversation).toHaveBeenCalledWith(
                    expect.objectContaining({ id: "conv-1", mealPlanMode: "pantry-only" }),
                ),
            );
        });

        it("모드 선택 후 입력창으로 포커스를 되돌린다", async () => {
            await renderAndWaitInput();
            fireEvent.click(screen.getByRole("button", { name: "보유 재료로만" }));
            expect(screen.getByPlaceholderText("식단을 요청해보세요...")).toHaveFocus();
        });

        it("식재료가 풍부하면 배너 없이 바로 전송 가능하다", async () => {
            vi.mocked(getAllIngredients).mockResolvedValue(PLENTIFUL_INGREDIENTS);
            await renderAndWaitInput();

            expect(screen.queryByText(/어떻게 추천해드릴까요/)).not.toBeInTheDocument();
            typeAndSend("식단 짜줘");

            expect(sendMock).toHaveBeenCalledTimes(1);
            const body = sendMock.mock.calls[0][0] as { context: { mealPlanMode?: string } };
            expect(body.context.mealPlanMode).toBeUndefined();
        });

        it("새 대화 시 선택이 초기화되어 배너가 다시 표시된다", async () => {
            await renderAndWaitInput();
            fireEvent.click(screen.getByRole("button", { name: "보유 재료로만" }));
            expect(screen.queryByText(/어떻게 추천해드릴까요/)).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
            expect(screen.getByText(/어떻게 추천해드릴까요/)).toBeInTheDocument();
        });

        it("프로필의 키·몸무게를 컨텍스트에 포함해 전송한다", async () => {
            vi.mocked(getUserProfile).mockResolvedValue({
                ...MOCK_PROFILE,
                heightCm: 178,
                weightKg: 78,
            });
            await renderAndWaitInput();
            fireEvent.click(screen.getByRole("button", { name: "자유롭게 추천" }));
            typeAndSend("식단 짜줘");

            const body = sendMock.mock.calls[0][0] as {
                context: { heightCm?: number; weightKg?: number };
            };
            expect(body.context.heightCm).toBe(178);
            expect(body.context.weightKg).toBe(78);
        });

        it("범위 밖 저장값은 컨텍스트에서 제외한다 (과거 데이터 방어)", async () => {
            vi.mocked(getUserProfile).mockResolvedValue({
                ...MOCK_PROFILE,
                heightCm: 30,
                weightKg: 78,
            });
            await renderAndWaitInput();
            fireEvent.click(screen.getByRole("button", { name: "자유롭게 추천" }));
            typeAndSend("식단 짜줘");

            const body = sendMock.mock.calls[0][0] as {
                context: { heightCm?: number; weightKg?: number };
            };
            expect(body.context.heightCm).toBeUndefined();
            expect(body.context.weightKg).toBe(78);
        });
    });

    describe("메시지 복사", () => {
        beforeEach(() => {
            vi.mocked(getUserProfile).mockResolvedValue(MOCK_PROFILE);
            vi.mocked(getAllIngredients).mockResolvedValue(PLENTIFUL_INGREDIENTS);
            vi.mocked(getLatestConversation).mockResolvedValue(makeConversation());
        });

        it("말풍선을 롱프레스하면 복사 메뉴가 뜬다", async () => {
            render(<ChatPage />);
            const bubble = await screen.findByText("닭가슴살 샐러드를 추천드려요.");
            fireEvent.contextMenu(bubble);

            expect(screen.getByRole("button", { name: "복사" })).toBeInTheDocument();
        });

        it("복사 버튼 클릭 시 메시지 내용을 복사하고 '복사됨'을 표시한다", async () => {
            render(<ChatPage />);
            const bubble = await screen.findByText("닭가슴살 샐러드를 추천드려요.");
            fireEvent.contextMenu(bubble);
            fireEvent.click(screen.getByRole("button", { name: "복사" }));

            await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("닭가슴살 샐러드를 추천드려요."));
            await waitFor(() => expect(screen.getByText("복사됨")).toBeInTheDocument());
            // 복사 후 메뉴는 닫힌다
            expect(screen.queryByRole("button", { name: "복사" })).not.toBeInTheDocument();
        });

        it("사용자 말풍선도 복사할 수 있다", async () => {
            render(<ChatPage />);
            const bubble = await screen.findByText("닭가슴살로 뭐 해먹을까요?");
            fireEvent.contextMenu(bubble);
            fireEvent.click(screen.getByRole("button", { name: "복사" }));

            await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("닭가슴살로 뭐 해먹을까요?"));
        });

        it("복사 실패 시 실패 안내를 표시한다", async () => {
            vi.mocked(copyToClipboard).mockResolvedValue(false);
            render(<ChatPage />);
            const bubble = await screen.findByText("닭가슴살 샐러드를 추천드려요.");
            fireEvent.contextMenu(bubble);
            fireEvent.click(screen.getByRole("button", { name: "복사" }));

            await waitFor(() => expect(screen.getByText(/복사에 실패/)).toBeInTheDocument());
        });

        it("메뉴 바깥을 누르면 복사 메뉴가 닫힌다", async () => {
            render(<ChatPage />);
            const bubble = await screen.findByText("닭가슴살 샐러드를 추천드려요.");
            fireEvent.contextMenu(bubble);
            expect(screen.getByRole("button", { name: "복사" })).toBeInTheDocument();

            fireEvent.click(screen.getByRole("dialog", { name: "복사 메뉴" }));
            expect(screen.queryByRole("button", { name: "복사" })).not.toBeInTheDocument();
        });
    });
});
