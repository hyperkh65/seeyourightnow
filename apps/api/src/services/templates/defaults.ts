/**
 * Default document & email templates installed for every new tenant.
 * Handlebars syntax, auto-escaped. Tenants edit them in Admin → 문서 템플릿 (versioned).
 * Contract clauses are a neutral starting point and are flagged for legal review.
 */

export const BASE_CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { font-family: 'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; color: #0f172a; font-size: 10.5pt; line-height: 1.55; margin: 0; }
h1 { font-size: 20pt; letter-spacing: -0.02em; margin: 0; }
h2 { font-size: 11.5pt; margin: 18px 0 8px; }
.muted { color: #64748b; }
.small { font-size: 8.5pt; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid {{brand.primaryColor}}; padding-bottom: 12px; margin-bottom: 16px; }
.logo { max-height: 42px; max-width: 180px; }
.doc-meta { text-align: right; }
.doc-meta .no { font-weight: 700; font-size: 11pt; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
.box h3 { margin: 0 0 6px; font-size: 9pt; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th { background: #f8fafc; color: #334155; font-weight: 600; font-size: 9pt; text-align: left; padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
td { padding: 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; }
.totals { margin-left: auto; width: 46%; margin-top: 10px; }
.totals td { border: none; padding: 4px 8px; }
.totals tr.grand td { border-top: 2px solid #0f172a; font-weight: 700; font-size: 12pt; padding-top: 8px; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 8pt; background: #eef2ff; color: #3730a3; }
.badge.warn { background: #fef3c7; color: #92400e; }
.notice { background: #f8fafc; border-left: 3px solid {{brand.primaryColor}}; padding: 8px 12px; border-radius: 4px; margin-top: 12px; }
.clause { margin-bottom: 10px; page-break-inside: avoid; }
.clause h4 { margin: 0 0 3px; font-size: 10pt; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 28px; }
.sign .box { min-height: 90px; }
.footer { margin-top: 26px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 8pt; color: #64748b; }
.draft-mark { position: fixed; top: 40%; left: 10%; font-size: 64pt; color: rgba(220,38,38,.08); transform: rotate(-24deg); font-weight: 800; }
`;

const HEADER = `
{{#if demo}}<div class="draft-mark">DEMO</div>{{/if}}
<div class="header">
  <div>
    {{#if brand.logoDataUri}}<img class="logo" src="{{brand.logoDataUri}}" alt="">{{else}}<div style="font-size:15pt;font-weight:800;color:{{brand.primaryColor}}">{{brand.siteName}}</div>{{/if}}
    <div class="small muted" style="margin-top:6px">{{company.legalName}}{{#if company.businessRegistrationNo}} · 사업자등록번호 {{company.businessRegistrationNo}}{{/if}}</div>
    <div class="small muted">{{company.address}}</div>
    <div class="small muted">{{#if company.phone}}Tel {{company.phone}}{{/if}}{{#if company.email}} · {{company.email}}{{/if}}</div>
  </div>
  <div class="doc-meta">
    <h1>{{title}}</h1>
    <div class="no">{{number}}{{#if version}} · v{{version}}{{/if}}</div>
    <div class="small muted">발행일 {{issueDate}}</div>
    {{#if validUntil}}<div class="small muted">유효기한 {{validUntil}}</div>{{/if}}
  </div>
</div>`;

const BANK = `
{{#if banks.length}}
<h2>입금 계좌</h2>
<table><thead><tr><th>은행</th><th>계좌번호</th><th>예금주</th><th>통화</th><th>SWIFT</th></tr></thead><tbody>
{{#each banks}}<tr><td>{{bankName}}</td><td>{{accountNumber}}</td><td>{{accountHolder}}</td><td>{{currency}}</td><td>{{swift}}</td></tr>{{/each}}
</tbody></table>
{{/if}}`;

const FOOTER = `<div class="footer">{{company.legalName}} · 대표 {{company.representative}} · {{company.address}}<br>문서 번호 {{number}}{{#if version}} v{{version}}{{/if}} · 본 문서는 시스템에서 발행되었으며 발행 시점의 정보로 고정됩니다.</div>`;

export const QUOTATION_HTML = `${HEADER}
<div class="grid2">
  <div class="box"><h3>고객</h3><strong>{{customer.name}}</strong><div>{{contactName}}</div><div class="muted small">{{contactEmail}}</div></div>
  <div class="box"><h3>견적 조건</h3>
    <div>납기: {{leadTime}}</div><div>결제 조건: {{paymentTerms}}</div><div>통화: {{currency}}</div>
    <div>프로젝트: {{projectCode}}</div>
  </div>
</div>
<h2>견적 내역</h2>
<table>
  <thead><tr><th style="width:52px"></th><th>제품 / 사양</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th></tr></thead>
  <tbody>
  {{#each items}}
    <tr>
      <td>{{#if imageDataUri}}<img class="thumb" src="{{imageDataUri}}" alt="">{{/if}}</td>
      <td><strong>{{name}}</strong>{{#if specification}}<div class="small muted">{{specification}}</div>{{/if}}
        {{#each visibleBreakdown}}<div class="small muted">· {{label}} {{money amount ../../currency}}</div>{{/each}}
        {{#if badgeLabel}}<span class="badge {{#if badgeWarn}}warn{{/if}}">{{badgeLabel}}</span>{{/if}}
      </td>
      <td class="num">{{number quantity}} {{unit}}</td>
      <td class="num">{{money unitPrice ../currency}}</td>
      <td class="num">{{money amount ../currency}}</td>
    </tr>
  {{/each}}
  </tbody>
</table>
<table class="totals">
  <tr><td>공급가액</td><td class="num">{{money subtotal currency}}</td></tr>
  {{#if showShipping}}<tr><td>운송비</td><td class="num">{{money shippingTotal currency}}</td></tr>{{/if}}
  {{#if showOther}}<tr><td>기타 비용</td><td class="num">{{money otherCharges currency}}</td></tr>{{/if}}
  <tr><td>부가세</td><td class="num">{{money vat currency}}</td></tr>
  <tr class="grand"><td>합계</td><td class="num">{{money total currency}}</td></tr>
</table>
{{#if customerCaution}}<div class="notice"><strong>안내</strong><br>{{nl2br customerCaution}}</div>{{/if}}
{{#if notes}}<h2>비고</h2><div>{{nl2br notes}}</div>{{/if}}
{{#if terms}}<h2>견적 조건</h2><div class="small">{{nl2br terms}}</div>{{/if}}
${BANK}
${FOOTER}`;

export const CONTRACT_HTML = `${HEADER}
{{#if legalReviewPending}}<div class="notice" style="border-color:#dc2626"><strong>법률 검토 필요</strong> — 이 계약서 양식은 아직 법률 검토가 완료되지 않았습니다.</div>{{/if}}
<div class="grid2" style="margin-top:12px">
  <div class="box"><h3>공급자 (갑)</h3><strong>{{company.legalName}}</strong><div class="small">{{company.address}}</div><div class="small">대표 {{company.representative}}</div></div>
  <div class="box"><h3>구매자 (을)</h3><strong>{{customer.name}}</strong><div class="small">{{customer.address}}</div><div class="small">{{#if customer.businessNumber}}사업자등록번호 {{customer.businessNumber}}{{/if}}</div></div>
</div>
<h2>계약 품목</h2>
<table><thead><tr><th>제품</th><th>사양</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th></tr></thead><tbody>
{{#each items}}<tr><td>{{name}}</td><td class="small">{{specification}}</td><td class="num">{{number quantity}}</td><td class="num">{{money unitPrice ../currency}}</td><td class="num">{{money amount ../currency}}</td></tr>{{/each}}
</tbody></table>
<table class="totals"><tr class="grand"><td>계약 금액 (VAT 포함)</td><td class="num">{{money total currency}}</td></tr></table>
<h2>계약 조항</h2>
{{#each clauses}}<div class="clause"><h4>제{{inc @index}}조 ({{title}})</h4><div>{{nl2br body}}</div></div>{{/each}}
<div class="sign">
  <div class="box"><h3>갑</h3>{{company.legalName}}<br>{{#if companyApproval}}<span class="small">전자 승인: {{companyApproval.name}} · {{companyApproval.at}}</span>{{/if}}</div>
  <div class="box"><h3>을</h3>{{customer.name}}<br>{{#if customerApproval}}<span class="small">전자 승인: {{customerApproval.name}} · {{customerApproval.at}}</span>{{/if}}</div>
</div>
${FOOTER}`;

export const INVOICE_HTML = `${HEADER}
<div class="grid2">
  <div class="box"><h3>{{#if isPurchaseOrder}}공급자 (Supplier){{else}}고객 (Bill to){{/if}}</h3><strong>{{party.name}}</strong><div class="small">{{party.address}}</div></div>
  <div class="box"><h3>정보</h3><div>프로젝트: {{projectCode}}</div>{{#if contractNumber}}<div>계약: {{contractNumber}}</div>{{/if}}{{#if dueDate}}<div>결제기한: {{dueDate}}</div>{{/if}}{{#if incoterm}}<div>Incoterm: {{incoterm}}</div>{{/if}}</div>
</div>
<table><thead><tr><th>Description</th><th class="num">Qty</th>{{#unless packingOnly}}<th class="num">Unit price</th><th class="num">Amount</th>{{/unless}}{{#if packing}}<th class="num">Cartons</th><th class="num">G.W.(kg)</th><th class="num">CBM</th>{{/if}}</tr></thead><tbody>
{{#each lines}}<tr><td><strong>{{name}}</strong>{{#if spec}}<div class="small muted">{{spec}}</div>{{/if}}</td><td class="num">{{number quantity}} {{unit}}</td>{{#unless ../packingOnly}}<td class="num">{{money unitPrice ../currency}}</td><td class="num">{{money amount ../currency}}</td>{{/unless}}{{#if ../packing}}<td class="num">{{cartons}}</td><td class="num">{{grossWeightKg}}</td><td class="num">{{cbm}}</td>{{/if}}</tr>{{/each}}
</tbody></table>
{{#unless packingOnly}}
<table class="totals">
  <tr><td>Subtotal</td><td class="num">{{money subtotal currency}}</td></tr>
  {{#if vat}}<tr><td>VAT</td><td class="num">{{money vat currency}}</td></tr>{{/if}}
  <tr class="grand"><td>Total</td><td class="num">{{money total currency}}</td></tr>
</table>
{{/unless}}
{{#if notes}}<div class="notice">{{nl2br notes}}</div>{{/if}}
{{#unless isPurchaseOrder}}${BANK}{{/unless}}
${FOOTER}`;

export const DEFAULT_CONTRACT_CLAUSES = [
  { key: 'product', title: '목적 및 제품', body: '갑은 본 계약서에 기재된 제품(이하 "제품")을 을에게 공급하고, 을은 이에 대한 대금을 지급한다. 제품의 상세 사양은 승인된 견적서 및 샘플을 따른다.' },
  { key: 'quantity_price', title: '수량 및 가격', body: '제품의 수량과 가격은 본 계약서 품목표를 따른다. 가격은 별도 표기가 없는 한 부가가치세를 포함한다.' },
  { key: 'payment', title: '대금 지급', body: '{{paymentTerms}}. 을이 지급 기한을 지키지 않는 경우 갑은 생산 또는 출고를 보류할 수 있다.' },
  { key: 'lead_time', title: '납기', body: '납기는 계약금 입금 및 샘플 확정일로부터 {{leadTime}}로 한다. 불가항력 또는 을의 사유로 인한 지연은 납기에 산입하지 않는다.' },
  { key: 'shipping', title: '운송 및 인도', body: '인도 조건은 {{incoterm}} 기준으로 하며, 위험은 인도 시점에 을에게 이전된다.' },
  { key: 'sample', title: '샘플 승인', body: '양산 전 샘플을 제공하는 경우, 을이 서면(전자 승인 포함)으로 승인한 샘플이 품질 기준이 된다.' },
  { key: 'quality', title: '품질 기준 및 허용 불량률', body: '품질 기준은 승인 샘플 및 합의된 사양을 따르며, 허용 불량률은 {{acceptableDefectRate}}로 한다.' },
  { key: 'inspection', title: '검품', body: '출고 전 검품은 합의된 방식(AQL 등)으로 실시할 수 있으며, 검품 결과는 양 당사자에게 공유된다.' },
  { key: 'claim', title: '클레임', body: '을은 제품 수령 후 {{claimDays}}일 이내에 하자를 서면으로 통지하여야 하며, 갑은 확인 후 교환·보수·환불 중 합의된 방식으로 처리한다.' },
  { key: 'delay', title: '지연', body: '갑의 귀책으로 납기가 지연되는 경우 양 당사자는 협의하여 조치하며, 구체적인 지체상금은 별도 합의에 따른다.' },
  { key: 'fx', title: '환율 변동', body: '견적 기준 환율 대비 결제 시점 환율이 {{fxThresholdPct}}% 이상 변동한 경우 양 당사자는 가격 조정을 협의할 수 있다.' },
  { key: 'freight', title: '운임 변동', body: '국제 운임이 견적 시점 대비 현저히 변동한 경우 실제 운임 기준으로 정산할 수 있다.' },
  { key: 'certification', title: '인증', body: '제품의 한국 내 판매에 필요한 인증의 범위와 비용 부담은 견적서 및 별도 합의에 따른다. 인증 결과에 따라 사양 변경이 필요할 수 있다.' },
  { key: 'ip', title: '지식재산권', body: '을이 제공한 로고, 디자인 등에 대한 지식재산권 침해 문제는 을이 책임지며, 갑은 제3자의 권리를 침해하지 않도록 합리적인 노력을 한다.' },
  { key: 'cancellation', title: '계약 해제', body: '생산 착수 이후 을의 사유로 계약을 해제하는 경우 이미 발생한 비용은 을이 부담한다.' },
  { key: 'force_majeure', title: '불가항력', body: '천재지변, 전쟁, 감염병, 정부 조치, 항만 폐쇄 등 불가항력으로 인한 불이행에 대해 양 당사자는 책임을 지지 않는다.' },
  { key: 'confidentiality', title: '비밀유지', body: '양 당사자는 본 계약과 관련하여 알게 된 상대방의 영업 비밀을 제3자에게 누설하지 않는다.' },
  { key: 'dispute', title: '분쟁 해결', body: '본 계약에 관한 분쟁은 상호 협의하여 해결하며, 협의가 되지 않을 경우 갑의 소재지 관할 법원을 전속 관할로 한다.' },
];

export const DOCUMENT_TEMPLATE_DEFAULTS: Array<{ kind: string; name: string; html: string; requiresLegalReview?: boolean }> = [
  { kind: 'QUOTATION', name: '견적서', html: QUOTATION_HTML },
  { kind: 'CONTRACT', name: '제품 공급 계약서', html: CONTRACT_HTML, requiresLegalReview: true },
  { kind: 'PROFORMA_INVOICE', name: 'Proforma Invoice', html: INVOICE_HTML },
  { kind: 'COMMERCIAL_INVOICE', name: 'Commercial Invoice', html: INVOICE_HTML },
  { kind: 'PACKING_LIST', name: 'Packing List', html: INVOICE_HTML },
  { kind: 'SALES_INVOICE', name: '거래명세서', html: INVOICE_HTML },
  { kind: 'RECEIPT', name: '영수증', html: INVOICE_HTML },
  { kind: 'PURCHASE_ORDER', name: 'Purchase Order', html: INVOICE_HTML },
  { kind: 'SHIPPING_NOTICE', name: '선적 통지', html: INVOICE_HTML },
  { kind: 'DELIVERY_NOTE', name: '납품서', html: INVOICE_HTML },
];

const EMAIL_LAYOUT = (body: string) => `<div style="font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
<div style="padding:20px 0;border-bottom:2px solid {{brand.primaryColor}}"><strong style="font-size:18px;color:{{brand.primaryColor}}">{{brand.siteName}}</strong></div>
<div style="padding:24px 0;font-size:15px;line-height:1.7">${body}</div>
<div style="padding:16px 0;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">{{company.legalName}} · {{company.address}}<br>문의: {{company.email}} {{company.phone}}</div></div>`;

const BTN = (label: string) => `<p style="margin:24px 0"><a href="{{link}}" style="background:{{brand.primaryColor}};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p>`;

export const EMAIL_TEMPLATE_DEFAULTS: Record<string, { subject: string; body: string }> = {
  SOURCING_RECEIVED: { subject: '[{{projectCode}}] 소싱 요청이 접수되었습니다', body: EMAIL_LAYOUT(`<p>{{recipientName}}님, 안녕하세요.</p><p>요청하신 <strong>{{productName}}</strong> 소싱 요청이 접수되었습니다. 제품 분석과 공급처 검색을 시작합니다.</p>${BTN('진행 상황 보기')}`) },
  ANALYSIS_COMPLETED: { subject: '[{{projectCode}}] 제품 분석이 완료되었습니다', body: EMAIL_LAYOUT(`<p>{{productName}}의 분석이 완료되었습니다. 공급처 비교와 예상 도착가격을 확인해 보세요.</p>${BTN('결과 확인하기')}`) },
  QUOTE_ISSUED: { subject: '[{{projectCode}}] 견적서가 도착했습니다 ({{quoteNumber}})', body: EMAIL_LAYOUT(`<p>{{recipientName}}님, 요청하신 견적서를 보내드립니다.</p><p>견적번호 <strong>{{quoteNumber}}</strong> · 합계 <strong>{{total}}</strong><br>유효기한: {{validUntil}}</p>${BTN('견적서 보기')}`) },
  QUOTE_REMINDER: { subject: '[{{projectCode}}] 견적 유효기한이 곧 끝납니다', body: EMAIL_LAYOUT(`<p>견적 {{quoteNumber}}의 유효기한이 {{validUntil}}에 끝납니다.</p>${BTN('견적서 보기')}`) },
  QUOTE_APPROVED: { subject: '[{{projectCode}}] 견적이 승인되었습니다', body: EMAIL_LAYOUT(`<p>견적 {{quoteNumber}}이(가) 승인되었습니다. 계약 절차를 안내해 드리겠습니다.</p>${BTN('프로젝트 보기')}`) },
  CONTRACT_READY: { subject: '[{{projectCode}}] 계약서를 확인해 주세요', body: EMAIL_LAYOUT(`<p>계약서({{contractNumber}})가 준비되었습니다. 내용을 확인하고 승인해 주세요.</p>${BTN('계약서 확인하기')}`) },
  CONTRACT_COMPLETED: { subject: '[{{projectCode}}] 계약이 체결되었습니다', body: EMAIL_LAYOUT(`<p>계약({{contractNumber}})이 체결되었습니다.</p>${BTN('프로젝트 보기')}`) },
  PI_ISSUED: { subject: '[{{projectCode}}] Proforma Invoice가 발행되었습니다', body: EMAIL_LAYOUT(`<p>PI {{invoiceNumber}}가 발행되었습니다. 결제 금액 <strong>{{total}}</strong>, 결제기한 {{dueDate}}.</p>${BTN('인보이스 보기')}`) },
  PAYMENT_RECEIVED: { subject: '[{{projectCode}}] 입금이 확인되었습니다', body: EMAIL_LAYOUT(`<p>{{amount}} 입금이 확인되었습니다. 감사합니다.</p>${BTN('프로젝트 보기')}`) },
  PRODUCTION_STARTED: { subject: '[{{projectCode}}] 생산이 시작되었습니다', body: EMAIL_LAYOUT(`<p>주문하신 제품의 생산이 시작되었습니다. 예상 완료일: {{plannedEnd}}</p>${BTN('생산 현황 보기')}`) },
  PRODUCTION_DELAY: { subject: '[{{projectCode}}] 생산 일정 변경 안내', body: EMAIL_LAYOUT(`<p>생산 일정이 변경되었습니다.</p><p>사유: {{reason}}<br>변경된 예상 완료일: {{plannedEnd}}</p>${BTN('생산 현황 보기')}`) },
  INSPECTION_COMPLETED: { subject: '[{{projectCode}}] 검품이 완료되었습니다', body: EMAIL_LAYOUT(`<p>검품 결과: <strong>{{result}}</strong></p>${BTN('검품 결과 보기')}`) },
  SHIPMENT_BOOKED: { subject: '[{{projectCode}}] 선적 예약이 완료되었습니다', body: EMAIL_LAYOUT(`<p>선적이 예약되었습니다. 출항 예정일(ETD): {{etd}}</p>${BTN('운송 현황 보기')}`) },
  VESSEL_DEPARTED: { subject: '[{{projectCode}}] 화물이 출항했습니다', body: EMAIL_LAYOUT(`<p>화물이 {{originPort}}에서 출항했습니다. 예상 도착일(ETA): {{eta}}</p>${BTN('운송 현황 보기')}`) },
  ETA_CHANGED: { subject: '[{{projectCode}}] 도착 예정일이 변경되었습니다', body: EMAIL_LAYOUT(`<p>예상 도착일이 {{previousEta}}에서 <strong>{{eta}}</strong>(으)로 변경되었습니다. ({{etaSource}} 기준 예상치)</p>${BTN('운송 현황 보기')}`) },
  ARRIVED: { subject: '[{{projectCode}}] 화물이 도착했습니다', body: EMAIL_LAYOUT(`<p>화물이 {{destinationPort}}에 도착했습니다. 통관을 진행합니다.</p>${BTN('운송 현황 보기')}`) },
  CUSTOMS_COMPLETED: { subject: '[{{projectCode}}] 통관이 완료되었습니다', body: EMAIL_LAYOUT(`<p>통관이 완료되었습니다. 곧 국내 배송이 시작됩니다.</p>${BTN('운송 현황 보기')}`) },
  DELIVERY_STARTED: { subject: '[{{projectCode}}] 국내 배송이 시작되었습니다', body: EMAIL_LAYOUT(`<p>국내 배송이 시작되었습니다.</p>${BTN('배송 현황 보기')}`) },
  DELIVERED: { subject: '[{{projectCode}}] 배송이 완료되었습니다', body: EMAIL_LAYOUT(`<p>배송이 완료되었습니다. 이용해 주셔서 감사합니다.</p>${BTN('프로젝트 보기')}`) },
};

export const POLICY_DEFAULTS: Array<{ type: string; title: string; body: string }> = [
  { type: 'PRIVACY', title: '개인정보처리방침', body: '※ 이 문서는 기본 양식입니다. 회사 정보와 실제 처리 현황에 맞게 수정하고 법률 검토 후 게시하세요.\n\n1. 수집하는 개인정보 항목: 이름, 이메일, 연락처, 회사명\n2. 수집 목적: 소싱 요청 처리, 견적 및 계약 진행, 고객 상담\n3. 보유 기간: 관계 법령에 따른 기간 또는 회원 탈퇴 시까지\n4. 제3자 제공: 물류·통관·인증 진행에 필요한 범위에서 협력사에 제공될 수 있습니다.\n5. 이용자의 권리: 열람, 정정, 삭제, 처리정지를 요구할 수 있습니다.' },
  { type: 'TERMS', title: '이용약관', body: '※ 이 문서는 기본 양식입니다. 법률 검토 후 게시하세요.\n\n제1조 (목적) 이 약관은 회사가 제공하는 소싱 서비스 이용 조건을 정합니다.' },
  { type: 'SOURCING_TERMS', title: '소싱 서비스 약관', body: '※ 기본 양식. 검색 결과의 가격·운임·관세·인증 정보는 예상값이며, 확정 값은 견적서에 명시됩니다.' },
  { type: 'QUOTATION_NOTICE', title: '견적 안내', body: '견적 가격은 유효기한 내에서 유효하며, 환율·운임·원자재 가격 변동에 따라 조정될 수 있습니다. 인증 비용은 시험 결과에 따라 달라질 수 있습니다.' },
  { type: 'CANCELLATION', title: '취소 정책', body: '※ 기본 양식. 생산 착수 이후 취소 시 발생한 비용이 청구될 수 있습니다.' },
  { type: 'REFUND', title: '환불 정책', body: '※ 기본 양식. 환불은 계약 조건 및 하자 확인 결과에 따릅니다.' },
  { type: 'SHIPPING', title: '배송 정책', body: '※ 기본 양식. 해상·항공 운송 일정은 선사·항공사 사정에 따라 변경될 수 있습니다.' },
];
