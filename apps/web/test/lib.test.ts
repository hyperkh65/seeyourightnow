import { describe, expect, it } from 'vitest';
import { formatMoney, hexToRgbChannels, readableOn } from '@/lib/utils';
import { safeNext } from '@/lib/auth-client';

describe('formatMoney (string-based, no float rounding)', () => {
  it('formats KRW without decimals and rounds half up', () => {
    expect(formatMoney('1234567.5', 'KRW')).toBe('₩1,234,568');
    expect(formatMoney('1234567.4', 'KRW')).toBe('₩1,234,567');
  });
  it('keeps precision for large values beyond float safety', () => {
    expect(formatMoney('90071992547409931.49', 'KRW')).toBe('₩90,071,992,547,409,931');
  });
  it('handles negatives, carries and empty values', () => {
    expect(formatMoney('-0.995', 'USD')).toBe('-$1.00');
    expect(formatMoney('9.999', 'USD')).toBe('$10.00');
    expect(formatMoney(null, 'KRW')).toBe('—');
  });
});

describe('safeNext (open-redirect guard)', () => {
  it('accepts same-origin paths', () => {
    expect(safeNext('/portal/projects/1?tab=a')).toBe('/portal/projects/1?tab=a');
  });
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/ space', ''])(
    'rejects %s',
    (v) => {
      expect(safeNext(v)).toBeNull();
    },
  );
});

describe('theme helpers', () => {
  it('converts hex to rgb channels and picks readable foreground', () => {
    expect(hexToRgbChannels('#1F4FD8')).toBe('31 79 216');
    expect(readableOn('#FFFFFF')).not.toBe(readableOn('#000000'));
  });
});
