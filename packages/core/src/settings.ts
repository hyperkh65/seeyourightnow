import { z } from 'zod';
import { DEFAULT_MATCH_WEIGHTS, MATCH_COMPONENTS } from './matching.js';
import { DEFAULT_NUMBER_PATTERNS } from './numbering.js';

/**
 * Tenant configuration sections. Each section is versioned with a
 * Draft → Preview → Publish workflow (see config_versions table).
 * Nothing company-specific is hard-coded: defaults are neutral.
 */

const hex = z.string().regex(/^#([0-9a-fA-F]{6})$/, '#RRGGBB 형식이어야 합니다');
const url = z.string().url().or(z.literal(''));
const optionalText = z.string().max(2000).default('');

export const brandSchema = z.object({
  siteName: z.string().min(1).max(80).default('Sourcing'),
  serviceName: z.string().max(80).default('AI Sourcing'),
  companyDisplayName: z.string().max(120).default(''),
  logoFileId: z.string().nullable().default(null),
  logoDarkFileId: z.string().nullable().default(null),
  faviconFileId: z.string().nullable().default(null),
  ogImageFileId: z.string().nullable().default(null),
  emailLogoFileId: z.string().nullable().default(null),
  pdfLogoFileId: z.string().nullable().default(null),
  primaryColor: hex.default('#1F4FD8'),
  secondaryColor: hex.default('#0F172A'),
  accentColor: hex.default('#10B981'),
  fontFamily: z.enum(['Pretendard', 'Noto Sans KR', 'Inter', 'System']).default('Pretendard'),
  buttonRadius: z.enum(['none', 'sm', 'md', 'lg', 'full']).default('lg'),
  darkModeEnabled: z.boolean().default(true),
});
export type BrandSettings = z.infer<typeof brandSchema>;

export const companySchema = z.object({
  legalName: optionalText,
  legalNameEn: optionalText,
  representative: optionalText,
  businessRegistrationNo: optionalText,
  ecommerceRegistrationNo: optionalText,
  address: optionalText,
  addressEn: optionalText,
  phone: optionalText,
  fax: optionalText,
  email: z.string().email().or(z.literal('')).default(''),
  website: url.default(''),
  contactPerson: optionalText,
  csContact: optionalText,
  csHours: optionalText,
});
export type CompanySettings = z.infer<typeof companySchema>;

export const socialLinkSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1).max(40), // KAKAO_CHANNEL, KAKAO_OPENCHAT, WECHAT, WHATSAPP, INSTAGRAM, YOUTUBE, FACEBOOK, X, THREADS, NAVER_BLOG, CUSTOM
  label: z.string().max(60).default(''),
  url: z.string().max(500).default(''),
  value: z.string().max(200).default(''), // e.g. WeChat ID
  enabled: z.boolean().default(true),
  showInFooter: z.boolean().default(true),
  showAsCta: z.boolean().default(false),
});
export const socialSchema = z.object({ links: z.array(socialLinkSchema).default([]) });
export type SocialSettings = z.infer<typeof socialSchema>;

export const footerSchema = z.object({
  copyright: optionalText,
  showCompanyInfo: z.boolean().default(true),
  customText: optionalText,
  policyLinks: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
});
export type FooterSettings = z.infer<typeof footerSchema>;

export const HOMEPAGE_SECTION_TYPES = [
  'HERO',
  'PRODUCT_SEARCH',
  'IMAGE_SEARCH',
  'HOW_IT_WORKS',
  'AI_SOURCING',
  'POPULAR_PRODUCTS',
  'RECOMMENDED_PRODUCTS',
  'CASE_STUDIES',
  'REVIEWS',
  'FAQ',
  'CONTACT',
  'MESSENGER_CTA',
  'CUSTOM_TEXT',
] as const;

export const homepageSectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(HOMEPAGE_SECTION_TYPES),
  enabled: z.boolean().default(true),
  title: z.string().max(200).default(''),
  subtitle: z.string().max(600).default(''),
  body: z.string().max(5000).default(''),
  imageFileId: z.string().nullable().default(null),
  videoUrl: z.string().max(500).default(''),
  buttons: z
    .array(
      z.object({
        label: z.string().max(40),
        href: z.string().max(500),
        variant: z.enum(['primary', 'secondary', 'ghost']).default('primary'),
      }),
    )
    .default([]),
  background: z.enum(['default', 'muted', 'brand', 'dark']).default('default'),
  align: z.enum(['left', 'center']).default('left'),
  visibility: z.enum(['ALL', 'ANONYMOUS', 'LOGGED_IN']).default('ALL'),
  hideOnMobile: z.boolean().default(false),
  items: z
    .array(
      z.object({
        title: z.string().max(200),
        text: z.string().max(1000).default(''),
        imageFileId: z.string().nullable().default(null),
      }),
    )
    .default([]),
});
export type HomepageSection = z.infer<typeof homepageSectionSchema>;
export const homepageSchema = z.object({ sections: z.array(homepageSectionSchema).default([]) });
export type HomepageSettings = z.infer<typeof homepageSchema>;

export const pricingDisplaySchema = z.object({
  mode: z.enum(['TOTAL_ONLY', 'BREAKDOWN']).default('BREAKDOWN'),
  visibleLines: z
    .array(z.enum(['PRODUCT', 'INTERNATIONAL_FREIGHT', 'DOMESTIC_DELIVERY', 'SERVICE', 'DUTY_TAX', 'VAT']))
    .default(['PRODUCT', 'INTERNATIONAL_FREIGHT', 'DOMESTIC_DELIVERY', 'SERVICE', 'VAT']),
  showEstimatedBadge: z.boolean().default(true),
  baseCurrency: z.string().length(3).default('KRW'),
  vatPct: z.string().default('10'),
  vatRecoverable: z.boolean().default(true),
  quoteValidityDays: z.number().int().min(1).max(180).default(14),
  defaultPaymentTerms: z.string().max(500).default('계약금 30%, 선적 전 잔금 70%'),
  certificationAllocation: z
    .enum(['FULL_ON_ORDER', 'AMORTIZE', 'COMPANY_EXPENSE', 'CUSTOMER_SEPARATE'])
    .default('FULL_ON_ORDER'),
  roundingMode: z.enum(['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN']).default('UP'),
  roundingStep: z.string().default('10'),
});
export type PricingDisplaySettings = z.infer<typeof pricingDisplaySchema>;

export const numberingSchema = z.object({
  patterns: z.record(z.string(), z.string().max(60)).default(DEFAULT_NUMBER_PATTERNS),
});

export const localeSchema = z.object({
  defaultLocale: z.enum(['ko', 'en', 'zh']).default('ko'),
  enabledLocales: z.array(z.enum(['ko', 'en', 'zh'])).default(['ko', 'en']),
  timezone: z.string().default('Asia/Seoul'),
});

export const searchSchema = z.object({
  anonymousSearchEnabled: z.boolean().default(true),
  anonymousDailyLimitPerIp: z.number().int().min(0).max(1000).default(10),
  matchWeights: z.record(z.enum(MATCH_COMPONENTS), z.number().min(0).max(100)).default(DEFAULT_MATCH_WEIGHTS),
  staleDaysWarning: z.number().int().min(1).max(365).default(14),
  priceAnomalyLowRatio: z.string().default('0.5'),
  defaultOrigin: z.string().default('CNNGB'),
  defaultDestination: z.string().default('KRPUS'),
});

export const aiRouterSchema = z.object({
  primaryText: z.string().nullable().default(null), // api_connection id
  fallbackText: z.string().nullable().default(null),
  primaryVision: z.string().nullable().default(null),
  fallbackVision: z.string().nullable().default(null),
  embedding: z.string().nullable().default(null),
  ocr: z.string().nullable().default(null),
  monthlyTokenBudget: z.number().int().min(0).default(0),
});

export const notificationDefaultsSchema = z.object({
  emailEnabled: z.boolean().default(true),
  staffAlertEmails: z.array(z.string().email()).default([]),
  senderName: z.string().max(80).default(''),
  senderEmail: z.string().email().or(z.literal('')).default(''),
  replyTo: z.string().email().or(z.literal('')).default(''),
});

export const privacySchema = z.object({
  retentionDaysAnonymousSearch: z.number().int().min(1).max(3650).default(180),
  retentionDaysClosedProjects: z.number().int().min(30).max(3650).default(1825),
  anonymizeInactiveCustomersDays: z.number().int().min(30).max(3650).default(1095),
});

export const SETTINGS_SECTIONS = {
  brand: brandSchema,
  company: companySchema,
  social: socialSchema,
  footer: footerSchema,
  homepage: homepageSchema,
  pricing: pricingDisplaySchema,
  numbering: numberingSchema,
  locale: localeSchema,
  search: searchSchema,
  ai: aiRouterSchema,
  notifications: notificationDefaultsSchema,
  privacy: privacySchema,
} as const;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
export const SETTINGS_SECTION_KEYS = Object.keys(SETTINGS_SECTIONS) as SettingsSection[];

/** Sections that support preview-before-publish in the UI. */
export const PREVIEWABLE_SECTIONS: SettingsSection[] = ['brand', 'homepage', 'footer', 'social'];

export function defaultSettings<S extends SettingsSection>(
  section: S,
): z.infer<(typeof SETTINGS_SECTIONS)[S]> {
  return SETTINGS_SECTIONS[section].parse({}) as z.infer<(typeof SETTINGS_SECTIONS)[S]>;
}

export function defaultHomepage(siteName: string): HomepageSettings {
  return homepageSchema.parse({
    sections: [
      {
        id: 'hero',
        type: 'HERO',
        title: '사진 한 장으로 시작하는 해외 소싱',
        subtitle:
          '제품 사진이나 링크를 올리면 공급처, 예상 도착가격, 필요한 인증까지 한 번에 정리해 드립니다.',
        align: 'center',
        buttons: [{ label: '지금 검색하기', href: '/search', variant: 'primary' }],
      },
      {
        id: 'search',
        type: 'IMAGE_SEARCH',
        title: '어떤 제품을 찾으세요?',
        subtitle: '사진, 상품 링크, 제품명 중 편한 방법으로 시작하세요.',
      },
      {
        id: 'how',
        type: 'HOW_IT_WORKS',
        title: '진행 방식',
        items: [
          { title: '1. 제품 분석', text: '사진과 설명으로 제품 특성을 파악합니다.' },
          { title: '2. 공급처 비교', text: '여러 공급처를 가격·품질·납기 기준으로 비교합니다.' },
          { title: '3. 도착가격 계산', text: '운임·관세·인증 비용을 포함한 예상 도착가격을 계산합니다.' },
          { title: '4. 견적과 진행', text: '견적 승인 후 계약, 생산, 선적, 배송까지 관리합니다.' },
        ],
      },
      {
        id: 'faq',
        type: 'FAQ',
        title: '자주 묻는 질문',
        items: [
          {
            title: '회원가입 없이도 검색할 수 있나요?',
            text: '네. 첫 검색은 가입 없이 가능하며, 견적을 받으려면 간단한 가입이 필요합니다.',
          },
          {
            title: '표시되는 가격은 확정 가격인가요?',
            text: '검색 단계의 가격은 예상값입니다. 운임·관세·인증은 협력사 확인 후 견적에서 확정됩니다.',
          },
        ],
      },
      {
        id: 'contact',
        type: 'CONTACT',
        title: '상담이 필요하신가요?',
        subtitle: `${siteName} 담당자가 도와드립니다.`,
      },
    ],
  });
}
