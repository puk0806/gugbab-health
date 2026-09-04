/**
 * ChatInputBar 유닛 테스트 — @gugbab/hooks useSpeechRecognition 기반.
 * 모듈 목킹 대신 가짜 window.SpeechRecognition으로 훅 실배선을 그대로 검증한다.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatInputBar from "./ChatInputBar";

interface ResultEntry {
    transcript: string;
    isFinal: boolean;
}

class FakeRecognition {
    static instances: FakeRecognition[] = [];
    lang = "";
    continuous = true;
    interimResults = false;
    onresult: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() {
        FakeRecognition.instances.push(this);
    }
    emitResults(entries: ResultEntry[], resultIndex = 0) {
        const results: Record<number | string, unknown> = { length: entries.length };
        entries.forEach((e, i) => {
            results[i] = { isFinal: e.isFinal, 0: { transcript: e.transcript } };
        });
        act(() => this.onresult?.({ results, resultIndex }));
    }
    emitEnd() {
        act(() => this.onend?.());
    }
    emitError(error: string) {
        act(() => this.onerror?.({ error }));
    }
}

function last(): FakeRecognition {
    const inst = FakeRecognition.instances[FakeRecognition.instances.length - 1];
    if (!inst) throw new Error("recognizer가 생성되지 않았습니다");
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

    // ── 경계·이상 경로 ──

    it("음성 인식 미지원이면 마이크 버튼을 숨긴다", () => {
        Reflect.deleteProperty(window, "SpeechRecognition");
        render(<ChatInputBar {...baseProps()} />);
        expect(screen.queryByRole("button", { name: "음성 입력" })).not.toBeInTheDocument();
    });

    it("마이크 탭 → 인식 시작(ko-KR), 다시 탭 → 중지", () => {
        render(<ChatInputBar {...baseProps()} />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));
        expect(last().start).toHaveBeenCalledTimes(1);
        expect(last().lang).toBe("ko-KR");

        fireEvent.click(screen.getByRole("button", { name: "음성 입력 중지" }));
        expect(last().stop).toHaveBeenCalledTimes(1);
    });

    it("중간 결과는 힌트로 표시하고 최종 결과는 입력에 추가한다", () => {
        const props = baseProps();
        render(<ChatInputBar {...props} value="오늘" />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));

        last().emitResults([{ transcript: "닭가슴", isFinal: false }]);
        expect(screen.getByText("닭가슴")).toBeInTheDocument();
        expect(props.onChange).not.toHaveBeenCalled();

        last().emitResults([{ transcript: "닭가슴살 먹었어", isFinal: true }]);
        expect(props.onChange).toHaveBeenCalledWith("오늘 닭가슴살 먹었어");
    });

    // ── 악성·오남용/에러 경로 ──

    it("권한 거부 시 에러 안내를 표시한다", () => {
        render(<ChatInputBar {...baseProps()} />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));

        last().emitError("not-allowed");
        expect(screen.getByText(/마이크 권한이 필요합니다/)).toBeInTheDocument();
    });

    it("재시작 후 이전 인스턴스의 지연 콜백은 무시한다", () => {
        render(<ChatInputBar {...baseProps()} />);

        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));
        const first = last();
        fireEvent.click(screen.getByRole("button", { name: "음성 입력 중지" }));
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));

        // 중지된 첫 인스턴스의 늦은 onend — 새 세션의 듣기 상태를 건드리면 안 됨
        first.emitEnd();
        expect(screen.getByRole("button", { name: "음성 입력 중지" })).toBeInTheDocument();
    });

    it("스트리밍 시작(disabled) 시 진행 중이던 인식을 파기하고 늦은 결과를 무시한다", () => {
        const props = baseProps();
        const { rerender } = render(<ChatInputBar {...props} />);
        fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));
        const inst = last();

        rerender(<ChatInputBar {...props} disabled />);
        expect(inst.abort).toHaveBeenCalled();

        inst.emitResults([{ transcript: "늦게 도착한 결과", isFinal: true }]);
        expect(props.onChange).not.toHaveBeenCalled();
    });

    it("disabled(스트리밍 중)면 입력과 마이크가 모두 비활성화된다", () => {
        render(<ChatInputBar {...baseProps()} disabled />);
        expect(screen.getByPlaceholderText("식단을 요청해보세요...")).toBeDisabled();
        expect(screen.getByRole("button", { name: "음성 입력" })).toBeDisabled();
    });
});
