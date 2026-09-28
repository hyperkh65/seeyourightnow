'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan, useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Textarea,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface Bank {
  id: string;
  label: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  currency: string;
  swift: string;
  bankAddress: string;
  intermediaryInfo: string;
  isDefault: boolean;
  showOnDocuments: boolean;
  active: boolean;
}
type Form = Omit<Bank, 'id'> & { id?: string };
const EMPTY: Form = {
  label: '',
  bankName: '',
  accountNumber: '',
  accountHolder: '',
  currency: 'KRW',
  swift: '',
  bankAddress: '',
  intermediaryInfo: '',
  isDefault: false,
  showOnDocuments: true,
  active: true,
};

export default function BankAccounts() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({
    queryKey: ['banks'],
    queryFn: () => api.get<{ items: Bank[] }>('/admin/bank-accounts'),
  });
  const [f, setF] = useState<Form | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['banks'] });
  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = f!;
      return id ? api.patch(`/admin/bank-accounts/${id}`, body) : api.post('/admin/bank-accounts', body);
    },
    onSuccess: () => {
      toast.ok('저장했습니다.');
      setF(null);
      refresh();
    },
    onError: toast.error,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/bank-accounts/${id}`),
    onSuccess: () => {
      toast.ok('삭제했습니다.');
      setF(null);
      refresh();
    },
    onError: toast.error,
  });
  const writable = can('tenant.bank.write');
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((x) => x && { ...x, [k]: e.target.value });
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="입금 계좌"
        description="견적서·인보이스에 표시할 계좌입니다."
        actions={
          writable && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setF({ ...EMPTY })}>
              계좌 추가
            </Button>
          )
        }
      />
      <Alert className="mb-6">
        계좌 추가·변경·삭제 시 본인 확인(OTP)을 한 번 더 요청합니다. 변경 내역은 감사 로그에 기록됩니다.
      </Alert>
      {q.isLoading ? (
        <Card className="p-5">
          <LoadingBlock rows={3} />
        </Card>
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState
            icon={<Landmark className="h-6 w-6" />}
            title="등록된 계좌가 없습니다"
            description="계좌가 없으면 인보이스에 입금 정보가 표시되지 않습니다."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.items.map((b) => (
            <Card key={b.id} className={b.active ? '' : 'opacity-60'}>
              <CardBody className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{b.label || b.bankName}</p>
                  {b.isDefault && <Badge tone="brand">기본</Badge>}
                  <Badge>{b.currency}</Badge>
                  {!b.showOnDocuments && <Badge>문서 미표시</Badge>}
                </div>
                <p className="text-sm">
                  {b.bankName} · <span className="font-mono">****{b.accountNumber.slice(-4)}</span> ·{' '}
                  {b.accountHolder}
                </p>
                {b.swift && <p className="text-xs text-ink-muted">SWIFT {b.swift}</p>}
                {writable && (
                  <Button size="sm" variant="secondary" className="mt-2" onClick={() => setF({ ...b })}>
                    수정
                  </Button>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={!!f}
        onClose={() => setF(null)}
        size="lg"
        title={f?.id ? '계좌 수정' : '계좌 추가'}
        footer={
          <>
            {f?.id && (
              <Button
                variant="ghost"
                className="mr-auto"
                onClick={() => {
                  if (confirm('이 계좌를 삭제할까요?')) del.mutate(f.id!);
                }}
              >
                삭제
              </Button>
            )}
            <Button variant="secondary" onClick={() => setF(null)}>
              취소
            </Button>
            <Button
              loading={save.isPending}
              disabled={!f?.bankName || !f?.accountNumber || !f?.accountHolder}
              onClick={() => save.mutate()}
            >
              저장
            </Button>
          </>
        }
      >
        {f && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="별칭">
              <Input value={f.label} onChange={set('label')} placeholder="예: 원화 입금용" />
            </Field>
            <Field label="통화">
              <Input
                value={f.currency}
                maxLength={3}
                onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="은행" required>
              <Input value={f.bankName} onChange={set('bankName')} />
            </Field>
            <Field label="계좌번호" required>
              <Input value={f.accountNumber} onChange={set('accountNumber')} autoComplete="off" />
            </Field>
            <Field label="예금주" required>
              <Input value={f.accountHolder} onChange={set('accountHolder')} />
            </Field>
            <Field label="SWIFT (해외 송금)">
              <Input value={f.swift} onChange={set('swift')} />
            </Field>
            <Field label="은행 주소" className="sm:col-span-2">
              <Input value={f.bankAddress} onChange={set('bankAddress')} />
            </Field>
            <Field label="중개 은행 정보" className="sm:col-span-2">
              <Textarea rows={2} value={f.intermediaryInfo} onChange={set('intermediaryInfo')} />
            </Field>
            <div className="flex flex-wrap gap-4 sm:col-span-2">
              <Checkbox
                checked={f.isDefault}
                onChange={(x) => setF({ ...f, isDefault: x })}
                label="기본 계좌"
              />
              <Checkbox
                checked={f.showOnDocuments}
                onChange={(x) => setF({ ...f, showOnDocuments: x })}
                label="견적서·인보이스에 표시"
              />
              <Checkbox checked={f.active} onChange={(x) => setF({ ...f, active: x })} label="사용" />
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
