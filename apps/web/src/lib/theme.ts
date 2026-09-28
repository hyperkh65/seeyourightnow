import type { CSSProperties } from 'react';
import type { SiteConfig } from './site';
import { hexToRgbChannels, readableOn, softTint } from './utils';

const RADIUS: Record<string, string> = {
  none: '0px',
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px',
};

/** CSS variables for the tenant's white-label theme (applied on <html>). */
export function themeStyle(site: SiteConfig | null): CSSProperties {
  const b = site?.brand;
  const primary = b?.primaryColor ?? '#1F4FD8';
  return {
    ['--brand' as string]: hexToRgbChannels(primary),
    ['--brand-fg' as string]: readableOn(primary),
    ['--brand-soft' as string]: softTint(primary),
    ['--accent' as string]: hexToRgbChannels(b?.accentColor ?? '#10B981'),
    ['--radius' as string]: RADIUS[b?.buttonRadius ?? 'lg'] ?? '0.75rem',
    ['--font-sans' as string]:
      b?.fontFamily === 'Inter'
        ? 'Inter'
        : b?.fontFamily === 'Noto Sans KR'
          ? "'Noto Sans KR'"
          : b?.fontFamily === 'System'
            ? 'system-ui'
            : "'Pretendard Variable', Pretendard",
  };
}

export function assetUrl(fileId: string | null | undefined): string | null {
  return fileId ? `/api/v1/public/assets/${fileId}` : null;
}
