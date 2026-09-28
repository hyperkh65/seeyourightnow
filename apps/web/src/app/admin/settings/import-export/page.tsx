'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

const ENTITIES: Record<string, { label: string; importable: boolean; columns: string }> = {
  suppliers: {
    label: '공급처',
    importable: true,
    columns:
      'name, alias, visibility, sourceType, businessType, country, province, city, yearsInBusiness, businessVerified, ...',
  },
  products: {
    label: '공급 상품',
    importable: true,
    columns: 'title, titleKo, model, currency, unitPrice, moq, supplierId, sourceType, ...',
  },
  customers: {
    label: '고객사',
    importable: true,
    columns: 'name, businessNumber, ceo, address, industry, tier, paymentTerms, taxInvoiceEmail',
  },
  freight_rates: {
    label: '운임',
    importable: true,
    columns:
      'mode, origin, destination, source, currency, basis, rate, minCharge, transitDaysMin, transitDaysMax, validUntil',
  },
  margin_rules: { label: '마진 규칙', importable: false, columns: '' },
  hs_history: { label: 'HS 분류 이력', importable: false, columns: '' },
};
interface Job {
  id: string;
  entity: string;
  status: string;
  totalRows: number;
  importedRows: number;
  errors: Array<{ row: number; message: string }>;
  createdAt: string;
}

export default function ImportExport() {
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState('suppliers');
  const [result, setResult] = useState<{
    total: number;
    imported: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const jobs = useQuery({
    queryKey: ['import-jobs'],
    queryFn: () => api.get<{ items: Job[] }>('/admin/import-jobs'),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.upload<{ total: number; imported: number; errors: Array<{ row: number; message: string }> }>(
        `/admin/import/${entity}`,
        fd,
      );
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.errors.length)
        toast.error(`${r.imported}/${r.total}행을 가져왔고 ${r.errors.length}행은 오류가 있습니다.`);
      else toast.ok(`${r.imported}행을 가져왔습니다.`);
      void qc.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: toast.error,
    onSettled: () => {
      if (ref.current) ref.current.value = '';
    },
  });
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="가져오기·내보내기"
        description="CSV 또는 Excel(.xlsx) 파일로 데이터를 옮깁니다."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="내보내기"
            description="내보내기 기록은 감사 로그에 남습니다. 수식으로 해석될 수 있는 값은 자동으로 무력화됩니다."
          />
          <CardBody className="space-y-2">
            {Object.entries(ENTITIES).map(([k, e]) => (
              <div
                key={k}
                className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"
              >
                <span>{e.label}</span>
                <span className="flex gap-2">
                  <a
                    className="inline-flex items-center gap-1 text-brand hover:underline"
                    href={`/api/v1/admin/export/${k}?format=csv`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    CSV
                  </a>
                  <a
                    className="inline-flex items-center gap-1 text-brand hover:underline"
                    href={`/api/v1/admin/export/${k}?format=xlsx`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Excel
                  </a>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="가져오기"
            description="첫 행은 열 이름이어야 합니다. 행마다 검사하고, 오류가 있는 행만 건너뜁니다."
          />
          <CardBody className="space-y-4">
            <Select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setResult(null);
              }}
              aria-label="가져올 항목"
            >
              {Object.entries(ENTITIES)
                .filter(([, e]) => e.importable)
                .map(([k, e]) => (
                  <option key={k} value={k}>
                    {e.label}
                  </option>
                ))}
            </Select>
            <p className="text-xs text-ink-muted">
              열: {ENTITIES[entity]?.columns}. 먼저 내보내기로 형식을 확인하면 편합니다.
            </p>
            <Button
              icon={<Upload className="h-4 w-4" />}
              loading={upload.isPending}
              onClick={() => ref.current?.click()}
            >
              파일 선택
            </Button>
            <input
              ref={ref}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
              }}
            />
            {result && (
              <Alert
                tone={result.errors.length ? 'warn' : 'ok'}
                title={`${result.total}행 중 ${result.imported}행 가져옴`}
              >
                {result.errors.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
                    {result.errors.map((e) => (
                      <li key={e.row}>
                        {e.row}행: {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="가져오기 기록" />
        {jobs.isLoading ? (
          <LoadingBlock rows={3} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>일시</Th>
                <Th>항목</Th>
                <Th>결과</Th>
                <Th className="text-right">행</Th>
              </tr>
            </thead>
            <tbody>
              {(jobs.data?.items ?? []).map((j) => (
                <tr key={j.id}>
                  <Td className="text-xs">{formatDate(j.createdAt, true)}</Td>
                  <Td>{ENTITIES[j.entity]?.label ?? j.entity}</Td>
                  <Td>
                    <Badge tone={j.status === 'SUCCESS' ? 'ok' : j.status === 'FAILED' ? 'danger' : 'warn'}>
                      {j.status}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular">
                    {j.importedRows}/{j.totalRows}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
