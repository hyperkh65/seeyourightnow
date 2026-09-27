/**
 * Document numbering. Tenants configure a pattern per document type, e.g.
 *   "QT-{YYYY}-{SEQ:4}"  → QT-2026-0001
 *   "SRC-{YYYY}-{SEQ:6}" → SRC-2026-000184
 * Supported tokens: {YYYY} {YY} {MM} {DD} {SEQ:n}
 */

export const DEFAULT_NUMBER_PATTERNS: Record<string, string> = {
  PROJECT: 'SRC-{YYYY}-{SEQ:6}',
  QUOTATION: 'QT-{YYYY}-{SEQ:4}',
  CONTRACT: 'CT-{YYYY}-{SEQ:4}',
  PURCHASE_ORDER: 'PO-{YYYY}-{SEQ:4}',
  PROFORMA_INVOICE: 'PI-{YYYY}-{SEQ:4}',
  COMMERCIAL_INVOICE: 'CI-{YYYY}-{SEQ:4}',
  PACKING_LIST: 'PL-{YYYY}-{SEQ:4}',
  SALES_INVOICE: 'SI-{YYYY}-{SEQ:4}',
  RECEIPT: 'RC-{YYYY}-{SEQ:4}',
  SHIPPING_NOTICE: 'SN-{YYYY}-{SEQ:4}',
  DELIVERY_NOTE: 'DN-{YYYY}-{SEQ:4}',
  SHIPMENT: 'SHP-{YYYY}-{SEQ:5}',
  RFQ: 'RFQ-{YYYY}-{SEQ:5}',
};

export function formatNumber(pattern: string, seq: number, date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  return pattern
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, String(date.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/\{DD\}/g, String(date.getUTCDate()).padStart(2, '0'))
    .replace(/\{SEQ(?::(\d+))?\}/g, (_m, w: string | undefined) => String(seq).padStart(w ? Number(w) : 4, '0'));
}

/** Whether the sequence resets yearly (pattern contains a year token). */
export function sequenceScope(pattern: string, date = new Date()): string {
  return /\{YY(YY)?\}/.test(pattern) ? String(date.getUTCFullYear()) : 'ALL';
}

/** Project reference as it appears in email subjects for ingestion, e.g. "[SRC-2026-000184]". */
export const PROJECT_REF_REGEX = /\[([A-Z]{2,5}-\d{4}-\d{3,8})\]/;

export function extractProjectRef(subject: string): string | null {
  return PROJECT_REF_REGEX.exec(subject)?.[1] ?? null;
}
