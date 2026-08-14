---
name: history-compression-cross-review
description: "이력 압축 크로스 리뷰(health↔dream) — 서로의 장점 상호 이식 완료 (2026-08-14, 양쪽 다 미커밋)"
metadata: 
  node_type: memory
  type: project
  originSessionId: ab20dba6-df2f-4b12-a539-1a28bb20553a
  modified: 2026-08-14T07:20:45.120Z
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

검증: health 테스트 215개·dream 115개 전부 통과, 양쪽 tsc·biome 클린.
양쪽 모두 미커밋 상태 — dream은 `feature/relay-input-limits` 브랜치(그쪽 세션의
기존 미커밋 변경 위), health는 main 워킹 트리. 커밋은 사용자 요청 대기.

남은 아이디어: dream에는 크로스 세션 요약 주입(health의 recentMealSummaries
상당)이 없음 — 사용자 요청 시 진행.

관련: [[architecture-ai-integration]], [[commit-push-discipline]]
