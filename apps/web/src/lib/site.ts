import type { BrandSettings, FooterSettings, HomepageSettings, SocialSettings } from '@sos/core';

export interface SiteConfig {
  platform?: boolean;
  tenant: { slug: string; name: string; isDemo: boolean };
  previewing: boolean;
  brand: BrandSettings;
  company: {
    legalName: string;
    legalNameEn: string;
    representative: string;
    businessRegistrationNo: string;
    ecommerceRegistrationNo: string;
    address: string;
    phone: string;
    fax: string;
    email: string;
    website: string;
    csContact: string;
    csHours: string;
  };
  social: SocialSettings;
  footer: FooterSettings;
  homepage: HomepageSettings;
  locale: { defaultLocale: 'ko' | 'en' | 'zh'; enabledLocales: Array<'ko' | 'en' | 'zh'> };
  search: { anonymousSearchEnabled: boolean };
  pricing: { showEstimatedBadge: boolean; baseCurrency: string };
  policies: Array<{ type: string; title: string; version: number }>;
  analytics: { ga4: string } | null;
  features: string[];
}

export interface Me {
  platform: boolean;
  tenant: { id: string; slug: string; name: string; isDemo: boolean } | null;
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
    audience: 'PLATFORM' | 'STAFF' | 'PARTNER' | 'CUSTOMER';
    companyId: string | null;
    mfaEnabled: boolean;
    mfaPending: boolean;
    mfaSetupRequired: boolean;
    impersonating: boolean;
  } | null;
  csrfToken: string | null;
  permissions: string[];
  features: string[];
}
