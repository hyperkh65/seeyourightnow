'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe, useToast } from '@/components/providers';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
} from '@/components/ui';

const KINDS = [
  { kind: 'QUOTE_ISSUED', label: '견적서 도착' },
  { kind: 'CONTRACT_READY', label: '계약서 확인 요청' },
  { kind: 'PI_ISSUED', label: '인보이스 발행' },
  { kind: 'PRODUCTION_DELAY', label: '생산 일정 변경' },
  { kind: 'VESSEL_DEPARTED', label: '출항' },
  { kind: 'ETA_CHANGED', label: '도착 예정일 변경' },
  { kind: 'DELIVERED', label: '배송 완료' },
];

export default function PortalSettings() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const company = useQuery({
    queryKey: ['me-company'],
    queryFn: () =>
      api.get<{
        name: string;
        businessNumber: string;
        ceo: string;
        address: string;
        taxInvoiceEmail: string;
      } | null>('/me/company'),
  });
  const prefs = useQuery({
    queryKey: ['prefs'],
    queryFn: () =>
      api.get<{ items: Array<{ kind: string; channels: string[] }> }>('/notifications/preferences'),
  });
  const [f, setF] = useState({ name: '', businessNumber: '', ceo: '', address: '', taxInvoiceEmail: '' });
  useEffect(() => {
    if (company.data)
      setF({
        name: company.data.name,
        businessNumber: company.data.businessNumber,
        ceo: company.data.ceo,
        address: company.data.address,
        taxInvoiceEmail: company.data.taxInvoiceEmail,
      });
  }, [company.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/me/company', f),
    onSuccess: () => {
      toast.ok('저장했습니다.');
      void qc.invalidateQueries({ queryKey: ['me-company'] });
    },
    onError: toast.error,
  });
  const channels = (kind: string) =>
    prefs.data?.items.find((p) => p.kind === kind)?.channels ?? ['WEB', 'EMAIL'];
  const setPref = useMutation({
    mutationFn: (items: Array<{ kind: string; channels: string[] }>) =>
      api.put('/notifications/preferences', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs'] }),
    onError: toast.error,
  });
  const isAdmin = me.data?.user?.roles.includes('CUSTOMER_ADMIN');
  return (
    <>
      <PageHeader title="설정" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="회사 정보" description="세금계산서와 계약서에 사용됩니다." />
          <CardBody>
            {company.isLoading ? (
              <LoadingBlock />
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <Field label="회사명">
                  <Input
                    value={f.name}
                    disabled={!isAdmin}
                    onChange={(e) => setF({ ...f, name: e.target.value })}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="사업자등록번호">
                    <Input
                      value={f.businessNumber}
                      disabled={!isAdmin}
                      onChange={(e) => setF({ ...f, businessNumber: e.target.value })}
                    />
                  </Field>
                  <Field label="대표자">
                    <Input
                      value={f.ceo}
                      disabled={!isAdmin}
                      onChange={(e) => setF({ ...f, ceo: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="주소">
                  <Input
                    value={f.address}
                    disabled={!isAdmin}
                    onChange={(e) => setF({ ...f, address: e.target.value })}
                  />
                </Field>
                <Field label="세금계산서 이메일">
                  <Input
                    type="email"
                    value={f.taxInvoiceEmail}
                    disabled={!isAdmin}
                    onChange={(e) => setF({ ...f, taxInvoiceEmail: e.target.value })}
                  />
                </Field>
                {isAdmin && (
                  <Button type="submit" loading={save.isPending}>
                    저장
                  </Button>
                )}
              </form>
            )}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="알림 설정" description="어떤 소식을 이메일로 받을지 정할 수 있습니다." />
            <CardBody className="space-y-3">
              {KINDS.map((k) => {
                const ch = channels(k.kind);
                return (
                  <div key={k.kind} className="flex items-center justify-between gap-3 text-sm">
                    <span>{k.label}</span>
                    <Checkbox
                      checked={ch.includes('EMAIL')}
                      onChange={(v) =>
                        setPref.mutate([
                          {
                            kind: k.kind,
                            channels: v ? [...new Set([...ch, 'EMAIL'])] : ch.filter((c) => c !== 'EMAIL'),
                          },
                        ])
                      }
                      label="이메일"
                    />
                  </div>
                );
              })}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-brand" />
                <div>
                  <p className="text-sm font-medium">계정 보안</p>
                  <p className="text-xs text-ink-muted">비밀번호, 2단계 인증, 패스키, 로그인 기기</p>
                </div>
              </div>
              <Link href="/account/security">
                <Button variant="secondary" size="sm">
                  관리
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
