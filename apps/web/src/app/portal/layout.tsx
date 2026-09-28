'use client';

import type { ReactNode } from 'react';
import { FileText, Home, PackageSearch, Search, Settings, Ship } from 'lucide-react';
import { AppShell, type NavGroup, type NavItem } from '@/components/shell';

const groups: NavGroup[] = [
  {
    items: [
      { href: '/portal', label: '내 소싱', icon: Home, exact: true },
      { href: '/search', label: '새 제품 찾기', icon: Search },
      { href: '/portal/quotes', label: '견적', icon: FileText },
      { href: '/portal/shipments', label: '배송 조회', icon: Ship },
      { href: '/portal/settings', label: '설정', icon: Settings },
    ],
  },
];
const bottom: NavItem[] = [
  { href: '/portal', label: '내 소싱', icon: Home, exact: true },
  { href: '/search', label: '찾기', icon: PackageSearch },
  { href: '/portal/quotes', label: '견적', icon: FileText },
  { href: '/portal/shipments', label: '배송', icon: Ship },
  { href: '/portal/settings', label: '설정', icon: Settings },
];

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell audience={['CUSTOMER']} groups={groups} bottomNav={bottom}>
      {children}
    </AppShell>
  );
}
