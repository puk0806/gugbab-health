/**
 * 마이크 파이프라인 통합 테스트 — @gugbab/hooks 실배선을 목킹하지 않고
 * 가짜 window.SpeechRecognition으로 실제 브라우저 이벤트 시퀀스를 재현한다.
 * (유닛 테스트가 speech.ts와 ChatInputBar를 따로 검증하며 놓치는 조합 결함 방지)
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatInputBar from "./ChatInputBar";

interface FakeResultEntry {
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

    /** Chrome 스타일 onresult 이벤트 발화 */
    emitResults(entries: FakeResultEntry[], resultIndex = 0) {
        const results: Record<number | string, unknown> = { length: entries.length };
        entries.forEach((e, i) => {
            results[i] = { isFinal: e.isFinal, 0: { transcript: e.transcript } };
        });
        act(() => this.onresult?.({ results, resultIndex }));
    }

    /** resultIndex 속성이 아예 없는 구형/비표준 브라우저 이벤트 발화 */
    emitResultsWithoutIndex(entries: FakeResultEntry[]) {
        const results: Record<number | string, unknown> = { length: entries.length };
        entries.forEach((e, i) => {
            results[i] = { isFinal: e.isFinal, 0: { transcript: e.transcript } };
        });
        act(() => this.onresult?.({ results }));
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

const onSendMock = vi.fn();

/** 실제 상태 배선 — 부모(page.tsx)의 value/onChange 연결과 동일 */
function Harness() {
    const [value, setValue] = useState("");
    return <ChatInputBar value={value} onChange={setValue} onSend={onSendMock} disabled={false} />;
}

function input(): HTMLInputElement {
    return screen.getByPlaceholderText("식단을 요청해보세요...") as HTMLInputElement;
}

function startMic() {
    fireEvent.click(screen.getByRole("button", { name: "음성 입력" }));
}

describe("마이크 통합 (실제 speech.ts 파이프라인)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        FakeRecognition.instances = [];
        Reflect.set(window, "SpeechRecognition", FakeRecognition);
    });

    afterEach(() => {
        Reflect.deleteProperty(window, "SpeechRecognition");
    });

    it("Chrome 시퀀스: 말하는 동안 중간 글자가 보이다가 최종 결과가 입력창에 들어간다", () => {
        render(<Harness />);
        startMic();
        const rec = last();
        expect(rec.start).toHaveBeenCalledTimes(1);
        expect(rec.lang).toBe("ko-KR");

        // 말하는 동안 — 같은 result(index 0)가 갱신되며 interim 반복
        rec.emitResults([{ transcript: "오늘", isFinal: false }]);
        expect(screen.getByText("오늘")).toBeInTheDocument();

        rec.emitResults([{ transcript: "오늘 저녁", isFinal: false }]);
        expect(screen.getByText("오늘 저녁")).toBeInTheDocument();
        expect(input().value).toBe(""); // 아직 입력창에는 안 들어감

        // 최종 확정 — 한 번에 입력창으로
        rec.emitResults([{ transcript: "오늘 저녁 추천해줘", isFinal: true }]);
        rec.emitEnd();

        expect(input().value).toBe("오늘 저녁 추천해줘");
        expect(screen.queryByText("오늘 저녁")).not.toBeInTheDocument(); // 힌트 사라짐
        expect(screen.getByRole("button", { name: "음성 입력" })).toBeInTheDocument(); // 듣기 종료
    });

    it("기존 입력이 있으면 최종 결과를 뒤에 이어붙인다", () => {
        render(<Harness />);
        fireEvent.change(input(), { target: { value: "메모:" } });
        startMic();

        last().emitResults([{ transcript: "닭가슴살 200g", isFinal: true }]);
        expect(input().value).toBe("메모: 닭가슴살 200g");
    });

    it("두 번 연속 사용해도 각각 정상 입력된다 (재시작 가드가 과차단하지 않음)", () => {
        render(<Harness />);

        startMic();
        last().emitResults([{ transcript: "첫 문장", isFinal: true }]);
        last().emitEnd();
        expect(input().value).toBe("첫 문장");

        startMic();
        last().emitResults([{ transcript: "둘째 문장", isFinal: true }]);
        last().emitEnd();
        expect(input().value).toBe("첫 문장 둘째 문장");
    });

    it("final과 새 interim이 한 이벤트에 배치돼도 final을 잃지 않는다", () => {
        render(<Harness />);
        startMic();

        last().emitResults([
            { transcript: "안녕하세요", isFinal: true },
            { transcript: "오늘", isFinal: false },
        ]);
        expect(input().value).toBe("안녕하세요");
        expect(screen.getByText("오늘")).toBeInTheDocument();
    });

    it("resultIndex가 없는 브라우저에서도 결과를 잃지 않는다 (방어)", () => {
        render(<Harness />);
        startMic();

        last().emitResultsWithoutIndex([{ transcript: "사파리 결과", isFinal: true }]);
        expect(input().value).toBe("사파리 결과");
    });

    it("resultIndex 없는 누적 리스트에서 이전 final을 중복 입력하지 않는다", () => {
        render(<Harness />);
        startMic();
        const rec = last();

        rec.emitResultsWithoutIndex([{ transcript: "첫 문장", isFinal: true }]);
        expect(input().value).toBe("첫 문장");

        // 누적 구현: 다음 이벤트에 이전 final이 그대로 포함되어 옴
        rec.emitResultsWithoutIndex([
            { transcript: "첫 문장", isFinal: true },
            { transcript: "둘째 문장", isFinal: true },
        ]);
        expect(input().value).toBe("첫 문장 둘째 문장"); // "첫 문장"이 두 번 들어가면 안 됨
    });

    it("resultIndex 없이 final+interim이 배치돼도 final을 잃지 않는다", () => {
        render(<Harness />);
        startMic();

        last().emitResultsWithoutIndex([
            { transcript: "확정 문장", isFinal: true },
            { transcript: "이어지는", isFinal: false },
        ]);
        expect(input().value).toBe("확정 문장");
        expect(screen.getByText("이어지는")).toBeInTheDocument();
    });

    it("무음(no-speech) 시 안내 문구를 보여주고 듣기를 종료한다", () => {
        render(<Harness />);
        startMic();
        const rec = last();

        act(() => rec.onerror?.({ error: "no-speech" }));
        rec.emitEnd();

        expect(screen.getByText(/음성이 감지되지 않았습니다/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "음성 입력" })).toBeInTheDocument();
    });
});
