import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatInputBar from "./ChatInputBar";

/**
 * 음성 인식은 @gugbab/hooks의 useSpeechRecognition에 위임한다.
 * 훅 내부(세션 가드 등)는 패키지가 검증하므로, 여기서는 가짜 window.SpeechRecognition으로
 * 실제 훅을 구동해 ChatInputBar의 배선(표시·문구 매핑·상한·비활성)만 검증한다.
 */
class FakeRecognition {
    static instances: FakeRecognition[] = [];
    lang = "";
    continuous = false;
    interimResults = true;
    onresult: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() {
        FakeRecognition.instances.push(this);
    }

    emit(transcript: string, isFinal: boolean) {
        const results: Record<number | string, unknown> = {
            length: 1,
            0: { isFinal, 0: { transcript } },
        };
        act(() => this.onresult?.({ results, resultIndex: 0 }));
    }

    emitError(error: string) {
        act(() => this.onerror?.({ error }));
    }

    emitEnd() {
        act(() => this.onend?.());
    }
}

function last(): FakeRecognition {
    const inst = FakeRecognition.instances[FakeRecognition.instances.length - 1];
    if (!inst) throw new Error("SpeechRecognition 인스턴스 없음");
    return inst;
}

function baseProps() {
    return {
        value: "",
        onChange: vi.fn(),
        onSend: vi.fn(),
        disabled: false,
    };
}

describe("ChatInputBar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        FakeRecognition.instances = [];
        Reflect.set(window, "SpeechRecognition", FakeRecognition);
    });

    afterEach(() => {
        Reflect.deleteProperty(window, "SpeechRecognition");
    });

    it("입력·전송이 동작한다", () => {
        const props = baseProps();
        render(<ChatInputBar {...props} value="샐러드" />);

        fireEvent.change(screen.getByPlaceholderText("식단을 요청해보세요..."), {
            target: { value: "샐러드 추천" },
        });
        expect(props.onChange).toHaveBeenCalledWith("샐러드 추천");

        fireEvent.click(screen.getByRole("button", { name: "전송" }));
        expect(props.onSend).toHaveBeenCalledTimes(1);
    });

    it("Enter 키로 전송한다", () => {
        const props = baseProps();
        render(<ChatInputBar {...props} value="안녕" />);
        fireEvent.keyDown(screen.getByPlaceholderText("식단을 요청해보세요..."), { key: "Enter" });
        expect(props.onSend).toHaveBeenCalledTimes(1);
    });

    it("sendBlocked면 전송 버튼이 비활성화된다", () => {
        render(<ChatInputBar {...baseProps()} value="안녕" sendBlocked />);
        expect(screen.getByRole("button", { name: "전송" })).toBeDisabled();
    });

    it("음성 인식 미지원이면 마이크 버튼을 숨긴다", () => {
        Reflect.deleteProperty(window, "SpeechRecognition");
        render(<ChatInputBar {...baseProps()} />);
        expect(screen.queryByRole("button", { name: "음성 입력" })).not.toBeInTheDocument();
    });

    it("마이크 탭 → 인식 시작, 다시 탭 → 중지", () => {
        render(<ChatInputBar {...baseProps()} />);

        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));
        const rec = last();
        expect(rec.start).toHaveBeenCalledTimes(1);
        expect(rec.lang).toBe("ko-KR");

        fireEvent.click(screen.getByRole("button", { name: "음성 입력 중지" }));
        expect(rec.stop).toHaveBeenCalledTimes(1);
    });

    it("중간 결과는 힌트로 표시하고 최종 결과는 입력에 추가한다", () => {
        const props = baseProps();
        render(<ChatInputBar {...props} value="오늘" />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));

        last().emit("닭가슴", false);
        expect(screen.getByText("닭가슴")).toBeInTheDocument();
        expect(props.onChange).not.toHaveBeenCalled();

        last().emit("닭가슴살 먹었어", true);
        expect(props.onChange).toHaveBeenCalledWith("오늘 닭가슴살 먹었어");
    });

    it("최종 결과도 maxLength 상한을 넘지 않는다 (프로그램적 입력은 maxLength 속성을 우회)", () => {
        const props = baseProps();
        render(<ChatInputBar {...props} value={"가".repeat(10)} maxLength={15} />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));

        last().emit("나".repeat(10), true);
        expect(props.onChange).toHaveBeenCalledWith(expect.stringMatching(/^.{15}$/));
    });

    it("권한 거부 시 에러 안내를 표시한다", () => {
        render(<ChatInputBar {...baseProps()} />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));

        last().emitError("not-allowed");
        expect(screen.getByText(/마이크 권한이 필요합니다/)).toBeInTheDocument();
    });

    it("스트리밍 시작(disabled) 시 진행 중이던 인식을 파기하고 늦은 결과를 무시한다", () => {
        const props = baseProps();
        const { rerender } = render(<ChatInputBar {...props} />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));
        const rec = last();

        rerender(<ChatInputBar {...props} disabled />);
        expect(rec.abort).toHaveBeenCalled();

        rec.emit("늦게 도착한 결과", true);
        expect(props.onChange).not.toHaveBeenCalled();
    });

    it("disabled(스트리밍 중)면 입력과 마이크가 모두 비활성화된다", () => {
        render(<ChatInputBar {...baseProps()} disabled />);
        expect(screen.getByPlaceholderText("식단을 요청해보세요...")).toBeDisabled();
        expect(screen.getByRole("button", { name: "음성 입력" })).toBeDisabled();
    });
});
