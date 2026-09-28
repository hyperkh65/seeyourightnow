# Workflows

## 1. Sourcing request → result (progressive)

```
input (photos / URL / text + options)
  → sourcing_requests (status PENDING, access token for anonymous users)
  → job sourcing.analyze
       segment (AI worker) → OCR → caption → embedding → pHash
       LLM structuring (attributes stay UNKNOWN unless evidenced) → products, product_images
  → parallel jobs
       sourcing.search      private network (trigram + vector) → marketplace connectors (1688/…) → DEV mocks only if DEV_MODE
       market.collect       Korean market prices (Naver/Coupang/11st/generic) → market stats, anomaly checks
       hs.classify          HS candidates (rules + nomenclature similarity) → tariff lookup (imported rates only)
  → compliance.evaluate  versioned regulation rules × tri-state attributes → RULE_MATCHED / AI_LIKELY / UNKNOWN / NOT_APPLICABLE
  → cost.estimate        landed cost per top candidate (FX, freight priority, duty, VAT, certification allocation) → margin engine
  → rebuildCandidates    clustering + explainable Best Match (12 components, data coverage, tags, cautions)
```

The result page polls `/sourcing/requests/:id/status` and renders each section as soon as its step finishes; failed or skipped steps show why (e.g. “국내 시장가격 커넥터가 연결되지 않았습니다”). Customers see only allow-listed fields; staff see scores, evidence, internal cost and supplier identity.

## 2. Project stages

`REQUESTED → SEARCHING → QUOTE_PREPARING → QUOTE_APPROVED → CONTRACT → PRODUCTION → INSPECTION → READY_TO_SHIP → SHIPPED → ARRIVED → CUSTOMS → DELIVERING → COMPLETED` (or `CANCELLED`)

The customer timeline is derived from the stage history; staff additionally see the durable workflow below and “attention” flags (customs hold, delay, stale price, regulation change).

## 3. Durable order workflow (`ORDER_FULFILLMENT`)

| # | Step | Waits for a person | Completed by |
| --- | --- | --- | --- |
| 1 | 견적 발행 `QUOTE_ISSUED` | | Quote issue (PDF + hash) |
| 2 | 고객 견적 승인 `CUSTOMER_APPROVAL` | ✔ customer | Customer approval with evidence |
| 3 | 관리자 최종 승인 `ADMIN_APPROVAL` | ✔ staff | Final approval (quote LOCKED) |
| 4 | 계약 체결 `CONTRACT` | ✔ both | Contract EFFECTIVE (customer + company approval) |
| 5 | 계약금 입금 `DEPOSIT` | ✔ finance | Deposit payment PAID |
| 6 | 공장 발주 `PURCHASE_ORDER` | ✔ sourcing | PO issued |
| 7 | 생산 `PRODUCTION` | ✔ sourcing | Production COMPLETED |
| 8 | 검품 `INSPECTION` | ✔ QC | Inspection PASSED / PASSED_WITH_REMARKS |
| 9 | 포워더 배정·선적 예약 `FORWARDER` | ✔ logistics | Shipment booked |
| 10 | 선적 `SHIPPED` | | Carrier/forwarder/manual departure event |
| 11 | 입항 `ARRIVED` | | Arrival event (carrier, AIS geofence confirmation, manual) |
| 12 | 통관 `CUSTOMS` | ✔ broker | UNI-PASS clearance or manual status |
| 13 | 국내 배송 `DELIVERY` | ✔ logistics | Delivered event |
| 14 | 완료 `COMPLETED` | | Delivery; actual-cost settlement feeds accuracy analytics |

Steps are idempotent; completing a later step never re-opens an earlier one. See ADR-001 in ARCHITECTURE for the Temporal migration path.

## 4. Quotation

`DRAFT → ADMIN_REVIEW → SENT → CUSTOMER_APPROVED → ADMIN_FINAL_APPROVED → LOCKED` · `REJECTED` · `EXPIRED`

- Draft from selected candidates: unit price = explicit > admin final price > calculated price; internal cost is stored for the profit preview (staff only).
- **Issue** renders the PDF, stores its SHA-256, freezes the version (DB trigger) and emails the customer (idempotent).
- Any change after issue creates **v+1**; approvals reference the version and document hash, and approving a stale version is rejected.
- Customer approval records user, time, IP, user agent and hash; the admin then reviews cost/margin and gives final approval (step LOCKED). Price changes of a quoted supplier listing flag the quote (“change detection”).

## 5. Contract

`DRAFT → CUSTOMER_REVIEW → CUSTOMER_APPROVED → COMPANY_APPROVED → EFFECTIVE` (or `CANCELLED`)

Created from a locked quote with default clauses (incoterm, defect rate, claim period, FX threshold). Clause edits create new versions. Contracts above the configured thresholds require a **legal review** mark before company approval. The executed PDF carries both electronic approvals.

## 6. Invoices, payments, production, shipment

- PI with deposit % → inbound payment schedule → `PAID` completes the deposit step; CI/PL/거래명세서/영수증/선적 통지/납품서 are generated from the locked quote.
- PO to the supplier (internal), production updates (delays notify the customer), inspections with defect counts.
- Shipment: DCSA carrier events (confirmed), forwarder reports, AIS-inferred events (**need staff confirmation before customers see them**), separate ETAs per source (carrier, AIS, historical, manual), map with estimated great-circle route vs actual AIS track, geofence arrival detection, UNI-PASS customs progress.

## 7. Expert / partner loop

Staff assign tasks (HS review, compliance review, freight quote). Partners see only the product facts needed for the task — no customer identity, prices or margins. Their answers are stored as **verified** values next to the AI estimate; the product is re-evaluated and accuracy metrics update.

## 8. Settlement & learning

Actual freight, duty and purchase prices are recorded against the estimates. `model_predictions` keeps predicted vs human vs actual values; admins approve rows for future training. The analytics page reports HS top-1/top-3, freight and landed-cost MAPE, compliance correction rate, image top-k and recommendation adoption.

## 9. Change detection

- `change.scan` / `change.detect` re-check watched supplier listings (price, MOQ) and count stale listings; a changed price used by an open quote flags the project and notifies staff.
- A new regulation version runs an impact analysis (affected products, open quotes, open orders), marks existing checks stale and re-evaluates the products.
- FX updates apply to new calculations only; every cost snapshot keeps the FX rates it used.
- Issued quote versions are never modified automatically — staff create a new version.
