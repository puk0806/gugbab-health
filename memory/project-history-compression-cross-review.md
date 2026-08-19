---
name: history-compression-cross-review
description: "이력 압축 크로스 리뷰(health↔dream) — 서로의 장점 상호 이식 완료 (2026-08-14, 양쪽 다 미커밋)"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab20dba6-df2f-4b12-a539-1a28bb20553a
  modified: 2026-08-18T06:54:28.874Z
---

2026-08-14, relay 입력 상한 대응(wantSummary 이력 압축)을 health와
dream(03_gugbab-claude-dream) 두 앱이 각자 구현한 것을 이 세션에서 크로스
리뷰하고, 사용자 승인 하에 양쪽에 서로의 장점을 이식했다.

**health에 이식한 것 (dream의 장점):**
- `OUTGOING_BUDGET_BYTES = 90_000` 안전 마진 (relay 상한 100KB의 90%) —
  `lib/relay-limits.ts`. 클라이언트 압축·프록시 재시도(절반 45KB)가 공유
- 프록시 사전 가드 — `app/api/chat/route.ts`가 relay 전송 전 `fitMessagesToBudget` 적용
- adversarial 테스트 — relay body 키 집합 `["app","messages","systemPrompt","wantSummary"]` 고정 검증

**dream에 이식한 것 (health의 장점):** dream 세션이 피어 목록에 미등록이라
세션 간 메시지 대신 이 세션이 dream 레포를 직접 수정(방법 A, 사용자 선택).
- `lib/chat-history.ts` 자체 압축 → `compressHistory`+`fitMessagesToBudget` 위임
  (role user|model ↔ user|assistant 매핑), 클라이언트 바이트 예산 적용
- 재시도 시 바이트 예산도 절반(`RETRY_BUDGET_BYTES = 45_000`)으로 축소
- 상세 스토리는 dream 레포 `memory/project_history_v3_cross_review.md`에 기록

2차 재점검(같은 날)에서 health에 추가 보완: ① done summary 런타임 문자열
가드(page.tsx), ② systemPrompt 20,000자 상한 사전 방어 —
`trimContextForPrompt`(context.ts, goals 중복 제거 + metrics/ingredients/summaries
절삭), ③ dream의 adversarial 테스트 3종 이식(__proto__ 오염·스택 미노출·시크릿
미노출), ④ 재시도 개수 축소 `RETRY_MAX_MESSAGES = 5`. goals 무제한 이슈는
Codex 리뷰가 발견(ACCEPT). dream 세션은 이후 활동 재개해 자체적으로 다듬는 중
(KEEP_RECENT_TURNS 3으로 조정 등) — dream 쪽은 그 세션 소관.

3차 일괄 점검(2026-08-14~18, 사용자 요청 "관점 다른 리뷰어로 한번에"): 리뷰어
3명 병렬(로직·계약 정합·데이터 손실) + Codex 반복 라운드로 수렴시킴. 반영:
① relay-types 1.0.0-202608141124 범프(violation 정식 타입), ② MetricSchema
BODY_LIMITS bound + trimContextForPrompt 숫자 round2(무제한 숫자 직렬화로
프롬프트 상한 20,031자 초과하던 실측 구멍), ③ **빈 content assistant 저장 시
방 영구 브릭** 수정 — 전송 필터 + 빈 done은 확정·저장 생략, ④ transient
메시지 개념 신설(ChatMessage.transient) — 에러 버블·미응답 user 턴을 화면에만
남기고 저장·전송 제외(이력 오염·연속 user 턴 방지, mealPlanMode 저장 경로
포함), ⑤ zod refine 첫·마지막 user 거부, ⑥ appendTranscript 추출 + 서로게이트
절단 방어, ⑦ 범위 밖 레거시 metric 클라이언트 필터(400 브릭 방지), ⑧
KEEP_RECENT_TURNS 3. 교훈: 스크래치 디렉토리에서 pnpm add가 실행되어 범프가
누락된 적 있음 — 패키지 설치는 반드시 레포 루트 cd 후 실행.

검증: health 테스트 232개·dream 115개 전부 통과, 양쪽 tsc 클린, Codex 최종
라운드 무지적 수렴 (2026-08-18).

**종결 (2026-08-18)**: health는 PR #16으로 main 머지·Vercel Production 배포
완료. 프로덕션 실측 — 신규 검증(기형 이력·범위 밖 지표) 400 동작, 실채팅
SSE·summary 수신, 압축 형태 17개 멀티턴 이력 정상 응답까지 확인. dream도
자체 세션에서 수렴 종결 선언. 크로스 포팅은 이후 handoff 문서로만 진행
(ad-hoc 스윕 금지 — dream memory의 재발 방지 규칙 참조).
양쪽 모두 미커밋 상태 — dream은 `feature/relay-input-limits` 브랜치(그쪽 세션의
기존 미커밋 변경 위), health는 main 워킹 트리. 커밋은 사용자 요청 대기.

남은 아이디어: dream에는 크로스 세션 요약 주입(health의 recentMealSummaries
상당)이 없음 — 사용자 요청 시 진행.

관련: [[architecture-ai-integration]], [[commit-push-discipline]]
