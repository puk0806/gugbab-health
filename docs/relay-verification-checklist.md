# relay 연동 최종 검증 체크리스트 — health

> relay(`05_gugbab-claude-relay`) 2026-08-18 기준 최신 계약에 대한 앱 측 확인 항목.
> 이 파일은 relay 세션에서 생성함. 새 health 세션에 "이 파일 읽고 검증 진행해줘"로 전달.

## relay 최신 상태 (전부 프로덕션 배포·검증 완료)

| 날짜 | 변경 | 앱 영향 |
|------|------|---------|
| 08-13 | 한글 멀티바이트 청크 오염 수정 (PR #17) | `stream inconsistency` 오탐 소멸 |
| 08-14 | 입력 상한 도입 (PR #19): 메시지 20,000자·100개·합산 UTF-8 100,000바이트·systemPrompt 20,000자 | 초과 시 400 — **이력 압축이 전제** |
| 08-14 | 400에 `violation` 필드 (PR #21): `"history-budget"`(트림 재시도 가능) / `"message-size"`(입력 축소 안내) | `isHistoryValidationError`가 이 필드로 판정 |
| 08-18 | **요약 마커 쌍·런 노출 수정 (PR #22)**: 마커 반복 변종에도 마커 미노출·summary 정상 탑재 | summary 유실률 감소 → **압축 품질 회복** |

relay 측 실측: haiku·wantSummary 3회 — 마커 노출 0·error 0·summary 탑재 확인 (08-18).

## 검증 결과 (2026-08-18, 전 항목 통과)

구현은 PR #16(`[app] Modify: 이력 압축 공통 유틸 위임 + relay 입력 상한 대응`)으로
main 머지·Vercel Production 배포 완료. 아래는 배포된 프로덕션 대상 검증 결과.

### A. summary 수신·저장 (PR #22로 유실률 개선 — 재확인)
- [x] 매 응답 후 `done.summary`가 IndexedDB에 assistant 턴과 함께 저장되는지
      → `app/page.tsx` 확정 이펙트에서 assistant 턴에 부착 저장
- [x] summary 부재(생성 실패) 시 원문 유지 폴백이 동작하는지
      → `handleDone`이 비문자열·빈 문자열을 undefined로 정규화, 단위 테스트 커버
- [x] 말풍선에 `<<<SUMMARY>>>`나 요약 원문이 노출되지 않는지 (5회 이상)
      → **프로덕션 5회 호출: 마커 노출 0건 / summary 탑재 5/5 / error 0건**

### B. 이력 압축 전송 (구현 완료분 회귀 확인)
- [x] `compressHistory(messages, { getSummary, keepRecentTurns: N })` — 오래된 assistant 턴이 저장된 summary로 교체돼 전송되는지
      → `lib/ai/history.ts` (N = 3왕복, 리팩터링 이전 "최근 4개 메시지" 보호 범위 포함)
- [x] `fitMessagesToBudget(compressed, ...)` — 바이트·개수 **둘 다** 전달되는지
      → 전달함. 단 상한 그대로가 아니라 **안전 마진 적용**: 90,000B(상한의 90%) /
        30개(상한 100). 경계값 오차·상수 drift 대비로 의도적으로 더 보수적
- [x] recentMealSummaries가 저장된 summary 기반으로 채워지는지
      → 방별 최신 summary 수집 후 현재 방 제외·최대 5개 주입
- [x] 상수가 로컬 const 파일에 모여 있는지 → `lib/relay-limits.ts` (`x-relay-limits` 참조 소스 주석 명시)

### C. 400 대응
- [x] `isHistoryValidationError` true → 재압축 후 1회 자동 재시도
      → 프록시(`app/api/chat/route.ts`)에서 예산 절반(45,000B)·최근 5개로 축소해 1회.
        클라이언트 훅이 에러 body를 노출하지 않아 프록시에 배치
- [x] `violation === "message-size"` → 안내 (재시도 금지)
- [x] 입력창 글자 수 제한
      → 앱 자체 상한과 일치하는 **4,000자**(relay 20,000자보다 엄격) + 음성 입력
        경로 clamp(서로게이트 절단 방어)

### D. 실측 시나리오 (핵심 — 상한 도입의 원 목적)
- [x] 요약 10개 이상 누적 후에도 400 없이 대화 지속되는지
      → **요약 11개 누적 + 최근 왕복 원문, 총 25개 메시지로 프로덕션 호출 → 정상 응답**
- [x] 압축 전후 payload 크기 비교 — 실제로 감소하는지
      → **82,207B → 8,321B (10%, 90% 감소)** — 요약 12개 누적 시나리오 실측
- [x] 압축된 이력으로도 answer 품질이 유지되는지 (직전 맥락 참조 정확도)
      → "방금 추천한 메뉴에서 탄수화물만 바꿔줘" 요청에 직전 턴 구성을 정확히 인식,
        현미밥(150kcal)만 구운 단호박(90kcal)으로 교체하고 총 칼로리 586→526kcal 재계산

### 부수 확인 (배포본이 신규 코드임을 동작으로 검증)
- assistant로 끝나는 기형 이력 → 400 (신규 zod refine)
- 범위 밖 신체 지표(weight 9999) → 400 (신규 BODY_LIMITS bound)

### 앱 측 추가 방어 (체크리스트 항목 외, 리뷰에서 발견해 함께 수정)
- systemPrompt 상한(20,000자) 사전 절삭 — `trimContextForPrompt`.
  이 400은 history-budget 재시도로 복구 불가한 유형이라 사전 방어가 유일한 수단
- 빈 응답(chunk 없이 done) 저장 시 이후 모든 전송이 검증에 걸려 방이 영구 전송
  불가가 되던 버그 수정
- 에러 안내·미응답 user 턴을 `transient`로 분리 — 화면에만 표시, 저장·전송 제외

## 문제 발견 시

relay 쪽 원인으로 보이면 (summary 유실, 오탐 400, 스트림 오염 등):
원인 분석을 `05_gugbab-claude-relay/docs/handoff/`에 md로 작성해 relay 세션에 전달
(선례: `summary-marker-pair-leak-prompt.md` — 증상 SSE 원문·원인 분석·작업 요청 구조).
