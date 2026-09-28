import type { ReactNode } from 'react';
import { MessengerCta, PreviewBanner, PublicFooter, PublicHeader } from '@/components/site/chrome';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <PreviewBanner />
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
      <MessengerCta />
    </div>
  );
}
