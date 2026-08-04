---
name: architecture-ai-integration
description: AI 통합 아키텍처 — gugbab-claude-relay 경유 Claude 호출 (OpenAI 계획은 폐기됨)
metadata: 
  node_type: memory
  type: project
  originSessionId: 129f65e5-2b78-4b68-a65e-571f8f9d9d0e
  modified: 2026-08-04T00:31:08.209Z
---

## 현재 아키텍처 (2026-07-07 프로덕션 반영 완료)

- **AI 제공자**: Claude — 별도 서버 **gugbab-claude-relay**(`05_gugbab-claude-relay`, https://gugbab-claude-relay.vercel.app) 경유. ~~OpenAI~~ 계획은 폐기.
- **호출 경로**: 브라우저 → health `/api/chat`(서버 프록시) → relay `/api/chat` → Claude. 브라우저가 relay를 직접 호출하지 않음(CORS·시크릿 보호).
- **인증**: `X-Relay-Secret` 헤더 (env: `RELAY_URL`, `RELAY_SECRET` — 로컬 .env.local + Vercel 양쪽).
- **스킬 주입**: 과거 "OpenAI tools로 스킬 노출" 요구는 relay 방식으로 실현 — relay가 `app: "health"` 기준으로 자체 SKILL.md 5종(영양 도메인)을 시스템 프롬프트에 자동 주입. 요청별 컨텍스트(신체·식재료·mealPlanMode)는 health의 `lib/ai/context.ts` `buildSystemPrompt`가 생성해 함께 전달.
- **모델**: relay `GET /api/models`가 목록(haiku/sonnet/opus/fable)과 기본값(sonnet)을 내려줌 — 앱에 하드코딩 금지, health의 `/api/models` 프록시로 전달. 사용자 선택은 localStorage.
- **SSE 규약**: `data: {type: chunk|done|error}` — `@gugbab/utils`의 `toSSELine`/`SseEvent`, 클라이언트는 `@gugbab/hooks`의 `useSSEChat`. relay 오류·transport 실패는 모두 SSE error 이벤트(HTTP 200)로 변환하는 게 설계 규약.
- **답변 요약(2026-08 도입)**: ChatRequest `wantSummary: true`(health 프록시가 항상 전송) → `done` 이벤트에 `summary?`(한국어 1~3문장, best-effort, 실패 시 누락). health는 summary를 `ChatMessage.summary`로 IndexedDB에 저장하고, 전송 시 `lib/ai/history.ts` `toOutgoingMessages`로 이력 압축(최근 4개 원문, 오래된 답변은 요약 대체/절삭, 4000자·50개 한도는 `MESSAGE_LIMITS` 단일 소스). 다른 방 요약은 `recentMealSummaries`로 전달. 배경: 4000자 초과 식단 답변이 이력에 쌓이면 같은 방 모든 요청이 400으로 죽던 버그의 근본 수정. utils/hooks 1.2.0+, relay-types 1.0.0-202608031427+ 필요.
- **타입 계약 패키지**: `@gugbab/relay-types`(npm) — OpenAPI 생성 타입(ChatRequest·SSEEvent·ModelInfo·ModelsResponse·ModelAlias 등). health는 devDependency로 `"latest"` 태그 의존(2026-07-08 도입) — 버전이 `1.0.0-YYYYMMDDHHmm` 프리릴리즈 형식이라 `^` 범위로는 후속 버전이 안 잡힘. 갱신은 `pnpm update @gugbab/relay-types`. health의 `lib/ai/types.ts`가 re-export 지점.

**How to apply:** AI 관련 변경 시 런타임 계약은 relay 스펙(`05_gugbab-claude-relay/lib/schema.ts`), 소비자 측 TypeScript 타입은 `@gugbab/relay-types`가 단일 소스. 요청별 규칙은 health의 systemPrompt에, 도메인 지식은 relay 스킬에 둔다.
