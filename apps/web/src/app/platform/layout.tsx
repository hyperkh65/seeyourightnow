'use client';

import type { ReactNode } from 'react';
import { Activity, Building, Gauge, Layers, ShieldCheck } from 'lucide-react';
import { AppShell, type NavGroup } from '@/components/shell';

const groups: NavGroup[] = [
  {
    items: [
      { href: '/platform', label: '대시보드', icon: Gauge, exact: true },
      { href: '/platform/tenants', label: '테넌트', icon: Building },
      { href: '/platform/plans', label: '요금제', icon: Layers },
      { href: '/platform/audit', label: '플랫폼 감사 로그', icon: Activity },
      { href: '/account/security', label: '보안 설정', icon: ShieldCheck },
    ],
  },
];

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell audience={['PLATFORM']} groups={groups} title="플랫폼 관리">
      {children}
    </AppShell>
  );
}
