# Memory Index

- [프로젝트 개요](project-gugbab-health.md) — gugbab-health: 식료품+신체지표 기반 식단 PWA. relay 연동·대화방·모델선택·마이크까지 프로덕션 운영 중
- [AI 통합 아키텍처](architecture-ai-integration.md) — gugbab-claude-relay 경유 Claude, SSE 규약, 모델 목록 동적 로딩 (OpenAI 계획 폐기)
- [배포 워크플로우](project-deploy-workflow.md) — main 직접 푸시 차단(PR 필수), Vercel 실서비스=gugbab-claude-health(중복 구 프로젝트 주의), env는 재배포 필요
- [E2E 테스트 노하우](project-e2e-testing-notes.md) — Playwright+가짜 API 주입 패턴, dev 모드 상호작용 함정→프로덕션 빌드로 검증, 127.0.0.1+3002 포트
- [회사망 TLS 인터셉션](env-corp-tls-interception.md) — 로컬 Node fetch가 외부 HTTPS 실패 시 NODE_EXTRA_CA_CERTS 우회, relay 로컬은 :3000
- [기술스택 레퍼런스](project-stack-reference.md) — gugbab 앱 공통 패턴: Vite or Next.js + Biome + Playwright + pnpm + Vercel
- [사용자 선호도](user-preferences.md) — 대화 기록 메모리 저장, 브라우저 시각 자료 사용, 단계적 설계 진행 방식 선호
- [커밋·푸시 규율](feedback-commit-push-discipline.md) — 명시적 요청 없이 절대 실행 금지, 퍼미션 프롬프트 승인도 요청 대체 불가
- [완료 보고 전 검증 의무](feedback-e2e-verification-before-report.md) — CI/CD 플로우 등 크리티컬 패스는 직접 검증 후 보고
- [검증 후 안내 의무](feedback-verify-before-guiding.md) — UI 조작법·사실 안내는 문서/실측 검증 후, 실패한 안내 반복 금지
- [브랜치 전 fetch 필수](feedback-fetch-before-branching.md) — 작업 브랜치 생성 전 git fetch, 캐시된 origin/main 믿지 말 것, 뒤처진 브랜치는 머지로 업데이트
- [이력 압축 크로스 리뷰](project-history-compression-cross-review.md) — health↔dream 장점 상호 이식 완료(2026-08-14), 양쪽 미커밋, dream 상세는 그쪽 memory 참조
