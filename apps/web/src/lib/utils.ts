import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYMBOL: Record<string, string> = { KRW: '₩', USD: '$', CNY: '¥', EUR: '€', JPY: '¥' };
const PRECISION: Record<string, number> = { KRW: 0, JPY: 0 };

/** Formats a decimal string for display without floating-point arithmetic on the value itself. */
export function formatMoney(value: string | number | null | undefined, currency = 'KRW', opts: { symbol?: boolean; precision?: number } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  const neg = s.startsWith('-');
  const [intRaw = '0', fracRaw = ''] = (neg ? s.slice(1) : s).split('.');
  const p = opts.precision ?? PRECISION[currency] ?? 2;
  // Round half-up on the string representation.
  let int = intRaw.replace(/^0+(?=\d)/, '');
  let frac = fracRaw.padEnd(p + 1, '0');
  const roundDigit = Number(frac[p] ?? '0');
  frac = frac.slice(0, p);
  if (roundDigit >= 5) {
    const combined = (BigInt(int + frac) + 1n).toString().padStart(int.length + p, '0');
    int = combined.slice(0, combined.length - p) || '0';
    frac = p ? combined.slice(combined.length - p) : '';
  }
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = p ? `${grouped}.${frac}` : grouped;
  const sym = opts.symbol === false ? '' : (SYMBOL[currency] ?? `${currency} `);
  return `${neg ? '-' : ''}${sym}${body}`;
}

export function formatNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatDate(v: string | Date | null | undefined, withTime = false): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  const f = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) });
  return f.format(d).replace(/\.\s?/g, '.').replace(/\.$/, '');
}

export function timeAgo(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`;
  return formatDate(v);
}

export function hexToRgbChannels(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '31 79 216';
  return `${parseInt(m[1]!, 16)} ${parseInt(m[2]!, 16)} ${parseInt(m[3]!, 16)}`;
}

/** Chooses black/white text for a background colour (WCAG contrast). */
export function readableOn(hex: string): string {
  const [r, g, b] = hexToRgbChannels(hex).split(' ').map(Number) as [number, number, number];
  const lum = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  return L > 0.45 ? '15 23 42' : '255 255 255';
}

export function softTint(hex: string): string {
  const [r, g, b] = hexToRgbChannels(hex).split(' ').map(Number) as [number, number, number];
  const mix = (c: number) => Math.round(c + (255 - c) * 0.9);
  return `${mix(r)} ${mix(g)} ${mix(b)}`;
}

export function initials(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  return /[가-힣]/.test(t) ? t.slice(0, 1) : t.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
