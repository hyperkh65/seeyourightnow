'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, newIdempotencyKey } from '@/lib/api';
import { useToast } from '@/components/providers';
import { ContractView, type ContractDetail } from '@/components/contract-view';
import { Button, Card, CardBody, Checkbox, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';

export default function PortalContract() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [agree, setAgree] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const q = useQuery({ queryKey: ['contract', id], queryFn: () => api.get<ContractDetail>(`/contracts/${id}`) });
  const approve = useMutation({
    mutationFn: () => api.post(`/contracts/${id}/customer-approve`, { agree: true, version: q.data!.currentVersion }, { idempotencyKey: key }),
    onSuccess: () => {
      toast.ok('계약서를 승인했습니다. 회사 승인 후 체결됩니다.');
      void qc.invalidateQueries();
    },
    onError: toast.error,
  });
  if (q.isLoading) return <Card className="p-5"><LoadingBlock rows={8} /></Card>;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader title="계약서" />
      {q.data.canApprove && (
        <Card className="mb-6 border-brand/30">
          <CardBody className="space-y-4">
            <p className="font-semibold">계약 내용을 확인하고 전자 승인해 주세요</p>
            <Checkbox checked={agree} onChange={setAgree} label="계약서의 모든 조항을 확인했으며 이에 동의합니다." />
            <Button disabled={!agree} loading={approve.isPending} onClick={() => approve.mutate()}>전자 승인하기</Button>
          </CardBody>
        </Card>
      )}
      <ContractView c={q.data} />
    </>
  );
}
