'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, MinusCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/providers';
import { Alert, Button, Card, ErrorState, LoadingBlock, PageHeader, Progress } from '@/components/ui';
import { SettingsBack } from '../_components/editor';

const STEPS: Record<string, { title: string; desc: string; href: string; optional?: boolean }> = {
  company: {
    title: '회사 정보',
    desc: '견적서·계약서에 들어갈 사업자 정보를 입력합니다.',
    href: '/admin/settings/company',
  },
  brand: { title: '브랜드', desc: '사이트 이름, 로고, 대표 색상을 정합니다.', href: '/admin/settings/brand' },
  domain: {
    title: '도메인',
    desc: '자체 도메인을 연결합니다. 기본 주소로도 운영할 수 있습니다.',
    href: '/admin/settings/domains',
    optional: true,
  },
  bank: { title: '입금 계좌', desc: '인보이스에 표시할 계좌를 등록합니다.', href: '/admin/settings/bank' },
  ai: {
    title: 'AI 연결',
    desc: 'Groq 등 AI 제공자를 연결하면 제품 분석과 번역 검색이 가능해집니다.',
    href: '/admin/settings/connections',
  },
  marketplace: {
    title: '중국 공급처 연결',
    desc: '1688 공식 API 또는 계약된 데이터 제공자를 연결합니다.',
    href: '/admin/settings/connections',
    optional: true,
  },
  domestic: {
    title: '국내 시장가격 연결',
    desc: '네이버 쇼핑·쿠팡 파트너스 등으로 국내 가격을 비교합니다.',
    href: '/admin/settings/connections',
    optional: true,
  },
  email: {
    title: '이메일 발송',
    desc: 'SMTP를 연결하고 발신 정보를 설정합니다.',
    href: '/admin/settings/notifications',
  },
  freight: { title: '운임표', desc: '포워더 운임이나 계약 운임을 등록합니다.', href: '/admin/freight' },
  experts: {
    title: '전문가·협력사 초대',
    desc: '관세사, 인증 전문가, 포워더를 초대합니다.',
    href: '/admin/users',
    optional: true,
  },
  margin: { title: '마진 규칙', desc: '기본 마진과 카테고리별 규칙을 정합니다.', href: '/admin/margin' },
  documents: {
    title: '약관·문서 양식',
    desc: '이용약관, 개인정보처리방침, 견적서 양식을 확인합니다.',
    href: '/admin/settings/policies',
  },
};

export default function Setup() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['setup'],
    queryFn: () =>
      api.get<{ completedAt: string | null; state: Record<string, 'DONE' | 'SKIPPED'>; steps: string[] }>(
        '/admin/setup',
      ),
  });
  const mark = useMutation({
    mutationFn: ({ step, status }: { step: string; status: 'DONE' | 'SKIPPED' }) =>
      api.post(`/admin/setup/${step}`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['setup'] }),
    onError: toast.error,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { state, steps } = q.data;
  const done = steps.filter((s) => state[s]).length;
  const next = steps.find((s) => !state[s]);
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="초기 설정"
        description="순서대로 진행하면 바로 견적을 받을 수 있는 상태가 됩니다. 나중에 언제든 바꿀 수 있습니다."
      />
      <Card className="mb-6 p-5">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">
            {done}/{steps.length}단계
          </span>
          {q.data.completedAt && <span className="text-emerald-600">완료</span>}
        </div>
        <Progress value={(done / steps.length) * 100} />
      </Card>
      {!q.data.completedAt && next && (
        <Alert className="mb-6" title={`다음: ${STEPS[next]?.title ?? next}`}>
          {STEPS[next]?.desc}
        </Alert>
      )}
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const def = STEPS[s] ?? { title: s, desc: '', href: '/admin/settings' };
          const st = state[s];
          return (
            <li key={s}>
              <Card
                className={`flex flex-wrap items-center gap-4 p-4 ${s === next ? 'border-brand/40' : ''}`}
              >
                <span className="shrink-0">
                  {st === 'DONE' ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  ) : st === 'SKIPPED' ? (
                    <MinusCircle className="h-6 w-6 text-ink-muted" />
                  ) : (
                    <Circle className="h-6 w-6 text-line" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {i + 1}. {def.title}
                    {def.optional && <span className="ml-2 text-xs text-ink-muted">선택</span>}
                  </p>
                  <p className="text-sm text-ink-muted">{def.desc}</p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={def.href}
                    className="inline-flex h-8 items-center gap-1 rounded-[var(--radius)] border border-line px-3 text-sm hover:bg-surface-sunken"
                  >
                    설정하기 <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  {st !== 'DONE' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => mark.mutate({ step: s, status: 'DONE' })}
                    >
                      완료
                    </Button>
                  )}
                  {!st && def.optional && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => mark.mutate({ step: s, status: 'SKIPPED' })}
                    >
                      건너뛰기
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
    </>
  );
}
