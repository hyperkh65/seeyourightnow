'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Box, CalendarClock, ChevronLeft, ClipboardCheck, RefreshCw, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { EVENT_LABEL, ShipmentView, type ShipmentDetail } from '@/components/shipment-view';
import { ShipmentStatus } from '@/components/status';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';

type D = ShipmentDetail & { projectId: string };
type Modal = null | 'event' | 'container' | 'vessel' | 'customs' | 'delivery' | 'schedule';

const toIso = (v: string) => (v ? new Date(v).toISOString() : undefined);

export default function AdminShipment() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({
    queryKey: ['shipment', id],
    queryFn: () => api.get<D>(`/shipments/${id}`),
    refetchInterval: 60_000,
  });
  const [modal, setModal] = useState<Modal>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const open = (m: Modal, init: Record<string, string> = {}) => {
    setF(init);
    setModal(m);
  };
  const ok = (msg: string) => {
    toast.ok(msg);
    setModal(null);
    void qc.invalidateQueries();
  };

  const submit = useMutation({
    mutationFn: async (m: Exclude<Modal, null>) => {
      switch (m) {
        case 'event':
          return api.post(`/shipments/${id}/events`, {
            eventType: f.eventType,
            occurredAt: toIso(f.occurredAt ?? ''),
            locationCode: (f.locationCode ?? '').toUpperCase(),
            note: f.note ?? '',
            source: f.source ?? 'MANUAL',
          });
        case 'container':
          return api.post(`/shipments/${id}/containers`, {
            containerNumber: (f.containerNumber ?? '').toUpperCase(),
            isoType: f.isoType ?? '',
            sealNumber: f.sealNumber ?? '',
          });
        case 'vessel':
          return api.post(`/shipments/${id}/vessels`, {
            vesselName: f.vesselName,
            imo: f.imo ?? '',
            mmsi: f.mmsi ?? '',
            voyage: f.voyage ?? '',
            legSequence: Number(f.legSequence || 1),
          });
        case 'customs':
          return api.post(`/shipments/${id}/customs`, { status: f.status, note: f.note ?? '' });
        case 'delivery':
          return api.post(`/shipments/${id}/delivery`, { status: f.status, note: f.note ?? '' });
        case 'schedule':
          return api.patch(`/shipments/${id}`, {
            carrierCode: f.carrierCode,
            carrierName: f.carrierName,
            bookingNumber: f.bookingNumber,
            blNumber: f.blNumber,
            etd: toIso(f.etd ?? ''),
            eta: toIso(f.eta ?? ''),
          });
      }
    },
    onSuccess: (_r, m) =>
      ok(
        {
          event: '이벤트를 기록했습니다.',
          container: '컨테이너를 추가했습니다.',
          vessel: '선박을 추가했습니다. AIS 위치 추적을 시작합니다.',
          customs: '통관 상태를 저장했습니다.',
          delivery: '배송 상태를 저장했습니다.',
          schedule: '선적 정보를 저장했습니다.',
        }[m],
      ),
    onError: toast.error,
  });
  const refresh = useMutation({
    mutationFn: () => api.post(`/shipments/${id}/refresh`, {}),
    onSuccess: () => ok('추적 정보를 새로 요청했습니다. 잠시 후 반영됩니다.'),
    onError: toast.error,
  });
  const confirm = useMutation({
    mutationFn: (e: D['events'][number]) =>
      api.post(`/shipments/${id}/events`, {
        eventType: e.eventType,
        occurredAt: new Date(e.occurredAt).toISOString(),
        locationCode: e.locationCode,
        note: 'AIS 추정 이벤트를 담당자가 확인',
        source: 'MANUAL',
        confirmAisEventId: e.id,
      }),
    onSuccess: () => ok('AIS 추정 이벤트를 확인 처리했습니다.'),
    onError: toast.error,
  });

  if (q.isLoading)
    return (
      <Card className="p-5">
        <LoadingBlock rows={8} />
      </Card>
    );
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const unconfirmed = s.events.filter((e) => !e.confirmed);
  const writable = can('shipment.write');
  const local = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 16) : '');
  return (
    <>
      <PageHeader
        back={
          <Link
            href={`/admin/projects/${s.projectId}?tab=shipments`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" />
            프로젝트
          </Link>
        }
        eyebrow={s.code}
        title={`${s.originPort} → ${s.destinationPort}`}
        description={`${s.mode} · ${s.carrierName || '선사 미지정'}${s.blNumber ? ` · B/L ${s.blNumber}` : ''}`}
        actions={<ShipmentStatus status={s.status} />}
      />
      {writable && (
        <Card className="mb-6">
          <CardBody className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<CalendarClock className="h-4 w-4" />}
              onClick={() =>
                open('schedule', {
                  carrierCode: s.carrierCode,
                  carrierName: s.carrierName,
                  bookingNumber: s.bookingNumber,
                  blNumber: s.blNumber,
                  etd: local(s.etd),
                  eta: local(s.eta),
                })
              }
            >
              선적 정보·일정
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                open('event', {
                  eventType: 'DEPARTED',
                  occurredAt: new Date().toISOString().slice(0, 16),
                  source: 'MANUAL',
                })
              }
            >
              이벤트 기록
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Box className="h-4 w-4" />}
              onClick={() => open('container')}
            >
              컨테이너
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Anchor className="h-4 w-4" />}
              onClick={() => open('vessel', { legSequence: String(s.vessels.length + 1) })}
            >
              선박
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ClipboardCheck className="h-4 w-4" />}
              onClick={() =>
                open('customs', { status: s.customsStatus === 'NOT_STARTED' ? 'IN_PROGRESS' : 'CLEARED' })
              }
            >
              통관
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Truck className="h-4 w-4" />}
              onClick={() =>
                open('delivery', { status: s.status === 'DELIVERING' ? 'DELIVERED' : 'STARTED' })
              }
            >
              국내 배송
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="h-4 w-4" />}
              loading={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              추적 새로고침
            </Button>
            <span className="ml-auto self-center text-xs text-ink-muted">
              마지막 추적 {s.lastTrackedAt ? formatDate(s.lastTrackedAt, true) : '없음'}
            </span>
          </CardBody>
        </Card>
      )}
      {s.trackingError && (
        <Alert tone="warn" className="mb-6" title="자동 추적 오류">
          {s.trackingError} — 수동으로 이벤트를 기록하거나 연결 설정을 확인해 주세요.
        </Alert>
      )}
      {unconfirmed.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title="확인이 필요한 추정 이벤트"
            description="AIS 위치로 추정한 이벤트는 담당자가 확인해야 고객에게 표시됩니다."
          />
          <ul className="divide-y divide-line">
            {unconfirmed.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  {EVENT_LABEL[e.eventType] ?? e.eventType} · {e.locationName || e.locationCode} ·{' '}
                  {formatDate(e.occurredAt, true)}{' '}
                  <Badge tone="warn" className="ml-1">
                    {e.source === 'AIS_INFERRED' ? 'AIS 추정' : e.source}
                  </Badge>
                </span>
                {writable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={confirm.isPending}
                    onClick={() => confirm.mutate(e)}
                  >
                    확인
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ShipmentView s={s} staff />

      <Dialog
        open={!!modal}
        onClose={() => setModal(null)}
        size={modal === 'schedule' ? 'lg' : 'md'}
        title={
          {
            event: '이벤트 기록',
            container: '컨테이너 추가',
            vessel: '선박 추가',
            customs: '통관 상태',
            delivery: '국내 배송',
            schedule: '선적 정보·일정',
          }[modal ?? 'event']
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              취소
            </Button>
            <Button loading={submit.isPending} onClick={() => modal && submit.mutate(modal)}>
              저장
            </Button>
          </>
        }
      >
        {modal === 'event' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="이벤트">
              <Select value={f.eventType} onChange={set('eventType')}>
                {Object.entries(EVENT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="발생 시각">
              <Input type="datetime-local" value={f.occurredAt ?? ''} onChange={set('occurredAt')} />
            </Field>
            <Field label="장소 (UN/LOCODE)">
              <Input value={f.locationCode ?? ''} onChange={set('locationCode')} placeholder="KRPUS" />
            </Field>
            <Field label="출처">
              <Select value={f.source} onChange={set('source')}>
                <option value="MANUAL">담당자 입력</option>
                <option value="FORWARDER_REPORTED">포워더 보고</option>
              </Select>
            </Field>
            <Field label="메모" className="sm:col-span-2">
              <Textarea value={f.note ?? ''} onChange={set('note')} />
            </Field>
          </div>
        )}
        {modal === 'container' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="컨테이너 번호" hint="예: MSKU1234567" className="sm:col-span-3">
              <Input value={f.containerNumber ?? ''} onChange={set('containerNumber')} />
            </Field>
            <Field label="ISO 타입">
              <Input value={f.isoType ?? ''} onChange={set('isoType')} placeholder="22G1" />
            </Field>
            <Field label="씰 번호" className="sm:col-span-2">
              <Input value={f.sealNumber ?? ''} onChange={set('sealNumber')} />
            </Field>
          </div>
        )}
        {modal === 'vessel' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="선박명" className="sm:col-span-2">
              <Input value={f.vesselName ?? ''} onChange={set('vesselName')} />
            </Field>
            <Field label="IMO (7자리)">
              <Input value={f.imo ?? ''} onChange={set('imo')} />
            </Field>
            <Field label="MMSI (9자리)" hint="AIS 위치 추적에 사용">
              <Input value={f.mmsi ?? ''} onChange={set('mmsi')} />
            </Field>
            <Field label="항차">
              <Input value={f.voyage ?? ''} onChange={set('voyage')} />
            </Field>
            <Field label="구간 순서">
              <Input value={f.legSequence ?? '1'} onChange={set('legSequence')} />
            </Field>
          </div>
        )}
        {(modal === 'customs' || modal === 'delivery') && (
          <div className="space-y-3">
            <Field label="상태">
              <Select value={f.status} onChange={set('status')}>
                {modal === 'customs' ? (
                  <>
                    <option value="IN_PROGRESS">통관 진행 중</option>
                    <option value="HOLD">보류</option>
                    <option value="CLEARED">수리 (통관 완료)</option>
                  </>
                ) : (
                  <>
                    <option value="STARTED">배송 시작</option>
                    <option value="DELIVERED">배송 완료</option>
                  </>
                )}
              </Select>
            </Field>
            <Field label="메모 (고객 공개)">
              <Textarea value={f.note ?? ''} onChange={set('note')} />
            </Field>
          </div>
        )}
        {modal === 'schedule' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="선사 코드 (SCAC)">
              <Input value={f.carrierCode ?? ''} onChange={set('carrierCode')} />
            </Field>
            <Field label="선사/항공사">
              <Input value={f.carrierName ?? ''} onChange={set('carrierName')} />
            </Field>
            <Field label="부킹 번호">
              <Input value={f.bookingNumber ?? ''} onChange={set('bookingNumber')} />
            </Field>
            <Field label="B/L 번호">
              <Input value={f.blNumber ?? ''} onChange={set('blNumber')} />
            </Field>
            <Field label="ETD">
              <Input type="datetime-local" value={f.etd ?? ''} onChange={set('etd')} />
            </Field>
            <Field label="ETA (담당자 입력)">
              <Input type="datetime-local" value={f.eta ?? ''} onChange={set('eta')} />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
