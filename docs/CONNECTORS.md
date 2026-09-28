# Connectors

All external integrations are configured **per tenant** in *관리자 → 설정 → API 연결*. Secrets are encrypted server-side, shown only as `********1234`, and never sent to the browser. Every connector has a **연결 테스트** button that calls a harmless endpoint and records the result, latency and last error. Failures open a circuit breaker so one bad provider cannot stall the pipeline.

**Principles**
- Official APIs first. No scraping of sites whose terms forbid it; generic URL previews obey `robots.txt`.
- No invented APIs: where a partner/contract API is required (e.g. carrier T&T), the connector is a documented, configurable adapter.
- Missing connector ⇒ graceful fallback and an explicit “연결 필요” state — never mock data shown as real. Mock listings exist only with `DEV_MODE=true`, titled `[DEV MOCK]`.

## Catalogue

| Provider key | Category | What it does | How to get access | Fallback when absent |
| --- | --- | --- | --- | --- |
| `GROQ` | AI | LLM + vision: attribute structuring, multilingual queries (ko→zh/en), image understanding (OpenAI-compatible) | console.groq.com → API Keys | Other AI provider in the router; otherwise text analysis is skipped and fields stay `UNKNOWN` |
| `OPENAI_COMPATIBLE` | AI | Any Chat Completions API (OpenAI, vLLM, Ollama, LM Studio…) | Provider console / self-hosted URL | — |
| `ANTHROPIC` | AI | Claude messages API as primary or fallback | console.anthropic.com | — |
| `AI_WORKER` | AI | Self-hosted OCR (PaddleOCR), SigLIP embeddings, Florence-2 caption, background removal, AIS NMEA decoding | `docker compose` service `ai-worker`; token from the `secrets` volume (`worker_token`) | pHash image similarity and text-only matching |
| `ALIBABA_1688_OPEN` | Marketplace | 1688 Open Platform product lookup/search (AOP signature HMAC-SHA1) | open.1688.com developer account + app approval for the required API namespaces | Private supply network + RFQ |
| `GENERIC_HTTP_SOURCE` | Marketplace | Any licensed product-data API returning JSON; URL template + JSONPath field mapping | Contract with a data provider | — |
| `NAVER_SHOPPING` | Domestic market | 네이버 쇼핑 검색 API (price, mall, link) | developers.naver.com → 애플리케이션 등록 (검색) | Market price section shows “연결 필요” |
| `COUPANG_PARTNERS` | Domestic market | 쿠팡 파트너스 Open API product search (HMAC) | partners.coupang.com (approved partners) | — |
| `ELEVENST_OPENAPI` | Domestic market | 11번가 Open API product search | openapi.11st.co.kr | — |
| `GENERIC_HTTP_MARKET` | Domestic market | Licensed market-price data API with field mapping | Data provider contract | — |
| `DCSA_TNT` | Shipping | Carrier Track & Trace in the **DCSA** standard (events, containers, vessels, ETA) | Carrier API programme (e.g. Maersk, MSC, Hapag-Lloyd, ONE, CMA CGM) — base URL + API key from the carrier | Forwarder-reported or manual events |
| `AISSTREAM` | Shipping | Live AIS positions via websocket (bounding boxes around active vessels) | aisstream.io API key | Last known position marked stale; AI worker can decode NMEA from a receiver |
| `KOREAEXIM_FX` | Government | 한국수출입은행 현재환율 API (daily) | koreaexim.go.kr → Open API 인증키 | Manually entered FX rates (marked with source/date) |
| `UNIPASS` | Customs | 관세청 UNI-PASS 화물통관 진행정보 | unipass.customs.go.kr → OpenAPI 신청 | Manual customs status |
| `SMTP` | Email | Tenant mail server (SPF/DKIM recommended) | Mail provider | System default SMTP from the environment |
| `SOLAPI` | SMS | SMS / 카카오 알림톡 (HMAC) | solapi.com | Email only |
| `SLACK` | Messaging | Internal alerts via incoming webhook | Slack app → Incoming Webhooks | Email alerts |
| `TOSS_PAYMENTS` | Payment | Card/transfer payment confirmation | tosspayments.com merchant keys | Bank transfer + manual confirmation |
| `GA4` | Analytics | Measurement ID for the tenant site | Google Analytics | — |

Tariff rates, HS nomenclature and regulations are **imported data** (CSV/XLSX from 관세청·관세사, versioned), not live APIs, so every duty rate carries its source and verification status.

## Freight rate priority

`REAL_TIME_API > FORWARDER_VERIFIED > CONTRACT_RATE > MARKET_RATE > GOVERNMENT_STATISTICS > HISTORICAL_ACTUAL > AI_ESTIMATE`

Expired or missing rates surface as “운임 확인 필요” and can be requested from forwarders with an RFQ (partner portal). Actual invoiced freight is stored separately and feeds the accuracy report.

## Adding a connector

1. Add a `ProviderDef` to `apps/api/src/services/connections/registry.ts` (category, config/secret fields with Korean labels, capabilities, `test()`).
2. Implement the adapter in `services/connectors/*` using `safeFetch` (SSRF-safe) and map the response into the shared types (`ProductCandidate`, `MarketListing`, `TrackingEvent`…).
3. Record provenance (`source`, `connector`, `collectedAt`, `verification`) and add unit tests with recorded fixtures.
