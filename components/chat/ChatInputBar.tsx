import { type MicError, useSpeechRecognition } from "@gugbab/hooks";
import { appendTranscript } from "@gugbab/utils";
import { useEffect, useRef } from "react";
import styles from "./ChatInputBar.module.css";

// 에러 문구는 앱 정책 — 패키지 훅은 MicError 분류만 반환한다
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
    // 인식 콜백이 생성 시점의 value에 고정되지 않도록 최신 값을 ref로 추적
    const valueRef = useRef(value);
    valueRef.current = value;

    const {
        supported: micAvailable,
        listening,
        interimText,
        error,
        abort,
        toggle,
    } = useSpeechRecognition({
        lang: "ko-KR",
        // 최종 결과만 입력에 반영 — 이어붙이기·상한 정책은 앱이 정한다
        onFinal: (transcript) => onChange(appendTranscript(valueRef.current, transcript, maxLength)),
    });
    const micError = error ? MIC_ERROR_MESSAGES[error] : "";

    // 전송 등으로 비활성화되면 진행 중이던 인식을 즉시 파기 — 늦은 결과가 입력을 다시 채우는 것 방지
    useEffect(() => {
        if (disabled) abort();
    }, [disabled, abort]);

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
                        onClick={toggle}
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
