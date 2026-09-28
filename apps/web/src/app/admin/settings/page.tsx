'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  Calculator,
  CheckCircle2,
  FileText,
  Globe,
  Hash,
  Home,
  Image,
  Landmark,
  Languages,
  Mail,
  MessageCircle,
  PanelBottom,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Webhook,
  Wand2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/components/providers';
import { Card, PageHeader, Progress } from '@/components/ui';

const GROUPS: Array<{
  title: string;
  items: Array<{ href: string; label: string; desc: string; icon: typeof Home; perm?: string }>;
}> = [
  {
    title: '사이트',
    items: [
      { href: '/admin/settings/brand', label: '브랜드', desc: '이름, 로고, 색상, 글꼴', icon: Image },
      { href: '/admin/settings/homepage', label: '홈페이지 구성', desc: '섹션 추가·순서·내용', icon: Home },
      { href: '/admin/settings/company', label: '회사 정보', desc: '사업자 정보, 연락처', icon: Building2 },
      {
        href: '/admin/settings/social',
        label: 'SNS·메신저',
        desc: '카카오톡, WeChat, WhatsApp',
        icon: MessageCircle,
      },
      { href: '/admin/settings/footer', label: '푸터', desc: '하단 문구와 링크', icon: PanelBottom },
      {
        href: '/admin/settings/domains',
        label: '도메인',
        desc: '자체 도메인 연결',
        icon: Globe,
        perm: 'tenant.domains.manage',
      },
      {
        href: '/admin/settings/policies',
        label: '약관·정책',
        desc: '이용약관, 개인정보처리방침',
        icon: ShieldCheck,
      },
    ],
  },
  {
    title: '거래',
    items: [
      {
        href: '/admin/settings/pricing',
        label: '가격·견적',
        desc: '고객 가격 표시, 부가세, 유효기간',
        icon: Calculator,
      },
      { href: '/admin/settings/bank', label: '입금 계좌', desc: '견적서·인보이스에 표시', icon: Landmark },
      {
        href: '/admin/settings/numbering',
        label: '문서 번호',
        desc: '견적·계약·인보이스 번호 규칙',
        icon: Hash,
      },
      {
        href: '/admin/settings/document-templates',
        label: '문서 양식',
        desc: '견적서·계약서·인보이스 양식',
        icon: FileText,
        perm: 'document.template.manage',
      },
      {
        href: '/admin/settings/search',
        label: '검색·추천',
        desc: '추천 점수 가중치, 검색 제한',
        icon: Search,
      },
    ],
  },
  {
    title: '연결·알림',
    items: [
      {
        href: '/admin/settings/connections',
        label: 'API 연결',
        desc: 'AI, 마켓, 운송, 환율, 이메일',
        icon: Plug,
        perm: 'tenant.settings.read',
      },
      { href: '/admin/settings/ai', label: 'AI 라우팅', desc: '기본·대체 AI 제공자', icon: Sparkles },
      { href: '/admin/settings/notifications', label: '알림', desc: '발신 정보, 내부 알림', icon: Bell },
      {
        href: '/admin/settings/email-templates',
        label: '이메일 양식',
        desc: '자동 발송 메일 문구',
        icon: Mail,
        perm: 'email.manage',
      },
      {
        href: '/admin/settings/webhooks',
        label: '웹훅',
        desc: '외부 시스템으로 이벤트 전송',
        icon: Webhook,
        perm: 'webhook.manage',
      },
    ],
  },
  {
    title: '운영',
    items: [
      {
        href: '/admin/settings/locale',
        label: '언어·시간대',
        desc: '한국어, English, 中文',
        icon: Languages,
      },
      {
        href: '/admin/settings/privacy',
        label: '개인정보·보관',
        desc: '보관 기간, 익명 처리',
        icon: ShieldCheck,
      },
      {
        href: '/admin/settings/import-export',
        label: '가져오기·내보내기',
        desc: '공급처, 고객, 운임 CSV',
        icon: Upload,
        perm: 'import.export',
      },
    ],
  },
];

export default function SettingsHub() {
  const can = useCan();
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () =>
      api.get<{ completedAt: string | null; state: Record<string, string>; steps: string[] }>('/admin/setup'),
  });
  const done = setup.data ? Object.keys(setup.data.state).length : 0;
  const total = setup.data?.steps.length ?? 12;
  return (
    <>
      <PageHeader
        title="설정"
        description="모든 변경은 버전으로 기록되며, 사이트에 보이는 설정은 초안 → 미리보기 → 게시 순서로 반영됩니다."
      />
      {setup.data && !setup.data.completedAt && (
        <Link href="/admin/settings/setup" className="mb-6 block">
          <Card className="flex items-center gap-4 border-brand/30 p-5 transition hover:shadow-md">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Wand2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">초기 설정을 마무리하세요</p>
              <p className="text-sm text-ink-muted">
                {done}/{total}단계 완료 · 회사 정보, 브랜드, 계좌, API 연결 순서로 안내합니다.
              </p>
              <Progress value={(done / total) * 100} className="mt-2" />
            </div>
          </Card>
        </Link>
      )}
      {setup.data?.completedAt && (
        <p className="mb-6 flex items-center gap-1.5 text-sm text-ink-muted">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          초기 설정 완료 ·{' '}
          <Link href="/admin/settings/setup" className="text-brand hover:underline">
            다시 보기
          </Link>
        </p>
      )}
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-sm font-semibold text-ink-muted">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items
                .filter((i) => !i.perm || can(i.perm))
                .map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className="group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-brand/40 hover:shadow-md"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-soft group-hover:bg-brand/10 group-hover:text-brand">
                      <i.icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{i.label}</span>
                      <span className="block text-xs text-ink-muted">{i.desc}</span>
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
