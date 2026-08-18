import { useEffect, useRef, useState } from "react";
import { createRecognizer, isRecognitionSupported, type MicError, type SpeechRecognizer } from "@/lib/speech";
import styles from "./ChatInputBar.module.css";

/**
 * 음성 인식 최종 결과를 기존 입력에 이어붙인다.
 * input의 maxLength 속성은 프로그램적 onChange를 막지 못하므로 여기서 상한을 강제하고,
 * 절단 지점이 서로게이트 쌍(이모지 등) 중간이면 한 코드유닛 더 제거해 깨진 문자를 남기지 않는다.
 */
export function appendTranscript(prev: string, transcript: string, max?: number): string {
    const composed = prev ? `${prev} ${transcript}` : transcript;
    if (max === undefined || composed.length <= max) return composed;
    const cut = composed.slice(0, max);
    const last = cut.charCodeAt(cut.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

const MIC_ERROR_MESSAGES: Record<MicError, string> = {
    "not-allowed": "마이크 권한이 필요합니다. 브라우저 설정에서 허용해주세요.",
    "no-speech": "음성이 감지되지 않았습니다. 다시 시도해주세요.",
    network: "네트워크 오류로 음성 인식에 실패했습니다.",
    unknown: "음성 인식에 실패했습니다. 다시 시도해주세요.",
};

interface ChatInputBarProps {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    /** 스트리밍 중 — 입력·마이크·전송 모두 비활성 */
    disabled: boolean;
    /** 전송만 차단 (식재료 부족 모드 미선택 등) */
    sendBlocked?: boolean;
    /** 입력 글자 수 상한 — 개별 메시지 길이 제한 초과를 입력 시점에 방어 */
    maxLength?: number;
    inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function ChatInputBar({
    value,
    onChange,
    onSend,
    disabled,
    sendBlocked = false,
    maxLength,
    inputRef,
}: ChatInputBarProps) {
    const [micAvailable, setMicAvailable] = useState(false);
    const [listening, setListening] = useState(false);
    const [interimText, setInterimText] = useState("");
    const [micError, setMicError] = useState("");
    const recognizerRef = useRef<SpeechRecognizer | null>(null);
    // 인식 콜백이 생성 시점의 value에 고정되지 않도록 최신 값을 ref로 추적
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
        setMicAvailable(isRecognitionSupported());
    }, []);

    useEffect(() => {
        return () => {
            recognizerRef.current?.abort();
        };
    }, []);

    // 전송 등으로 비활성화되면 진행 중이던 인식을 즉시 중단 — 늦은 결과가 입력을 다시 채우는 것 방지
    useEffect(() => {
        if (!disabled) return;
        recognizerRef.current?.abort();
        recognizerRef.current = null;
        setListening(false);
        setInterimText("");
    }, [disabled]);

    function handleMic() {
        setMicError("");
        if (listening) {
            recognizerRef.current?.stop();
            setListening(false);
            setInterimText("");
            return;
        }
        recognizerRef.current?.abort();

        try {
            // 이전 인스턴스의 지연 콜백(onend/onerror)이 새 세션 상태를 뒤집지 않도록
            // 콜백마다 자신이 현재 활성 인스턴스인지 확인한다
            const rec: SpeechRecognizer = createRecognizer(
                (transcript, isFinal) => {
                    if (recognizerRef.current !== rec) return;
                    if (isFinal) {
                        // 최종 결과만 실제 입력에 반영 (interim 덮어쓰기 방지)
                        onChange(appendTranscript(valueRef.current, transcript, maxLength));
                        setInterimText("");
                    } else {
                        setInterimText(transcript);
                    }
                },
                () => {
                    if (recognizerRef.current !== rec) return;
                    setListening(false);
                    setInterimText("");
                },
                (type) => {
                    if (recognizerRef.current !== rec) return;
                    setListening(false);
                    setInterimText("");
                    setMicError(MIC_ERROR_MESSAGES[type]);
                },
            );
            recognizerRef.current = rec;
            rec.start();
            setListening(true);
        } catch {
            setMicError(MIC_ERROR_MESSAGES.unknown);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
        }
    }

    return (
        <>
            {(interimText || micError) && (
                <div className={styles.micHint}>
                    {interimText && (
                        <span className={styles.interim} aria-live="polite">
                            {interimText}
                        </span>
                    )}
                    {micError && (
                        <span className={styles.micError} role="alert">
                            {micError}
                        </span>
                    )}
                </div>
            )}
            <div className={styles.inputBar}>
                {micAvailable && (
                    <button
                        type="button"
                        className={listening ? styles.micBtnActive : styles.micBtn}
                        onClick={handleMic}
                        disabled={disabled}
                        aria-label={listening ? "음성 입력 중지" : "음성 입력"}
                    >
                        {listening ? "■" : "🎤"}
                    </button>
                )}
                <input
                    ref={inputRef}
                    className={styles.input}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="식단을 요청해보세요..."
                    disabled={disabled}
                    maxLength={maxLength}
                />
                <button
                    type="button"
                    className={styles.sendBtn}
                    onClick={onSend}
                    disabled={!value.trim() || disabled || sendBlocked}
                >
                    전송
                </button>
            </div>
        </>
    );
}
