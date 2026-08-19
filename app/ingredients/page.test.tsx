import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addIngredient, getAllIngredients } from "@/lib/db/ingredients";
import IngredientsPage from "./page";

vi.mock("@/components/layout/BottomNav", () => ({
    default: ({ active }: { active: string }) => <nav data-testid="bottom-nav" data-active={active} />,
}));

vi.mock("@/lib/db/ingredients", () => ({
    getAllIngredients: vi.fn().mockResolvedValue([]),
    addIngredient: vi.fn(),
    deleteIngredient: vi.fn().mockResolvedValue(undefined),
}));

describe("IngredientsPage", () => {
    beforeEach(() => {
        vi.mocked(getAllIngredients).mockResolvedValue([]);
        vi.mocked(addIngredient).mockClear();
    });

    it("renders add form with name input only (카테고리 폐지)", async () => {
        render(<IngredientsPage />);
        expect(screen.getByRole("textbox", { name: "식재료 이름" })).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "카테고리" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "추가" })).toBeInTheDocument();
    });

    it("add button is disabled when name is empty", () => {
        render(<IngredientsPage />);
        expect(screen.getByRole("button", { name: "추가" })).toBeDisabled();
    });

    it("shows empty state when no ingredients", async () => {
        render(<IngredientsPage />);
        await waitFor(() => expect(screen.getByText("등록된 식재료가 없습니다")).toBeInTheDocument());
    });

    it("renders BottomNav with active=ingredients", () => {
        render(<IngredientsPage />);
        expect(screen.getByTestId("bottom-nav")).toHaveAttribute("data-active", "ingredients");
    });

    it("adds ingredient and shows it in list", async () => {
        vi.mocked(addIngredient).mockResolvedValue({
            id: "01",
            name: "당근",
            addedAt: "",
        });

        render(<IngredientsPage />);
        fireEvent.change(screen.getByRole("textbox", { name: "식재료 이름" }), {
            target: { value: "당근" },
        });
        fireEvent.click(screen.getByRole("button", { name: "추가" }));

        await waitFor(() => expect(screen.getByText("당근")).toBeInTheDocument());
        // 이름만 인자로 전달 — 카테고리 인자 폐지
        expect(vi.mocked(addIngredient)).toHaveBeenCalledWith("당근");
    });
});
