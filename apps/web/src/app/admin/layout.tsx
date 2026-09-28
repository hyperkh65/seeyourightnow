'use client';

import type { ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Boxes,
  Building2,
  Calculator,
  ClipboardList,
  FileText,
  Gauge,
  LayoutDashboard,
  Lightbulb,
  Settings,
  ShieldCheck,
  Ship,
  Truck,
  Users,
} from 'lucide-react';
import { AppShell, type NavGroup } from '@/components/shell';

const groups: NavGroup[] = [
  {
    items: [
      { href: '/admin', label: '대시보드', icon: LayoutDashboard, exact: true },
      { href: '/admin/projects', label: '프로젝트', icon: ClipboardList, perm: 'sourcing.read' },
      { href: '/admin/quotes', label: '견적', icon: FileText, perm: 'quote.read' },
      { href: '/admin/shipments', label: '운송', icon: Ship, perm: 'shipment.read' },
    ],
  },
  {
    title: '데이터',
    items: [
      { href: '/admin/suppliers', label: '공급처', icon: Boxes, perm: 'supplier.read' },
      { href: '/admin/customers', label: '고객', icon: Building2, perm: 'crm.read', feature: 'CRM' },
      { href: '/admin/compliance', label: '인증·규제', icon: ShieldCheck, perm: 'compliance.read' },
      { href: '/admin/freight', label: '운임', icon: Truck, perm: 'freight.read' },
      { href: '/admin/margin', label: '마진·가격', icon: Calculator, perm: 'cost.read' },
    ],
  },
  {
    title: '인사이트',
    items: [
      {
        href: '/admin/analytics',
        label: '분석',
        icon: BarChart3,
        perm: 'analytics.read',
        feature: 'ANALYTICS',
      },
      { href: '/admin/demand', label: '수요·소싱 기회', icon: Lightbulb, perm: 'analytics.read' },
    ],
  },
  {
    title: '관리',
    items: [
      { href: '/admin/settings', label: '설정', icon: Settings, perm: 'tenant.settings.read' },
      { href: '/admin/users', label: '사용자·협력사', icon: Users, perm: 'tenant.users.manage' },
      { href: '/admin/system', label: '시스템 상태', icon: Gauge, perm: 'tenant.settings.read' },
      { href: '/admin/audit', label: '감사 로그', icon: Activity, perm: 'tenant.audit.read' },
    ],
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell audience={['STAFF']} groups={groups}>
      {children}
    </AppShell>
  );
}
