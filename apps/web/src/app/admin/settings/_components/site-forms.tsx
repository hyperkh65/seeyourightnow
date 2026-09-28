'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  HOMEPAGE_SECTION_TYPES,
  type BrandSettings,
  type CompanySettings,
  type FooterSettings,
  type HomepageSection,
  type HomepageSettings,
  type SocialSettings,
} from '@sos/core';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Dialog,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';
import { AssetField } from './editor';

type P<T> = { v: T; set: (v: T) => void; ro: boolean };
const uid = () => Math.random().toString(36).slice(2, 10);

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <Field label={label} error={valid ? null : '#RRGGBB 형식으로 입력하세요'}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} 선택`}
          disabled={disabled}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-surface p-1"
        />
        <Input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
        />
      </div>
    </Field>
  );
}

export function BrandForm({ v, set, ro }: P<BrandSettings>) {
  const f = <K extends keyof BrandSettings>(k: K, val: BrandSettings[K]) => set({ ...v, [k]: val });
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="이름" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="사이트 이름" required>
              <Input disabled={ro} value={v.siteName} onChange={(e) => f('siteName', e.target.value)} />
            </Field>
            <Field label="서비스 이름">
              <Input disabled={ro} value={v.serviceName} onChange={(e) => f('serviceName', e.target.value)} />
            </Field>
            <Field label="표시 회사명" className="sm:col-span-2">
              <Input
                disabled={ro}
                value={v.companyDisplayName}
                onChange={(e) => f('companyDisplayName', e.target.value)}
              />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="색상·스타일" />
          <CardBody className="grid gap-3 sm:grid-cols-3">
            <ColorField
              label="대표 색상"
              disabled={ro}
              value={v.primaryColor}
              onChange={(x) => f('primaryColor', x)}
            />
            <ColorField
              label="보조 색상"
              disabled={ro}
              value={v.secondaryColor}
              onChange={(x) => f('secondaryColor', x)}
            />
            <ColorField
              label="강조 색상"
              disabled={ro}
              value={v.accentColor}
              onChange={(x) => f('accentColor', x)}
            />
            <Field label="글꼴">
              <Select
                disabled={ro}
                value={v.fontFamily}
                onChange={(e) => f('fontFamily', e.target.value as BrandSettings['fontFamily'])}
              >
                {['Pretendard', 'Noto Sans KR', 'Inter', 'System'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="버튼 모서리">
              <Select
                disabled={ro}
                value={v.buttonRadius}
                onChange={(e) => f('buttonRadius', e.target.value as BrandSettings['buttonRadius'])}
              >
                {[
                  ['none', '각지게'],
                  ['sm', '조금'],
                  ['md', '보통'],
                  ['lg', '둥글게'],
                  ['full', '완전히 둥글게'],
                ].map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="self-end pb-2">
              <Switch
                disabled={ro}
                checked={v.darkModeEnabled}
                onChange={(x) => f('darkModeEnabled', x)}
                label="다크 모드 허용"
              />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="로고·이미지"
            description="PNG, JPG, WebP, ICO를 올릴 수 있습니다. 파일 내용까지 확인한 뒤 저장됩니다."
          />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <AssetField
              label="로고"
              disabled={ro}
              value={v.logoFileId}
              onChange={(x) => f('logoFileId', x)}
            />
            <AssetField
              label="다크 모드 로고"
              disabled={ro}
              value={v.logoDarkFileId}
              onChange={(x) => f('logoDarkFileId', x)}
            />
            <AssetField
              label="파비콘"
              disabled={ro}
              value={v.faviconFileId}
              onChange={(x) => f('faviconFileId', x)}
            />
            <AssetField
              label="공유 이미지 (OG)"
              hint="1200×630 권장"
              disabled={ro}
              value={v.ogImageFileId}
              onChange={(x) => f('ogImageFileId', x)}
            />
            <AssetField
              label="이메일 로고"
              disabled={ro}
              value={v.emailLogoFileId}
              onChange={(x) => f('emailLogoFileId', x)}
            />
            <AssetField
              label="PDF 문서 로고"
              disabled={ro}
              value={v.pdfLogoFileId}
              onChange={(x) => f('pdfLogoFileId', x)}
            />
          </CardBody>
        </Card>
      </div>
      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader title="미리보기" />
        <CardBody className="space-y-4">
          <div
            className="rounded-xl border border-line p-4"
            style={{ fontFamily: v.fontFamily === 'System' ? 'system-ui' : v.fontFamily }}
          >
            <p className="text-lg font-bold" style={{ color: v.secondaryColor }}>
              {v.siteName || '사이트 이름'}
            </p>
            <p className="mb-4 text-sm text-ink-muted">{v.serviceName}</p>
            <div className="flex gap-2">
              <span
                className="px-4 py-2 text-sm font-semibold text-white"
                style={{
                  background: v.primaryColor,
                  borderRadius: { none: 0, sm: 6, md: 8, lg: 12, full: 999 }[v.buttonRadius],
                }}
              >
                견적 요청
              </span>
              <span
                className="border px-4 py-2 text-sm"
                style={{
                  borderColor: v.primaryColor,
                  color: v.primaryColor,
                  borderRadius: { none: 0, sm: 6, md: 8, lg: 12, full: 999 }[v.buttonRadius],
                }}
              >
                둘러보기
              </span>
            </div>
            <p className="mt-4 text-xs" style={{ color: v.accentColor }}>
              ● 강조 색상
            </p>
          </div>
          <p className="text-xs text-ink-muted">실제 사이트 모습은 ‘미리보기’ 버튼으로 확인할 수 있습니다.</p>
        </CardBody>
      </Card>
    </div>
  );
}

export function CompanyForm({ v, set, ro }: P<CompanySettings>) {
  const t = (k: keyof CompanySettings, label: string, opts: { span?: boolean; hint?: string } = {}) => (
    <Field label={label} hint={opts.hint} className={opts.span ? 'sm:col-span-2' : undefined}>
      <Input disabled={ro} value={v[k]} onChange={(e) => set({ ...v, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Card>
      <CardBody className="grid gap-3 sm:grid-cols-2">
        {t('legalName', '상호 (법인명)')}
        {t('legalNameEn', '영문 상호', { hint: '무역 서류(PI, CI)에 사용됩니다' })}
        {t('representative', '대표자')}
        {t('businessRegistrationNo', '사업자등록번호')}
        {t('ecommerceRegistrationNo', '통신판매업 신고번호')}
        {t('phone', '대표 전화')}
        {t('address', '주소', { span: true })}
        {t('addressEn', '영문 주소', { span: true })}
        {t('email', '대표 이메일')}
        {t('fax', '팩스')}
        {t('website', '웹사이트', { hint: 'https://로 시작' })}
        {t('contactPerson', '담당자')}
        {t('csContact', '고객센터 연락처')}
        {t('csHours', '상담 시간', { hint: '예: 평일 09:00~18:00' })}
      </CardBody>
    </Card>
  );
}

const SOCIAL_TYPES: Record<string, string> = {
  KAKAO_CHANNEL: '카카오톡 채널',
  KAKAO_OPENCHAT: '카카오 오픈채팅',
  WECHAT: 'WeChat',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: '인스타그램',
  YOUTUBE: '유튜브',
  FACEBOOK: '페이스북',
  X: 'X',
  THREADS: '스레드',
  NAVER_BLOG: '네이버 블로그',
  CUSTOM: '직접 입력',
};

export function SocialForm({ v, set, ro }: P<SocialSettings>) {
  const upd = (i: number, patch: Partial<SocialSettings['links'][number]>) =>
    set({ links: v.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="space-y-4">
      {v.links.map((l, i) => (
        <Card key={l.id}>
          <CardBody className="grid gap-3 sm:grid-cols-4">
            <Field label="종류">
              <Select disabled={ro} value={l.type} onChange={(e) => upd(i, { type: e.target.value })}>
                {Object.entries(SOCIAL_TYPES).map(([k, x]) => (
                  <option key={k} value={k}>
                    {x}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="표시 이름">
              <Input
                disabled={ro}
                value={l.label}
                onChange={(e) => upd(i, { label: e.target.value })}
                placeholder={SOCIAL_TYPES[l.type]}
              />
            </Field>
            <Field label="링크" className="sm:col-span-2">
              <Input
                disabled={ro}
                value={l.url}
                onChange={(e) => upd(i, { url: e.target.value })}
                placeholder="https://"
              />
            </Field>
            <Field label="ID (링크가 없을 때)">
              <Input disabled={ro} value={l.value} onChange={(e) => upd(i, { value: e.target.value })} />
            </Field>
            <div className="flex flex-wrap items-end gap-4 pb-2 sm:col-span-3">
              <Switch
                disabled={ro}
                checked={l.enabled}
                onChange={(x) => upd(i, { enabled: x })}
                label="사용"
              />
              <Checkbox
                checked={l.showInFooter}
                onChange={(x) => upd(i, { showInFooter: x })}
                label="푸터에 표시"
              />
              <Checkbox
                checked={l.showAsCta}
                onChange={(x) => upd(i, { showAsCta: x })}
                label="상담 버튼으로 표시"
              />
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={ro}
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => set({ links: v.links.filter((_, j) => j !== i) })}
              >
                삭제
              </Button>
            </div>
          </CardBody>
        </Card>
      ))}
      {!ro && (
        <Button
          variant="secondary"
          icon={<Plus className="h-4 w-4" />}
          onClick={() =>
            set({
              links: [
                ...v.links,
                {
                  id: uid(),
                  type: 'KAKAO_CHANNEL',
                  label: '',
                  url: '',
                  value: '',
                  enabled: true,
                  showInFooter: true,
                  showAsCta: false,
                },
              ],
            })
          }
        >
          채널 추가
        </Button>
      )}
    </div>
  );
}

export function FooterForm({ v, set, ro }: P<FooterSettings>) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <Field label="저작권 문구" hint="비우면 회사명으로 자동 표시됩니다">
          <Input
            disabled={ro}
            value={v.copyright}
            onChange={(e) => set({ ...v, copyright: e.target.value })}
          />
        </Field>
        <Switch
          disabled={ro}
          checked={v.showCompanyInfo}
          onChange={(x) => set({ ...v, showCompanyInfo: x })}
          label="사업자 정보 표시 (전자상거래법상 표시 의무 항목)"
        />
        <Field label="추가 문구">
          <Textarea
            disabled={ro}
            value={v.customText}
            onChange={(e) => set({ ...v, customText: e.target.value })}
          />
        </Field>
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-ink-soft">추가 링크</p>
          {v.policyLinks.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input
                disabled={ro}
                value={l.label}
                aria-label="링크 이름"
                placeholder="이름"
                onChange={(e) =>
                  set({
                    ...v,
                    policyLinks: v.policyLinks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  })
                }
              />
              <Input
                disabled={ro}
                value={l.href}
                aria-label="링크 주소"
                placeholder="/policies/terms 또는 https://"
                onChange={(e) =>
                  set({
                    ...v,
                    policyLinks: v.policyLinks.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)),
                  })
                }
              />
              <Button
                variant="ghost"
                disabled={ro}
                aria-label="삭제"
                onClick={() => set({ ...v, policyLinks: v.policyLinks.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {!ro && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => set({ ...v, policyLinks: [...v.policyLinks, { label: '', href: '' }] })}
            >
              링크 추가
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

const SECTION_LABEL: Record<HomepageSection['type'], string> = {
  HERO: '메인 배너',
  PRODUCT_SEARCH: '제품 검색',
  IMAGE_SEARCH: '이미지 검색',
  HOW_IT_WORKS: '진행 방식',
  AI_SOURCING: 'AI 소싱 소개',
  POPULAR_PRODUCTS: '인기 제품',
  RECOMMENDED_PRODUCTS: '추천 제품',
  CASE_STUDIES: '진행 사례',
  REVIEWS: '고객 후기',
  FAQ: '자주 묻는 질문',
  CONTACT: '문의',
  MESSENGER_CTA: '메신저 상담',
  CUSTOM_TEXT: '자유 텍스트',
};

function newSection(type: HomepageSection['type']): HomepageSection {
  return {
    id: uid(),
    type,
    enabled: true,
    title: SECTION_LABEL[type],
    subtitle: '',
    body: '',
    imageFileId: null,
    videoUrl: '',
    buttons: [],
    background: 'default',
    align: 'left',
    visibility: 'ALL',
    hideOnMobile: false,
    items: [],
  };
}

function SectionDialog({
  s,
  onSave,
  onClose,
}: {
  s: HomepageSection;
  onSave: (s: HomepageSection) => void;
  onClose: () => void;
}) {
  const [x, setX] = useState(s);
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`${SECTION_LABEL[x.type]} 편집`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={() => onSave(x)}>적용</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="제목" className="sm:col-span-2">
          <Input value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} />
        </Field>
        <Field label="부제목" className="sm:col-span-2">
          <Textarea rows={2} value={x.subtitle} onChange={(e) => setX({ ...x, subtitle: e.target.value })} />
        </Field>
        {['CUSTOM_TEXT', 'AI_SOURCING', 'CONTACT', 'HERO'].includes(x.type) && (
          <Field label="본문" className="sm:col-span-2">
            <Textarea rows={4} value={x.body} onChange={(e) => setX({ ...x, body: e.target.value })} />
          </Field>
        )}
        <AssetField label="이미지" value={x.imageFileId} onChange={(id) => setX({ ...x, imageFileId: id })} />
        <Field label="동영상 URL">
          <Input
            value={x.videoUrl}
            onChange={(e) => setX({ ...x, videoUrl: e.target.value })}
            placeholder="https://"
          />
        </Field>
        <Field label="배경">
          <Select
            value={x.background}
            onChange={(e) => setX({ ...x, background: e.target.value as HomepageSection['background'] })}
          >
            <option value="default">기본</option>
            <option value="muted">연한 회색</option>
            <option value="brand">브랜드 색상</option>
            <option value="dark">어두운 배경</option>
          </Select>
        </Field>
        <Field label="정렬">
          <Select
            value={x.align}
            onChange={(e) => setX({ ...x, align: e.target.value as HomepageSection['align'] })}
          >
            <option value="left">왼쪽</option>
            <option value="center">가운데</option>
          </Select>
        </Field>
        <Field label="보이는 대상">
          <Select
            value={x.visibility}
            onChange={(e) => setX({ ...x, visibility: e.target.value as HomepageSection['visibility'] })}
          >
            <option value="ALL">모두</option>
            <option value="ANONYMOUS">로그인 전</option>
            <option value="LOGGED_IN">로그인 후</option>
          </Select>
        </Field>
        <div className="self-end pb-2">
          <Checkbox
            checked={x.hideOnMobile}
            onChange={(v) => setX({ ...x, hideOnMobile: v })}
            label="모바일에서 숨기기"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-[13px] font-medium text-ink-soft">버튼</p>
          {x.buttons.map((b, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto]">
              <Input
                value={b.label}
                aria-label="버튼 이름"
                placeholder="이름"
                onChange={(e) =>
                  setX({
                    ...x,
                    buttons: x.buttons.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)),
                  })
                }
              />
              <Input
                value={b.href}
                aria-label="버튼 링크"
                placeholder="/search 또는 https://"
                onChange={(e) =>
                  setX({
                    ...x,
                    buttons: x.buttons.map((y, j) => (j === i ? { ...y, href: e.target.value } : y)),
                  })
                }
              />
              <Select
                value={b.variant}
                aria-label="버튼 모양"
                onChange={(e) =>
                  setX({
                    ...x,
                    buttons: x.buttons.map((y, j) =>
                      j === i ? { ...y, variant: e.target.value as 'primary' } : y,
                    ),
                  })
                }
              >
                <option value="primary">기본</option>
                <option value="secondary">보조</option>
                <option value="ghost">텍스트</option>
              </Select>
              <Button
                variant="ghost"
                aria-label="버튼 삭제"
                onClick={() => setX({ ...x, buttons: x.buttons.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {x.buttons.length < 3 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setX({ ...x, buttons: [...x.buttons, { label: '', href: '', variant: 'primary' }] })
              }
            >
              버튼 추가
            </Button>
          )}
        </div>
        {[
          'HOW_IT_WORKS',
          'FAQ',
          'CASE_STUDIES',
          'REVIEWS',
          'POPULAR_PRODUCTS',
          'RECOMMENDED_PRODUCTS',
          'AI_SOURCING',
        ].includes(x.type) && (
          <div className="space-y-2 sm:col-span-2">
            <p className="text-[13px] font-medium text-ink-soft">
              {x.type === 'FAQ' ? '질문과 답변' : '항목'}
            </p>
            {x.items.map((it, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_2fr_auto]"
              >
                <Input
                  value={it.title}
                  aria-label="항목 제목"
                  placeholder={x.type === 'FAQ' ? '질문' : '제목'}
                  onChange={(e) =>
                    setX({
                      ...x,
                      items: x.items.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)),
                    })
                  }
                />
                <Textarea
                  rows={2}
                  value={it.text}
                  aria-label="항목 내용"
                  placeholder={x.type === 'FAQ' ? '답변' : '설명'}
                  onChange={(e) =>
                    setX({
                      ...x,
                      items: x.items.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  aria-label="항목 삭제"
                  onClick={() => setX({ ...x, items: x.items.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setX({ ...x, items: [...x.items, { title: '', text: '', imageFileId: null }] })}
            >
              항목 추가
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function HomepageForm({ v, set, ro }: P<HomepageSettings>) {
  const [edit, setEdit] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [add, setAdd] = useState<HomepageSection['type']>('CUSTOM_TEXT');
  const move = (from: number, to: number) => {
    if (to < 0 || to >= v.sections.length || from === to) return;
    const next = [...v.sections];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    set({ sections: next });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        끌어서 순서를 바꾸거나 화살표 버튼을 사용하세요. 변경 사항은 게시 전 ‘미리보기’로 확인할 수 있습니다.
      </p>
      <ol className="space-y-2">
        {v.sections.map((s, i) => (
          <li
            key={s.id}
            draggable={!ro}
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-surface px-3 py-3 ${drag === i ? 'border-brand' : 'border-line'} ${s.enabled ? '' : 'opacity-60'}`}
          >
            <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-ink-muted" aria-hidden />
            <div className="min-w-[55%] flex-1">
              <p className="truncate text-sm font-medium">{s.title || SECTION_LABEL[s.type]}</p>
              <p className="text-xs text-ink-muted">
                {SECTION_LABEL[s.type]}
                {s.visibility !== 'ALL' && ` · ${s.visibility === 'ANONYMOUS' ? '로그인 전' : '로그인 후'}만`}
                {s.hideOnMobile && ' · 모바일 숨김'}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {!s.enabled && <Badge>숨김</Badge>}
              <Switch
                disabled={ro}
                checked={s.enabled}
                onChange={(x) =>
                  set({ sections: v.sections.map((y, j) => (j === i ? { ...y, enabled: x } : y)) })
                }
                label={<span className="sr-only">{s.title} 표시</span>}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={ro || i === 0}
                aria-label="위로"
                onClick={() => move(i, i - 1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={ro || i === v.sections.length - 1}
                aria-label="아래로"
                onClick={() => move(i, i + 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" disabled={ro} aria-label="편집" onClick={() => setEdit(i)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={ro}
                aria-label="삭제"
                onClick={() => set({ sections: v.sections.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {!ro && (
        <div className="flex gap-2">
          <Select
            className="w-52"
            value={add}
            onChange={(e) => setAdd(e.target.value as HomepageSection['type'])}
            aria-label="추가할 섹션"
          >
            {HOMEPAGE_SECTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {SECTION_LABEL[t]}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => set({ sections: [...v.sections, newSection(add)] })}
          >
            섹션 추가
          </Button>
        </div>
      )}
      {edit !== null && v.sections[edit] && (
        <SectionDialog
          s={v.sections[edit]!}
          onClose={() => setEdit(null)}
          onSave={(s) => {
            set({ sections: v.sections.map((y, j) => (j === edit ? s : y)) });
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}
