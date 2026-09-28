'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ShieldCheck, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { useMe, useToast } from '@/components/providers';
import { EXPERT_TYPE_LABEL, ROLE_LABEL } from '@/components/status';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Table,
  Tabs,
  Td,
  Th,
} from '@/components/ui';

interface User {
  id: string;
  email: string;
  name: string;
  status: string;
  companyId: string | null;
  expertTypes: string[];
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  roles: string[];
}
const STAFF = [
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'SALES',
  'SOURCING_MANAGER',
  'FINANCE',
  'WAREHOUSE',
  'READ_ONLY',
];
const PARTNER = ['CUSTOMS_PARTNER', 'FORWARDER_PARTNER', 'CERTIFICATION_PARTNER', 'SUPPLIER_PARTNER'];
const STATUS: Record<string, [string, 'ok' | 'warn' | 'neutral' | 'danger']> = {
  ACTIVE: ['사용 중', 'ok'],
  INVITED: ['초대됨', 'warn'],
  DISABLED: ['중지', 'neutral'],
  LOCKED: ['잠김', 'danger'],
};

type Form = { id?: string; email: string; name: string; roles: string[]; expertTypes: string[] };

export default function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [tab, setTab] = useState<'STAFF' | 'PARTNER'>('STAFF');
  const q = useQuery({
    queryKey: ['users', tab],
    queryFn: () => api.get<{ items: User[] }>(`/admin/users?audience=${tab}`),
  });
  const [form, setForm] = useState<Form | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] });
  const save = useMutation({
    mutationFn: () =>
      form!.id
        ? api.patch(`/admin/users/${form!.id}`, {
            roles: form!.roles,
            name: form!.name,
            expertTypes: form!.expertTypes,
          })
        : api.post<{ inviteLink: string }>('/admin/users/invite', {
            email: form!.email,
            name: form!.name,
            roles: form!.roles,
            expertTypes: form!.expertTypes,
          }),
    onSuccess: (r) => {
      if (r && typeof r === 'object' && 'inviteLink' in r) setLink((r as { inviteLink: string }).inviteLink);
      else toast.ok('저장했습니다.');
      setForm(null);
      refresh();
    },
    onError: toast.error,
  });
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: 'ACTIVE' | 'DISABLED' }) =>
      api.patch(`/admin/users/${id}`, { status: s }),
    onSuccess: () => {
      toast.ok('변경했습니다.');
      refresh();
    },
    onError: toast.error,
  });
  const roleOptions = tab === 'STAFF' ? STAFF : PARTNER;
  return (
    <>
      <PageHeader
        title="사용자·협력사"
        description="직원 계정과 관세사·포워더·인증 전문가 같은 외부 협력사를 관리합니다."
        actions={
          <Button
            icon={<UserPlus className="h-4 w-4" />}
            onClick={() =>
              setForm({
                email: '',
                name: '',
                roles: [roleOptions[tab === 'STAFF' ? 2 : 0]!],
                expertTypes: [],
              })
            }
          >
            초대
          </Button>
        }
      />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'STAFF', label: '직원' },
          { value: 'PARTNER', label: '협력사' },
        ]}
      />
      {tab === 'PARTNER' && (
        <Alert className="mb-4">
          협력사는 배정된 작업만 볼 수 있으며, 고객 정보·원가·마진에는 접근할 수 없습니다.
        </Alert>
      )}
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={5} />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState title="사용자가 없습니다" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>이름</Th>
                <Th>역할</Th>
                <Th>보안</Th>
                <Th>상태</Th>
                <Th>최근 접속</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((u) => {
                const [sl, st] = STATUS[u.status] ?? [u.status, 'neutral'];
                const self = u.id === me.data?.user?.id;
                return (
                  <tr key={u.id}>
                    <Td>
                      <p className="font-medium">
                        {u.name || u.email}
                        {self && <span className="ml-1 text-xs text-ink-muted">(나)</span>}
                      </p>
                      <p className="text-xs text-ink-muted">{u.email}</p>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} tone={r === 'TENANT_OWNER' ? 'brand' : 'neutral'}>
                            {ROLE_LABEL[r] ?? r}
                          </Badge>
                        ))}
                        {u.expertTypes.map((e) => (
                          <Badge key={e} tone="info">
                            {EXPERT_TYPE_LABEL[e] ?? e}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      {u.mfaEnabled ? (
                        <Badge tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>
                          2단계 인증
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-muted">미사용</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={st}>{sl}</Badge>
                    </Td>
                    <Td className="text-xs text-ink-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {!self && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setForm({
                              id: u.id,
                              email: u.email,
                              name: u.name,
                              roles: u.roles,
                              expertTypes: u.expertTypes,
                            })
                          }
                        >
                          권한
                        </Button>
                      )}
                      {!self && u.status !== 'INVITED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            status.mutate({ id: u.id, s: u.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' })
                          }
                        >
                          {u.status === 'DISABLED' ? '다시 사용' : '중지'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? '권한 변경' : tab === 'STAFF' ? '직원 초대' : '협력사 초대'}
        description={
          form?.id
            ? '변경 즉시 적용되며 감사 로그에 기록됩니다.'
            : '초대 링크는 한 번만 사용할 수 있고 7일 뒤 만료됩니다.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              취소
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form?.roles.length || (!form?.id && !form?.email.includes('@'))}
              onClick={() => save.mutate()}
            >
              {form?.id ? '저장' : '초대'}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            {!form.id && (
              <Field label="이메일" required>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            )}
            <Field label="이름">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="역할">
              <div className="grid grid-cols-2 gap-2">
                {roleOptions.map((r) => (
                  <Checkbox
                    key={r}
                    checked={form.roles.includes(r)}
                    onChange={(x) =>
                      setForm({
                        ...form,
                        roles: x ? [...form.roles, r].slice(0, 4) : form.roles.filter((y) => y !== r),
                      })
                    }
                    label={ROLE_LABEL[r] ?? r}
                  />
                ))}
              </div>
            </Field>
            {tab === 'PARTNER' && (
              <Field label="전문 분야" hint="전문가 확인 요청 시 분야별로 배정됩니다">
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(EXPERT_TYPE_LABEL).map(([k, l]) => (
                    <Checkbox
                      key={k}
                      checked={form.expertTypes.includes(k)}
                      onChange={(x) =>
                        setForm({
                          ...form,
                          expertTypes: x ? [...form.expertTypes, k] : form.expertTypes.filter((y) => y !== k),
                        })
                      }
                      label={l}
                    />
                  ))}
                </div>
              </Field>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!link}
        onClose={() => setLink(null)}
        title="초대 링크"
        description="이메일이 설정되어 있으면 자동으로 발송됩니다. 직접 전달하려면 아래 링크를 복사하세요. 이 링크는 다시 표시되지 않습니다."
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
