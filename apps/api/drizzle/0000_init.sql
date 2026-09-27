CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"purpose" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"account_holder" text NOT NULL,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"swift" text DEFAULT '' NOT NULL,
	"bank_address" text DEFAULT '' NOT NULL,
	"intermediary_info" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"show_on_documents" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"data" jsonb NOT NULL,
	"preview_token" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_monthly" text,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"previous_token_hash" text,
	"csrf_token" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"step_up_at" timestamp with time zone,
	"impersonator_id" uuid,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"device_label" text DEFAULT '' NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"limit_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feature_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"kind" text NOT NULL,
	"verification_token" text NOT NULL,
	"dns_status" text DEFAULT 'PENDING' NOT NULL,
	"ssl_status" text DEFAULT 'PENDING' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"setup_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" "citext" NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"company_id" uuid,
	"expert_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locale" text DEFAULT 'ko' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"mfa_recovery_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"business_number" text DEFAULT '' NOT NULL,
	"ceo" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"industry" text DEFAULT '' NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tax_invoice_email" text DEFAULT '' NOT NULL,
	"payment_terms" text DEFAULT '' NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tier" text DEFAULT 'STANDARD' NOT NULL,
	"credit_level" text DEFAULT 'NORMAL' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_user_id" uuid,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"messenger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(20, 8) NOT NULL,
	"rate_date" text NOT NULL,
	"source" text NOT NULL,
	"verification" text DEFAULT 'UNVERIFIED' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"unit_price" numeric(20, 4) NOT NULL,
	"currency" text NOT NULL,
	"moq" integer,
	"stock" integer,
	"specs_hash" text,
	"seller_name" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid,
	"platform" text NOT NULL,
	"external_id" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"seller" text DEFAULT '' NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"selling_price" numeric(20, 4),
	"discount_price" numeric(20, 4),
	"currency" text DEFAULT 'KRW' NOT NULL,
	"reviews" integer,
	"rating" real,
	"rank" integer,
	"delivery" text DEFAULT '' NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"is_dev_mock" boolean DEFAULT false NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"price" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid,
	"label" text DEFAULT '' NOT NULL,
	"supplier_count" integer DEFAULT 0 NOT NULL,
	"currency" text,
	"lowest_price" numeric(20, 4),
	"median_price" numeric(20, 4),
	"highest_price" numeric(20, 4),
	"moq_distribution" jsonb DEFAULT '{"min":null,"median":null,"max":null}'::jsonb NOT NULL,
	"avg_seller_quality" real,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid,
	"request_id" uuid,
	"file_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"phash" text,
	"width" integer,
	"height" integer,
	"ocr_text" text,
	"ocr_provider" text,
	"subject_box" jsonb,
	"analysis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"request_id" uuid,
	"name_ko" text DEFAULT '' NOT NULL,
	"name_en" text DEFAULT '' NOT NULL,
	"name_cn" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'UNKNOWN' NOT NULL,
	"subcategory" text DEFAULT 'UNKNOWN' NOT NULL,
	"attributes_estimated" jsonb,
	"attributes_verified" jsonb,
	"attribute_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attribute_conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"hs_code_estimated" text,
	"hs_code_verified" text,
	"hs_code_actual" text,
	"passport" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"cluster_id" uuid,
	"score" real DEFAULT 0 NOT NULL,
	"coverage" real DEFAULT 0 NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weights_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cautions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_price_base" numeric(20, 4),
	"image_similarity" real,
	"pinned" boolean DEFAULT false NOT NULL,
	"hidden_from_customer" boolean DEFAULT false NOT NULL,
	"is_internal_recommendation" boolean DEFAULT false NOT NULL,
	"internal_cost" numeric(20, 4),
	"customer_price" numeric(20, 4),
	"customer_price_currency" text,
	"quality_level" text,
	"reason" text DEFAULT '' NOT NULL,
	"private_note" text DEFAULT '' NOT NULL,
	"customer_note" text DEFAULT '' NOT NULL,
	"added_by" uuid,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"normalized_query" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'UNKNOWN' NOT NULL,
	"cluster_key" text DEFAULT '' NOT NULL,
	"input_type" text NOT NULL,
	"quantity" integer,
	"target_price_krw" numeric(20, 4),
	"buyer_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid,
	"source_type" text NOT NULL,
	"connector" text NOT NULL,
	"external_id" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"title_ko" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"price_tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supplier_list_price" numeric(20, 4),
	"supplier_verified_price" numeric(20, 4),
	"moq" integer,
	"lead_time_days" integer,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phash" text,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sales_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"packaging" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shipping_origin" text DEFAULT '' NOT NULL,
	"oem_supported" boolean,
	"seller_quality" real,
	"cluster_id" uuid,
	"is_dev_mock" boolean DEFAULT false NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"company_id" uuid,
	"customer_user_id" uuid,
	"owner_user_id" uuid,
	"stage" text DEFAULT 'REQUESTED' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"attention" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"access_token_hash" text,
	"created_by_user_id" uuid,
	"anonymous_ip_hash" text,
	"input_type" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quantity" integer,
	"target_purchase_price" numeric(20, 4),
	"target_purchase_currency" text,
	"target_landed_price_krw" numeric(20, 4),
	"target_selling_price_krw" numeric(20, 4),
	"desired_lead_time_days" integer,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"wechat" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'zh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"project_id" uuid,
	"rating" real,
	"amount" numeric(20, 4),
	"currency" text,
	"note" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_local" text DEFAULT '' NOT NULL,
	"alias" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'ALIAS' NOT NULL,
	"source_type" text NOT NULL,
	"business_type" text DEFAULT 'UNKNOWN' NOT NULL,
	"country" text DEFAULT 'CN' NOT NULL,
	"province" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"lat" real,
	"lon" real,
	"nearest_port" text DEFAULT '' NOT NULL,
	"years_in_business" integer,
	"business_verified" boolean,
	"verification_note" text DEFAULT '' NOT NULL,
	"avg_response_hours" real,
	"typical_moq" integer,
	"oem_supported" boolean,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bank_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blacklisted" boolean DEFAULT false NOT NULL,
	"blacklist_reason" text DEFAULT '' NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"last_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"regulation_id" uuid NOT NULL,
	"regulation_version_id" uuid NOT NULL,
	"estimated_status" text NOT NULL,
	"estimated_confidence" real DEFAULT 0 NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_status" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"expert_note" text DEFAULT '' NOT NULL,
	"estimated_cost" numeric(20, 4),
	"verified_cost" numeric(20, 4),
	"actual_cost" numeric(20, 4),
	"cost_currency" text DEFAULT 'KRW' NOT NULL,
	"certificate_number" text DEFAULT '' NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"request_id" uuid,
	"candidate_id" uuid,
	"product_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'ESTIMATED' NOT NULL,
	"quantity" integer NOT NULL,
	"base_currency" text DEFAULT 'KRW' NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"landed_cost_total" numeric(20, 4) NOT NULL,
	"landed_cost_per_unit" numeric(20, 4) NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"verification" text NOT NULL,
	"fx_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"calculation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"component" text NOT NULL,
	"total_base" numeric(20, 4) NOT NULL,
	"per_unit_base" numeric(20, 8) NOT NULL,
	"original_amount" numeric(20, 4),
	"original_currency" text,
	"source" text NOT NULL,
	"verification" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rfq_id" uuid,
	"project_id" uuid,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"source" text NOT NULL,
	"partner_user_id" uuid,
	"provider_name" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"freight" numeric(20, 4),
	"origin_charges" numeric(20, 4),
	"destination_charges" numeric(20, 4),
	"customs_charges" numeric(20, 4),
	"delivery_charges" numeric(20, 4),
	"total" numeric(20, 4) NOT NULL,
	"total_base" numeric(20, 4),
	"transit_days" text DEFAULT '' NOT NULL,
	"valid_until" text,
	"note" text DEFAULT '' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"source" text NOT NULL,
	"verification" text DEFAULT 'UNVERIFIED' NOT NULL,
	"provider_name" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"basis" text NOT NULL,
	"rate" numeric(20, 4) NOT NULL,
	"min_charge" numeric(20, 4),
	"fixed_charges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transit_days_min" integer,
	"transit_days_max" integer,
	"valid_from" text,
	"valid_until" text,
	"note" text DEFAULT '' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"project_id" uuid,
	"request_id" uuid,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"incoterm" text DEFAULT 'FOB' NOT NULL,
	"cartons" integer NOT NULL,
	"cbm" numeric(20, 8) NOT NULL,
	"gross_weight_kg" numeric(20, 8) NOT NULL,
	"cargo_type" text DEFAULT 'GENERAL' NOT NULL,
	"battery" boolean DEFAULT false NOT NULL,
	"dangerous_goods" boolean DEFAULT false NOT NULL,
	"ready_date" text,
	"modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"packing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"awarded_quote_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hs_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_hs" text,
	"estimated_confidence" real,
	"estimated_source" text DEFAULT '' NOT NULL,
	"verified_hs" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text DEFAULT '' NOT NULL,
	"actual_hs" text,
	"actual_source" text DEFAULT '' NOT NULL,
	"actual_at" timestamp with time zone,
	"selected_rate_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hs_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" text NOT NULL,
	"level" integer NOT NULL,
	"description_ko" text DEFAULT '' NOT NULL,
	"description_en" text DEFAULT '' NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"import_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"verification" text DEFAULT 'UNVERIFIED' NOT NULL,
	"effective_from" text,
	"effective_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "margin_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"config" jsonb NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"due_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unlocode" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"geofence_km" real DEFAULT 15 NOT NULL,
	"kind" text DEFAULT 'SEAPORT' NOT NULL,
	"source" text DEFAULT 'UN/LOCODE' NOT NULL,
	CONSTRAINT "ports_unlocode_unique" UNIQUE("unlocode")
);
--> statement-breakpoint
CREATE TABLE "pricing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"candidate_id" uuid,
	"cost_calculation_id" uuid,
	"margin_rule_set_id" uuid,
	"quantity" integer NOT NULL,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"supplier_list_price" numeric(20, 4),
	"supplier_verified_price" numeric(20, 4),
	"actual_purchase_price" numeric(20, 4),
	"supplier_price_currency" text,
	"estimated_landed_cost" numeric(20, 4),
	"verified_landed_cost" numeric(20, 4),
	"actual_landed_cost" numeric(20, 4),
	"calculated_customer_price" numeric(20, 4),
	"admin_final_price" numeric(20, 4),
	"admin_final_reason" text,
	"admin_final_note" text DEFAULT '' NOT NULL,
	"admin_final_by" uuid,
	"admin_final_at" timestamp with time zone,
	"actual_customer_price" numeric(20, 4),
	"price_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"regulation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"hs_prefixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_all" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_any" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"documents_required" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tests_required" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expert_type" text,
	"official_source" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"effective_from" text,
	"effective_to" text,
	"change_note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"authority" text NOT NULL,
	"category" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"hs_code" text NOT NULL,
	"rate_type" text NOT NULL,
	"rate_pct" numeric(20, 8),
	"specific_duty" text,
	"origin_country" text DEFAULT '*' NOT NULL,
	"requires_coo" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"verification" text DEFAULT 'UNVERIFIED' NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"document_hash" text,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"template_version_id" uuid,
	"clauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"quotation_id" uuid,
	"quotation_version_id" uuid,
	"company_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"current_version_id" uuid,
	"legal_review_required" boolean DEFAULT true NOT NULL,
	"legal_reviewed_at" timestamp with time zone,
	"legal_reviewed_by" uuid,
	"effective_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"production_order_id" uuid,
	"type" text DEFAULT 'PRE_SHIPMENT' NOT NULL,
	"inspector" text DEFAULT '' NOT NULL,
	"scheduled_at" text,
	"result" text DEFAULT 'PENDING' NOT NULL,
	"aql_level" text DEFAULT '' NOT NULL,
	"sample_size" integer,
	"defects_critical" integer DEFAULT 0 NOT NULL,
	"defects_major" integer DEFAULT 0 NOT NULL,
	"defects_minor" integer DEFAULT 0 NOT NULL,
	"report_file_id" uuid,
	"photo_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"cost" numeric(20, 4),
	"cost_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_id" uuid,
	"company_id" uuid,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"subtotal" numeric(20, 4) DEFAULT '0' NOT NULL,
	"vat" numeric(20, 4) DEFAULT '0' NOT NULL,
	"total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"payment_status" text DEFAULT 'PENDING' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_id" uuid,
	"issued_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"invoice_id" uuid,
	"direction" text DEFAULT 'INBOUND' NOT NULL,
	"kind" text DEFAULT 'DEPOSIT' NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"currency" text NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"paid_at" timestamp with time zone,
	"method" text DEFAULT 'BANK_TRANSFER' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"planned_start" text,
	"planned_end" text,
	"actual_start" text,
	"actual_end" text,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"delay_reason" text DEFAULT '' NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid,
	"currency" text NOT NULL,
	"total" numeric(20, 4) NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"document_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"candidate_id" uuid,
	"pricing_snapshot_id" uuid,
	"image_file_id" uuid,
	"name" text NOT NULL,
	"specification" text DEFAULT '' NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text DEFAULT 'EA' NOT NULL,
	"unit_price" numeric(20, 4) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"visible_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_badge" text DEFAULT 'ESTIMATED' NOT NULL,
	"internal_cost" numeric(20, 4),
	"internal_meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "quotation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"issue_date" text,
	"valid_until" text,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"subtotal" numeric(20, 4) DEFAULT '0' NOT NULL,
	"shipping_total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"other_charges" numeric(20, 4) DEFAULT '0' NOT NULL,
	"vat" numeric(20, 4) DEFAULT '0' NOT NULL,
	"total" numeric(20, 4) DEFAULT '0' NOT NULL,
	"lead_time" text DEFAULT '' NOT NULL,
	"payment_terms" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"customer_caution" text DEFAULT '' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"snapshot" jsonb,
	"internal_summary" jsonb,
	"document_id" uuid,
	"sent_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid,
	"current_version_id" uuid,
	"current_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"container_number" text NOT NULL,
	"iso_type" text DEFAULT '' NOT NULL,
	"seal_number" text DEFAULT '' NOT NULL,
	"cartons" integer,
	"gross_weight_kg" text,
	"cbm" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_etas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"source" text NOT NULL,
	"eta" timestamp with time zone NOT NULL,
	"confidence" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"container_id" uuid,
	"event_type" text NOT NULL,
	"classifier" text DEFAULT 'ACT' NOT NULL,
	"source" text NOT NULL,
	"location_code" text DEFAULT '' NOT NULL,
	"location_name" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"external_id" text DEFAULT '' NOT NULL,
	"confirmed" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_vessels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"leg_sequence" integer DEFAULT 1 NOT NULL,
	"vessel_name" text NOT NULL,
	"imo" text DEFAULT '' NOT NULL,
	"mmsi" text DEFAULT '' NOT NULL,
	"voyage" text DEFAULT '' NOT NULL,
	"load_port" text DEFAULT '' NOT NULL,
	"discharge_port" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"carrier_code" text DEFAULT '' NOT NULL,
	"carrier_name" text DEFAULT '' NOT NULL,
	"booking_number" text DEFAULT '' NOT NULL,
	"bl_number" text DEFAULT '' NOT NULL,
	"origin_port" text NOT NULL,
	"destination_port" text NOT NULL,
	"transshipment_ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"incoterm" text DEFAULT 'FOB' NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"etd" timestamp with time zone,
	"atd" timestamp with time zone,
	"eta" timestamp with time zone,
	"ata" timestamp with time zone,
	"last_tracked_at" timestamp with time zone,
	"tracking_error" text,
	"customs_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vessel_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_vessel_id" uuid NOT NULL,
	"mmsi" text NOT NULL,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"speed_knots" real,
	"course_deg" real,
	"heading_deg" real,
	"nav_status" text,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"success" boolean NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'DISCONNECTED' NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"circuit_open_until" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_id" uuid,
	"actor_role" text DEFAULT '' NOT NULL,
	"impersonator_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"request_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"html" text NOT NULL,
	"css" text DEFAULT '' NOT NULL,
	"default_clauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_legal_review" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"locale" text DEFAULT 'ko' NOT NULL,
	"name" text NOT NULL,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"project_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"template_version_id" uuid,
	"file_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"renderer" text NOT NULL,
	"customer_visible" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"locale" text DEFAULT 'ko' NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger" text,
	"project_id" uuid,
	"to_address" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"dedupe_key" text,
	"direction" text DEFAULT 'OUTBOUND' NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"bucket" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"purpose" text NOT NULL,
	"scan_status" text DEFAULT 'PENDING' NOT NULL,
	"scan_detail" text DEFAULT '' NOT NULL,
	"is_public_asset" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"result" jsonb,
	"dedupe_key" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"predicted" jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"confidence" real,
	"human_value" jsonb,
	"human_by" uuid,
	"human_at" timestamp with time zone,
	"actual_value" jsonb,
	"actual_at" timestamp with time zone,
	"approved_for_training" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channels" jsonb DEFAULT '["WEB","EMAIL"]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"channels" jsonb DEFAULT '["WEB"]'::jsonb NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"scope" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"original" jsonb,
	"changed" jsonb,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_type" text NOT NULL,
	"policy_version" integer NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"backend" text DEFAULT 'BUILTIN' NOT NULL,
	"external_ref" text DEFAULT '' NOT NULL,
	"ciphertext" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"last4" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rotated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret_ref" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"project_id" uuid,
	"current_step" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"waiting_for" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "config_versions_uq" ON "config_versions" USING btree ("tenant_id","section","version");--> statement-breakpoint
CREATE INDEX "config_versions_status_idx" ON "config_versions" USING btree ("tenant_id","section","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_uq" ON "feature_flags" USING btree ("tenant_id","module");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_uq" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_domains_hostname_uq" ON "tenant_domains" USING btree ("hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_uq" ON "usage_counters" USING btree ("tenant_id","metric","period");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_uq" ON "user_roles" USING btree ("user_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_uq" ON "users" USING btree ("tenant_id","email") WHERE "users"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_platform_email_uq" ON "users" USING btree ("email") WHERE "users"."tenant_id" is null;--> statement-breakpoint
CREATE INDEX "companies_tenant_name_idx" ON "companies" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "fx_rates_pair_idx" ON "fx_rates" USING btree ("base","quote","rate_date");--> statement-breakpoint
CREATE INDEX "listing_price_history_idx" ON "listing_price_history" USING btree ("tenant_id","listing_id","observed_at");--> statement-breakpoint
CREATE INDEX "market_listings_req_idx" ON "market_listings" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "market_listings_ext_idx" ON "market_listings" USING btree ("tenant_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "market_price_history_idx" ON "market_price_history" USING btree ("tenant_id","platform","external_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_embeddings_owner_uq" ON "product_embeddings" USING btree ("owner_type","owner_id","model");--> statement-breakpoint
CREATE INDEX "product_images_sha_idx" ON "product_images" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX "product_images_phash_idx" ON "product_images" USING btree ("tenant_id","phash");--> statement-breakpoint
CREATE INDEX "products_project_idx" ON "products" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_candidates_uq" ON "request_candidates" USING btree ("request_id","listing_id");--> statement-breakpoint
CREATE INDEX "request_candidates_req_idx" ON "request_candidates" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "search_events_query_idx" ON "search_events" USING btree ("tenant_id","normalized_query");--> statement-breakpoint
CREATE INDEX "listings_supplier_idx" ON "source_listings" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_external_uq" ON "source_listings" USING btree ("tenant_id","connector","external_id") WHERE "source_listings"."external_id" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "projects_code_uq" ON "sourcing_projects" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "projects_stage_idx" ON "sourcing_projects" USING btree ("tenant_id","stage");--> statement-breakpoint
CREATE INDEX "requests_project_idx" ON "sourcing_requests" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "requests_created_idx" ON "sourcing_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_events_supplier_idx" ON "supplier_events" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_name_idx" ON "suppliers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_checks_uq" ON "compliance_checks" USING btree ("product_id","regulation_id");--> statement-breakpoint
CREATE INDEX "compliance_checks_product_idx" ON "compliance_checks" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "cost_calculations_project_idx" ON "cost_calculations" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "freight_quotes_project_idx" ON "freight_quotes" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "freight_rates_lane_idx" ON "freight_rates" USING btree ("tenant_id","mode","origin","destination");--> statement-breakpoint
CREATE UNIQUE INDEX "hs_classifications_product_uq" ON "hs_classifications" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "hs_codes_code_idx" ON "hs_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "margin_rule_sets_uq" ON "margin_rule_sets" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE INDEX "partner_tasks_user_idx" ON "partner_tasks" USING btree ("tenant_id","partner_user_id","status");--> statement-breakpoint
CREATE INDEX "pricing_snapshots_project_idx" ON "pricing_snapshots" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regulation_versions_uq" ON "regulation_versions" USING btree ("regulation_id","version");--> statement-breakpoint
CREATE INDEX "tariff_rates_hs_idx" ON "tariff_rates" USING btree ("hs_code","rate_type");--> statement-breakpoint
CREATE INDEX "approvals_entity_idx" ON "approvals" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_versions_uq" ON "contract_versions" USING btree ("contract_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_number_uq" ON "contracts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("tenant_id","type","number");--> statement-breakpoint
CREATE INDEX "invoices_project_idx" ON "invoices" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "payments_project_idx" ON "payments" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_versions_uq" ON "quotation_versions" USING btree ("quotation_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_number_uq" ON "quotations" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "quotations_project_idx" ON "quotations" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "shipment_etas_idx" ON "shipment_etas" USING btree ("tenant_id","shipment_id","computed_at");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("tenant_id","shipment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_code_uq" ON "shipments" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "vessel_positions_idx" ON "vessel_positions" USING btree ("tenant_id","shipment_vessel_id","observed_at");--> statement-breakpoint
CREATE INDEX "ai_usage_tenant_idx" ON "ai_usage" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_idx" ON "analytics_events" USING btree ("tenant_id","name","created_at");--> statement-breakpoint
CREATE INDEX "api_connections_tenant_idx" ON "api_connections" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_uq" ON "document_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_uq" ON "document_templates" USING btree ("tenant_id","kind","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_uq" ON "documents" USING btree ("tenant_id","kind","number","version");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "documents" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_uq" ON "email_templates" USING btree ("tenant_id","trigger","locale","version");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_dedupe_uq" ON "emails" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "emails_project_idx" ON "emails" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "files_sha_idx" ON "files" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_uq" ON "idempotency_keys" USING btree ("tenant_id","key","route");--> statement-breakpoint
CREATE INDEX "jobs_poll_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "model_predictions_kind_idx" ON "model_predictions" USING btree ("tenant_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_uq" ON "notification_preferences" USING btree ("tenant_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("tenant_id","user_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "number_sequences_uq" ON "number_sequences" USING btree ("tenant_id","doc_type","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_uq" ON "policies" USING btree ("tenant_id","type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_name_uq" ON "secrets" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_idx" ON "webhook_deliveries" USING btree ("tenant_id","webhook_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_project_def_uq" ON "workflow_instances" USING btree ("tenant_id","project_id","definition");