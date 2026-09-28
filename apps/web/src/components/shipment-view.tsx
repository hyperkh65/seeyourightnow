'use client';

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Anchor, Clock, MapPin, Navigation, Radio } from 'lucide-react';
import { formatDate, timeAgo } from '@/lib/utils';
import { ShipmentStatus } from './status';
import { Alert, Badge, Card, CardBody, CardHeader, KeyValue } from './ui';

export interface ShipmentDetail {
  id: string;
  code: string;
  mode: string;
  status: string;
  carrierName: string;
  carrierCode: string;
  bookingNumber: string;
  blNumber: string;
  originPort: string;
  destinationPort: string;
  transshipmentPorts: string[];
  incoterm: string;
  etd: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  customsStatus: string;
  trackingError: string | null;
  lastTrackedAt: string | null;
  events: Array<{ id: string; eventType: string; source: string; classifier: string; confirmed: boolean; locationCode: string; locationName: string; occurredAt: string; note: string }>;
  containers: Array<{ id: string; containerNumber: string; isoType: string; sealNumber: string }>;
  vessels: Array<{ id: string; vesselName: string; imo: string; mmsi: string; voyage: string; legSequence: number }>;
  etas: Array<{ source: string; eta: string; confidence: number | null; computedAt: string; note: string }>;
  map: {
    ports: Array<{ unlocode: string; name: string; lat: number; lon: number; role: string }>;
    estimatedRoute: { coordinates: Array<[number, number]>; kind: string; note: string };
    actualTrack: { coordinates: Array<[number, number]>; source: string };
    currentPosition: null | { lat: number; lon: number; speedKnots: number | null; headingDeg: number | null; observedAt: string; stale: boolean; mmsi: string };
  };
}

export const EVENT_LABEL: Record<string, string> = {
  BOOKED: '선적 예약',
  EMPTY_RELEASED: '공컨테이너 반출',
  GATE_IN: '터미널 반입',
  LOADED: '선적',
  DEPARTED: '출항',
  TRANSSHIPMENT: '환적',
  ARRIVED: '입항',
  DISCHARGED: '양하',
  CUSTOMS: '통관',
  GATE_OUT: '터미널 반출',
  DELIVERED: '배송 완료',
};
const SOURCE_LABEL: Record<string, string> = { CARRIER_CONFIRMED: '선사 확인', AIS_INFERRED: 'AIS 추정', FORWARDER_REPORTED: '포워더 보고', MANUAL: '담당자 입력' };
const ETA_LABEL: Record<string, string> = { CARRIER: '선사', AIS: 'AIS 기반', HISTORICAL: '과거 실적', INTERNAL_ML: '내부 예측', FORWARDER: '포워더', MANUAL: '담당자' };

const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/positron';

function ShipmentMap({ map }: { map: ShipmentDetail['map'] }) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!el.current || map.ports.length === 0) return;
    let disposed = false;
    let instance: { remove: () => void } | null = null;
    void (async () => {
      try {
        const maplibre = (await import('maplibre-gl')).default;
        if (disposed || !el.current) return;
        const coords = [...map.ports.map((p) => [p.lon, p.lat] as [number, number]), ...(map.currentPosition ? [[map.currentPosition.lon, map.currentPosition.lat] as [number, number]] : [])];
        const lons = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        const m = new maplibre.Map({
          container: el.current,
          style: MAP_STYLE,
          bounds: [
            [Math.min(...lons) - 2, Math.min(...lats) - 2],
            [Math.max(...lons) + 2, Math.max(...lats) + 2],
          ],
          attributionControl: { compact: true },
        });
        instance = m;
        m.on('error', () => setFailed(true));
        m.on('load', () => {
          m.addSource('est', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: map.estimatedRoute.coordinates } } });
          m.addLayer({ id: 'est', type: 'line', source: 'est', paint: { 'line-color': '#64748b', 'line-width': 2, 'line-dasharray': [2, 2] } });
          if (map.actualTrack.coordinates.length > 1) {
            m.addSource('act', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: map.actualTrack.coordinates } } });
            m.addLayer({ id: 'act', type: 'line', source: 'act', paint: { 'line-color': `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--brand').trim().split(/\s+/).join(',') || '31,79,216'})`, 'line-width': 3 } });
          }
        });
        for (const p of map.ports) {
          const dot = document.createElement('div');
          dot.className = 'rounded-full border-2 border-white shadow';
          dot.style.cssText = `width:12px;height:12px;background:${p.role === 'DESTINATION' ? '#10b981' : p.role === 'ORIGIN' ? '#1f4fd8' : '#f59e0b'}`;
          dot.title = `${p.name} (${p.unlocode})`;
          new maplibre.Marker({ element: dot }).setLngLat([p.lon, p.lat]).addTo(m);
        }
        if (map.currentPosition) {
          const ship = document.createElement('div');
          ship.style.cssText = `width:18px;height:18px;border-radius:9999px;background:${map.currentPosition.stale ? '#94a3b8' : '#ef4444'};border:3px solid white;box-shadow:0 0 0 4px rgb(239 68 68 / .25)`;
          ship.title = map.currentPosition.stale ? '마지막 AIS 위치 (오래됨)' : '현재 선박 위치 (AIS)';
          new maplibre.Marker({ element: ship }).setLngLat([map.currentPosition.lon, map.currentPosition.lat]).addTo(m);
        }
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      instance?.remove();
    };
  }, [map]);

  return (
    <div className="relative">
      <div ref={el} className="h-72 w-full overflow-hidden rounded-xl bg-surface-sunken sm:h-96" role="img" aria-label="운송 경로 지도" />
      {failed && <p className="absolute inset-x-0 bottom-2 text-center text-xs text-ink-muted">지도 타일을 불러오지 못했습니다. 경로 정보는 아래 목록을 참고하세요.</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-slate-500" /> 예상 항로 (실제 위치 아님)</span>
        {map.actualTrack.coordinates.length > 1 && <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-brand" /> AIS 실제 항적</span>}
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> 선박 현재 위치 (AIS)</span>
      </div>
    </div>
  );
}

export function ShipmentView({ s, staff }: { s: ShipmentDetail; staff?: boolean }) {
  const pos = s.map.currentPosition;
  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-ink-muted">{s.code} · {s.mode}</p>
              <p className="mt-1 flex items-center gap-2 text-xl font-bold">
                {s.originPort} <Navigation className="h-4 w-4 rotate-90 text-ink-muted" /> {s.destinationPort}
              </p>
            </div>
            <ShipmentStatus status={s.status} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-ink-muted">출항</p>
              <p className="text-sm font-semibold">{s.atd ? formatDate(s.atd) : s.etd ? `${formatDate(s.etd)} (예정)` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">도착</p>
              <p className="text-sm font-semibold">{s.ata ? formatDate(s.ata) : s.eta ? `${formatDate(s.eta)} (예상)` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">통관</p>
              <p className="text-sm font-semibold">{{ NOT_STARTED: '대기', IN_PROGRESS: '진행 중', HOLD: '보류', CLEARED: '완료' }[s.customsStatus] ?? s.customsStatus}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">선박</p>
              <p className="truncate text-sm font-semibold">{s.vessels[0]?.vesselName ?? '—'}</p>
            </div>
          </div>
          <ShipmentMap map={s.map} />
          {pos ? (
            <Alert tone={pos.stale ? 'warn' : 'info'}>
              {pos.stale ? `마지막 AIS 위치는 ${timeAgo(pos.observedAt)} 기준입니다. 최신 위치 신호가 없습니다.` : `AIS 위치 ${timeAgo(pos.observedAt)} · ${pos.speedKnots ?? '—'}노트`}
            </Alert>
          ) : (
            <p className="text-xs text-ink-muted">실시간 선박 위치(AIS) 정보가 없어 예상 항로만 표시합니다.</p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="운송 이력" description="출처(선사 확인·AIS 추정·담당자 입력)를 함께 표시합니다." />
          <CardBody>
            {s.events.length === 0 ? (
              <p className="text-sm text-ink-muted">아직 기록된 운송 이벤트가 없습니다.</p>
            ) : (
              <ol className="relative space-y-4 border-l-2 border-line pl-5">
                {s.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className={`absolute -left-[27px] top-1 flex h-3.5 w-3.5 rounded-full border-2 border-surface ${e.confirmed ? 'bg-brand' : 'bg-slate-300'}`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                      <Badge tone={e.source === 'CARRIER_CONFIRMED' ? 'ok' : e.source === 'AIS_INFERRED' ? 'warn' : 'neutral'}>{SOURCE_LABEL[e.source] ?? e.source}</Badge>
                      {!e.confirmed && <Badge tone="warn">미확정</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      <Clock className="mr-1 inline h-3 w-3" />
                      {formatDate(e.occurredAt, true)}
                      {e.locationCode && (
                        <>
                          {' '}· <MapPin className="mr-0.5 inline h-3 w-3" />
                          {e.locationName || e.locationCode}
                        </>
                      )}
                    </p>
                    {e.note && <p className="mt-1 text-xs text-ink-soft">{e.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="도착 예정일" description="모든 ETA는 예상값입니다." />
            <CardBody className="space-y-2">
              {s.etas.length === 0 ? (
                <p className="text-sm text-ink-muted">아직 예상 도착일 정보가 없습니다.</p>
              ) : (
                s.etas.map((e) => (
                  <div key={e.source} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-ink-soft">{e.source === 'AIS' ? <Radio className="h-3.5 w-3.5" /> : <Anchor className="h-3.5 w-3.5" />}{ETA_LABEL[e.source] ?? e.source}</span>
                    <span className="font-semibold">{formatDate(e.eta, true)}</span>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="운송 정보" />
            <CardBody>
              <KeyValue
                cols={1}
                items={[
                  { label: '선사', value: s.carrierName || s.carrierCode || '—' },
                  { label: 'B/L', value: s.blNumber || '—', hide: !staff && !s.blNumber },
                  { label: '부킹 번호', value: s.bookingNumber || '—' },
                  { label: '컨테이너', value: s.containers.map((c) => `${c.containerNumber}${c.isoType ? ` (${c.isoType})` : ''}`).join(', ') || '—' },
                  { label: '선박', value: s.vessels.map((v) => `${v.vesselName}${v.voyage ? ` ${v.voyage}` : ''}${v.mmsi ? ` · MMSI ${v.mmsi}` : ''}`).join(', ') || '—' },
                  { label: '인코텀즈', value: s.incoterm },
                  { label: '마지막 추적', value: s.lastTrackedAt ? timeAgo(s.lastTrackedAt) : '—', hide: !staff },
                ]}
              />
              {staff && s.trackingError && <Alert tone="warn" className="mt-4">{s.trackingError}</Alert>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
