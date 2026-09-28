'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale, Send, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/providers';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, Field, Input, Select, Textarea } from '@/components/ui';
import type { StaffResult } from './types';

const STATUS_LABEL: Record<string, [string, 'neutral' | 'info' | 'warn' | 'ok' | 'danger' | 'brand' | 'purple']> = {
  NOT_APPLICABLE: ['해당 없음', 'neutral'],
  UNKNOWN: ['정보 부족', 'neutral'],
  AI_POSSIBLE: ['가능성 있음', 'info'],
  AI_LIKELY: ['가능성 높음', 'warn'],
  RULE_MATCHED: ['규칙 일치', 'warn'],
  EXPERT_REVIEW_REQUIRED: ['전문가 확인 필요', 'purple'],
  VERIFIED: ['확인 완료', 'ok'],
  REJECTED: ['비대상 확인', 'ok'],
  CONFIRMED: ['대상 확정', 'ok'],
};

interface Partner {
  id: string;
  name: string;
  email: string;
  role: string;
  expertTypes: string[];
}

function AssignDialog({ open, onClose, entity, kind, projectId, title }: { open: boolean; onClose: () => void; entity: { type: string; id: string } | null; kind: 'COMPLIANCE_REVIEW' | 'HS_REVIEW'; projectId: string; title: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const partners = useQuery({ queryKey: ['partners'], queryFn: () => api.get<{ items: Partner[] }>('/partners'), enabled: open });
  const [pid, setPid] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/partner-tasks', { partnerUserId: pid, kind, entityType: entity!.type, entityId: entity!.id, projectId, title }),
    onSuccess: () => { toast.ok('전문가에게 확인을 요청했습니다.'); onClose(); void qc.invalidateQueries(); },
    onError: toast.error,
  });
  const list = (partners.data?.items ?? []).filter((p) => (kind === 'HS_REVIEW' ? p.role === 'CUSTOMS_PARTNER' : p.role === 'CERTIFICATION_PARTNER' || p.role === 'CUSTOMS_PARTNER'));
  return (
    <Dialog open={open} onClose={onClose} title="전문가 확인 요청" description={title} footer={<><Button variant="secondary" onClick={onClose}>취소</Button><Button disabled={!pid} loading={m.isPending} onClick={() => m.mutate()} icon={<Send className="h-4 w-4" />}>요청</Button></>}>
      {list.length === 0 ? <Alert tone="info">등록된 협력사가 없습니다. 설정 → 사용자·협력사에서 관세사·시험기관을 초대하세요.</Alert> : (
        <Field label="담당 전문가">
          <Select value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">선택하세요</option>
            {list.map((p) => <option key={p.id} value={p.id}>{p.name || p.email} ({p.expertTypes.join(', ') || p.role})</option>)}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}

export function ComplianceTab({ r }: { r: StaffResult }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [assign, setAssign] = useState<null | { kind: 'COMPLIANCE_REVIEW' | 'HS_REVIEW'; entity: { type: string; id: string }; title: string }>(null);
  const [review, setReview] = useState<null | { id: string; name: string; status: string; note: string; cost: string }>(null);
  const [hs, setHs] = useState({ code: r.hs?.verifiedHs ?? r.hs?.estimatedHs ?? '', rateType: '', note: '' });
  const saveReview = useMutation({
    mutationFn: () => api.post(`/compliance-checks/${review!.id}/review`, { status: review!.status, note: review!.note, ...(review!.cost ? { verifiedCost: review!.cost } : {}) }),
    onSuccess: () => { toast.ok('확인 결과를 저장했습니다. AI 예상값은 그대로 보존됩니다.'); setReview(null); void qc.invalidateQueries({ queryKey: ['staff-result'] }); },
    onError: toast.error,
  });
  const verifyHs = useMutation({
    mutationFn: () => api.post(`/products/${r.product!.id}/hs/verify`, { hsCode: hs.code.replace(/\D/g, ''), ...(hs.rateType ? { rateType: hs.rateType } : {}), note: hs.note }),
    onSuccess: () => { toast.ok('HS 코드를 확정했습니다.'); void qc.invalidateQueries({ queryKey: ['staff-result'] }); },
    onError: toast.error,
  });
  if (!r.product) return <Card><EmptyState title="제품 분석이 끝나면 표시됩니다" /></Card>;
  const visible = r.compliance.filter((c) => c.status !== 'NOT_APPLICABLE');
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" />인증·규제 후보</span>} description="AI·규칙 추정값과 전문가 확인값을 따로 보관합니다." />
        <ul className="divide-y divide-line">
          {visible.map((c) => {
            const [label, tone] = STATUS_LABEL[c.status] ?? [c.status, 'neutral'];
            const [elabel] = STATUS_LABEL[c.estimatedStatus] ?? [c.estimatedStatus];
            return (
              <li key={c.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-ink-muted">{c.authority}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={tone}>{label}</Badge>
                    {c.verifiedStatus && <Badge tone="neutral">AI: {elabel}</Badge>}
                  </div>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{c.reasons.join(' · ')}{c.missing.length ? ` · 미확인: ${c.missing.join(', ')}` : ''}</p>
                {c.expertNote && <p className="mt-1 text-xs text-violet-700 dark:text-violet-300">전문가: {c.expertNote}</p>}
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setReview({ id: c.id, name: c.name, status: c.verifiedStatus ?? 'CONFIRMED', note: c.expertNote, cost: c.verifiedCost ?? '' })}>결과 입력</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAssign({ kind: 'COMPLIANCE_REVIEW', entity: { type: 'compliance_check', id: c.id }, title: `${c.name} 확인 요청` })}>전문가에게 요청</Button>
                </div>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-5 py-8 text-center text-sm text-ink-muted">해당 가능성이 있는 규제가 없습니다.</li>}
        </ul>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Scale className="h-4 w-4 text-brand" />HS 코드 · 관세</span>} action={r.hs?.verifiedHs ? <Badge tone="ok">확정 {r.hs.verifiedHs}</Badge> : <Badge tone="warn">미확정</Badge>} />
          <CardBody className="space-y-4">
            {r.hs?.candidates.length ? (
              <ul className="space-y-2">
                {r.hs.candidates.map((c, i) => (
                  <li key={c.code} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex items-center justify-between"><span className="font-mono font-semibold">{c.code}</span><span className="text-xs text-ink-muted">후보 {i + 1} · {Math.round(c.score * 100)}</span></div>
                    <p className="text-xs text-ink-soft">{c.description}</p>
                    <p className="mt-1 text-[11px] text-ink-muted">{c.reasons.join(' · ')}</p>
                    <Button size="sm" variant="link" onClick={() => setHs({ ...hs, code: c.code })}>이 코드 선택</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-muted">HS 후보를 찾지 못했습니다. 관세사 확인이 필요합니다.</p>}
            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-sm font-semibold">관세율 옵션</p>
              {r.tariffs.length === 0 ? <p className="text-xs text-ink-muted">이 HS 코드의 공식 관세율 데이터가 없습니다. 관세율표를 가져오거나 관세사 확인을 받으세요.</p> : r.tariffs.map((t) => (
                <div key={t.rateType} className="flex items-center justify-between text-sm">
                  <span>{t.rateType}{t.requiresCertificateOfOrigin && <span className="text-xs text-ink-muted"> · 원산지증명 필요</span>}</span>
                  <span className="flex items-center gap-1.5 tabular">{t.ratePct === null ? '—' : `${Number(t.ratePct)}%`}{t.demo && <Badge tone="warn">데모</Badge>}</span>
                </div>
              ))}
            </div>
            <form className="space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); verifyHs.mutate(); }}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="확정 HS 코드"><Input value={hs.code} onChange={(e) => setHs({ ...hs, code: e.target.value })} placeholder="10자리 권장" /></Field>
                <Field label="적용 세율"><Select value={hs.rateType} onChange={(e) => setHs({ ...hs, rateType: e.target.value })}><option value="">자동 (최저)</option>{r.tariffs.map((t) => <option key={t.rateType}>{t.rateType}</option>)}</Select></Field>
              </div>
              <Field label="확인 메모"><Input value={hs.note} onChange={(e) => setHs({ ...hs, note: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" loading={verifyHs.isPending} disabled={hs.code.replace(/\D/g, '').length < 6}>HS 확정 저장</Button>
                {r.hs && <Button size="sm" variant="secondary" onClick={() => setAssign({ kind: 'HS_REVIEW', entity: { type: 'hs_classification', id: r.hs!.id }, title: `${r.product!.nameKo} HS 분류 확인` })}>관세사에게 요청</Button>}
              </div>
            </form>
          </CardBody>
        </Card>
        {r.product.requiredDocuments.length > 0 && (
          <Card>
            <CardHeader title="제품 패스포트 · 필요 서류" />
            <CardBody><ul className="grid gap-1 text-sm text-ink-soft sm:grid-cols-2">{r.product.requiredDocuments.map((d) => <li key={d}>· {d}</li>)}</ul></CardBody>
          </Card>
        )}
      </div>
      {assign && r.projectId && <AssignDialog open onClose={() => setAssign(null)} entity={assign.entity} kind={assign.kind} projectId={r.projectId} title={assign.title} />}
      <Dialog open={!!review} onClose={() => setReview(null)} title="확인 결과 입력" description={review?.name}
        footer={<><Button variant="secondary" onClick={() => setReview(null)}>취소</Button><Button loading={saveReview.isPending} onClick={() => saveReview.mutate()}>저장</Button></>}>
        {review && (
          <div className="space-y-3">
            <Field label="결과"><Select value={review.status} onChange={(e) => setReview({ ...review, status: e.target.value })}>
              <option value="CONFIRMED">인증 대상 (확정)</option><option value="REJECTED">비대상 (확인)</option><option value="VERIFIED">확인 완료 (기존 인증 보유 등)</option><option value="EXPERT_REVIEW_REQUIRED">추가 검토 필요</option>
            </Select></Field>
            <Field label="확정 인증 비용 (원, 선택)"><Input value={review.cost} onChange={(e) => setReview({ ...review, cost: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="메모"><Textarea value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
