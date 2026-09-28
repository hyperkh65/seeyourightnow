'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  isDemo: boolean;
  plan: string | null;
  users: number;
  primaryDomain: string | null;
  featureFlags: Record<string, boolean>;
  limitOverrides: Record<string, { value: number; hard: boolean }>;
  createdAt: string;
  setupCompletedAt: string | null;
}
interface Plans {
  items: Array<{ code: string; name: string; features: string[] }>;
  modules: string[];
  limitKeys: string[];
}

export default function Tenants() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => api.get<{ items: Tenant[] }>('/platform/tenants'),
  });
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<Plans>('/platform/plans') });
  const [create, setCreate] = useState<null | {
    name: string;
    slug: string;
    planCode: string;
    ownerEmail: string;
    ownerName: string;
  }>(null);
  const [edit, setEdit] = useState<Tenant | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean | null>>({});
  const [imp, setImp] = useState<{ tenant: Tenant; reason: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['platform-tenants'] });
  const doCreate = useMutation({
    mutationFn: () => api.post<{ inviteLink: string }>('/platform/tenants', create),
    onSuccess: (r) => {
      setCreate(null);
      setLink(r.inviteLink);
      refresh();
    },
    onError: toast.error,
  });
  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/platform/tenants/${edit!.id}`, {
        status: edit!.status,
        name: edit!.name,
        ...(edit!.plan ? { planCode: edit!.plan } : {}),
      });
      if (Object.keys(flags).length) await api.put(`/platform/tenants/${edit!.id}/feature-flags`, { flags });
    },
    onSuccess: () => {
      toast.ok('저장했습니다.');
      setEdit(null);
      setFlags({});
      refresh();
    },
    onError: toast.error,
  });
  const impersonate = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>(`/platform/tenants/${imp!.tenant.id}/impersonate`, { reason: imp!.reason }),
    onSuccess: (r) => {
      setImp(null);
      window.open(r.url, '_blank', 'noopener');
      toast.ok('대리 접속 링크를 열었습니다 (60초 유효). 모든 작업이 기록됩니다.');
    },
    onError: toast.error,
  });
  const planOf = (code: string | null) => plans.data?.items.find((p) => p.code === code);
  return (
    <>
      <PageHeader
        title="테넌트"
        description="고객사(화이트라벨 사이트)를 만들고 요금제·기능·상태를 관리합니다."
        actions={
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() =>
              setCreate({
                name: '',
                slug: '',
                planCode: 'BUSINESS',
                ownerEmail: '',
                ownerName: '대표 관리자',
              })
            }
          >
            테넌트 만들기
          </Button>
        }
      />
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={5} />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState title="테넌트가 없습니다" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>이름</Th>
                <Th>주소</Th>
                <Th>요금제</Th>
                <Th className="text-right">사용자</Th>
                <Th>상태</Th>
                <Th>생성</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <p className="font-medium">
                      {t.name}
                      {t.isDemo && (
                        <Badge tone="warn" className="ml-2">
                          DEMO
                        </Badge>
                      )}
                    </p>
                    {!t.setupCompletedAt && <p className="text-xs text-ink-muted">초기 설정 진행 중</p>}
                  </Td>
                  <Td className="font-mono text-xs">{t.primaryDomain ?? t.slug}</Td>
                  <Td>
                    <Badge>{t.plan ?? '없음'}</Badge>
                  </Td>
                  <Td className="text-right tabular">{t.users}</Td>
                  <Td>
                    <Badge tone={t.status === 'ACTIVE' ? 'ok' : 'danger'}>
                      {t.status === 'ACTIVE' ? '사용 중' : '중지'}
                    </Badge>
                  </Td>
                  <Td className="text-xs">{formatDate(t.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEdit({ ...t });
                        setFlags({});
                      }}
                    >
                      관리
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<UserCog className="h-4 w-4" />}
                      onClick={() => setImp({ tenant: t, reason: '' })}
                    >
                      대리 접속
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        open={!!create}
        onClose={() => setCreate(null)}
        title="테넌트 만들기"
        description="대표 관리자에게 초대 링크가 발급됩니다. 대표 관리자는 첫 로그인 시 2단계 인증을 설정합니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreate(null)}>
              취소
            </Button>
            <Button
              loading={doCreate.isPending}
              disabled={
                !create?.name ||
                !/^[a-z0-9-]{3,32}$/.test(create?.slug ?? '') ||
                !create?.ownerEmail.includes('@')
              }
              onClick={() => doCreate.mutate()}
            >
              만들기
            </Button>
          </>
        }
      >
        {create && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="이름" required>
              <Input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />
            </Field>
            <Field label="주소 (slug)" hint="영문 소문자·숫자·하이픈 3~32자" required>
              <Input
                value={create.slug}
                onChange={(e) =>
                  setCreate({ ...create, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
                }
              />
            </Field>
            <Field label="요금제">
              <Select
                value={create.planCode}
                onChange={(e) => setCreate({ ...create, planCode: e.target.value })}
              >
                {plans.data?.items.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div />
            <Field label="대표 관리자 이메일" required>
              <Input
                type="email"
                value={create.ownerEmail}
                onChange={(e) => setCreate({ ...create, ownerEmail: e.target.value })}
              />
            </Field>
            <Field label="대표 관리자 이름">
              <Input
                value={create.ownerName}
                onChange={(e) => setCreate({ ...create, ownerName: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        title={edit?.name ?? ''}
        description="변경 내용은 플랫폼 감사 로그에 기록됩니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>
              취소
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              저장
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="이름">
                <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label="요금제">
                <Select value={edit.plan ?? ''} onChange={(e) => setEdit({ ...edit, plan: e.target.value })}>
                  {plans.data?.items.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="상태">
                <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  <option value="ACTIVE">사용 중</option>
                  <option value="SUSPENDED">중지</option>
                </Select>
              </Field>
            </div>
            {edit.status === 'SUSPENDED' && (
              <Alert tone="warn">
                중지하면 이 테넌트의 사이트와 로그인이 모두 막힙니다. 데이터는 보존됩니다.
              </Alert>
            )}
            <Field label="기능" hint="요금제 기본값 위에 테넌트별로 켜고 끌 수 있습니다">
              <div className="grid gap-2 sm:grid-cols-2">
                {plans.data?.modules.map((m) => {
                  const inPlan = !!planOf(edit.plan)?.features.includes(m);
                  const override =
                    m in flags ? flags[m] : m in edit.featureFlags ? edit.featureFlags[m] : null;
                  return (
                    <label
                      key={m}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-xs"
                    >
                      <span>
                        {m}
                        <span className="ml-1 text-ink-muted">{inPlan ? '(요금제 포함)' : ''}</span>
                      </span>
                      <select
                        aria-label={`${m} 설정`}
                        className="rounded border border-line bg-surface px-1 py-0.5"
                        value={override === null || override === undefined ? '' : override ? 'on' : 'off'}
                        onChange={(e) =>
                          setFlags({ ...flags, [m]: e.target.value === '' ? null : e.target.value === 'on' })
                        }
                      >
                        <option value="">요금제 따름</option>
                        <option value="on">켜기</option>
                        <option value="off">끄기</option>
                      </select>
                    </label>
                  );
                })}
              </div>
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!imp}
        onClose={() => setImp(null)}
        title={`${imp?.tenant.name ?? ''} 대리 접속`}
        description="대표 관리자 계정으로 60초 유효한 1회용 링크가 발급됩니다. 대리 접속 중 모든 작업은 감사 로그에 표시됩니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setImp(null)}>
              취소
            </Button>
            <Button
              loading={impersonate.isPending}
              disabled={(imp?.reason.trim().length ?? 0) < 10}
              onClick={() => impersonate.mutate()}
            >
              대리 접속
            </Button>
          </>
        }
      >
        {imp && (
          <Field label="사유" hint="10자 이상 (고객 요청 번호 등)" required>
            <Textarea value={imp.reason} onChange={(e) => setImp({ ...imp, reason: e.target.value })} />
          </Field>
        )}
      </Dialog>

      <Dialog
        open={!!link}
        onClose={() => setLink(null)}
        title="테넌트를 만들었습니다"
        description="대표 관리자에게 아래 초대 링크를 전달하세요. 이 링크는 다시 표시되지 않습니다."
        footer={<Button onClick={() => setLink(null)}>확인</Button>}
      >
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-surface-sunken p-2 text-xs">{link}</code>
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy className="h-4 w-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(link ?? '');
              toast.ok('복사했습니다.');
            }}
          >
            복사
          </Button>
        </div>
      </Dialog>
    </>
  );
}
