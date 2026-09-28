'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Mail, Pencil, Pin, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoney, timeAgo } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { QuoteStatus, StageBadge } from '@/components/status';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValue,
  LoadingBlock,
  PageHeader,
  Textarea,
} from '@/components/ui';
import { CompanyForm, fromCompany, toCompanyBody, type CompanyFormState } from '../company-form';

interface Detail {
  id: string;
  name: string;
  businessNumber: string;
  ceo: string;
  address: string;
  industry: string;
  categories: string[];
  taxInvoiceEmail: string;
  paymentTerms: string;
  tier: string;
  creditLevel: string;
  warnings: string[];
  preferences: { targetMarginPct?: string; preferredFreight?: string };
  contacts: Array<{
    id: string;
    name: string;
    department: string;
    title: string;
    phone: string;
    email: string;
    isPrimary: boolean;
  }>;
  notes: Array<{ id: string; body: string; pinned: boolean; createdAt: string }>;
  projects: Array<{ id: string; code: string; title: string; stage: string; updatedAt: string }>;
  quotations: Array<{
    id: string;
    number: string;
    status: string;
    total: string | null;
    currency: string | null;
  }>;
  portalUsers: Array<{ id: string; email: string; name: string; status: string; lastLoginAt: string | null }>;
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({ queryKey: ['company', id], queryFn: () => api.get<Detail>(`/crm/companies/${id}`) });
  const [edit, setEdit] = useState<CompanyFormState | null>(null);
  const [modal, setModal] = useState<null | 'contact' | 'invite'>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [primary, setPrimary] = useState(false);
  const [note, setNote] = useState('');
  const [pinned, setPinned] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['company', id] });
  const save = useMutation({
    mutationFn: () => api.patch(`/crm/companies/${id}`, toCompanyBody(edit!)),
    onSuccess: () => {
      toast.ok('저장했습니다.');
      setEdit(null);
      refresh();
    },
    onError: toast.error,
  });
  const submit = useMutation({
    mutationFn: () =>
      modal === 'contact'
        ? api.post(`/crm/companies/${id}/contacts`, {
            name: f.name,
            department: f.department ?? '',
            title: f.title ?? '',
            phone: f.phone ?? '',
            email: f.email ?? '',
            isPrimary: primary,
          })
        : api.post('/admin/users/invite', {
            email: f.email,
            name: f.name ?? '',
            roles: ['CUSTOMER_ADMIN'],
            companyId: id,
          }),
    onSuccess: () => {
      toast.ok(modal === 'invite' ? '초대 메일을 보냈습니다.' : '담당자를 추가했습니다.');
      setModal(null);
      refresh();
    },
    onError: toast.error,
  });
  const addNote = useMutation({
    mutationFn: () => api.post(`/crm/companies/${id}/notes`, { body: note, pinned }),
    onSuccess: () => {
      setNote('');
      setPinned(false);
      refresh();
    },
    onError: toast.error,
  });
  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const writable = can('crm.write');
  return (
    <>
      <PageHeader
        back={
          <Link
            href="/admin/customers"
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            고객
          </Link>
        }
        title={c.name}
        description={[c.businessNumber, c.industry].filter(Boolean).join(' · ')}
        actions={
          writable && (
            <Button
              variant="secondary"
              icon={<Pencil className="h-4 w-4" />}
              onClick={() => setEdit(fromCompany(c))}
            >
              정보 수정
            </Button>
          )
        }
      />
      {c.warnings.length > 0 && (
        <Alert tone="warn" className="mb-6" title="주의 사항">
          {c.warnings.join(' · ')}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="회사 정보" />
            <CardBody>
              <KeyValue
                items={[
                  { label: '대표자', value: c.ceo || '—' },
                  { label: '등급', value: `${c.tier} · 신용 ${c.creditLevel}` },
                  { label: '주소', value: c.address || '—' },
                  { label: '세금계산서', value: c.taxInvoiceEmail || '—' },
                  { label: '결제 조건', value: c.paymentTerms || '—' },
                  {
                    label: '목표 마진',
                    value: c.preferences.targetMarginPct ? `${c.preferences.targetMarginPct}%` : '—',
                  },
                  { label: '선호 운송', value: c.preferences.preferredFreight || '—' },
                  { label: '관심 카테고리', value: c.categories.join(', ') || '—' },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="담당자"
              action={
                writable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => {
                      setF({});
                      setPrimary(false);
                      setModal('contact');
                    }}
                  >
                    추가
                  </Button>
                )
              }
            />
            <CardBody className="space-y-3">
              {c.contacts.length === 0 ? (
                <p className="text-sm text-ink-muted">등록된 담당자가 없습니다.</p>
              ) : (
                c.contacts.map((x) => (
                  <div key={x.id} className="text-sm">
                    <b>{x.name}</b>{' '}
                    <span className="text-ink-muted">
                      {[x.department, x.title].filter(Boolean).join(' ')}
                    </span>
                    {x.isPrimary && (
                      <Badge tone="brand" className="ml-2">
                        주 담당
                      </Badge>
                    )}
                    <div className="text-xs text-ink-muted">
                      {[x.phone, x.email].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="포털 계정"
              action={
                can('tenant.users.manage') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Mail className="h-4 w-4" />}
                    onClick={() => {
                      setF({});
                      setModal('invite');
                    }}
                  >
                    초대
                  </Button>
                )
              }
            />
            <CardBody className="space-y-2">
              {c.portalUsers.length === 0 ? (
                <p className="text-sm text-ink-muted">고객 포털 계정이 없습니다.</p>
              ) : (
                c.portalUsers.map((u) => (
                  <div key={u.id} className="flex justify-between text-sm">
                    <span>
                      {u.name || u.email} <span className="text-xs text-ink-muted">{u.email}</span>
                    </span>
                    <span className="text-xs text-ink-muted">
                      {u.status === 'ACTIVE'
                        ? u.lastLoginAt
                          ? `최근 접속 ${timeAgo(u.lastLoginAt)}`
                          : '접속 기록 없음'
                        : u.status}
                    </span>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="프로젝트" />
            {c.projects.length === 0 ? (
              <EmptyState title="프로젝트가 없습니다" className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {c.projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/admin/projects/${p.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {p.title} <span className="text-xs text-ink-muted">{p.code}</span>
                      </span>
                      <StageBadge status={p.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="견적" />
            {c.quotations.length === 0 ? (
              <EmptyState title="견적이 없습니다" className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {c.quotations.map((x) => (
                  <li key={x.id}>
                    <Link
                      href={`/admin/quotes/${x.id}`}
                      className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface-sunken"
                    >
                      <span>{x.number}</span>
                      <span className="flex items-center gap-2 tabular">
                        {x.total ? formatMoney(x.total, x.currency ?? 'KRW') : ''}
                        <QuoteStatus status={x.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {can('crm.internal_notes') && (
            <Card>
              <CardHeader title="내부 메모" description="고객에게 절대 보이지 않습니다." />
              <CardBody className="space-y-4">
                <div className="space-y-2">
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="상담 내용, 선호 조건, 주의할 점"
                    aria-label="메모"
                  />
                  <div className="flex items-center justify-between">
                    <Checkbox checked={pinned} onChange={setPinned} label="상단 고정" />
                    <Button
                      size="sm"
                      disabled={!note.trim()}
                      loading={addNote.isPending}
                      onClick={() => addNote.mutate()}
                    >
                      메모 추가
                    </Button>
                  </div>
                </div>
                {c.notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-line p-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
                      {n.pinned && <Pin className="h-3 w-3" />}
                      {formatDate(n.createdAt, true)}
                    </p>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        title="고객사 정보 수정"
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
        {edit && <CompanyForm f={edit} onChange={setEdit} />}
      </Dialog>
      <Dialog
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'invite' ? '고객 포털 초대' : '담당자 추가'}
        description={modal === 'invite' ? '초대 링크는 한 번만 사용할 수 있고 7일 뒤 만료됩니다.' : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              취소
            </Button>
            <Button
              loading={submit.isPending}
              disabled={modal === 'invite' ? !f.email : !f.name}
              onClick={() => submit.mutate()}
            >
              {modal === 'invite' ? '초대 보내기' : '추가'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="이름" required={modal === 'contact'}>
            <Input value={f.name ?? ''} onChange={set('name')} />
          </Field>
          <Field label="이메일" required={modal === 'invite'}>
            <Input type="email" value={f.email ?? ''} onChange={set('email')} />
          </Field>
          {modal === 'contact' && (
            <>
              <Field label="부서">
                <Input value={f.department ?? ''} onChange={set('department')} />
              </Field>
              <Field label="직함">
                <Input value={f.title ?? ''} onChange={set('title')} />
              </Field>
              <Field label="전화">
                <Input value={f.phone ?? ''} onChange={set('phone')} />
              </Field>
              <div className="self-end pb-2">
                <Checkbox checked={primary} onChange={setPrimary} label="주 담당자" />
              </div>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
