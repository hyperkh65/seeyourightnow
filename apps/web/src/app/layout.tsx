import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/components/providers';
import { getSite } from '@/lib/server';
import { assetUrl, themeStyle } from '@/lib/theme';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  if (!site || site.platform) return { title: 'Sourcing OS Platform', robots: { index: false } };
  const b = site.brand;
  const title = b.serviceName ? `${b.siteName} · ${b.serviceName}` : b.siteName;
  const description = site.homepage.sections.find((s) => s.type === 'HERO')?.subtitle || `${b.siteName} — 사진 한 장으로 시작하는 해외 소싱`;
  return {
    title: { default: title, template: `%s · ${b.siteName}` },
    description,
    icons: b.faviconFileId ? { icon: assetUrl(b.faviconFileId)! } : undefined,
    openGraph: { title, description, siteName: b.siteName, type: 'website', ...(b.ogImageFileId ? { images: [assetUrl(b.ogImageFileId)!] } : {}) },
    robots: site.tenant.isDemo ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches&&document.documentElement.dataset.dark==='1'))document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const site = await getSite();
  const lang = site?.locale?.defaultLocale ?? 'ko';
  return (
    <html lang={lang} style={themeStyle(site)} data-dark={site?.brand?.darkModeEnabled === false ? '0' : '1'} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers site={site}>{children}</Providers>
      </body>
    </html>
  );
}
