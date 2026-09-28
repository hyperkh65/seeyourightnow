'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/shell';
import { useMe } from '@/components/providers';
import { homeFor } from '@/lib/auth-client';

export default function AccountLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  return (
    <AppShell
      audience={['STAFF', 'CUSTOMER', 'PARTNER', 'PLATFORM']}
      groups={[
        {
          items: [
            { href: homeFor(me.data?.user?.audience), label: '돌아가기', icon: ArrowLeft, exact: true },
            { href: '/account/security', label: '계정·보안', icon: ShieldCheck },
          ],
        },
      ]}
    >
      {children}
    </AppShell>
  );
}
