'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { useToast } from '@/components/providers';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
} from '@/components/ui';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string;
  features: string[];
  limits: Record<string, { value: number; hard: boolean }>;
  priceMonthly: string | null;
  active: boolean;
}
type Form = {
  code: string;
  name: string;
  description: string;
  features: string[];
  limits: Record<string, { value: number; hard: boolean }>;
  priceMonthly: string;
  active: boolean;
};
const LIMIT_LABEL: Record<string, string> = {
  users: '사용자',
  monthly_searches: '월 검색',
  ai_requests: '월 AI 요청',
  storage_mb: '저장 용량 (MB)',
  quotes: '월 견적',
  projects: '월 프로젝트',
  api_calls: '월 API 호출',
  custom_domains: '자체 도메인',
};

export default function PlansPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api.get<{ items: Plan[]; modules: string[]; limitKeys: string[] }>('/platform/plans'),
  });
  const [f, setF] = useState<Form | null>(null);
  const save = useMutation({
    mutationFn: () => api.post('/platform/plans', { ...f, priceMonthly: f!.priceMonthly || null }),
    onSuccess: () => {
      toast.ok('요금제를 저장했습니다.');
      setF(null);
      void qc.invalidateQueries({ queryKey: ['platform-plans'] });
    },
    onError: toast.error,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={6} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { modules, limitKeys } = q.data;
  const blank = (): Form => ({
    code: '',
    name: '',
    description: '',
    features: [],
    limits: Object.fromEntries(limitKeys.map((k) => [k, { value: -1, hard: false }])),
    priceMonthly: '',
    active: true,
  });
  return (
    <>
      <PageHeader
        title="요금제"
        description="요금제별 기능과 사용 한도입니다. -1은 무제한입니다. 같은 코드로 저장하면 수정됩니다."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF(blank())}>
            요금제 추가
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {q.data.items.map((p) => (
          <Card key={p.id} className={p.active ? '' : 'opacity-60'}>
            <CardHeader
              title={
                <span>
                  {p.name} <span className="text-xs font-normal text-ink-muted">{p.code}</span>
                </span>
              }
              description={p.priceMonthly ? `월 ${formatMoney(p.priceMonthly, 'KRW')}` : '가격 미정'}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setF({
                      code: p.code,
                      name: p.name,
                      description: p.description,
                      features: p.features,
                      limits: {
                        ...Object.fromEntries(limitKeys.map((k) => [k, { value: -1, hard: false }])),
                        ...p.limits,
                      },
                      priceMonthly: p.priceMonthly ?? '',
                      active: p.active,
                    })
                  }
                >
                  수정
                </Button>
              }
            />
            <CardBody className="space-y-3 text-sm">
              <p className="text-ink-muted">{p.description}</p>
              <div className="flex flex-wrap gap-1">
                {p.features.map((x) => (
                  <Badge key={x}>{x}</Badge>
                ))}
              </div>
              <ul className="space-y-0.5 text-xs">
                {Object.entries(p.limits).map(([k, l]) => (
                  <li key={k} className="flex justify-between">
                    <span>{LIMIT_LABEL[k] ?? k}</span>
                    <span className="tabular">
                      {l.value < 0 ? '무제한' : l.value.toLocaleString()}
                      {l.hard ? ' (초과 차단)' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
      <Dialog
        open={!!f}
        onClose={() => setF(null)}
        size="xl"
        title="요금제"
        footer={
          <>
            <Button variant="secondary" onClick={() => setF(null)}>
              취소
            </Button>
            <Button loading={save.isPending} disabled={!f?.code || !f?.name} onClick={() => save.mutate()}>
              저장
            </Button>
          </>
        }
      >
        {f && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="코드">
                <Input
                  value={f.code}
                  onChange={(e) =>
                    setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })
                  }
                />
              </Field>
              <Field label="이름">
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label="월 가격 (원)">
                <Input
                  value={f.priceMonthly}
                  onChange={(e) => setF({ ...f, priceMonthly: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="설명" className="sm:col-span-3">
                <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              </Field>
            </div>
            <Field label="기능">
              <div className="grid gap-2 sm:grid-cols-3">
                {modules.map((m) => (
                  <Checkbox
                    key={m}
                    checked={f.features.includes(m)}
                    onChange={(x) =>
                      setF({ ...f, features: x ? [...f.features, m] : f.features.filter((y) => y !== m) })
                    }
                    label={m}
                  />
                ))}
              </div>
            </Field>
            <Field label="한도">
              <div className="grid gap-2 sm:grid-cols-2">
                {limitKeys.map((k) => (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <span className="w-32 shrink-0">{LIMIT_LABEL[k] ?? k}</span>
                    <Input
                      className="w-28"
                      aria-label={`${k} 한도`}
                      value={String(f.limits[k]?.value ?? -1)}
                      onChange={(e) =>
                        setF({
                          ...f,
                          limits: {
                            ...f.limits,
                            [k]: {
                              value: Number(e.target.value.replace(/[^\d-]/g, '') || -1),
                              hard: f.limits[k]?.hard ?? false,
                            },
                          },
                        })
                      }
                    />
                    <Checkbox
                      checked={f.limits[k]?.hard ?? false}
                      onChange={(x) =>
                        setF({
                          ...f,
                          limits: { ...f.limits, [k]: { value: f.limits[k]?.value ?? -1, hard: x } },
                        })
                      }
                      label="초과 차단"
                    />
                  </div>
                ))}
              </div>
            </Field>
            <Checkbox
              checked={f.active}
              onChange={(x) => setF({ ...f, active: x })}
              label="신규 가입에 사용"
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
