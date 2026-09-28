'use client';

import { notFound, useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { SectionEditor } from '../_components/editor';
import { BrandForm, CompanyForm, FooterForm, HomepageForm, SocialForm } from '../_components/site-forms';
import {
  AiForm,
  LocaleForm,
  NotificationsForm,
  NumberingForm,
  PricingForm,
  PrivacyForm,
  SearchForm,
} from '../_components/ops-forms';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Def = {
  title: string;
  description: string;
  render: (v: any, set: (v: any) => void, ro: boolean) => ReactNode;
  validate?: (v: any) => string | null;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const SECTIONS: Record<string, Def> = {
  brand: {
    title: '브랜드',
    description: '사이트 이름, 로고, 색상, 글꼴을 설정합니다.',
    render: (v, set, ro) => <BrandForm v={v} set={set} ro={ro} />,
    validate: (v) =>
      !v.siteName?.trim()
        ? '사이트 이름을 입력하세요.'
        : [v.primaryColor, v.secondaryColor, v.accentColor].every((c: string) => HEX.test(c))
          ? null
          : '색상은 #RRGGBB 형식이어야 합니다.',
  },
  company: {
    title: '회사 정보',
    description: '견적서·계약서·푸터에 표시되는 사업자 정보입니다.',
    render: (v, set, ro) => <CompanyForm v={v} set={set} ro={ro} />,
    validate: (v) =>
      v.website && !/^https?:\/\//.test(v.website) ? '웹사이트는 https://로 시작해야 합니다.' : null,
  },
  social: {
    title: 'SNS·메신저',
    description: '카카오톡, WeChat, WhatsApp 등 상담 채널과 SNS 링크입니다.',
    render: (v, set, ro) => <SocialForm v={v} set={set} ro={ro} />,
  },
  footer: {
    title: '푸터',
    description: '사이트 하단 문구와 링크입니다.',
    render: (v, set, ro) => <FooterForm v={v} set={set} ro={ro} />,
  },
  homepage: {
    title: '홈페이지 구성',
    description: '홈 화면 섹션을 추가·정렬·편집합니다.',
    render: (v, set, ro) => <HomepageForm v={v} set={set} ro={ro} />,
  },
  pricing: {
    title: '가격·견적',
    description: '고객에게 보여 줄 가격 항목과 계산 기준입니다.',
    render: (v, set, ro) => <PricingForm v={v} set={set} ro={ro} />,
  },
  numbering: {
    title: '문서 번호',
    description: '견적서·계약서·인보이스 번호 규칙입니다.',
    render: (v, set, ro) => <NumberingForm v={v} set={set} ro={ro} />,
    validate: (v) =>
      Object.values(v.patterns ?? {}).some((p) => !/\{SEQ(:\d+)?\}/.test(String(p)))
        ? '모든 번호 규칙에 {SEQ} 또는 {SEQ:4} 같은 일련번호가 있어야 합니다.'
        : null,
  },
  locale: {
    title: '언어·시간대',
    description: '기본 언어와 사용할 언어입니다.',
    render: (v, set, ro) => <LocaleForm v={v} set={set} ro={ro} />,
  },
  search: {
    title: '검색·추천',
    description: '검색 제한과 추천 점수 가중치입니다.',
    render: (v, set, ro) => <SearchForm v={v} set={set} ro={ro} />,
  },
  ai: {
    title: 'AI 라우팅',
    description: '어떤 AI 제공자를 기본·대체로 쓸지 정합니다.',
    render: (v, set, ro) => <AiForm v={v} set={set} ro={ro} />,
  },
  notifications: {
    title: '알림',
    description: '이메일 발신 정보와 내부 알림 수신자입니다.',
    render: (v, set, ro) => <NotificationsForm v={v} set={set} ro={ro} />,
  },
  privacy: {
    title: '개인정보·보관',
    description: '데이터 보관 기간과 익명 처리 기준입니다.',
    render: (v, set, ro) => <PrivacyForm v={v} set={set} ro={ro} />,
  },
};

export default function SettingsSectionPage() {
  const { section } = useParams<{ section: string }>();
  const def = SECTIONS[section];
  if (!def) notFound();
  return (
    <SectionEditor<any>
      key={section}
      section={section}
      title={def.title}
      description={def.description}
      validate={def.validate}
    >
      {(v, set, ro) => def.render(v, set, ro)}
    </SectionEditor>
  );
}
