import { boolean, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, tenantId, ts, updatedAt } from './_common.js';

// ─────────────────────────── Quotations ───────────────────────────

export const quotations = pgTable(
  'quotations',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    projectId: uuid('project_id').notNull(),
    companyId: uuid('company_id'),
    currentVersionId: uuid('current_version_id'),
    currentVersion: integer('current_version').notNull().default(1),
    status: text('status').notNull().default('DRAFT'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('quotations_number_uq').on(t.tenantId, t.number), index('quotations_project_idx').on(t.tenantId, t.projectId)],
);

/**
 * A quotation version is immutable once SENT: the snapshot captures product
 * data, prices, FX, freight, duty, margin rules, terms, company & bank info and
 * the template version at issue time. Changes → new version.
 */
export const quotationVersions = pgTable(
  'quotation_versions',
  {
    id: id(),
    tenantId: tenantId(),
    quotationId: uuid('quotation_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('DRAFT'),
    contactName: text('contact_name').notNull().default(''),
    contactEmail: text('contact_email').notNull().default(''),
    issueDate: text('issue_date'),
    validUntil: text('valid_until'),
    currency: text('currency').notNull().default('KRW'),
    subtotal: money('subtotal').notNull().default('0'),
    shippingTotal: money('shipping_total').notNull().default('0'),
    otherCharges: money('other_charges').notNull().default('0'),
    vat: money('vat').notNull().default('0'),
    total: money('total').notNull().default('0'),
    leadTime: text('lead_time').notNull().default(''),
    paymentTerms: text('payment_terms').notNull().default(''),
    notes: text('notes').notNull().default(''),
    customerCaution: text('customer_caution').notNull().default(''),
    terms: text('terms').notNull().default(''),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>(),
    /** Internal profit preview captured at issue time (staff-only). */
    internalSummary: jsonb('internal_summary').$type<Record<string, unknown>>(),
    documentId: uuid('document_id'),
    sentAt: ts('sent_at'),
    lockedAt: ts('locked_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('quotation_versions_uq').on(t.quotationId, t.version)],
);

export const quotationItems = pgTable('quotation_items', {
  id: id(),
  tenantId: tenantId(),
  quotationVersionId: uuid('quotation_version_id').notNull(),
  position: integer('position').notNull(),
  productId: uuid('product_id'),
  candidateId: uuid('candidate_id'),
  pricingSnapshotId: uuid('pricing_snapshot_id'),
  imageFileId: uuid('image_file_id'),
  name: text('name').notNull(),
  specification: text('specification').notNull().default(''),
  quantity: integer('quantity').notNull(),
  unit: text('unit').notNull().default('EA'),
  unitPrice: money('unit_price').notNull(),
  amount: money('amount').notNull(),
  /** Customer-visible breakdown lines per tenant pricing display settings. */
  visibleBreakdown: jsonb('visible_breakdown').$type<Array<{ label: string; amount: string }>>().notNull().default([]),
  priceBadge: text('price_badge').notNull().default('ESTIMATED'), // ESTIMATED | VERIFIED | FINAL
  /** Staff-only numbers (redacted for customers). */
  internalCost: money('internal_cost'),
  internalMeta: jsonb('internal_meta').$type<Record<string, unknown>>(),
});

/** Every approval/rejection is evidenced: who, when, IP, user agent, document hash, version. */
export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    tenantId: tenantId(),
    entityType: text('entity_type').notNull(), // QUOTATION | CONTRACT | ...
    entityId: uuid('entity_id').notNull(),
    version: integer('version').notNull(),
    action: text('action').notNull(), // CUSTOMER_APPROVED | ADMIN_FINAL_APPROVED | REJECTED | COMPANY_APPROVED ...
    actorId: uuid('actor_id').notNull(),
    actorRole: text('actor_role').notNull(),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    documentHash: text('document_hash'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('approvals_entity_idx').on(t.tenantId, t.entityType, t.entityId)],
);

// ─────────────────────────── Contracts ───────────────────────────

export const contracts = pgTable(
  'contracts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    projectId: uuid('project_id').notNull(),
    quotationId: uuid('quotation_id'),
    quotationVersionId: uuid('quotation_version_id'),
    companyId: uuid('company_id'),
    status: text('status').notNull().default('DRAFT'),
    currentVersion: integer('current_version').notNull().default(1),
    currentVersionId: uuid('current_version_id'),
    legalReviewRequired: boolean('legal_review_required').notNull().default(true),
    legalReviewedAt: ts('legal_reviewed_at'),
    legalReviewedBy: uuid('legal_reviewed_by'),
    effectiveAt: ts('effective_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('contracts_number_uq').on(t.tenantId, t.number)],
);

export const contractVersions = pgTable(
  'contract_versions',
  {
    id: id(),
    tenantId: tenantId(),
    contractId: uuid('contract_id').notNull(),
    version: integer('version').notNull(),
    templateVersionId: uuid('template_version_id'),
    clauses: jsonb('clauses').$type<Array<{ key: string; title: string; body: string }>>().notNull().default([]),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
    documentId: uuid('document_id'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('contract_versions_uq').on(t.contractId, t.version)],
);

// ─────────────────────────── Invoices / payments ───────────────────────────

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type').notNull(), // PROFORMA_INVOICE | COMMERCIAL_INVOICE | PACKING_LIST | SALES_INVOICE | RECEIPT | SHIPPING_NOTICE | DELIVERY_NOTE | PURCHASE_ORDER
    number: text('number').notNull(),
    projectId: uuid('project_id').notNull(),
    contractId: uuid('contract_id'),
    companyId: uuid('company_id'),
    currency: text('currency').notNull().default('KRW'),
    subtotal: money('subtotal').notNull().default('0'),
    vat: money('vat').notNull().default('0'),
    total: money('total').notNull().default('0'),
    dueDate: text('due_date'),
    status: text('status').notNull().default('ISSUED'), // DRAFT | ISSUED | VOID
    paymentStatus: text('payment_status').notNull().default('PENDING'),
    lines: jsonb('lines').$type<Array<{ name: string; spec?: string; quantity: number; unit?: string; unitPrice: string; amount: string }>>().notNull().default([]),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
    documentId: uuid('document_id'),
    issuedAt: ts('issued_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('invoices_number_uq').on(t.tenantId, t.type, t.number), index('invoices_project_idx').on(t.tenantId, t.projectId)],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id').notNull(),
    invoiceId: uuid('invoice_id'),
    direction: text('direction').notNull().default('INBOUND'), // INBOUND (customer) | OUTBOUND (supplier/forwarder)
    kind: text('kind').notNull().default('DEPOSIT'), // DEPOSIT | BALANCE | FULL | FREIGHT | DUTY | OTHER
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    dueDate: text('due_date'),
    status: text('status').notNull().default('PENDING'),
    paidAt: ts('paid_at'),
    method: text('method').notNull().default('BANK_TRANSFER'),
    reference: text('reference').notNull().default(''),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payments_project_idx').on(t.tenantId, t.projectId)],
);

// ─────────────────────────── Orders / production / inspection ───────────────────────────

export const purchaseOrders = pgTable('purchase_orders', {
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  projectId: uuid('project_id').notNull(),
  supplierId: uuid('supplier_id'),
  currency: text('currency').notNull(),
  total: money('total').notNull(),
  lines: jsonb('lines').$type<Array<{ name: string; quantity: number; unitPrice: string; amount: string }>>().notNull().default([]),
  status: text('status').notNull().default('ISSUED'), // DRAFT | ISSUED | CONFIRMED | CANCELLED
  documentId: uuid('document_id'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productionOrders = pgTable('production_orders', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').notNull(),
  purchaseOrderId: uuid('purchase_order_id'),
  status: text('status').notNull().default('NOT_STARTED'),
  plannedStart: text('planned_start'),
  plannedEnd: text('planned_end'),
  actualStart: text('actual_start'),
  actualEnd: text('actual_end'),
  progressPct: integer('progress_pct').notNull().default(0),
  delayReason: text('delay_reason').notNull().default(''),
  milestones: jsonb('milestones').$type<Array<{ name: string; plannedAt?: string; doneAt?: string; note?: string }>>().notNull().default([]),
  updates: jsonb('updates').$type<Array<{ at: string; status: string; note: string; by?: string; photoFileIds?: string[] }>>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const inspections = pgTable('inspections', {
  id: id(),
  tenantId: tenantId(),
  projectId: uuid('project_id').notNull(),
  productionOrderId: uuid('production_order_id'),
  type: text('type').notNull().default('PRE_SHIPMENT'), // PRE_PRODUCTION | DURING_PRODUCTION | PRE_SHIPMENT | LOADING
  inspector: text('inspector').notNull().default(''),
  scheduledAt: text('scheduled_at'),
  result: text('result').notNull().default('PENDING'),
  aqlLevel: text('aql_level').notNull().default(''),
  sampleSize: integer('sample_size'),
  defectsCritical: integer('defects_critical').notNull().default(0),
  defectsMajor: integer('defects_major').notNull().default(0),
  defectsMinor: integer('defects_minor').notNull().default(0),
  reportFileId: uuid('report_file_id'),
  photoFileIds: jsonb('photo_file_ids').$type<string[]>().notNull().default([]),
  note: text('note').notNull().default(''),
  cost: money('cost'),
  costCurrency: text('cost_currency'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─────────────────────────── Shipments ───────────────────────────

export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    projectId: uuid('project_id').notNull(),
    mode: text('mode').notNull(),
    carrierCode: text('carrier_code').notNull().default(''), // SCAC or IATA
    carrierName: text('carrier_name').notNull().default(''),
    bookingNumber: text('booking_number').notNull().default(''),
    blNumber: text('bl_number').notNull().default(''),
    originPort: text('origin_port').notNull(),
    destinationPort: text('destination_port').notNull(),
    transshipmentPorts: jsonb('transshipment_ports').$type<string[]>().notNull().default([]),
    incoterm: text('incoterm').notNull().default('FOB'),
    status: text('status').notNull().default('PLANNED'),
    etd: ts('etd'),
    atd: ts('atd'),
    eta: ts('eta'),
    ata: ts('ata'),
    lastTrackedAt: ts('last_tracked_at'),
    trackingError: text('tracking_error'),
    customsStatus: text('customs_status').notNull().default('NOT_STARTED'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('shipments_code_uq').on(t.tenantId, t.code)],
);

export const shipmentContainers = pgTable('shipment_containers', {
  id: id(),
  tenantId: tenantId(),
  shipmentId: uuid('shipment_id').notNull(),
  containerNumber: text('container_number').notNull(),
  isoType: text('iso_type').notNull().default(''), // 22G1, 42G1, 45G1
  sealNumber: text('seal_number').notNull().default(''),
  cartons: integer('cartons'),
  grossWeightKg: text('gross_weight_kg'),
  cbm: text('cbm'),
  createdAt: createdAt(),
});

export const shipmentVessels = pgTable('shipment_vessels', {
  id: id(),
  tenantId: tenantId(),
  shipmentId: uuid('shipment_id').notNull(),
  legSequence: integer('leg_sequence').notNull().default(1),
  vesselName: text('vessel_name').notNull(),
  imo: text('imo').notNull().default(''),
  mmsi: text('mmsi').notNull().default(''),
  voyage: text('voyage').notNull().default(''),
  loadPort: text('load_port').notNull().default(''),
  dischargePort: text('discharge_port').notNull().default(''),
  createdAt: createdAt(),
});

/** Events keep their provenance: carrier-confirmed vs AIS-inferred vs manual are never merged. */
export const shipmentEvents = pgTable(
  'shipment_events',
  {
    id: id(),
    tenantId: tenantId(),
    shipmentId: uuid('shipment_id').notNull(),
    containerId: uuid('container_id'),
    eventType: text('event_type').notNull(),
    classifier: text('classifier').notNull().default('ACT'), // DCSA: PLN | EST | ACT
    source: text('source').notNull(), // CARRIER_CONFIRMED | AIS_INFERRED | FORWARDER_REPORTED | MANUAL
    locationCode: text('location_code').notNull().default(''),
    locationName: text('location_name').notNull().default(''),
    occurredAt: ts('occurred_at').notNull(),
    externalId: text('external_id').notNull().default(''),
    confirmed: boolean('confirmed').notNull().default(true),
    note: text('note').notNull().default(''),
    raw: jsonb('raw').$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [index('shipment_events_shipment_idx').on(t.tenantId, t.shipmentId, t.occurredAt)],
);

export const vesselPositions = pgTable(
  'vessel_positions',
  {
    id: id(),
    tenantId: tenantId(),
    shipmentVesselId: uuid('shipment_vessel_id').notNull(),
    mmsi: text('mmsi').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    speedKnots: real('speed_knots'),
    courseDeg: real('course_deg'),
    headingDeg: real('heading_deg'),
    navStatus: text('nav_status'),
    source: text('source').notNull(), // AISSTREAM | NMEA | MANUAL
    observedAt: ts('observed_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('vessel_positions_idx').on(t.tenantId, t.shipmentVesselId, t.observedAt)],
);

export const shipmentEtas = pgTable(
  'shipment_etas',
  {
    id: id(),
    tenantId: tenantId(),
    shipmentId: uuid('shipment_id').notNull(),
    source: text('source').notNull(), // CARRIER | AIS | HISTORICAL | INTERNAL_ML | FORWARDER | MANUAL
    eta: ts('eta').notNull(),
    confidence: real('confidence'),
    computedAt: ts('computed_at').notNull().defaultNow(),
    note: text('note').notNull().default(''),
  },
  (t) => [index('shipment_etas_idx').on(t.tenantId, t.shipmentId, t.computedAt)],
);
