'use client';

import type { ReactNode } from 'react';
import { ClipboardList, ShieldCheck } from 'lucide-react';
import { AppShell, type NavGroup } from '@/components/shell';

const groups: NavGroup[] = [
  {
    items: [
      { href: '/partner', label: '배정된 작업', icon: ClipboardList, exact: true },
      { href: '/account/security', label: '보안 설정', icon: ShieldCheck },
    ],
  },
];

export default function PartnerLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell audience={['PARTNER']} groups={groups} title="협력사">
      {children}
    </AppShell>
  );
}
