# Sourcing OS — White-label AI Sourcing & Trade ERP

사진·URL·검색어 하나로 **제품 이해 → 중국/자체 공급처 탐색 → 국내 시장가 비교 → 한국 인증·HS·관세 → 운임 → 도착원가·마진 → 견적 → 승인 → 계약 → PI/인보이스 → 발주·생산·검품 → 선적 추적(DCSA·AIS) → 통관 → 배송 → 실제 원가 정산 → 학습 피드백**까지 이어지는 멀티테넌트 B2B SaaS입니다.

- 모든 회사명·도메인·로고·계좌·색상·API 키는 **테넌트 설정**입니다. 코드에 하드코딩된 회사 정보는 없습니다.
- 계산 가능한 숫자(원가·관세·환율·마진)는 AI가 만들지 않습니다. 법적·재무적 의미가 있는 값은 출처·신뢰도·검증 상태와 함께 저장되며, **AI 추정값 · 전문가 확정값 · 실제값은 서로 덮어쓰지 않습니다.**
- 공급가·내부 원가·마진은 고객용 **API 응답 단계에서** 제거됩니다(화면에서 숨기는 것이 아님).

## Quick start

### A. Docker (one command)

```bash
docker compose up -d --build
```

| URL | 설명 |
| --- | --- |
| http://demo.localhost:3000 | 데모 테넌트 사이트 (DEMO 표시) |
| http://demo.localhost:3000/admin | 테넌트 관리자 |
| http://acme.localhost:3000 | 두 번째 테넌트 (격리 테스트용) |
| http://platform.localhost:3000 | 플랫폼(슈퍼 관리자) 콘솔 |
| http://localhost:4000/api/docs | OpenAPI (Swagger UI) |

`*.localhost`는 브라우저에서 자동으로 127.0.0.1로 연결됩니다. 비밀키(서명 키·암호화 마스터 키·AI 워커 토큰)는 첫 실행 때 `secrets` 볼륨에 생성되고 `*_FILE` 변수로만 전달됩니다.

Docker Hub 요청 제한이 있거나 사내 프록시가 TLS를 검사하는 환경에서는:

```bash
NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim \
PYTHON_IMAGE=mirror.gcr.io/library/python:3.11-slim \
EXTRA_CA_FILE=/path/to/proxy-ca.crt \
docker compose up -d --build
```

선택 프로필: `--profile security` (ClamAV 업로드 검사), `--profile edge` (Caddy + 자동 HTTPS, 운영용).
AI 모델(PaddleOCR·SigLIP·Florence-2·rembg)까지 설치하려면 `AI_INSTALL_ML=true`.

### B. Local development

```bash
corepack enable && pnpm install
docker compose -f docker-compose.dev.yml up -d          # Postgres(pgvector) + Valkey
cp .env.example .env                                     # 키 생성: openssl rand -base64 32
pnpm db:migrate && pnpm db:seed
pnpm dev                                                 # core(watch) + API :4000 + Web :3000
```

### 기본 계정 (로컬/데모 전용 — 운영에서는 생성되지 않음)

비밀번호: `Demo-Pass-2026!` (`SEED_PASSWORD`로 변경)

| 계정 | 역할 |
| --- | --- |
| `superadmin@platform.local` | 플랫폼 슈퍼 관리자 — **첫 로그인 시 2단계 인증(OTP) 설정 필수** |
| `owner@demo.local` | 테넌트 대표 관리자 |
| `sales@`, `sourcing@`, `finance@demo.local` | 영업 / 소싱 / 재무 |
| `customs@`, `forwarder@`, `lab@demo.local` | 관세사 / 포워더 / 인증 시험기관 (협력사 포털) |
| `buyer@demo.local` | 고객(바이어) |
| `owner@acme.local`, `buyer@acme.local` | 두 번째 테넌트 |

운영 부트스트랩은 `SEED_MODE=base` + `SEED_SUPERADMIN_PASSWORD`로 **참조 데이터와 슈퍼 관리자만** 만듭니다(데모 테넌트 없음). 자세한 내용은 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Tests

```bash
pnpm typecheck && pnpm lint
pnpm test          # core 엔진 · API 통합(테넌트 격리/RLS/RBAC/보안/견적 흐름) · web 단위
pnpm test:e2e      # Playwright (실행 중인 스택 대상, E2E_WEB_PORT로 포트 지정)
cd ai-worker && pip install -r requirements-dev.txt && ruff check . && pytest
```

## Repository layout

```
packages/core   순수 TS 엔진: 금액(decimal), 도착원가, 마진, 운임, 매칭, 인증 규칙, 리스크, 상태머신, 권한
apps/api        Fastify + Drizzle + PostgreSQL(RLS) — API, 작업 큐 워커, 커넥터, 문서/PDF
apps/web        Next.js — 공개 사이트, 고객 포털, 관리자, 협력사 포털, 플랫폼 콘솔
ai-worker       FastAPI — 배경 분리, OCR, 임베딩, 캡션, AIS 디코딩 (설치된 모델만 사용)
e2e             Playwright E2E
infra           Postgres 역할 초기화, Caddy, 비밀키 초기화 스크립트
docs            설계·보안·배포·커넥터·데이터 모델·워크플로·API 문서
```

## Documentation

- [ARCHITECTURE](docs/ARCHITECTURE.md) — 구성, 멀티테넌시, 작업 큐, 워크플로 엔진, ADR
- [SECURITY](docs/SECURITY.md) — 위협 모델, OWASP 점검 결과, 비밀키·인증·감사
- [DEPLOYMENT](docs/DEPLOYMENT.md) — 운영 배포, 도메인·TLS, 백업·PITR·복구 테스트
- [CONNECTORS](docs/CONNECTORS.md) — 외부 API 목록, 발급 방법, 폴백 정책
- [DATA_MODEL](docs/DATA_MODEL.md) — 테이블·RLS·불변 데이터
- [WORKFLOWS](docs/WORKFLOWS.md) — 소싱→견적→계약→배송 흐름과 상태
- [API](docs/API.md) — 인증, 멱등성, 오류 형식, 주요 엔드포인트
- [LICENSE-THIRD-PARTY](LICENSE-THIRD-PARTY.md)

> 레포지토리 루트의 기존 Streamlit 파일(`steamlit_app.py` 등)은 이전 프로토타입으로, 새 시스템과 독립적이며 수정하지 않았습니다.
