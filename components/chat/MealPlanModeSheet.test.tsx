import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MealPlanModeSheet from "./MealPlanModeSheet";

describe("MealPlanModeSheet", () => {
    it("모달 다이얼로그로 안내 문구와 두 선택지를 표시한다", () => {
        render(<MealPlanModeSheet onSelect={vi.fn()} />);
        expect(screen.getByRole("dialog", { name: "추천 방식 선택" })).toBeInTheDocument();
        expect(screen.getByText(/어떻게 추천해드릴까요/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "보유 재료로만" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "자유롭게 추천" })).toBeInTheDocument();
    });

    it("선택 시 해당 모드로 onSelect 호출", () => {
        const onSelect = vi.fn();
        render(<MealPlanModeSheet onSelect={onSelect} />);
        fireEvent.click(screen.getByRole("button", { name: "보유 재료로만" }));
        expect(onSelect).toHaveBeenCalledWith("pantry-only");
        fireEvent.click(screen.getByRole("button", { name: "자유롭게 추천" }));
        expect(onSelect).toHaveBeenCalledWith("free");
    });

    it("마운트 시 첫 번째 선택지로 포커스를 이동한다", () => {
        render(<MealPlanModeSheet onSelect={vi.fn()} />);
        expect(screen.getByRole("button", { name: "보유 재료로만" })).toHaveFocus();
    });

    it("Tab 포커스가 시트 안에서 순환한다", () => {
        render(<MealPlanModeSheet onSelect={vi.fn()} />);
        const dialog = screen.getByRole("dialog", { name: "추천 방식 선택" });
        const first = screen.getByRole("button", { name: "보유 재료로만" });
        const last = screen.getByRole("button", { name: "자유롭게 추천" });

        last.focus();
        fireEvent.keyDown(dialog, { key: "Tab" });
        expect(first).toHaveFocus();

        fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
        expect(last).toHaveFocus();
    });

    it("선택 강제 — 백드롭 클릭·ESC로 닫히지 않는다", () => {
        const onSelect = vi.fn();
        render(<MealPlanModeSheet onSelect={onSelect} />);
        const dialog = screen.getByRole("dialog", { name: "추천 방식 선택" });

        fireEvent.click(dialog);
        fireEvent.keyDown(window, { key: "Escape" });

        expect(screen.getByRole("dialog", { name: "추천 방식 선택" })).toBeInTheDocument();
        expect(onSelect).not.toHaveBeenCalled();
    });
});
