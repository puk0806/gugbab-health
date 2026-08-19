import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addBodyMetric, deleteBodyMetric, getLatestBodyMetrics } from "@/lib/db/bodyMetrics";
import BodyPage from "./page";

vi.mock("@/components/layout/BottomNav", () => ({
    default: ({ active }: { active: string }) => <nav data-testid="bottom-nav" data-active={active} />,
}));

vi.mock("@/lib/db/bodyMetrics", () => ({
    getLatestBodyMetrics: vi.fn().mockResolvedValue([]),
    addBodyMetric: vi.fn(),
    deleteBodyMetric: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/index", () => ({
    getLocalDateString: vi.fn().mockReturnValue("2026-06-27"),
    getDB: vi.fn(),
}));

describe("BodyPage", () => {
    beforeEach(() => {
        vi.mocked(getLatestBodyMetrics).mockResolvedValue([]);
        vi.mocked(addBodyMetric).mockClear();
    });

    it("renders weight input and save button", () => {
        render(<BodyPage />);
        expect(screen.getByLabelText(/체중/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
    });

    it("save button is disabled when weight is empty", () => {
        render(<BodyPage />);
        expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    });

    it("shows empty state when no records", async () => {
        render(<BodyPage />);
        await waitFor(() => expect(screen.getByText("기록이 없습니다")).toBeInTheDocument());
    });

    it("renders BottomNav with active=body", () => {
        render(<BodyPage />);
        expect(screen.getByTestId("bottom-nav")).toHaveAttribute("data-active", "body");
    });

    it("saves metric and shows record in list", async () => {
        vi.mocked(addBodyMetric).mockResolvedValue({
            id: "01",
            date: "2026-06-27",
            weight: 70,
            recordedAt: "",
        });

        render(<BodyPage />);
        fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "70" } });
        fireEvent.click(screen.getByRole("button", { name: "저장" }));

        await waitFor(() => expect(screen.getByText("70 kg")).toBeInTheDocument());
    });

    describe("입력 검증 (빨간 에러)", () => {
        it("범위 밖 체중은 에러 문구 표시 + 저장 차단", () => {
            render(<BodyPage />);
            fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "501" } });

            expect(screen.getByText("10~500 사이 숫자로 입력해주세요")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

            fireEvent.click(screen.getByRole("button", { name: "저장" }));
            expect(addBodyMetric).not.toHaveBeenCalled();
        });

        it("범위 밖 체지방률·골격근량도 각각 에러 표시", () => {
            render(<BodyPage />);
            fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "70" } });
            fireEvent.change(screen.getByLabelText(/체지방률/), { target: { value: "80" } });
            fireEvent.change(screen.getByLabelText(/골격근량/), { target: { value: "150" } });

            expect(screen.getByText("1~70 사이 숫자로 입력해주세요")).toBeInTheDocument();
            expect(screen.getByText("1~100 사이 숫자로 입력해주세요")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
        });

        it("골격근량이 체중보다 크면 에러 표시", () => {
            render(<BodyPage />);
            fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "50" } });
            fireEvent.change(screen.getByLabelText(/골격근량/), { target: { value: "90" } });

            expect(screen.getByText("골격근량은 체중보다 클 수 없어요")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
        });

        it("체지방률 입력 시 제지방량을 골격근량 상한으로 본다", () => {
            render(<BodyPage />);
            fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "70" } });
            fireEvent.change(screen.getByLabelText(/체지방률/), { target: { value: "30" } });
            fireEvent.change(screen.getByLabelText(/골격근량/), { target: { value: "55" } });

            // 제지방량 49kg 초과 — 안내 문구에 계산된 상한이 포함된다
            expect(screen.getByText(/제지방량\(49kg\)/)).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
        });

        it("체중 미입력 상태의 골격근량은 오탐 에러를 내지 않는다", () => {
            render(<BodyPage />);
            fireEvent.change(screen.getByLabelText(/골격근량/), { target: { value: "35" } });

            expect(screen.queryByText("골격근량은 체중보다 클 수 없어요")).not.toBeInTheDocument();
        });

        it("소수점 둘째 자리 이하를 버려서 저장한다 (반올림 아님)", async () => {
            render(<BodyPage />);
            fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "70.99" } });
            fireEvent.change(screen.getByLabelText(/체지방률/), { target: { value: "30.55" } });
            fireEvent.change(screen.getByLabelText(/골격근량/), { target: { value: "33.789" } });
            fireEvent.click(screen.getByRole("button", { name: "저장" }));

            await waitFor(() =>
                expect(addBodyMetric).toHaveBeenCalledWith({
                    weight: 70.9,
                    bodyFatPct: 30.5,
                    skeletalMuscleMass: 33.7,
                }),
            );
        });

        it("에러를 고치면 저장 버튼이 다시 활성화된다", () => {
            render(<BodyPage />);
            fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "501" } });
            expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

            fireEvent.change(screen.getByLabelText(/체중/), { target: { value: "70" } });
            expect(screen.queryByText(/사이 숫자로 입력해주세요/)).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
        });
    });

    describe("기록 삭제", () => {
        it("삭제 버튼 클릭 시 deleteBodyMetric 호출 + 재조회로 목록 갱신", async () => {
            vi.mocked(getLatestBodyMetrics)
                .mockResolvedValueOnce([
                    { id: "m1", date: "2026-07-06", weight: 78, recordedAt: "" },
                    { id: "m2", date: "2026-07-07", weight: 77.5, recordedAt: "" },
                ])
                // 삭제 후 재조회 — 8번째로 밀려 있던 이전 기록이 채워지는 상황
                .mockResolvedValueOnce([
                    { id: "m0", date: "2026-07-05", weight: 78.4, recordedAt: "" },
                    { id: "m2", date: "2026-07-07", weight: 77.5, recordedAt: "" },
                ]);
            render(<BodyPage />);
            await waitFor(() => expect(screen.getByText("78 kg")).toBeInTheDocument());

            fireEvent.click(screen.getByRole("button", { name: "2026-07-06 기록 삭제" }));

            await waitFor(() => expect(deleteBodyMetric).toHaveBeenCalledWith("m1"));
            await waitFor(() => expect(screen.queryByText("78 kg")).not.toBeInTheDocument());
            expect(screen.getByText("77.5 kg")).toBeInTheDocument();
            expect(screen.getByText("78.4 kg")).toBeInTheDocument();
        });
    });
});
