--
-- PostgreSQL database dump
--

\restrict GhboKUqFznqkwhkamB1c46bniOml3zZWjH73ur6UjfuD98WEHRhntxz9GdHkfgK

-- Dumped from database version 18.4 (Homebrew)
-- Dumped by pg_dump version 18.4 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pplcrm_owner
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO pplcrm_owner;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: notify_job_inserted(); Type: FUNCTION; Schema: public; Owner: pplcrm_owner
--

CREATE FUNCTION public.notify_job_inserted() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM pg_notify('background_jobs_channel', '');
      RETURN NEW;
    END;
    $$;


ALTER FUNCTION public.notify_job_inserted() OWNER TO pplcrm_owner;

--
-- Name: notify_webhook_event_inserted(); Type: FUNCTION; Schema: public; Owner: pplcrm_owner
--

CREATE FUNCTION public.notify_webhook_event_inserted() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM pg_notify('webhook_events_channel', '');
      RETURN NEW;
    END;
    $$;


ALTER FUNCTION public.notify_webhook_event_inserted() OWNER TO pplcrm_owner;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: pplcrm_owner
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;


ALTER FUNCTION public.set_updated_at() OWNER TO pplcrm_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: authusers; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.authusers (
    id bigint NOT NULL,
    tenant_id bigint,
    verified boolean DEFAULT false,
    role text,
    first_name text,
    last_name text,
    email text NOT NULL,
    password text NOT NULL,
    password_reset_code text,
    password_reset_code_created_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint,
    updatedby_id bigint,
    two_factor_enabled boolean DEFAULT false NOT NULL,
    two_factor_code text,
    two_factor_expires_at timestamp with time zone,
    deletion_scheduled_at timestamp with time zone,
    previous_email text,
    previous_role text,
    passkey_setup_dismissed_at timestamp with time zone,
    two_factor_attempts integer DEFAULT 0 NOT NULL,
    deactivated_at timestamp with time zone,
    CONSTRAINT chk_authusers_role CHECK (((role IS NULL) OR (role = ANY (ARRAY['owner'::text, 'admin'::text, 'user'::text, 'viewer'::text]))))
);

ALTER TABLE ONLY public.authusers FORCE ROW LEVEL SECURITY;


ALTER TABLE public.authusers OWNER TO pplcrm_owner;

--
-- Name: authusers_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.authusers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.authusers_id_seq OWNER TO pplcrm_owner;

--
-- Name: authusers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.authusers_id_seq OWNED BY public.authusers.id;


--
-- Name: background_jobs; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.background_jobs (
    id bigint NOT NULL,
    tenant_id bigint,
    queue text DEFAULT 'default'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    error text,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_background_jobs_status CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.background_jobs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.background_jobs OWNER TO pplcrm_owner;

--
-- Name: background_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.background_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.background_jobs_id_seq OWNER TO pplcrm_owner;

--
-- Name: background_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.background_jobs_id_seq OWNED BY public.background_jobs.id;


--
-- Name: campaign_person_facts; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.campaign_person_facts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    person_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    support_level text,
    support_source text,
    support_recorded_by bigint,
    support_recorded_at timestamp with time zone,
    voting_status text,
    voting_source text,
    voting_recorded_by bigint,
    voting_recorded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_cpf_support_level CHECK (((support_level IS NULL) OR (support_level = ANY (ARRAY['strong'::text, 'leaning'::text, 'neutral'::text, 'leaning_against'::text, 'against'::text, 'undecided'::text])))),
    CONSTRAINT chk_cpf_support_source CHECK (((support_source IS NULL) OR (support_source = ANY (ARRAY['manual'::text, 'canvass'::text, 'form'::text, 'import'::text, 'carryover'::text])))),
    CONSTRAINT chk_cpf_voting_source CHECK (((voting_source IS NULL) OR (voting_source = ANY (ARRAY['manual'::text, 'canvass'::text, 'form'::text, 'import'::text])))),
    CONSTRAINT chk_cpf_voting_status CHECK (((voting_status IS NULL) OR (voting_status = ANY (ARRAY['will_vote'::text, 'voted_advance'::text, 'voted_eday'::text, 'not_voting'::text, 'ineligible'::text]))))
);

ALTER TABLE ONLY public.campaign_person_facts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.campaign_person_facts OWNER TO pplcrm_owner;

--
-- Name: campaign_person_facts_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.campaign_person_facts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.campaign_person_facts_id_seq OWNER TO pplcrm_owner;

--
-- Name: campaign_person_facts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.campaign_person_facts_id_seq OWNED BY public.campaign_person_facts.id;


--
-- Name: campaign_subscriptions; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.campaign_subscriptions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    person_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    email text NOT NULL,
    status text DEFAULT 'subscribed'::text NOT NULL,
    consent_source text DEFAULT 'manual'::text NOT NULL,
    consent_at timestamp with time zone,
    unsubscribed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_csub_source CHECK ((consent_source = ANY (ARRAY['form'::text, 'import'::text, 'manual'::text, 'copied'::text]))),
    CONSTRAINT chk_csub_status CHECK ((status = ANY (ARRAY['subscribed'::text, 'pending'::text, 'unsubscribed'::text])))
);

ALTER TABLE ONLY public.campaign_subscriptions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.campaign_subscriptions OWNER TO pplcrm_owner;

--
-- Name: campaign_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.campaign_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.campaign_subscriptions_id_seq OWNER TO pplcrm_owner;

--
-- Name: campaign_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.campaign_subscriptions_id_seq OWNED BY public.campaign_subscriptions.id;


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.campaigns (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    admin_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    notes text,
    startdate date,
    enddate date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updatedby_id bigint,
    kind text DEFAULT 'office'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT chk_campaigns_kind CHECK ((kind = ANY (ARRAY['office'::text, 'election'::text]))),
    CONSTRAINT chk_campaigns_status CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.campaigns FORCE ROW LEVEL SECURITY;


ALTER TABLE public.campaigns OWNER TO pplcrm_owner;

--
-- Name: campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.campaigns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.campaigns_id_seq OWNER TO pplcrm_owner;

--
-- Name: campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.campaigns_id_seq OWNED BY public.campaigns.id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.companies (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    website text,
    email text,
    phone text,
    industry text,
    notes text,
    enrichment jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    file_id bigint,
    search_vector tsvector GENERATED ALWAYS AS (((((setweight(to_tsvector('simple'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(email, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(website, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(phone, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(industry, ''::text)), 'C'::"char"))) STORED,
    slug text
);

ALTER TABLE ONLY public.companies FORCE ROW LEVEL SECURITY;


ALTER TABLE public.companies OWNER TO pplcrm_owner;

--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.companies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.companies_id_seq OWNER TO pplcrm_owner;

--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: data_exports; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.data_exports (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    user_id bigint NOT NULL,
    entity text NOT NULL,
    file_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    row_count integer DEFAULT 0,
    storage_key text,
    columns jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_data_exports_status CHECK (((status IS NULL) OR (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))))
);

ALTER TABLE ONLY public.data_exports FORCE ROW LEVEL SECURITY;


ALTER TABLE public.data_exports OWNER TO pplcrm_owner;

--
-- Name: data_exports_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.data_exports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.data_exports_id_seq OWNER TO pplcrm_owner;

--
-- Name: data_exports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.data_exports_id_seq OWNED BY public.data_exports.id;


--
-- Name: data_imports; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.data_imports (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    file_name text NOT NULL,
    source text DEFAULT 'persons'::text NOT NULL,
    tag_name text,
    tag_id bigint,
    row_count integer DEFAULT 0 NOT NULL,
    inserted_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    households_created integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    error_message text,
    merged_count integer DEFAULT 0 NOT NULL,
    tags_applied jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_file_key text,
    source_file_size bigint,
    skip_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT chk_data_imports_status CHECK (((status IS NULL) OR (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))))
);

ALTER TABLE ONLY public.data_imports FORCE ROW LEVEL SECURITY;


ALTER TABLE public.data_imports OWNER TO pplcrm_owner;

--
-- Name: data_imports_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.data_imports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.data_imports_id_seq OWNER TO pplcrm_owner;

--
-- Name: data_imports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.data_imports_id_seq OWNED BY public.data_imports.id;


--
-- Name: delivery_requests; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.delivery_requests (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    household_id bigint NOT NULL,
    person_id bigint,
    web_form_id uuid,
    source text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    notes text,
    skip_reason text,
    createdby_id bigint NOT NULL,
    updatedby_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT chk_delivery_requests_source CHECK ((source = ANY (ARRAY['web_form'::text, 'manual'::text]))),
    CONSTRAINT chk_delivery_requests_status CHECK ((status = ANY (ARRAY['new'::text, 'approved'::text, 'declined'::text, 'delivered'::text])))
);

ALTER TABLE ONLY public.delivery_requests FORCE ROW LEVEL SECURITY;


ALTER TABLE public.delivery_requests OWNER TO pplcrm_owner;

--
-- Name: delivery_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.delivery_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.delivery_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: delivery_route_stops; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.delivery_route_stops (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    route_id bigint NOT NULL,
    request_id bigint NOT NULL,
    seq integer NOT NULL,
    leg_minutes double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text,
    acted_at timestamp with time zone,
    acted_via text,
    createdby_id bigint NOT NULL,
    updatedby_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_delivery_route_stops_acted_via CHECK (((acted_via IS NULL) OR (acted_via = ANY (ARRAY['volunteer_link'::text, 'staff'::text])))),
    CONSTRAINT chk_delivery_route_stops_status CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'skipped'::text])))
);

ALTER TABLE ONLY public.delivery_route_stops FORCE ROW LEVEL SECURITY;


ALTER TABLE public.delivery_route_stops OWNER TO pplcrm_owner;

--
-- Name: delivery_route_stops_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.delivery_route_stops ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.delivery_route_stops_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: delivery_routes; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.delivery_routes (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    volunteer_person_id bigint,
    start_address text NOT NULL,
    start_lat double precision NOT NULL,
    start_lng double precision NOT NULL,
    est_minutes double precision DEFAULT 0 NOT NULL,
    est_km double precision DEFAULT 0 NOT NULL,
    scheduled_for timestamp with time zone,
    share_token_hash text,
    share_token_expires_at timestamp with time zone,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT chk_delivery_routes_status CHECK ((status = ANY (ARRAY['draft'::text, 'assigned'::text, 'in_progress'::text, 'completed'::text, 'canceled'::text])))
);

ALTER TABLE ONLY public.delivery_routes FORCE ROW LEVEL SECURITY;


ALTER TABLE public.delivery_routes OWNER TO pplcrm_owner;

--
-- Name: delivery_routes_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.delivery_routes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.delivery_routes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: dismissed_duplicate_groups; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.dismissed_duplicate_groups (
    tenant_id bigint NOT NULL,
    group_key text NOT NULL,
    dismissed_by_id bigint NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.dismissed_duplicate_groups FORCE ROW LEVEL SECURITY;


ALTER TABLE public.dismissed_duplicate_groups OWNER TO pplcrm_owner;

--
-- Name: donation_periods; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.donation_periods (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    limit_amount integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT donation_periods_dates_check CHECK (((end_date IS NULL) OR (end_date > start_date))),
    CONSTRAINT donation_periods_limit_check CHECK ((limit_amount > 0))
);

ALTER TABLE ONLY public.donation_periods FORCE ROW LEVEL SECURITY;


ALTER TABLE public.donation_periods OWNER TO pplcrm_owner;

--
-- Name: donation_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.donation_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.donation_periods_id_seq OWNER TO pplcrm_owner;

--
-- Name: donation_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.donation_periods_id_seq OWNED BY public.donation_periods.id;


--
-- Name: donation_pledges; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.donation_pledges (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    person_id bigint,
    stripe_subscription_id text,
    stripe_customer_id text,
    monthly_amount integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    next_billing_date date,
    first_name text,
    last_name text,
    email text,
    state text,
    country text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT donation_pledges_status_check CHECK ((status = ANY (ARRAY['active'::text, 'past_due'::text, 'cancelled'::text, 'unpaid'::text])))
);

ALTER TABLE ONLY public.donation_pledges FORCE ROW LEVEL SECURITY;


ALTER TABLE public.donation_pledges OWNER TO pplcrm_owner;

--
-- Name: donation_pledges_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.donation_pledges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.donation_pledges_id_seq OWNER TO pplcrm_owner;

--
-- Name: donation_pledges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.donation_pledges_id_seq OWNED BY public.donation_pledges.id;


--
-- Name: donations; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.donations (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    person_id bigint,
    amount integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    stripe_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    first_name text,
    last_name text,
    email text,
    street text,
    apt text,
    city text,
    state text,
    zip text,
    country text,
    pledge_id bigint,
    method text DEFAULT 'card'::text NOT NULL,
    receipt_sent boolean DEFAULT true NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT chk_donations_method CHECK ((method = ANY (ARRAY['card'::text, 'check'::text, 'cash'::text, 'bank_transfer'::text])))
);

ALTER TABLE ONLY public.donations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.donations OWNER TO pplcrm_owner;

--
-- Name: donations_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.donations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.donations_id_seq OWNER TO pplcrm_owner;

--
-- Name: donations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.donations_id_seq OWNED BY public.donations.id;


--
-- Name: email_attachments; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_attachments (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    email_id bigint NOT NULL,
    filename text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    cid text,
    is_inline boolean DEFAULT false NOT NULL,
    pos integer DEFAULT 0 NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    file_id bigint
);

ALTER TABLE ONLY public.email_attachments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_attachments OWNER TO pplcrm_owner;

--
-- Name: email_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_attachments_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_attachments_id_seq OWNED BY public.email_attachments.id;


--
-- Name: email_bodies; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_bodies (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    email_id bigint NOT NULL,
    body_html text NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_bodies FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_bodies OWNER TO pplcrm_owner;

--
-- Name: email_bodies_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_bodies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_bodies_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_bodies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_bodies_id_seq OWNED BY public.email_bodies.id;


--
-- Name: email_comments; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_comments (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    email_id bigint NOT NULL,
    author_id bigint NOT NULL,
    comment text NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_comments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_comments OWNER TO pplcrm_owner;

--
-- Name: email_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_comments_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_comments_id_seq OWNED BY public.email_comments.id;


--
-- Name: email_drafts; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_drafts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    user_id bigint NOT NULL,
    thread_id text,
    to_list jsonb,
    cc_list jsonb,
    bcc_list jsonb,
    subject text,
    body_html text,
    body_delta jsonb,
    meta jsonb,
    is_locked boolean DEFAULT false NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id bigint NOT NULL
);

ALTER TABLE ONLY public.email_drafts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_drafts OWNER TO pplcrm_owner;

--
-- Name: email_drafts_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_drafts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_drafts_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_drafts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_drafts_id_seq OWNED BY public.email_drafts.id;


--
-- Name: email_headers; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_headers (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    email_id bigint NOT NULL,
    headers_json jsonb,
    raw_headers text,
    date_sent timestamp with time zone,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_headers FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_headers OWNER TO pplcrm_owner;

--
-- Name: email_headers_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_headers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_headers_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_headers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_headers_id_seq OWNED BY public.email_headers.id;


--
-- Name: email_read_states; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_read_states (
    tenant_id bigint NOT NULL,
    user_id bigint NOT NULL,
    email_id bigint NOT NULL,
    is_read boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_read_states FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_read_states OWNER TO pplcrm_owner;

--
-- Name: email_recipients; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_recipients (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    email_id bigint NOT NULL,
    kind text NOT NULL,
    name text,
    email text NOT NULL,
    pos integer DEFAULT 0 NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_recipients_kind_check CHECK ((kind = ANY (ARRAY['to'::text, 'cc'::text, 'bcc'::text])))
);

ALTER TABLE ONLY public.email_recipients FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_recipients OWNER TO pplcrm_owner;

--
-- Name: email_recipients_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_recipients_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_recipients_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_recipients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_recipients_id_seq OWNED BY public.email_recipients.id;


--
-- Name: email_suppressions; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_suppressions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    email text NOT NULL,
    reason text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_esup_reason CHECK ((reason = ANY (ARRAY['hard_bounce'::text, 'spam_complaint'::text, 'manual'::text])))
);

ALTER TABLE ONLY public.email_suppressions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_suppressions OWNER TO pplcrm_owner;

--
-- Name: email_suppressions_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_suppressions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_suppressions_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_suppressions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_suppressions_id_seq OWNED BY public.email_suppressions.id;


--
-- Name: email_trash; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.email_trash (
    tenant_id bigint NOT NULL,
    email_id bigint NOT NULL,
    from_folder_id bigint NOT NULL,
    trashed_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint,
    updatedby_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL,
    CONSTRAINT chk_email_trash_from_folder_id CHECK ((from_folder_id = ANY (ARRAY[(3)::bigint, (4)::bigint, (5)::bigint, (7)::bigint, (10)::bigint, (11)::bigint])))
);

ALTER TABLE ONLY public.email_trash FORCE ROW LEVEL SECURITY;


ALTER TABLE public.email_trash OWNER TO pplcrm_owner;

--
-- Name: email_trash_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.email_trash_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_trash_id_seq OWNER TO pplcrm_owner;

--
-- Name: email_trash_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.email_trash_id_seq OWNED BY public.email_trash.id;


--
-- Name: emails; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.emails (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    folder_id bigint NOT NULL,
    from_email text,
    to_email text,
    subject text,
    preview text,
    assigned_to bigint,
    is_favourite boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    status text DEFAULT 'open'::text,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT chk_emails_folder_id CHECK ((folder_id = ANY (ARRAY[(3)::bigint, (4)::bigint, (5)::bigint, (7)::bigint, (10)::bigint, (11)::bigint]))),
    CONSTRAINT chk_emails_status CHECK (((status IS NULL) OR (status = ANY (ARRAY['open'::text, 'closed'::text]))))
);

ALTER TABLE ONLY public.emails FORCE ROW LEVEL SECURITY;


ALTER TABLE public.emails OWNER TO pplcrm_owner;

--
-- Name: emails_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.emails_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.emails_id_seq OWNER TO pplcrm_owner;

--
-- Name: emails_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.emails_id_seq OWNED BY public.emails.id;


--
-- Name: event_registrations; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.event_registrations (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    event_id bigint NOT NULL,
    person_id bigint NOT NULL,
    ticket_type_id bigint,
    status text DEFAULT 'registered'::text NOT NULL,
    checked_in_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    CONSTRAINT event_registrations_status_check CHECK ((status = ANY (ARRAY['registered'::text, 'attended'::text, 'no_show'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.event_registrations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.event_registrations OWNER TO pplcrm_owner;

--
-- Name: event_registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.event_registrations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.event_registrations_id_seq OWNER TO pplcrm_owner;

--
-- Name: event_registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.event_registrations_id_seq OWNED BY public.event_registrations.id;


--
-- Name: event_ticket_types; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.event_ticket_types (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    event_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    price_cents integer DEFAULT 0 NOT NULL,
    capacity integer,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    CONSTRAINT event_ticket_types_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0))),
    CONSTRAINT event_ticket_types_price_check CHECK ((price_cents >= 0))
);

ALTER TABLE ONLY public.event_ticket_types FORCE ROW LEVEL SECURITY;


ALTER TABLE public.event_ticket_types OWNER TO pplcrm_owner;

--
-- Name: event_ticket_types_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.event_ticket_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.event_ticket_types_id_seq OWNER TO pplcrm_owner;

--
-- Name: event_ticket_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.event_ticket_types_id_seq OWNED BY public.event_ticket_types.id;


--
-- Name: events; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    location_address text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    capacity integer,
    contact_email text,
    contact_phone text,
    slug text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    send_reminder boolean DEFAULT true NOT NULL,
    send_registration_confirmation boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(location_address, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'C'::"char"))) STORED,
    fields jsonb DEFAULT '["first_name", "last_name", "email", "mobile", "notes"]'::jsonb NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT events_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0))),
    CONSTRAINT events_end_after_start_check CHECK ((end_time > start_time))
);

ALTER TABLE ONLY public.events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.events OWNER TO pplcrm_owner;

--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.events_id_seq OWNER TO pplcrm_owner;

--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: files; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.files (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    filename text NOT NULL,
    mime_type text,
    size_bytes bigint,
    storage_key text NOT NULL,
    sha256_hex text,
    uploaded_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_type text,
    entity_id bigint
);

ALTER TABLE ONLY public.files FORCE ROW LEVEL SECURITY;


ALTER TABLE public.files OWNER TO pplcrm_owner;

--
-- Name: files_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.files_id_seq OWNER TO pplcrm_owner;

--
-- Name: files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.files_id_seq OWNED BY public.files.id;


--
-- Name: form_submissions; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.form_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id bigint NOT NULL,
    form_id uuid NOT NULL,
    person_id bigint NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.form_submissions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.form_submissions OWNER TO pplcrm_owner;

--
-- Name: google_oauth_tokens; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.google_oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id bigint NOT NULL,
    user_id text,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    google_email text,
    delta_link text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sync_error text,
    last_sync_error_at timestamp with time zone,
    campaign_id bigint NOT NULL
);

ALTER TABLE ONLY public.google_oauth_tokens FORCE ROW LEVEL SECURITY;


ALTER TABLE public.google_oauth_tokens OWNER TO pplcrm_owner;

--
-- Name: households; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.households (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    campaign_id bigint,
    createdby_id bigint NOT NULL,
    file_id bigint,
    home_phone text,
    apt text,
    street_num text,
    street1 text,
    street2 text,
    city text,
    state text,
    zip text,
    country text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    address_fp_street text,
    address_fp_full text,
    is_placeholder boolean DEFAULT false NOT NULL,
    updatedby_id bigint,
    lat double precision,
    lng double precision,
    formatted_address text,
    type text,
    district text,
    precinct text,
    ward text,
    geocoding_status text DEFAULT 'pending'::text,
    search_vector tsvector GENERATED ALWAYS AS ((((((((((setweight(to_tsvector('simple'::regconfig, COALESCE(street1, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(city, ''::text)), 'A'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(address_fp_full, ''::text)), 'A'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(zip, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(state, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(home_phone, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(street_num, ''::text)), 'C'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(apt, ''::text)), 'C'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(street2, ''::text)), 'C'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(country, ''::text)), 'C'::"char"))) STORED,
    slug text,
    CONSTRAINT chk_households_geocoding_status CHECK (((geocoding_status IS NULL) OR (geocoding_status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text]))))
);

ALTER TABLE ONLY public.households FORCE ROW LEVEL SECURITY;


ALTER TABLE public.households OWNER TO pplcrm_owner;

--
-- Name: households_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.households_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.households_id_seq OWNER TO pplcrm_owner;

--
-- Name: households_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.households_id_seq OWNED BY public.households.id;


--
-- Name: kysely_migration; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.kysely_migration (
    name character varying(255) NOT NULL,
    "timestamp" character varying(255) NOT NULL
);


ALTER TABLE public.kysely_migration OWNER TO pplcrm_owner;

--
-- Name: kysely_migration_lock; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.kysely_migration_lock (
    id character varying(255) NOT NULL,
    is_locked integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.kysely_migration_lock OWNER TO pplcrm_owner;

--
-- Name: lists; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.lists (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    object text NOT NULL,
    is_dynamic boolean DEFAULT false NOT NULL,
    definition jsonb,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_refreshed_at timestamp with time zone,
    status text DEFAULT 'idle'::text NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT chk_lists_status CHECK ((status = ANY (ARRAY['idle'::text, 'refreshing'::text, 'failed'::text]))),
    CONSTRAINT lists_object_check CHECK ((object = ANY (ARRAY['people'::text, 'households'::text])))
);

ALTER TABLE ONLY public.lists FORCE ROW LEVEL SECURITY;


ALTER TABLE public.lists OWNER TO pplcrm_owner;

--
-- Name: lists_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.lists_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lists_id_seq OWNER TO pplcrm_owner;

--
-- Name: lists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.lists_id_seq OWNED BY public.lists.id;


--
-- Name: map_campaigns_users; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_campaigns_users (
    tenant_id bigint NOT NULL,
    campaign_id bigint NOT NULL,
    user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_campaigns_users FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_campaigns_users OWNER TO pplcrm_owner;

--
-- Name: map_households_tags; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_households_tags (
    tenant_id bigint NOT NULL,
    household_id bigint NOT NULL,
    tag_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_households_tags FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_households_tags OWNER TO pplcrm_owner;

--
-- Name: map_lists_households; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_lists_households (
    tenant_id bigint NOT NULL,
    list_id bigint NOT NULL,
    household_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_lists_households FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_lists_households OWNER TO pplcrm_owner;

--
-- Name: map_lists_persons; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_lists_persons (
    tenant_id bigint NOT NULL,
    list_id bigint NOT NULL,
    person_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_lists_persons FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_lists_persons OWNER TO pplcrm_owner;

--
-- Name: map_newsletters_lists; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_newsletters_lists (
    tenant_id bigint NOT NULL,
    newsletter_id bigint NOT NULL,
    list_id bigint NOT NULL,
    mode text DEFAULT 'include'::text NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_map_newsletters_lists_mode CHECK ((mode = ANY (ARRAY['include'::text, 'exclude'::text])))
);

ALTER TABLE ONLY public.map_newsletters_lists FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_newsletters_lists OWNER TO pplcrm_owner;

--
-- Name: map_peoples_tags; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_peoples_tags (
    tenant_id bigint NOT NULL,
    person_id bigint NOT NULL,
    tag_id bigint NOT NULL,
    deletable boolean DEFAULT true NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_peoples_tags FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_peoples_tags OWNER TO pplcrm_owner;

--
-- Name: map_teams_lists; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_teams_lists (
    tenant_id bigint NOT NULL,
    team_id bigint NOT NULL,
    list_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_teams_lists FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_teams_lists OWNER TO pplcrm_owner;

--
-- Name: map_teams_persons; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_teams_persons (
    tenant_id bigint NOT NULL,
    team_id bigint NOT NULL,
    person_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_teams_persons FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_teams_persons OWNER TO pplcrm_owner;

--
-- Name: map_web_forms_lists; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.map_web_forms_lists (
    tenant_id bigint NOT NULL,
    web_form_id uuid NOT NULL,
    list_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.map_web_forms_lists FORCE ROW LEVEL SECURITY;


ALTER TABLE public.map_web_forms_lists OWNER TO pplcrm_owner;

--
-- Name: ms_oauth_tokens; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.ms_oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id bigint NOT NULL,
    user_id text,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ms_email text,
    delta_link text,
    synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sync_error text,
    last_sync_error_at timestamp with time zone,
    campaign_id bigint NOT NULL
);

ALTER TABLE ONLY public.ms_oauth_tokens FORCE ROW LEVEL SECURITY;


ALTER TABLE public.ms_oauth_tokens OWNER TO pplcrm_owner;

--
-- Name: newsletter_events; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.newsletter_events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    newsletter_id bigint NOT NULL,
    email text NOT NULL,
    event_type text NOT NULL,
    sg_event_id text NOT NULL,
    sg_message_id text,
    url text,
    ip text,
    user_agent text,
    "timestamp" timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    bounce_type text
);

ALTER TABLE ONLY public.newsletter_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.newsletter_events OWNER TO pplcrm_owner;

--
-- Name: newsletter_events_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.newsletter_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.newsletter_events_id_seq OWNER TO pplcrm_owner;

--
-- Name: newsletter_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.newsletter_events_id_seq OWNED BY public.newsletter_events.id;


--
-- Name: newsletters; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.newsletters (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    subject text,
    preview_text text,
    audience_description text,
    target_lists jsonb,
    segments jsonb,
    total_recipients integer DEFAULT 0 NOT NULL,
    delivered_count integer DEFAULT 0 NOT NULL,
    bounce_count integer DEFAULT 0 NOT NULL,
    open_rate numeric DEFAULT 0 NOT NULL,
    click_rate numeric DEFAULT 0 NOT NULL,
    unique_opens integer DEFAULT 0 NOT NULL,
    unique_clicks integer DEFAULT 0 NOT NULL,
    unsubscribe_count integer DEFAULT 0 NOT NULL,
    spam_complaint_count integer DEFAULT 0 NOT NULL,
    reply_count integer DEFAULT 0 NOT NULL,
    send_date timestamp with time zone,
    last_engagement_at timestamp with time zone,
    summary text,
    html_content text,
    plain_text_content text,
    top_links jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id bigint NOT NULL,
    CONSTRAINT chk_newsletters_click_rate_range CHECK (((click_rate >= (0)::numeric) AND (click_rate <= (100)::numeric))),
    CONSTRAINT chk_newsletters_open_rate_range CHECK (((open_rate >= (0)::numeric) AND (open_rate <= (100)::numeric)))
);

ALTER TABLE ONLY public.newsletters FORCE ROW LEVEL SECURITY;


ALTER TABLE public.newsletters OWNER TO pplcrm_owner;

--
-- Name: newsletters_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.newsletters_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.newsletters_id_seq OWNER TO pplcrm_owner;

--
-- Name: newsletters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.newsletters_id_seq OWNED BY public.newsletters.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    user_id bigint NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    link text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


ALTER TABLE public.notifications OWNER TO pplcrm_owner;

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notifications_id_seq OWNER TO pplcrm_owner;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: passkeys; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.passkeys (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    device_type text NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    transports text[],
    aaguid text,
    friendly_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.passkeys FORCE ROW LEVEL SECURITY;


ALTER TABLE public.passkeys OWNER TO pplcrm_owner;

--
-- Name: passkeys_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.passkeys ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.passkeys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: person_connections; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.person_connections (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    from_person_id bigint NOT NULL,
    to_person_id bigint NOT NULL,
    relation_type text NOT NULL,
    custom_label text,
    is_mutual boolean DEFAULT false NOT NULL,
    notes text,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pc_custom_label_required CHECK (((relation_type <> 'custom'::text) OR ((custom_label IS NOT NULL) AND (custom_label <> ''::text)))),
    CONSTRAINT pc_no_self_loop CHECK ((from_person_id <> to_person_id)),
    CONSTRAINT pc_relation_type_check CHECK ((relation_type = ANY (ARRAY['referred_by'::text, 'referred_to'::text, 'close_friend'::text, 'family_member'::text, 'spouse'::text, 'colleague'::text, 'org_affiliation'::text, 'introduced_by'::text, 'introduced_to'::text, 'custom'::text])))
);

ALTER TABLE ONLY public.person_connections FORCE ROW LEVEL SECURITY;


ALTER TABLE public.person_connections OWNER TO pplcrm_owner;

--
-- Name: person_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.person_connections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.person_connections_id_seq OWNER TO pplcrm_owner;

--
-- Name: person_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.person_connections_id_seq OWNED BY public.person_connections.id;


--
-- Name: person_newsletter_engagements; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.person_newsletter_engagements (
    tenant_id bigint NOT NULL,
    newsletter_id bigint NOT NULL,
    email text NOT NULL,
    open_count integer DEFAULT 0 NOT NULL,
    click_count integer DEFAULT 0 NOT NULL,
    has_unsubscribed boolean DEFAULT false NOT NULL,
    hard_bounced boolean DEFAULT false NOT NULL,
    soft_bounced boolean DEFAULT false NOT NULL,
    first_opened_at timestamp with time zone,
    last_opened_at timestamp with time zone,
    first_clicked_at timestamp with time zone,
    last_clicked_at timestamp with time zone,
    bounced_at timestamp with time zone,
    unsubscribed_at timestamp with time zone
);

ALTER TABLE ONLY public.person_newsletter_engagements FORCE ROW LEVEL SECURITY;


ALTER TABLE public.person_newsletter_engagements OWNER TO pplcrm_owner;

--
-- Name: persons; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.persons (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    campaign_id bigint,
    createdby_id bigint NOT NULL,
    household_id bigint NOT NULL,
    file_id bigint,
    first_name text,
    middle_names text,
    last_name text,
    home_phone text,
    mobile text,
    email text,
    email2 text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updatedby_id bigint,
    company_id bigint,
    linkedin text,
    twitter text,
    facebook text,
    instagram text,
    assigned_to bigint,
    search_vector tsvector GENERATED ALWAYS AS ((((((setweight(to_tsvector('simple'::regconfig, COALESCE(first_name, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(last_name, ''::text)), 'A'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(email, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(email2, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(mobile, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(home_phone, ''::text)), 'C'::"char"))) STORED,
    preferred_contact text,
    slug text,
    public_id text,
    do_not_contact boolean DEFAULT false NOT NULL,
    do_not_contact_channels text[]
);

ALTER TABLE ONLY public.persons FORCE ROW LEVEL SECURITY;


ALTER TABLE public.persons OWNER TO pplcrm_owner;

--
-- Name: persons_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.persons_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.persons_id_seq OWNER TO pplcrm_owner;

--
-- Name: persons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.persons_id_seq OWNED BY public.persons.id;


--
-- Name: potential_duplicates; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.potential_duplicates (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    group_key text NOT NULL,
    person_id bigint,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    household_id bigint,
    company_id bigint
);

ALTER TABLE ONLY public.potential_duplicates FORCE ROW LEVEL SECURITY;


ALTER TABLE public.potential_duplicates OWNER TO pplcrm_owner;

--
-- Name: potential_duplicates_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.potential_duplicates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.potential_duplicates_id_seq OWNER TO pplcrm_owner;

--
-- Name: potential_duplicates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.potential_duplicates_id_seq OWNED BY public.potential_duplicates.id;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.profiles (
    id bigint NOT NULL,
    tenant_id bigint,
    auth_id bigint NOT NULL,
    middle_names text,
    last_name text,
    home_phone text,
    mobile text,
    email2 text,
    apt text,
    street_num text,
    street1 text,
    street2 text,
    city text,
    state text,
    zip text,
    country text,
    preferences jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    createdby_id bigint,
    updatedby_id bigint,
    avatar_file_id bigint
);

ALTER TABLE ONLY public.profiles FORCE ROW LEVEL SECURITY;


ALTER TABLE public.profiles OWNER TO pplcrm_owner;

--
-- Name: profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.profiles_id_seq OWNER TO pplcrm_owner;

--
-- Name: profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.profiles_id_seq OWNED BY public.profiles.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.sessions (
    id bigint NOT NULL,
    session_id text NOT NULL,
    refresh_token text,
    user_id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_accessed timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text NOT NULL,
    user_agent text,
    status text DEFAULT 'active'::text NOT NULL,
    other_properties jsonb,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone
);

ALTER TABLE ONLY public.sessions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.sessions OWNER TO pplcrm_owner;

--
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sessions_id_seq OWNER TO pplcrm_owner;

--
-- Name: sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.settings (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    createdby_id bigint,
    updatedby_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.settings FORCE ROW LEVEL SECURITY;


ALTER TABLE public.settings OWNER TO pplcrm_owner;

--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.settings_id_seq OWNER TO pplcrm_owner;

--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: tags; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.tags (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    deletable boolean DEFAULT true NOT NULL,
    color character varying(7),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'tag'::text NOT NULL
);

ALTER TABLE ONLY public.tags FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tags OWNER TO pplcrm_owner;

--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.tags_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tags_id_seq OWNER TO pplcrm_owner;

--
-- Name: tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;


--
-- Name: task_attachments; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.task_attachments (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    task_id bigint NOT NULL,
    filename text NOT NULL,
    content_type text,
    size_bytes bigint,
    url text,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.task_attachments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.task_attachments OWNER TO pplcrm_owner;

--
-- Name: task_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.task_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_attachments_id_seq OWNER TO pplcrm_owner;

--
-- Name: task_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.task_attachments_id_seq OWNED BY public.task_attachments.id;


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.task_comments (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    task_id bigint NOT NULL,
    author_id bigint NOT NULL,
    comment text NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.task_comments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.task_comments OWNER TO pplcrm_owner;

--
-- Name: task_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.task_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_comments_id_seq OWNER TO pplcrm_owner;

--
-- Name: task_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.task_comments_id_seq OWNED BY public.task_comments.id;


--
-- Name: task_subtasks; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.task_subtasks (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    task_id bigint NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'todo'::text,
    "position" integer DEFAULT 0,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.task_subtasks FORCE ROW LEVEL SECURITY;


ALTER TABLE public.task_subtasks OWNER TO pplcrm_owner;

--
-- Name: task_subtasks_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.task_subtasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.task_subtasks_id_seq OWNER TO pplcrm_owner;

--
-- Name: task_subtasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.task_subtasks_id_seq OWNED BY public.task_subtasks.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.tasks (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    details text,
    due_at timestamp with time zone,
    status text DEFAULT 'todo'::text,
    priority text,
    assigned_to bigint,
    completed_at timestamp with time zone,
    "position" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    team_id bigint,
    file_id bigint,
    CONSTRAINT chk_tasks_priority CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])))),
    CONSTRAINT chk_tasks_status CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'waiting'::text, 'done'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.tasks FORCE ROW LEVEL SECURITY;


ALTER TABLE public.tasks OWNER TO pplcrm_owner;

--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tasks_id_seq OWNER TO pplcrm_owner;

--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.teams (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    team_captain_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    team_lead_user_id bigint
);

ALTER TABLE ONLY public.teams FORCE ROW LEVEL SECURITY;


ALTER TABLE public.teams OWNER TO pplcrm_owner;

--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.teams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.teams_id_seq OWNER TO pplcrm_owner;

--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.tenants (
    id bigint NOT NULL,
    admin_id bigint,
    createdby_id bigint,
    name text NOT NULL,
    mobile text,
    email text,
    email2 text,
    apt text,
    street_num text,
    street1 text,
    street2 text,
    city text,
    state text,
    zip text,
    country text,
    billing_street_num text,
    billing_street1 text,
    billing_street2 text,
    billing_city text,
    billing_state text,
    billing_zip text,
    billing_country text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    placeholder_household_id bigint,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_plan text DEFAULT 'free'::text NOT NULL,
    subscription_status text,
    subscription_ends_at timestamp with time zone,
    deletion_scheduled_at timestamp with time zone,
    suspended_at timestamp with time zone,
    paused_at timestamp with time zone,
    slug text,
    demo_mode_at timestamp with time zone
);


ALTER TABLE public.tenants OWNER TO pplcrm_owner;

--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.tenants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tenants_id_seq OWNER TO pplcrm_owner;

--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: workspace_api_keys; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.workspace_api_keys (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    key_hash text NOT NULL,
    key_preview text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


ALTER TABLE public.workspace_api_keys OWNER TO pplcrm_owner;

--
-- Name: workspace_api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.workspace_api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.workspace_api_keys_id_seq OWNED BY public.workspace_api_keys.id;

ALTER TABLE ONLY public.workspace_api_keys ALTER COLUMN id SET DEFAULT nextval('public.workspace_api_keys_id_seq'::regclass);


--
-- Name: turf_assignments; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.turf_assignments (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    turf_id bigint NOT NULL,
    team_id bigint,
    token text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.turf_assignments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.turf_assignments OWNER TO pplcrm_owner;

--
-- Name: turf_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.turf_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.turf_assignments_id_seq OWNER TO pplcrm_owner;

--
-- Name: turf_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.turf_assignments_id_seq OWNED BY public.turf_assignments.id;


--
-- Name: turf_households; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.turf_households (
    tenant_id bigint NOT NULL,
    turf_id bigint NOT NULL,
    household_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.turf_households FORCE ROW LEVEL SECURITY;


ALTER TABLE public.turf_households OWNER TO pplcrm_owner;

--
-- Name: turf_knocks; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.turf_knocks (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    turf_id bigint NOT NULL,
    household_id bigint NOT NULL,
    person_id bigint,
    outcome text NOT NULL,
    response text,
    notes text,
    source text DEFAULT 'companion'::text NOT NULL,
    canvasser_name text,
    client_knock_id text,
    knocked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.turf_knocks FORCE ROW LEVEL SECURITY;


ALTER TABLE public.turf_knocks OWNER TO pplcrm_owner;

--
-- Name: turf_knocks_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.turf_knocks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.turf_knocks_id_seq OWNER TO pplcrm_owner;

--
-- Name: turf_knocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.turf_knocks_id_seq OWNED BY public.turf_knocks.id;


--
-- Name: turfs; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.turfs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    list_id bigint,
    target_doors integer,
    centroid_lat double precision,
    centroid_lng double precision,
    ward text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id bigint NOT NULL
);

ALTER TABLE ONLY public.turfs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.turfs OWNER TO pplcrm_owner;

--
-- Name: turfs_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.turfs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.turfs_id_seq OWNER TO pplcrm_owner;

--
-- Name: turfs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.turfs_id_seq OWNED BY public.turfs.id;


--
-- Name: user_activity; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.user_activity (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    user_id bigint NOT NULL,
    activity text NOT NULL,
    entity text NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_id text
);

ALTER TABLE ONLY public.user_activity FORCE ROW LEVEL SECURITY;


ALTER TABLE public.user_activity OWNER TO pplcrm_owner;

--
-- Name: user_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.user_activity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_activity_id_seq OWNER TO pplcrm_owner;

--
-- Name: user_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.user_activity_id_seq OWNED BY public.user_activity.id;


--
-- Name: volunteer_events; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.volunteer_events (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    location_address text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    capacity integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    contact_email text,
    contact_phone text,
    is_private boolean DEFAULT false NOT NULL,
    send_reminder boolean DEFAULT true NOT NULL,
    slug text NOT NULL,
    send_signup_confirmation boolean DEFAULT true NOT NULL,
    send_volunteer_alert boolean DEFAULT true NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS ((((setweight(to_tsvector('simple'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(location_address, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(contact_email, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, COALESCE(description, ''::text)), 'C'::"char"))) STORED,
    fields jsonb DEFAULT '["first_name", "last_name", "email", "mobile", "notes"]'::jsonb NOT NULL
);

ALTER TABLE ONLY public.volunteer_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_events OWNER TO pplcrm_owner;

--
-- Name: volunteer_events_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.volunteer_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.volunteer_events_id_seq OWNER TO pplcrm_owner;

--
-- Name: volunteer_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.volunteer_events_id_seq OWNED BY public.volunteer_events.id;


--
-- Name: volunteer_shifts; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.volunteer_shifts (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    event_id bigint NOT NULL,
    person_id bigint NOT NULL,
    status text DEFAULT 'signed_up'::text NOT NULL,
    hours_worked numeric(5,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_volunteer_shifts_status CHECK ((status = ANY (ARRAY['signed_up'::text, 'attended'::text, 'no_show'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.volunteer_shifts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.volunteer_shifts OWNER TO pplcrm_owner;

--
-- Name: volunteer_shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.volunteer_shifts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.volunteer_shifts_id_seq OWNER TO pplcrm_owner;

--
-- Name: volunteer_shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.volunteer_shifts_id_seq OWNED BY public.volunteer_shifts.id;


--
-- Name: web_forms; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.web_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    redirect_url text,
    target_tags jsonb,
    target_lists jsonb,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fields jsonb,
    send_confirmation boolean DEFAULT true NOT NULL,
    send_alert boolean DEFAULT true NOT NULL,
    form_type text DEFAULT 'standard'::text NOT NULL,
    type text,
    slug text NOT NULL,
    submit_label text,
    thanks_title text,
    thanks_body text,
    confirm_subject text,
    confirm_body text,
    notify_team_on boolean DEFAULT false NOT NULL,
    archived_at timestamp with time zone,
    campaign_id bigint NOT NULL,
    CONSTRAINT chk_web_forms_form_type CHECK (((form_type IS NULL) OR (form_type = ANY (ARRAY['standard'::text, 'donation'::text, 'recurring_donation'::text])))),
    CONSTRAINT chk_web_forms_status CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);

ALTER TABLE ONLY public.web_forms FORCE ROW LEVEL SECURITY;


ALTER TABLE public.web_forms OWNER TO pplcrm_owner;

--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.webhook_events (
    id bigint NOT NULL,
    tenant_id bigint,
    stripe_event_id text NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    error text,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT chk_webhook_events_status CHECK (((status IS NULL) OR (status = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text]))))
);

ALTER TABLE ONLY public.webhook_events FORCE ROW LEVEL SECURITY;


ALTER TABLE public.webhook_events OWNER TO pplcrm_owner;

--
-- Name: webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.webhook_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.webhook_events_id_seq OWNER TO pplcrm_owner;

--
-- Name: webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.webhook_events_id_seq OWNED BY public.webhook_events.id;


--
-- Name: workflow_enrollments; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.workflow_enrollments (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    workflow_id bigint NOT NULL,
    person_id bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_step_number integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workflow_enrollments_status CHECK (((status IS NULL) OR (status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text]))))
);

ALTER TABLE ONLY public.workflow_enrollments FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workflow_enrollments OWNER TO pplcrm_owner;

--
-- Name: workflow_enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.workflow_enrollments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.workflow_enrollments_id_seq OWNER TO pplcrm_owner;

--
-- Name: workflow_enrollments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.workflow_enrollments_id_seq OWNED BY public.workflow_enrollments.id;


--
-- Name: workflow_runs; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.workflow_runs (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    workflow_id bigint NOT NULL,
    enrollment_id bigint,
    person_id bigint,
    step_number integer,
    step_kind text,
    status text DEFAULT 'success'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_workflow_runs_status CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.workflow_runs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workflow_runs OWNER TO pplcrm_owner;

--
-- Name: workflow_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.workflow_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.workflow_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: workflow_steps; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.workflow_steps (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    workflow_id bigint NOT NULL,
    step_number integer NOT NULL,
    delay_days integer NOT NULL,
    subject text,
    preview_text text,
    html_content text,
    plain_text_content text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    delay_unit text DEFAULT 'days'::text NOT NULL,
    kind text DEFAULT 'send_email'::text NOT NULL,
    config jsonb,
    CONSTRAINT chk_workflow_steps_kind CHECK ((kind = ANY (ARRAY['wait'::text, 'send_email'::text, 'add_tag'::text, 'create_task'::text, 'notify_team'::text])))
);

ALTER TABLE ONLY public.workflow_steps FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workflow_steps OWNER TO pplcrm_owner;

--
-- Name: workflow_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.workflow_steps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.workflow_steps_id_seq OWNER TO pplcrm_owner;

--
-- Name: workflow_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.workflow_steps_id_seq OWNED BY public.workflow_steps.id;


--
-- Name: workflows; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.workflows (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    createdby_id bigint NOT NULL,
    updatedby_id bigint NOT NULL,
    name text NOT NULL,
    description text,
    trigger_type text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trigger_event_id text,
    conditions jsonb,
    CONSTRAINT chk_workflows_status CHECK (((status IS NULL) OR (status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text]))))
);

ALTER TABLE ONLY public.workflows FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workflows OWNER TO pplcrm_owner;

--
-- Name: workflows_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

CREATE SEQUENCE public.workflows_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.workflows_id_seq OWNER TO pplcrm_owner;

--
-- Name: workflows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: pplcrm_owner
--

ALTER SEQUENCE public.workflows_id_seq OWNED BY public.workflows.id;


--
-- Name: zapier_subscriptions; Type: TABLE; Schema: public; Owner: pplcrm_owner
--

CREATE TABLE public.zapier_subscriptions (
    id bigint NOT NULL,
    tenant_id bigint NOT NULL,
    event_type text NOT NULL,
    webhook_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.zapier_subscriptions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.zapier_subscriptions OWNER TO pplcrm_owner;

--
-- Name: zapier_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.zapier_subscriptions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.zapier_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: authusers id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.authusers ALTER COLUMN id SET DEFAULT nextval('public.authusers_id_seq'::regclass);


--
-- Name: background_jobs id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.background_jobs ALTER COLUMN id SET DEFAULT nextval('public.background_jobs_id_seq'::regclass);


--
-- Name: campaign_person_facts id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts ALTER COLUMN id SET DEFAULT nextval('public.campaign_person_facts_id_seq'::regclass);


--
-- Name: campaign_subscriptions id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.campaign_subscriptions_id_seq'::regclass);


--
-- Name: campaigns id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaigns ALTER COLUMN id SET DEFAULT nextval('public.campaigns_id_seq'::regclass);


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: data_exports id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_exports ALTER COLUMN id SET DEFAULT nextval('public.data_exports_id_seq'::regclass);


--
-- Name: data_imports id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_imports ALTER COLUMN id SET DEFAULT nextval('public.data_imports_id_seq'::regclass);


--
-- Name: donation_periods id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_periods ALTER COLUMN id SET DEFAULT nextval('public.donation_periods_id_seq'::regclass);


--
-- Name: donation_pledges id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_pledges ALTER COLUMN id SET DEFAULT nextval('public.donation_pledges_id_seq'::regclass);


--
-- Name: donations id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations ALTER COLUMN id SET DEFAULT nextval('public.donations_id_seq'::regclass);


--
-- Name: email_attachments id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_attachments ALTER COLUMN id SET DEFAULT nextval('public.email_attachments_id_seq'::regclass);


--
-- Name: email_bodies id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_bodies ALTER COLUMN id SET DEFAULT nextval('public.email_bodies_id_seq'::regclass);


--
-- Name: email_comments id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_comments ALTER COLUMN id SET DEFAULT nextval('public.email_comments_id_seq'::regclass);


--
-- Name: email_drafts id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_drafts ALTER COLUMN id SET DEFAULT nextval('public.email_drafts_id_seq'::regclass);


--
-- Name: email_headers id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_headers ALTER COLUMN id SET DEFAULT nextval('public.email_headers_id_seq'::regclass);


--
-- Name: email_recipients id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_recipients ALTER COLUMN id SET DEFAULT nextval('public.email_recipients_id_seq'::regclass);


--
-- Name: email_suppressions id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_suppressions ALTER COLUMN id SET DEFAULT nextval('public.email_suppressions_id_seq'::regclass);


--
-- Name: email_trash id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_trash ALTER COLUMN id SET DEFAULT nextval('public.email_trash_id_seq'::regclass);


--
-- Name: emails id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.emails ALTER COLUMN id SET DEFAULT nextval('public.emails_id_seq'::regclass);


--
-- Name: event_registrations id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_registrations ALTER COLUMN id SET DEFAULT nextval('public.event_registrations_id_seq'::regclass);


--
-- Name: event_ticket_types id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_ticket_types ALTER COLUMN id SET DEFAULT nextval('public.event_ticket_types_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: files id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.files ALTER COLUMN id SET DEFAULT nextval('public.files_id_seq'::regclass);


--
-- Name: households id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.households ALTER COLUMN id SET DEFAULT nextval('public.households_id_seq'::regclass);


--
-- Name: lists id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.lists ALTER COLUMN id SET DEFAULT nextval('public.lists_id_seq'::regclass);


--
-- Name: newsletter_events id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletter_events ALTER COLUMN id SET DEFAULT nextval('public.newsletter_events_id_seq'::regclass);


--
-- Name: newsletters id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletters ALTER COLUMN id SET DEFAULT nextval('public.newsletters_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: person_connections id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.person_connections ALTER COLUMN id SET DEFAULT nextval('public.person_connections_id_seq'::regclass);


--
-- Name: persons id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons ALTER COLUMN id SET DEFAULT nextval('public.persons_id_seq'::regclass);


--
-- Name: potential_duplicates id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.potential_duplicates ALTER COLUMN id SET DEFAULT nextval('public.potential_duplicates_id_seq'::regclass);


--
-- Name: profiles id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles ALTER COLUMN id SET DEFAULT nextval('public.profiles_id_seq'::regclass);


--
-- Name: sessions id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: tags id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);


--
-- Name: task_attachments id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_attachments ALTER COLUMN id SET DEFAULT nextval('public.task_attachments_id_seq'::regclass);


--
-- Name: task_comments id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_comments ALTER COLUMN id SET DEFAULT nextval('public.task_comments_id_seq'::regclass);


--
-- Name: task_subtasks id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_subtasks ALTER COLUMN id SET DEFAULT nextval('public.task_subtasks_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: turf_assignments id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments ALTER COLUMN id SET DEFAULT nextval('public.turf_assignments_id_seq'::regclass);


--
-- Name: turf_knocks id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks ALTER COLUMN id SET DEFAULT nextval('public.turf_knocks_id_seq'::regclass);


--
-- Name: turfs id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs ALTER COLUMN id SET DEFAULT nextval('public.turfs_id_seq'::regclass);


--
-- Name: user_activity id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.user_activity ALTER COLUMN id SET DEFAULT nextval('public.user_activity_id_seq'::regclass);


--
-- Name: volunteer_events id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_events ALTER COLUMN id SET DEFAULT nextval('public.volunteer_events_id_seq'::regclass);


--
-- Name: volunteer_shifts id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts ALTER COLUMN id SET DEFAULT nextval('public.volunteer_shifts_id_seq'::regclass);


--
-- Name: webhook_events id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.webhook_events ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_id_seq'::regclass);


--
-- Name: workflow_enrollments id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_enrollments ALTER COLUMN id SET DEFAULT nextval('public.workflow_enrollments_id_seq'::regclass);


--
-- Name: workflow_steps id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_steps ALTER COLUMN id SET DEFAULT nextval('public.workflow_steps_id_seq'::regclass);


--
-- Name: workflows id; Type: DEFAULT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflows ALTER COLUMN id SET DEFAULT nextval('public.workflows_id_seq'::regclass);


--
-- Name: authusers authusers_email_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.authusers
    ADD CONSTRAINT authusers_email_key UNIQUE (email);


--
-- Name: authusers authusers_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.authusers
    ADD CONSTRAINT authusers_pkey PRIMARY KEY (id);


--
-- Name: background_jobs background_jobs_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.background_jobs
    ADD CONSTRAINT background_jobs_pk PRIMARY KEY (id);


--
-- Name: campaign_person_facts campaign_person_facts_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT campaign_person_facts_id_key UNIQUE (id);


--
-- Name: campaign_person_facts campaign_person_facts_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT campaign_person_facts_pk PRIMARY KEY (id, tenant_id);


--
-- Name: campaign_subscriptions campaign_subscriptions_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT campaign_subscriptions_id_key UNIQUE (id);


--
-- Name: campaign_subscriptions campaign_subscriptions_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT campaign_subscriptions_pk PRIMARY KEY (id, tenant_id);


--
-- Name: campaigns campaigns_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_id_key UNIQUE (id);


--
-- Name: campaigns campaigns_id_tenantid; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_id_tenantid PRIMARY KEY (id, tenant_id);


--
-- Name: companies companies_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_id_key UNIQUE (id);


--
-- Name: companies companies_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pk PRIMARY KEY (id, tenant_id);


--
-- Name: data_exports data_exports_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_exports
    ADD CONSTRAINT data_exports_id_key UNIQUE (id);


--
-- Name: data_exports data_exports_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_exports
    ADD CONSTRAINT data_exports_pk PRIMARY KEY (id, tenant_id);


--
-- Name: data_imports data_imports_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_imports
    ADD CONSTRAINT data_imports_id_key UNIQUE (id);


--
-- Name: data_imports data_imports_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_imports
    ADD CONSTRAINT data_imports_pk PRIMARY KEY (id, tenant_id);


--
-- Name: delivery_requests delivery_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_requests
    ADD CONSTRAINT delivery_requests_pkey PRIMARY KEY (id);


--
-- Name: delivery_route_stops delivery_route_stops_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_route_stops
    ADD CONSTRAINT delivery_route_stops_pkey PRIMARY KEY (id);


--
-- Name: delivery_routes delivery_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_routes
    ADD CONSTRAINT delivery_routes_pkey PRIMARY KEY (id);


--
-- Name: dismissed_duplicate_groups dismissed_duplicate_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.dismissed_duplicate_groups
    ADD CONSTRAINT dismissed_duplicate_groups_pkey PRIMARY KEY (tenant_id, group_key);


--
-- Name: donation_periods donation_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_periods
    ADD CONSTRAINT donation_periods_pkey PRIMARY KEY (id, tenant_id);


--
-- Name: donation_pledges donation_pledges_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_pledges
    ADD CONSTRAINT donation_pledges_id_key UNIQUE (id);


--
-- Name: donation_pledges donation_pledges_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_pledges
    ADD CONSTRAINT donation_pledges_pkey PRIMARY KEY (id, tenant_id);


--
-- Name: donation_pledges donation_pledges_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_pledges
    ADD CONSTRAINT donation_pledges_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: donations donations_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_id_key UNIQUE (id);


--
-- Name: donations donations_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_pk PRIMARY KEY (id, tenant_id);


--
-- Name: donations donations_stripe_session_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_stripe_session_id_key UNIQUE (stripe_session_id);


--
-- Name: email_attachments email_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_pkey PRIMARY KEY (id);


--
-- Name: email_bodies email_bodies_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_bodies
    ADD CONSTRAINT email_bodies_pkey PRIMARY KEY (id);


--
-- Name: email_comments email_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_comments
    ADD CONSTRAINT email_comments_pkey PRIMARY KEY (id);


--
-- Name: email_drafts email_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT email_drafts_pkey PRIMARY KEY (id);


--
-- Name: email_headers email_headers_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_headers
    ADD CONSTRAINT email_headers_pkey PRIMARY KEY (id);


--
-- Name: email_read_states email_read_states_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_read_states
    ADD CONSTRAINT email_read_states_pk PRIMARY KEY (tenant_id, user_id, email_id);


--
-- Name: email_recipients email_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_recipients
    ADD CONSTRAINT email_recipients_pkey PRIMARY KEY (id);


--
-- Name: email_suppressions email_suppressions_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_id_key UNIQUE (id);


--
-- Name: email_suppressions email_suppressions_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_pk PRIMARY KEY (id, tenant_id);


--
-- Name: email_trash email_trash_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_trash
    ADD CONSTRAINT email_trash_pkey PRIMARY KEY (id);


--
-- Name: emails emails_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT emails_pkey PRIMARY KEY (id);


--
-- Name: event_registrations event_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_pkey PRIMARY KEY (id, tenant_id);


--
-- Name: event_registrations event_registrations_unique; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_unique UNIQUE (tenant_id, event_id, person_id);


--
-- Name: event_ticket_types event_ticket_types_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_ticket_types
    ADD CONSTRAINT event_ticket_types_id_key UNIQUE (id);


--
-- Name: event_ticket_types event_ticket_types_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_ticket_types
    ADD CONSTRAINT event_ticket_types_pkey PRIMARY KEY (id, tenant_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id, tenant_id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: form_submissions form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (tenant_id, id);


--
-- Name: google_oauth_tokens google_oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.google_oauth_tokens
    ADD CONSTRAINT google_oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: google_oauth_tokens google_oauth_tokens_tenant_campaign_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.google_oauth_tokens
    ADD CONSTRAINT google_oauth_tokens_tenant_campaign_key UNIQUE (tenant_id, campaign_id);


--
-- Name: households households_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_id_key UNIQUE (id);


--
-- Name: households households_id_tenantid; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_id_tenantid PRIMARY KEY (id, tenant_id);


--
-- Name: kysely_migration_lock kysely_migration_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.kysely_migration_lock
    ADD CONSTRAINT kysely_migration_lock_pkey PRIMARY KEY (id);


--
-- Name: kysely_migration kysely_migration_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.kysely_migration
    ADD CONSTRAINT kysely_migration_pkey PRIMARY KEY (name);


--
-- Name: lists lists_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.lists
    ADD CONSTRAINT lists_id_key UNIQUE (id);


--
-- Name: lists lists_id_tenantid; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.lists
    ADD CONSTRAINT lists_id_tenantid PRIMARY KEY (id, tenant_id);


--
-- Name: map_campaigns_users map_campaigns_users_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_campaigns_users
    ADD CONSTRAINT map_campaigns_users_pk PRIMARY KEY (tenant_id, campaign_id, user_id);


--
-- Name: map_households_tags map_households_tags_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_households_tags
    ADD CONSTRAINT map_households_tags_pk PRIMARY KEY (tenant_id, household_id, tag_id);


--
-- Name: map_lists_households map_lists_households_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_households
    ADD CONSTRAINT map_lists_households_pk PRIMARY KEY (tenant_id, list_id, household_id);


--
-- Name: map_lists_persons map_lists_persons_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_persons
    ADD CONSTRAINT map_lists_persons_pk PRIMARY KEY (tenant_id, list_id, person_id);


--
-- Name: map_newsletters_lists map_newsletters_lists_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_newsletters_lists
    ADD CONSTRAINT map_newsletters_lists_pk PRIMARY KEY (tenant_id, newsletter_id, list_id, mode);


--
-- Name: map_peoples_tags map_peoples_tags_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_peoples_tags
    ADD CONSTRAINT map_peoples_tags_pk PRIMARY KEY (tenant_id, person_id, tag_id);


--
-- Name: map_teams_lists map_teams_lists_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_lists
    ADD CONSTRAINT map_teams_lists_pk PRIMARY KEY (tenant_id, team_id, list_id);


--
-- Name: map_teams_persons map_teams_persons_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_persons
    ADD CONSTRAINT map_teams_persons_pk PRIMARY KEY (tenant_id, team_id, person_id);


--
-- Name: map_web_forms_lists map_web_forms_lists_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_web_forms_lists
    ADD CONSTRAINT map_web_forms_lists_pk PRIMARY KEY (tenant_id, web_form_id, list_id);


--
-- Name: ms_oauth_tokens ms_oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.ms_oauth_tokens
    ADD CONSTRAINT ms_oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: ms_oauth_tokens ms_oauth_tokens_tenant_campaign_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.ms_oauth_tokens
    ADD CONSTRAINT ms_oauth_tokens_tenant_campaign_key UNIQUE (tenant_id, campaign_id);


--
-- Name: newsletter_events newsletter_events_id_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletter_events
    ADD CONSTRAINT newsletter_events_id_pk PRIMARY KEY (id);


--
-- Name: newsletter_events newsletter_events_sg_event_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletter_events
    ADD CONSTRAINT newsletter_events_sg_event_id_key UNIQUE (sg_event_id);


--
-- Name: newsletters newsletters_id_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT newsletters_id_pk PRIMARY KEY (id);


--
-- Name: notifications notifications_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_id_key UNIQUE (id);


--
-- Name: notifications notifications_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pk PRIMARY KEY (id, tenant_id);


--
-- Name: passkeys passkeys_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_credential_id_key UNIQUE (credential_id);


--
-- Name: passkeys passkeys_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_pkey PRIMARY KEY (id);


--
-- Name: person_connections person_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.person_connections
    ADD CONSTRAINT person_connections_pkey PRIMARY KEY (id, tenant_id);


--
-- Name: person_newsletter_engagements person_newsletter_engagements_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.person_newsletter_engagements
    ADD CONSTRAINT person_newsletter_engagements_pkey PRIMARY KEY (tenant_id, newsletter_id, email);


--
-- Name: persons persons_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_id_key UNIQUE (id);


--
-- Name: persons persons_id_tenantid; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_id_tenantid PRIMARY KEY (id, tenant_id);


--
-- Name: potential_duplicates potential_duplicates_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.potential_duplicates
    ADD CONSTRAINT potential_duplicates_pk PRIMARY KEY (id);


--
-- Name: profiles profiles_auth_id_unique; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_auth_id_unique UNIQUE (auth_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_id_key UNIQUE (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (session_id);


--
-- Name: sessions sessions_refresh_token_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_refresh_token_key UNIQUE (refresh_token);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: tags tags_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_id_key UNIQUE (id);


--
-- Name: tags tags_id_tenantid; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_id_tenantid PRIMARY KEY (id, tenant_id);


--
-- Name: tags tags_tenant_name_type_unique; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_tenant_name_type_unique UNIQUE (tenant_id, name, type);


--
-- Name: task_attachments task_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_pkey PRIMARY KEY (id);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: task_subtasks task_subtasks_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_id_key UNIQUE (id);


--
-- Name: tasks tasks_id_tenantid; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_id_tenantid PRIMARY KEY (id, tenant_id);


--
-- Name: teams teams_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_id_key UNIQUE (id);


--
-- Name: teams teams_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pk PRIMARY KEY (id, tenant_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: turf_assignments turf_assignments_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT turf_assignments_id_key UNIQUE (id);


--
-- Name: turf_assignments turf_assignments_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT turf_assignments_pk PRIMARY KEY (id, tenant_id);


--
-- Name: turf_assignments turf_assignments_token_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT turf_assignments_token_key UNIQUE (token);


--
-- Name: turf_households turf_households_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_households
    ADD CONSTRAINT turf_households_pk PRIMARY KEY (tenant_id, turf_id, household_id);


--
-- Name: turf_knocks turf_knocks_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT turf_knocks_id_key UNIQUE (id);


--
-- Name: turf_knocks turf_knocks_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT turf_knocks_pk PRIMARY KEY (id, tenant_id);


--
-- Name: turfs turfs_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs
    ADD CONSTRAINT turfs_id_key UNIQUE (id);


--
-- Name: turfs turfs_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs
    ADD CONSTRAINT turfs_pk PRIMARY KEY (id, tenant_id);


--
-- Name: email_bodies unique_email_bodies_email_id; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_bodies
    ADD CONSTRAINT unique_email_bodies_email_id UNIQUE (email_id);


--
-- Name: email_headers unique_email_headers_email_id; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_headers
    ADD CONSTRAINT unique_email_headers_email_id UNIQUE (email_id);


--
-- Name: campaign_person_facts uq_cpf_campaign_person; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT uq_cpf_campaign_person UNIQUE (tenant_id, campaign_id, person_id);


--
-- Name: campaign_subscriptions uq_csub_campaign_person; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT uq_csub_campaign_person UNIQUE (tenant_id, campaign_id, person_id);


--
-- Name: email_suppressions uq_esup_email_reason; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT uq_esup_email_reason UNIQUE (tenant_id, email, reason);


--
-- Name: settings uq_settings_tenant_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT uq_settings_tenant_key UNIQUE (tenant_id, key);


--
-- Name: user_activity user_activity_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT user_activity_id_key UNIQUE (id);


--
-- Name: user_activity user_activity_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT user_activity_pk PRIMARY KEY (id, tenant_id);


--
-- Name: volunteer_events volunteer_events_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_events
    ADD CONSTRAINT volunteer_events_id_key UNIQUE (id);


--
-- Name: volunteer_events volunteer_events_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_events
    ADD CONSTRAINT volunteer_events_pk PRIMARY KEY (id, tenant_id);


--
-- Name: volunteer_shifts volunteer_shifts_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts
    ADD CONSTRAINT volunteer_shifts_id_key UNIQUE (id);


--
-- Name: volunteer_shifts volunteer_shifts_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts
    ADD CONSTRAINT volunteer_shifts_pk PRIMARY KEY (id, tenant_id);


--
-- Name: web_forms web_forms_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.web_forms
    ADD CONSTRAINT web_forms_id_key UNIQUE (id);


--
-- Name: web_forms web_forms_id_tenantid; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.web_forms
    ADD CONSTRAINT web_forms_id_tenantid PRIMARY KEY (id, tenant_id);


--
-- Name: webhook_events webhook_events_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pk PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_stripe_event_id_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_stripe_event_id_key UNIQUE (stripe_event_id);


--
-- Name: workflow_enrollments workflow_enrollments_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_enrollments
    ADD CONSTRAINT workflow_enrollments_pk PRIMARY KEY (id);


--
-- Name: workflow_runs workflow_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT workflow_runs_pkey PRIMARY KEY (id);


--
-- Name: workflow_steps workflow_steps_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT workflow_steps_pk PRIMARY KEY (id);


--
-- Name: workflows workflows_pk; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pk PRIMARY KEY (id);


--
-- Name: zapier_subscriptions zapier_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.zapier_subscriptions
    ADD CONSTRAINT zapier_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: zapier_subscriptions zapier_subscriptions_tenant_id_event_type_key; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.zapier_subscriptions
    ADD CONSTRAINT zapier_subscriptions_tenant_id_event_type_key UNIQUE (tenant_id, event_type);


--
-- Name: campaigns_map_tenant_user_index; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX campaigns_map_tenant_user_index ON public.map_campaigns_users USING btree (tenant_id, user_id);


--
-- Name: campaigns_tenant_index; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX campaigns_tenant_index ON public.campaigns USING btree (tenant_id);


--
-- Name: companies_tenant_slug_unique; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX companies_tenant_slug_unique ON public.companies USING btree (tenant_id, slug) WHERE (slug IS NOT NULL);


--
-- Name: event_registrations_event_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX event_registrations_event_idx ON public.event_registrations USING btree (tenant_id, event_id);


--
-- Name: event_registrations_person_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX event_registrations_person_idx ON public.event_registrations USING btree (tenant_id, person_id);


--
-- Name: events_search_vector_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX events_search_vector_idx ON public.events USING gin (search_vector);


--
-- Name: events_tenant_slug_unique; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX events_tenant_slug_unique ON public.events USING btree (tenant_id, slug);


--
-- Name: files_entity_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX files_entity_idx ON public.files USING btree (tenant_id, entity_type, entity_id);


--
-- Name: households_tenant_slug_unique; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX households_tenant_slug_unique ON public.households USING btree (tenant_id, slug) WHERE (slug IS NOT NULL);


--
-- Name: idx_background_jobs_active_type; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_background_jobs_active_type ON public.background_jobs USING btree (((payload ->> 'type'::text))) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: idx_background_jobs_claim; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_background_jobs_claim ON public.background_jobs USING btree (run_at, id) WHERE (status = 'pending'::text);


--
-- Name: idx_background_jobs_tenant_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_background_jobs_tenant_status ON public.background_jobs USING btree (tenant_id, status) WHERE (tenant_id IS NOT NULL);


--
-- Name: idx_companies_file_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_companies_file_id ON public.companies USING btree (file_id);


--
-- Name: idx_companies_fts; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_companies_fts ON public.companies USING gin (search_vector);


--
-- Name: idx_companies_tenant_email; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_companies_tenant_email ON public.companies USING btree (tenant_id, email);


--
-- Name: idx_companies_tenant_industry; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_companies_tenant_industry ON public.companies USING btree (tenant_id, industry);


--
-- Name: idx_companies_trgm_name; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_companies_trgm_name ON public.companies USING gin (name public.gin_trgm_ops);


--
-- Name: idx_cpf_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_cpf_tenant_campaign ON public.campaign_person_facts USING btree (tenant_id, campaign_id);


--
-- Name: idx_cpf_tenant_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_cpf_tenant_person ON public.campaign_person_facts USING btree (tenant_id, person_id);


--
-- Name: idx_csub_tenant_campaign_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_csub_tenant_campaign_status ON public.campaign_subscriptions USING btree (tenant_id, campaign_id, status);


--
-- Name: idx_csub_tenant_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_csub_tenant_person ON public.campaign_subscriptions USING btree (tenant_id, person_id);


--
-- Name: idx_data_exports_tenant_created; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_data_exports_tenant_created ON public.data_exports USING btree (tenant_id, created_at);


--
-- Name: idx_data_exports_tenant_pending; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_data_exports_tenant_pending ON public.data_exports USING btree (tenant_id, created_at) WHERE (status = 'pending'::text);


--
-- Name: idx_data_imports_tag; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_data_imports_tag ON public.data_imports USING btree (tag_id);


--
-- Name: idx_data_imports_tenant_processed; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_data_imports_tenant_processed ON public.data_imports USING btree (tenant_id, processed_at);


--
-- Name: idx_delivery_requests_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_delivery_requests_tenant_campaign ON public.delivery_requests USING btree (tenant_id, campaign_id);


--
-- Name: idx_delivery_requests_tenant_household; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_delivery_requests_tenant_household ON public.delivery_requests USING btree (tenant_id, household_id);


--
-- Name: idx_delivery_requests_tenant_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_delivery_requests_tenant_status ON public.delivery_requests USING btree (tenant_id, status);


--
-- Name: idx_delivery_route_stops_tenant_route; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_delivery_route_stops_tenant_route ON public.delivery_route_stops USING btree (tenant_id, route_id);


--
-- Name: idx_delivery_routes_share_token_hash; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_delivery_routes_share_token_hash ON public.delivery_routes USING btree (share_token_hash) WHERE (share_token_hash IS NOT NULL);


--
-- Name: idx_delivery_routes_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_delivery_routes_tenant_campaign ON public.delivery_routes USING btree (tenant_id, campaign_id);


--
-- Name: idx_delivery_routes_tenant_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_delivery_routes_tenant_status ON public.delivery_routes USING btree (tenant_id, status);


--
-- Name: idx_dismissed_duplicate_groups_tenant; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_dismissed_duplicate_groups_tenant ON public.dismissed_duplicate_groups USING btree (tenant_id);


--
-- Name: idx_donation_periods_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_donation_periods_tenant_campaign ON public.donation_periods USING btree (tenant_id, campaign_id);


--
-- Name: idx_donation_pledges_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_donation_pledges_tenant_campaign ON public.donation_pledges USING btree (tenant_id, campaign_id);


--
-- Name: idx_donations_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_donations_person ON public.donations USING btree (tenant_id, person_id);


--
-- Name: idx_donations_pledge; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_donations_pledge ON public.donations USING btree (pledge_id) WHERE (pledge_id IS NOT NULL);


--
-- Name: idx_donations_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_donations_tenant_campaign ON public.donations USING btree (tenant_id, campaign_id);


--
-- Name: idx_email_attachments_email_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_email_attachments_email_id ON public.email_attachments USING btree (email_id);


--
-- Name: idx_email_attachments_file_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_email_attachments_file_id ON public.email_attachments USING btree (file_id);


--
-- Name: idx_email_comments_email; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_email_comments_email ON public.email_comments USING btree (email_id);


--
-- Name: idx_email_drafts_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_email_drafts_tenant_campaign ON public.email_drafts USING btree (tenant_id, campaign_id);


--
-- Name: idx_email_drafts_user_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_email_drafts_user_id ON public.email_drafts USING btree (tenant_id, user_id);


--
-- Name: idx_email_read_states_email; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_email_read_states_email ON public.email_read_states USING btree (tenant_id, email_id);


--
-- Name: idx_email_recipients_kind; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_email_recipients_kind ON public.email_recipients USING btree (email_id, kind, pos);


--
-- Name: idx_email_trash_tenant_email_unique; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_email_trash_tenant_email_unique ON public.email_trash USING btree (tenant_id, email_id);


--
-- Name: idx_emails_tenant_assigned; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_emails_tenant_assigned ON public.emails USING btree (tenant_id, assigned_to);


--
-- Name: idx_emails_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_emails_tenant_campaign ON public.emails USING btree (tenant_id, campaign_id);


--
-- Name: idx_emails_tenant_folder; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_emails_tenant_folder ON public.emails USING btree (tenant_id, folder_id);


--
-- Name: idx_emails_tenant_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_emails_tenant_status ON public.emails USING btree (tenant_id, status);


--
-- Name: idx_esup_tenant_email; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_esup_tenant_email ON public.email_suppressions USING btree (tenant_id, email);


--
-- Name: idx_event_registrations_ticket; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_event_registrations_ticket ON public.event_registrations USING btree (ticket_type_id) WHERE (ticket_type_id IS NOT NULL);


--
-- Name: idx_events_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_events_tenant_campaign ON public.events USING btree (tenant_id, campaign_id);


--
-- Name: idx_files_sha256; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_files_sha256 ON public.files USING btree (sha256_hex) WHERE (sha256_hex IS NOT NULL);


--
-- Name: idx_files_tenant; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_files_tenant ON public.files USING btree (tenant_id);


--
-- Name: idx_form_submissions_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_form_submissions_person ON public.form_submissions USING btree (tenant_id, person_id);


--
-- Name: idx_form_submissions_tenant_form; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_form_submissions_tenant_form ON public.form_submissions USING btree (tenant_id, form_id, created_at DESC);


--
-- Name: idx_households_file_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_file_id ON public.households USING btree (file_id);


--
-- Name: idx_households_fp_full; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_fp_full ON public.households USING btree (address_fp_full);


--
-- Name: idx_households_fp_street; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_fp_street ON public.households USING btree (address_fp_street);


--
-- Name: idx_households_fts; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_fts ON public.households USING gin (search_vector);


--
-- Name: idx_households_placeholder; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_households_placeholder ON public.households USING btree (tenant_id) WHERE is_placeholder;


--
-- Name: idx_households_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_tenant_campaign ON public.households USING btree (tenant_id, campaign_id);


--
-- Name: idx_households_tenant_geocoding; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_tenant_geocoding ON public.households USING btree (tenant_id, geocoding_status);


--
-- Name: idx_households_tenant_type; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_tenant_type ON public.households USING btree (tenant_id, type);


--
-- Name: idx_households_trgm_city; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_trgm_city ON public.households USING gin (city public.gin_trgm_ops);


--
-- Name: idx_households_trgm_street1; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_trgm_street1 ON public.households USING gin (street1 public.gin_trgm_ops);


--
-- Name: idx_households_trgm_zip; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_households_trgm_zip ON public.households USING gin (zip public.gin_trgm_ops);


--
-- Name: idx_lists_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_lists_tenant_campaign ON public.lists USING btree (tenant_id, campaign_id);


--
-- Name: idx_lists_tenant_is_dynamic; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_lists_tenant_is_dynamic ON public.lists USING btree (tenant_id, is_dynamic);


--
-- Name: idx_lists_tenant_object; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_lists_tenant_object ON public.lists USING btree (tenant_id, object);


--
-- Name: idx_lists_tenant_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_lists_tenant_status ON public.lists USING btree (tenant_id, status);


--
-- Name: idx_map_households_tags_tag; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_households_tags_tag ON public.map_households_tags USING btree (tag_id);


--
-- Name: idx_map_lists_households_hh; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_lists_households_hh ON public.map_lists_households USING btree (household_id);


--
-- Name: idx_map_lists_persons_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_lists_persons_person ON public.map_lists_persons USING btree (person_id);


--
-- Name: idx_map_newsletters_lists_list; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_newsletters_lists_list ON public.map_newsletters_lists USING btree (tenant_id, list_id);


--
-- Name: idx_map_peoples_tags_tag; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_peoples_tags_tag ON public.map_peoples_tags USING btree (tag_id);


--
-- Name: idx_map_teams_lists_list; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_teams_lists_list ON public.map_teams_lists USING btree (list_id);


--
-- Name: idx_map_teams_persons_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_teams_persons_person ON public.map_teams_persons USING btree (tenant_id, person_id);


--
-- Name: idx_map_web_forms_lists_list; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_map_web_forms_lists_list ON public.map_web_forms_lists USING btree (tenant_id, list_id);


--
-- Name: idx_newsletter_events_newsletter_event; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_newsletter_events_newsletter_event ON public.newsletter_events USING btree (newsletter_id, event_type);


--
-- Name: idx_newsletter_events_type; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_newsletter_events_type ON public.newsletter_events USING btree (tenant_id, newsletter_id, event_type);


--
-- Name: idx_newsletters_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_newsletters_tenant_campaign ON public.newsletters USING btree (tenant_id, campaign_id);


--
-- Name: idx_notifications_read; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_notifications_read ON public.notifications USING btree (tenant_id, user_id, read);


--
-- Name: idx_persons_company_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_company_id ON public.persons USING btree (company_id);


--
-- Name: idx_persons_file_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_file_id ON public.persons USING btree (file_id);


--
-- Name: idx_persons_fts; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_fts ON public.persons USING gin (search_vector);


--
-- Name: idx_persons_tenant_assigned; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_tenant_assigned ON public.persons USING btree (tenant_id, assigned_to);


--
-- Name: idx_persons_tenant_company; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_tenant_company ON public.persons USING btree (tenant_id, company_id);


--
-- Name: idx_persons_tenant_email_btree; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_tenant_email_btree ON public.persons USING btree (tenant_id, email);


--
-- Name: idx_persons_tenant_email_unique; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_persons_tenant_email_unique ON public.persons USING btree (tenant_id, lower(email)) WHERE ((email IS NOT NULL) AND (TRIM(BOTH FROM email) <> ''::text));


--
-- Name: idx_persons_tenant_household; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_tenant_household ON public.persons USING btree (tenant_id, household_id);


--
-- Name: idx_persons_trgm_email; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_trgm_email ON public.persons USING gin (email public.gin_trgm_ops);


--
-- Name: idx_persons_trgm_first_name; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_trgm_first_name ON public.persons USING gin (first_name public.gin_trgm_ops);


--
-- Name: idx_persons_trgm_last_name; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_trgm_last_name ON public.persons USING gin (last_name public.gin_trgm_ops);


--
-- Name: idx_persons_trgm_mobile; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_persons_trgm_mobile ON public.persons USING gin (mobile public.gin_trgm_ops);


--
-- Name: idx_pne_newsletter; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_pne_newsletter ON public.person_newsletter_engagements USING btree (newsletter_id);


--
-- Name: idx_pne_tenant_email; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_pne_tenant_email ON public.person_newsletter_engagements USING btree (tenant_id, email);


--
-- Name: idx_potential_duplicates_company_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_potential_duplicates_company_id ON public.potential_duplicates USING btree (company_id) WHERE (company_id IS NOT NULL);


--
-- Name: idx_potential_duplicates_household_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_potential_duplicates_household_id ON public.potential_duplicates USING btree (household_id) WHERE (household_id IS NOT NULL);


--
-- Name: idx_potential_duplicates_person_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_potential_duplicates_person_id ON public.potential_duplicates USING btree (person_id);


--
-- Name: idx_potential_duplicates_tenant_group; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_potential_duplicates_tenant_group ON public.potential_duplicates USING btree (tenant_id, group_key);


--
-- Name: idx_potential_duplicates_unique_group_company; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_potential_duplicates_unique_group_company ON public.potential_duplicates USING btree (group_key, company_id) WHERE (company_id IS NOT NULL);


--
-- Name: idx_potential_duplicates_unique_group_household; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_potential_duplicates_unique_group_household ON public.potential_duplicates USING btree (group_key, household_id) WHERE (household_id IS NOT NULL);


--
-- Name: idx_potential_duplicates_unique_group_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_potential_duplicates_unique_group_person ON public.potential_duplicates USING btree (group_key, person_id);


--
-- Name: idx_profiles_avatar_file_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_profiles_avatar_file_id ON public.profiles USING btree (avatar_file_id);


--
-- Name: idx_sessions_expires_at; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_tags_tenant_type; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_tags_tenant_type ON public.tags USING btree (tenant_id, type);


--
-- Name: idx_task_attachments_task_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_task_attachments_task_id ON public.task_attachments USING btree (task_id);


--
-- Name: idx_task_comments_task_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_task_comments_task_id ON public.task_comments USING btree (task_id);


--
-- Name: idx_task_subtasks_task_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_task_subtasks_task_id ON public.task_subtasks USING btree (task_id);


--
-- Name: idx_tasks_file_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_tasks_file_id ON public.tasks USING btree (file_id);


--
-- Name: idx_tasks_team_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_tasks_team_id ON public.tasks USING btree (team_id);


--
-- Name: idx_tasks_tenant_assigned; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_tasks_tenant_assigned ON public.tasks USING btree (tenant_id, assigned_to);


--
-- Name: idx_tasks_tenant_due; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_tasks_tenant_due ON public.tasks USING btree (tenant_id, due_at);


--
-- Name: idx_tasks_tenant_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_tasks_tenant_status ON public.tasks USING btree (tenant_id, status);


--
-- Name: idx_teams_lead_user; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_teams_lead_user ON public.teams USING btree (team_lead_user_id);


--
-- Name: idx_teams_tenant_captain; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_teams_tenant_captain ON public.teams USING btree (tenant_id, team_captain_id);


--
-- Name: idx_tenants_slug; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_tenants_slug ON public.tenants USING btree (slug) WHERE (slug IS NOT NULL);


--
-- Name: idx_turf_assignments_team; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turf_assignments_team ON public.turf_assignments USING btree (tenant_id, team_id);


--
-- Name: idx_turf_assignments_turf; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turf_assignments_turf ON public.turf_assignments USING btree (tenant_id, turf_id);


--
-- Name: idx_turf_households_household; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turf_households_household ON public.turf_households USING btree (tenant_id, household_id);


--
-- Name: idx_turf_households_turf; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turf_households_turf ON public.turf_households USING btree (tenant_id, turf_id);


--
-- Name: idx_turf_knocks_household; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turf_knocks_household ON public.turf_knocks USING btree (tenant_id, household_id);


--
-- Name: idx_turf_knocks_knocked_at; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turf_knocks_knocked_at ON public.turf_knocks USING btree (tenant_id, knocked_at);


--
-- Name: idx_turf_knocks_turf; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turf_knocks_turf ON public.turf_knocks USING btree (tenant_id, turf_id);


--
-- Name: idx_turfs_tenant; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turfs_tenant ON public.turfs USING btree (tenant_id);


--
-- Name: idx_turfs_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turfs_tenant_campaign ON public.turfs USING btree (tenant_id, campaign_id);


--
-- Name: idx_turfs_tenant_list; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turfs_tenant_list ON public.turfs USING btree (tenant_id, list_id);


--
-- Name: idx_turfs_tenant_status; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_turfs_tenant_status ON public.turfs USING btree (tenant_id, status);


--
-- Name: idx_user_activity_tenant_entity; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_user_activity_tenant_entity ON public.user_activity USING btree (tenant_id, entity, entity_id);


--
-- Name: idx_user_activity_tenant_user; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_user_activity_tenant_user ON public.user_activity USING btree (tenant_id, user_id);


--
-- Name: idx_volunteer_events_dates; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_volunteer_events_dates ON public.volunteer_events USING btree (tenant_id, start_time, end_time);


--
-- Name: idx_volunteer_events_fts; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_volunteer_events_fts ON public.volunteer_events USING gin (search_vector);


--
-- Name: idx_volunteer_events_tenant_end; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_volunteer_events_tenant_end ON public.volunteer_events USING btree (tenant_id, end_time);


--
-- Name: idx_volunteer_events_tenant_slug; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_volunteer_events_tenant_slug ON public.volunteer_events USING btree (tenant_id, slug);


--
-- Name: idx_volunteer_shifts_event; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_volunteer_shifts_event ON public.volunteer_shifts USING btree (tenant_id, event_id);


--
-- Name: idx_volunteer_shifts_event_ri; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_volunteer_shifts_event_ri ON public.volunteer_shifts USING btree (event_id);


--
-- Name: idx_volunteer_shifts_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_volunteer_shifts_person ON public.volunteer_shifts USING btree (tenant_id, person_id);


--
-- Name: idx_volunteer_shifts_person_ri; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_volunteer_shifts_person_ri ON public.volunteer_shifts USING btree (person_id);


--
-- Name: idx_web_forms_tenant_campaign; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_web_forms_tenant_campaign ON public.web_forms USING btree (tenant_id, campaign_id);


--
-- Name: idx_web_forms_tenant_slug; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX idx_web_forms_tenant_slug ON public.web_forms USING btree (tenant_id, slug) WHERE (slug IS NOT NULL);


--
-- Name: idx_webhook_events_status_run_at; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_webhook_events_status_run_at ON public.webhook_events USING btree (status, run_at);


--
-- Name: idx_workflow_enrollments_next_run; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflow_enrollments_next_run ON public.workflow_enrollments USING btree (status, next_run_at);


--
-- Name: idx_workflow_enrollments_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflow_enrollments_person ON public.workflow_enrollments USING btree (person_id);


--
-- Name: idx_workflow_enrollments_tenant_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflow_enrollments_tenant_id ON public.workflow_enrollments USING btree (tenant_id);


--
-- Name: idx_workflow_enrollments_workflow_person; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflow_enrollments_workflow_person ON public.workflow_enrollments USING btree (workflow_id, person_id);


--
-- Name: idx_workflow_runs_tenant_workflow_created; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflow_runs_tenant_workflow_created ON public.workflow_runs USING btree (tenant_id, workflow_id, created_at DESC);


--
-- Name: idx_workflow_steps_tenant_workflow; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflow_steps_tenant_workflow ON public.workflow_steps USING btree (tenant_id, workflow_id, step_number);


--
-- Name: idx_workflows_tenant_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflows_tenant_id ON public.workflows USING btree (tenant_id);


--
-- Name: idx_workflows_trigger_event_id; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workflows_trigger_event_id ON public.workflows USING btree (trigger_event_id);


--
-- Name: newsletters_tenant_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX newsletters_tenant_idx ON public.newsletters USING btree (tenant_id);


--
-- Name: passkeys_user_id_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX passkeys_user_id_idx ON public.passkeys USING btree (user_id);


--
-- Name: pc_from_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX pc_from_idx ON public.person_connections USING btree (tenant_id, from_person_id);


--
-- Name: pc_to_idx; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX pc_to_idx ON public.person_connections USING btree (tenant_id, to_person_id);


--
-- Name: pc_unique_edge; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX pc_unique_edge ON public.person_connections USING btree (tenant_id, from_person_id, to_person_id, relation_type);


--
-- Name: persons_tenant_campaign_household_index; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX persons_tenant_campaign_household_index ON public.persons USING btree (tenant_id, campaign_id, household_id);


--
-- Name: persons_tenant_public_id_unique; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX persons_tenant_public_id_unique ON public.persons USING btree (tenant_id, public_id) WHERE (public_id IS NOT NULL);


--
-- Name: persons_tenant_slug_unique; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX persons_tenant_slug_unique ON public.persons USING btree (tenant_id, slug) WHERE (slug IS NOT NULL);


--
-- Name: sessions_user_index; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX sessions_user_index ON public.sessions USING btree (user_id);


--
-- Name: uq_delivery_route_stops_active_request; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX uq_delivery_route_stops_active_request ON public.delivery_route_stops USING btree (request_id) WHERE (status = 'pending'::text);


--
-- Name: uq_delivery_route_stops_route_seq; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX uq_delivery_route_stops_route_seq ON public.delivery_route_stops USING btree (route_id, seq);


--
-- Name: uq_turf_knocks_client; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE UNIQUE INDEX uq_turf_knocks_client ON public.turf_knocks USING btree (tenant_id, turf_id, client_knock_id) WHERE (client_knock_id IS NOT NULL);


--
-- Name: web_forms_tenant_index; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX web_forms_tenant_index ON public.web_forms USING btree (tenant_id);


--
-- Name: idx_workspace_api_keys_key_hash; Type: INDEX; Schema: public; Owner: pplcrm_owner
--

CREATE INDEX idx_workspace_api_keys_key_hash ON public.workspace_api_keys USING btree (key_hash);


--
-- Name: authusers trg_authusers_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_authusers_updated_at BEFORE UPDATE ON public.authusers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: background_jobs trg_background_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_background_jobs_updated_at BEFORE UPDATE ON public.background_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: campaigns trg_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: companies trg_companies_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: data_exports trg_data_exports_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_data_exports_updated_at BEFORE UPDATE ON public.data_exports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: data_imports trg_data_imports_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_data_imports_updated_at BEFORE UPDATE ON public.data_imports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: donation_periods trg_donation_periods_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_donation_periods_updated_at BEFORE UPDATE ON public.donation_periods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: donation_pledges trg_donation_pledges_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_donation_pledges_updated_at BEFORE UPDATE ON public.donation_pledges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: donations trg_donations_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_donations_updated_at BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_attachments trg_email_attachments_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_email_attachments_updated_at BEFORE UPDATE ON public.email_attachments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_bodies trg_email_bodies_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_email_bodies_updated_at BEFORE UPDATE ON public.email_bodies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_comments trg_email_comments_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_email_comments_updated_at BEFORE UPDATE ON public.email_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_drafts trg_email_drafts_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_email_drafts_updated_at BEFORE UPDATE ON public.email_drafts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_headers trg_email_headers_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_email_headers_updated_at BEFORE UPDATE ON public.email_headers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_recipients trg_email_recipients_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_email_recipients_updated_at BEFORE UPDATE ON public.email_recipients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_trash trg_email_trash_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_email_trash_updated_at BEFORE UPDATE ON public.email_trash FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: emails trg_emails_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_emails_updated_at BEFORE UPDATE ON public.emails FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: event_registrations trg_event_registrations_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_event_registrations_updated_at BEFORE UPDATE ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: event_ticket_types trg_event_ticket_types_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_event_ticket_types_updated_at BEFORE UPDATE ON public.event_ticket_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: events trg_events_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: files trg_files_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_files_updated_at BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: google_oauth_tokens trg_google_oauth_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_google_oauth_tokens_updated_at BEFORE UPDATE ON public.google_oauth_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: households trg_households_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_households_updated_at BEFORE UPDATE ON public.households FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: lists trg_lists_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_lists_updated_at BEFORE UPDATE ON public.lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: map_campaigns_users trg_map_campaigns_users_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_map_campaigns_users_updated_at BEFORE UPDATE ON public.map_campaigns_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: map_households_tags trg_map_households_tags_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_map_households_tags_updated_at BEFORE UPDATE ON public.map_households_tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: map_lists_households trg_map_lists_households_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_map_lists_households_updated_at BEFORE UPDATE ON public.map_lists_households FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: map_lists_persons trg_map_lists_persons_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_map_lists_persons_updated_at BEFORE UPDATE ON public.map_lists_persons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: map_peoples_tags trg_map_peoples_tags_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_map_peoples_tags_updated_at BEFORE UPDATE ON public.map_peoples_tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: map_teams_lists trg_map_teams_lists_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_map_teams_lists_updated_at BEFORE UPDATE ON public.map_teams_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: map_teams_persons trg_map_teams_persons_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_map_teams_persons_updated_at BEFORE UPDATE ON public.map_teams_persons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ms_oauth_tokens trg_ms_oauth_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_ms_oauth_tokens_updated_at BEFORE UPDATE ON public.ms_oauth_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: newsletters trg_newsletters_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_newsletters_updated_at BEFORE UPDATE ON public.newsletters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notifications trg_notifications_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: person_connections trg_person_connections_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_person_connections_updated_at BEFORE UPDATE ON public.person_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: persons trg_persons_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_persons_updated_at BEFORE UPDATE ON public.persons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: potential_duplicates trg_potential_duplicates_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_potential_duplicates_updated_at BEFORE UPDATE ON public.potential_duplicates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: settings trg_settings_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tags trg_tags_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_tags_updated_at BEFORE UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_attachments trg_task_attachments_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_task_attachments_updated_at BEFORE UPDATE ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_comments trg_task_comments_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_task_comments_updated_at BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_subtasks trg_task_subtasks_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_task_subtasks_updated_at BEFORE UPDATE ON public.task_subtasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tasks trg_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: teams trg_teams_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenants trg_tenants_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_activity trg_user_activity_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_user_activity_updated_at BEFORE UPDATE ON public.user_activity FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_events trg_volunteer_events_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_volunteer_events_updated_at BEFORE UPDATE ON public.volunteer_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: volunteer_shifts trg_volunteer_shifts_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_volunteer_shifts_updated_at BEFORE UPDATE ON public.volunteer_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: web_forms trg_web_forms_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_web_forms_updated_at BEFORE UPDATE ON public.web_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: webhook_events trg_webhook_events_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_webhook_events_updated_at BEFORE UPDATE ON public.webhook_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workflow_enrollments trg_workflow_enrollments_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_workflow_enrollments_updated_at BEFORE UPDATE ON public.workflow_enrollments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workflow_steps trg_workflow_steps_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_workflow_steps_updated_at BEFORE UPDATE ON public.workflow_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workflows trg_workflows_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_workflows_updated_at BEFORE UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: zapier_subscriptions trg_zapier_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trg_zapier_subscriptions_updated_at BEFORE UPDATE ON public.zapier_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: background_jobs trigger_notify_job_inserted; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trigger_notify_job_inserted AFTER INSERT ON public.background_jobs FOR EACH ROW EXECUTE FUNCTION public.notify_job_inserted();


--
-- Name: webhook_events trigger_notify_webhook_event_inserted; Type: TRIGGER; Schema: public; Owner: pplcrm_owner
--

CREATE TRIGGER trigger_notify_webhook_event_inserted AFTER INSERT ON public.webhook_events FOR EACH ROW EXECUTE FUNCTION public.notify_webhook_event_inserted();


--
-- Name: email_comments email_comments_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_comments
    ADD CONSTRAINT email_comments_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_trash email_trash_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_trash
    ADD CONSTRAINT email_trash_email_id_fkey FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: campaigns fk_admin_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT fk_admin_id FOREIGN KEY (admin_id) REFERENCES public.authusers(id);


--
-- Name: tenants fk_admin_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT fk_admin_id FOREIGN KEY (admin_id) REFERENCES public.authusers(id);


--
-- Name: authusers fk_authusers_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.authusers
    ADD CONSTRAINT fk_authusers_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: authusers fk_authusers_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.authusers
    ADD CONSTRAINT fk_authusers_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: authusers fk_authusers_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.authusers
    ADD CONSTRAINT fk_authusers_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: background_jobs fk_background_jobs_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.background_jobs
    ADD CONSTRAINT fk_background_jobs_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: households fk_campaign_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT fk_campaign_id FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: map_campaigns_users fk_campaign_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_campaigns_users
    ADD CONSTRAINT fk_campaign_id FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: persons fk_campaign_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT fk_campaign_id FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: campaigns fk_campaigns_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT fk_campaigns_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: campaigns fk_campaigns_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT fk_campaigns_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: companies fk_companies_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT fk_companies_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: companies fk_companies_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT fk_companies_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: companies fk_companies_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT fk_companies_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: campaign_person_facts fk_cpf_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT fk_cpf_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_person_facts fk_cpf_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT fk_cpf_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: campaign_person_facts fk_cpf_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT fk_cpf_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: campaign_person_facts fk_cpf_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT fk_cpf_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: campaign_person_facts fk_cpf_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_person_facts
    ADD CONSTRAINT fk_cpf_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: campaigns fk_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT fk_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: households fk_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT fk_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: persons fk_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT fk_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: tenants fk_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT fk_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: campaign_subscriptions fk_csub_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT fk_csub_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_subscriptions fk_csub_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT fk_csub_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: campaign_subscriptions fk_csub_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT fk_csub_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: campaign_subscriptions fk_csub_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT fk_csub_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: campaign_subscriptions fk_csub_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.campaign_subscriptions
    ADD CONSTRAINT fk_csub_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: data_exports fk_data_exports_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_exports
    ADD CONSTRAINT fk_data_exports_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: data_exports fk_data_exports_user; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_exports
    ADD CONSTRAINT fk_data_exports_user FOREIGN KEY (user_id) REFERENCES public.authusers(id);


--
-- Name: data_imports fk_data_imports_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_imports
    ADD CONSTRAINT fk_data_imports_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: data_imports fk_data_imports_tag; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_imports
    ADD CONSTRAINT fk_data_imports_tag FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE SET NULL;


--
-- Name: data_imports fk_data_imports_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_imports
    ADD CONSTRAINT fk_data_imports_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: data_imports fk_data_imports_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.data_imports
    ADD CONSTRAINT fk_data_imports_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: delivery_requests fk_delivery_requests_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_requests
    ADD CONSTRAINT fk_delivery_requests_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: delivery_requests fk_delivery_requests_household; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_requests
    ADD CONSTRAINT fk_delivery_requests_household FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;


--
-- Name: delivery_requests fk_delivery_requests_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_requests
    ADD CONSTRAINT fk_delivery_requests_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: delivery_requests fk_delivery_requests_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_requests
    ADD CONSTRAINT fk_delivery_requests_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: delivery_requests fk_delivery_requests_web_form; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_requests
    ADD CONSTRAINT fk_delivery_requests_web_form FOREIGN KEY (web_form_id) REFERENCES public.web_forms(id) ON DELETE SET NULL;


--
-- Name: delivery_route_stops fk_delivery_route_stops_request; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_route_stops
    ADD CONSTRAINT fk_delivery_route_stops_request FOREIGN KEY (request_id) REFERENCES public.delivery_requests(id) ON DELETE CASCADE;


--
-- Name: delivery_route_stops fk_delivery_route_stops_route; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_route_stops
    ADD CONSTRAINT fk_delivery_route_stops_route FOREIGN KEY (route_id) REFERENCES public.delivery_routes(id) ON DELETE CASCADE;


--
-- Name: delivery_route_stops fk_delivery_route_stops_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_route_stops
    ADD CONSTRAINT fk_delivery_route_stops_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: delivery_routes fk_delivery_routes_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_routes
    ADD CONSTRAINT fk_delivery_routes_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: delivery_routes fk_delivery_routes_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_routes
    ADD CONSTRAINT fk_delivery_routes_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: delivery_routes fk_delivery_routes_volunteer; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.delivery_routes
    ADD CONSTRAINT fk_delivery_routes_volunteer FOREIGN KEY (volunteer_person_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: dismissed_duplicate_groups fk_dismissed_duplicate_groups_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.dismissed_duplicate_groups
    ADD CONSTRAINT fk_dismissed_duplicate_groups_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: donation_periods fk_donation_periods_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_periods
    ADD CONSTRAINT fk_donation_periods_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: donation_periods fk_donation_periods_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_periods
    ADD CONSTRAINT fk_donation_periods_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: donation_pledges fk_donation_pledges_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_pledges
    ADD CONSTRAINT fk_donation_pledges_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: donation_pledges fk_donation_pledges_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donation_pledges
    ADD CONSTRAINT fk_donation_pledges_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: donations fk_donations_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT fk_donations_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: donations fk_donations_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT fk_donations_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: donations fk_donations_pledge; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT fk_donations_pledge FOREIGN KEY (pledge_id) REFERENCES public.donation_pledges(id) ON DELETE SET NULL;


--
-- Name: donations fk_donations_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT fk_donations_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: email_attachments fk_email_attachments_email; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT fk_email_attachments_email FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_attachments fk_email_attachments_file; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT fk_email_attachments_file FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE SET NULL;


--
-- Name: email_attachments fk_email_attachments_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT fk_email_attachments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_bodies fk_email_bodies_email; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_bodies
    ADD CONSTRAINT fk_email_bodies_email FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_bodies fk_email_bodies_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_bodies
    ADD CONSTRAINT fk_email_bodies_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_comments fk_email_comments_author; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_comments
    ADD CONSTRAINT fk_email_comments_author FOREIGN KEY (author_id) REFERENCES public.authusers(id);


--
-- Name: email_comments fk_email_comments_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_comments
    ADD CONSTRAINT fk_email_comments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_drafts fk_email_drafts_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT fk_email_drafts_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: email_drafts fk_email_drafts_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT fk_email_drafts_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_drafts fk_email_drafts_user; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_drafts
    ADD CONSTRAINT fk_email_drafts_user FOREIGN KEY (user_id) REFERENCES public.authusers(id) ON DELETE CASCADE;


--
-- Name: email_headers fk_email_headers_email; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_headers
    ADD CONSTRAINT fk_email_headers_email FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_headers fk_email_headers_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_headers
    ADD CONSTRAINT fk_email_headers_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_read_states fk_email_read_states_email; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_read_states
    ADD CONSTRAINT fk_email_read_states_email FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_read_states fk_email_read_states_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_read_states
    ADD CONSTRAINT fk_email_read_states_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: email_read_states fk_email_read_states_user; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_read_states
    ADD CONSTRAINT fk_email_read_states_user FOREIGN KEY (user_id) REFERENCES public.authusers(id);


--
-- Name: email_recipients fk_email_recipients_email; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_recipients
    ADD CONSTRAINT fk_email_recipients_email FOREIGN KEY (email_id) REFERENCES public.emails(id) ON DELETE CASCADE;


--
-- Name: email_recipients fk_email_recipients_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_recipients
    ADD CONSTRAINT fk_email_recipients_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_trash fk_email_trash_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_trash
    ADD CONSTRAINT fk_email_trash_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: emails fk_emails_assigned; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT fk_emails_assigned FOREIGN KEY (assigned_to) REFERENCES public.authusers(id);


--
-- Name: emails fk_emails_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT fk_emails_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: emails fk_emails_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.emails
    ADD CONSTRAINT fk_emails_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_suppressions fk_esup_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT fk_esup_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: event_registrations fk_event_registrations_event; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT fk_event_registrations_event FOREIGN KEY (event_id, tenant_id) REFERENCES public.events(id, tenant_id) ON DELETE CASCADE;


--
-- Name: event_registrations fk_event_registrations_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT fk_event_registrations_person FOREIGN KEY (person_id, tenant_id) REFERENCES public.persons(id, tenant_id) ON DELETE CASCADE;


--
-- Name: event_registrations fk_event_registrations_ticket_type; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT fk_event_registrations_ticket_type FOREIGN KEY (ticket_type_id) REFERENCES public.event_ticket_types(id) ON DELETE SET NULL;


--
-- Name: event_ticket_types fk_event_ticket_types_event; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.event_ticket_types
    ADD CONSTRAINT fk_event_ticket_types_event FOREIGN KEY (event_id, tenant_id) REFERENCES public.events(id, tenant_id) ON DELETE CASCADE;


--
-- Name: events fk_events_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT fk_events_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: volunteer_events fk_events_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_events
    ADD CONSTRAINT fk_events_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: volunteer_events fk_events_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_events
    ADD CONSTRAINT fk_events_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: volunteer_events fk_events_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_events
    ADD CONSTRAINT fk_events_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: files fk_files_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT fk_files_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: files fk_files_uploaded_by; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT fk_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES public.authusers(id) ON DELETE SET NULL;


--
-- Name: form_submissions fk_form_submissions_form; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT fk_form_submissions_form FOREIGN KEY (form_id, tenant_id) REFERENCES public.web_forms(id, tenant_id) ON DELETE CASCADE;


--
-- Name: form_submissions fk_form_submissions_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT fk_form_submissions_person FOREIGN KEY (person_id, tenant_id) REFERENCES public.persons(id, tenant_id) ON DELETE CASCADE;


--
-- Name: google_oauth_tokens fk_google_oauth_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.google_oauth_tokens
    ADD CONSTRAINT fk_google_oauth_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: google_oauth_tokens fk_google_oauth_tokens_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.google_oauth_tokens
    ADD CONSTRAINT fk_google_oauth_tokens_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: persons fk_household_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT fk_household_id FOREIGN KEY (household_id) REFERENCES public.households(id);


--
-- Name: households fk_households_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT fk_households_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: households fk_households_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.households
    ADD CONSTRAINT fk_households_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: lists fk_lists_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.lists
    ADD CONSTRAINT fk_lists_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: lists fk_lists_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.lists
    ADD CONSTRAINT fk_lists_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: lists fk_lists_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.lists
    ADD CONSTRAINT fk_lists_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: lists fk_lists_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.lists
    ADD CONSTRAINT fk_lists_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: map_campaigns_users fk_map_campaigns_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_campaigns_users
    ADD CONSTRAINT fk_map_campaigns_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_households_tags fk_map_household_tags_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_households_tags
    ADD CONSTRAINT fk_map_household_tags_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_lists_households fk_map_lists_households_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_households
    ADD CONSTRAINT fk_map_lists_households_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_lists_persons fk_map_lists_persons_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_persons
    ADD CONSTRAINT fk_map_lists_persons_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_newsletters_lists fk_map_newsletters_lists_list; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_newsletters_lists
    ADD CONSTRAINT fk_map_newsletters_lists_list FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE;


--
-- Name: map_newsletters_lists fk_map_newsletters_lists_newsletter; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_newsletters_lists
    ADD CONSTRAINT fk_map_newsletters_lists_newsletter FOREIGN KEY (newsletter_id) REFERENCES public.newsletters(id) ON DELETE CASCADE;


--
-- Name: map_newsletters_lists fk_map_newsletters_lists_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_newsletters_lists
    ADD CONSTRAINT fk_map_newsletters_lists_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_peoples_tags fk_map_peoples_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_peoples_tags
    ADD CONSTRAINT fk_map_peoples_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_teams_lists fk_map_teams_lists_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_lists
    ADD CONSTRAINT fk_map_teams_lists_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: map_teams_lists fk_map_teams_lists_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_lists
    ADD CONSTRAINT fk_map_teams_lists_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_teams_lists fk_map_teams_lists_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_lists
    ADD CONSTRAINT fk_map_teams_lists_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: map_teams_persons fk_map_teams_persons_created; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_persons
    ADD CONSTRAINT fk_map_teams_persons_created FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: map_teams_persons fk_map_teams_persons_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_persons
    ADD CONSTRAINT fk_map_teams_persons_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: map_teams_persons fk_map_teams_persons_updated; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_persons
    ADD CONSTRAINT fk_map_teams_persons_updated FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: map_web_forms_lists fk_map_web_forms_lists_form; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_web_forms_lists
    ADD CONSTRAINT fk_map_web_forms_lists_form FOREIGN KEY (web_form_id) REFERENCES public.web_forms(id) ON DELETE CASCADE;


--
-- Name: map_web_forms_lists fk_map_web_forms_lists_list; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_web_forms_lists
    ADD CONSTRAINT fk_map_web_forms_lists_list FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE;


--
-- Name: map_web_forms_lists fk_map_web_forms_lists_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_web_forms_lists
    ADD CONSTRAINT fk_map_web_forms_lists_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: ms_oauth_tokens fk_ms_oauth_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.ms_oauth_tokens
    ADD CONSTRAINT fk_ms_oauth_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ms_oauth_tokens fk_ms_oauth_tokens_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.ms_oauth_tokens
    ADD CONSTRAINT fk_ms_oauth_tokens_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: newsletter_events fk_newsletter_events_newsletter_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletter_events
    ADD CONSTRAINT fk_newsletter_events_newsletter_id FOREIGN KEY (newsletter_id) REFERENCES public.newsletters(id) ON DELETE CASCADE;


--
-- Name: newsletter_events fk_newsletter_events_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletter_events
    ADD CONSTRAINT fk_newsletter_events_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: newsletters fk_newsletters_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT fk_newsletters_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: newsletters fk_newsletters_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT fk_newsletters_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: newsletters fk_newsletters_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT fk_newsletters_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: newsletters fk_newsletters_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.newsletters
    ADD CONSTRAINT fk_newsletters_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: notifications fk_notifications_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: notifications fk_notifications_user; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES public.authusers(id) ON DELETE CASCADE;


--
-- Name: passkeys fk_passkeys_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT fk_passkeys_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: persons fk_persons_assigned_to; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT fk_persons_assigned_to FOREIGN KEY (assigned_to) REFERENCES public.authusers(id) ON DELETE SET NULL;


--
-- Name: persons fk_persons_company; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT fk_persons_company FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: persons fk_persons_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT fk_persons_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: persons fk_persons_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT fk_persons_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: person_newsletter_engagements fk_pne_newsletter; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.person_newsletter_engagements
    ADD CONSTRAINT fk_pne_newsletter FOREIGN KEY (newsletter_id) REFERENCES public.newsletters(id) ON DELETE CASCADE;


--
-- Name: person_newsletter_engagements fk_pne_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.person_newsletter_engagements
    ADD CONSTRAINT fk_pne_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: potential_duplicates fk_potential_duplicates_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.potential_duplicates
    ADD CONSTRAINT fk_potential_duplicates_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: potential_duplicates fk_potential_duplicates_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.potential_duplicates
    ADD CONSTRAINT fk_potential_duplicates_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: profiles fk_profiles_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT fk_profiles_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: profiles fk_profiles_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT fk_profiles_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: profiles fk_profiles_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT fk_profiles_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: sessions fk_sessions_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT fk_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: settings fk_settings_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT fk_settings_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: volunteer_shifts fk_shifts_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts
    ADD CONSTRAINT fk_shifts_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: volunteer_shifts fk_shifts_event; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts
    ADD CONSTRAINT fk_shifts_event FOREIGN KEY (event_id) REFERENCES public.volunteer_events(id) ON DELETE CASCADE;


--
-- Name: volunteer_shifts fk_shifts_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts
    ADD CONSTRAINT fk_shifts_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: volunteer_shifts fk_shifts_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts
    ADD CONSTRAINT fk_shifts_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: volunteer_shifts fk_shifts_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.volunteer_shifts
    ADD CONSTRAINT fk_shifts_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: tags fk_tags_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT fk_tags_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: tags fk_tags_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT fk_tags_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tags fk_tags_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT fk_tags_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: task_attachments fk_task_attachments_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT fk_task_attachments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: task_comments fk_task_comments_author; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT fk_task_comments_author FOREIGN KEY (author_id) REFERENCES public.authusers(id) ON DELETE CASCADE;


--
-- Name: task_comments fk_task_comments_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT fk_task_comments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: task_subtasks fk_task_subtasks_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT fk_task_subtasks_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tasks fk_tasks_assigned_to; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_assigned_to FOREIGN KEY (assigned_to) REFERENCES public.authusers(id);


--
-- Name: tasks fk_tasks_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: tasks fk_tasks_team_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_team_id FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: tasks fk_tasks_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tasks fk_tasks_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: teams fk_teams_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT fk_teams_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: teams fk_teams_team_captain; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT fk_teams_team_captain FOREIGN KEY (team_captain_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: teams fk_teams_team_lead_user; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT fk_teams_team_lead_user FOREIGN KEY (team_lead_user_id) REFERENCES public.authusers(id);


--
-- Name: teams fk_teams_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT fk_teams_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: teams fk_teams_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT fk_teams_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: turf_assignments fk_turf_assignments_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT fk_turf_assignments_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: turf_assignments fk_turf_assignments_team; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT fk_turf_assignments_team FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: turf_assignments fk_turf_assignments_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT fk_turf_assignments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: turf_assignments fk_turf_assignments_turf; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT fk_turf_assignments_turf FOREIGN KEY (turf_id) REFERENCES public.turfs(id) ON DELETE CASCADE;


--
-- Name: turf_assignments fk_turf_assignments_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_assignments
    ADD CONSTRAINT fk_turf_assignments_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: turf_households fk_turf_households_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_households
    ADD CONSTRAINT fk_turf_households_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: turf_households fk_turf_households_household; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_households
    ADD CONSTRAINT fk_turf_households_household FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;


--
-- Name: turf_households fk_turf_households_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_households
    ADD CONSTRAINT fk_turf_households_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: turf_households fk_turf_households_turf; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_households
    ADD CONSTRAINT fk_turf_households_turf FOREIGN KEY (turf_id) REFERENCES public.turfs(id) ON DELETE CASCADE;


--
-- Name: turf_households fk_turf_households_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_households
    ADD CONSTRAINT fk_turf_households_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: turf_knocks fk_turf_knocks_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT fk_turf_knocks_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: turf_knocks fk_turf_knocks_household; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT fk_turf_knocks_household FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;


--
-- Name: turf_knocks fk_turf_knocks_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT fk_turf_knocks_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE SET NULL;


--
-- Name: turf_knocks fk_turf_knocks_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT fk_turf_knocks_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: turf_knocks fk_turf_knocks_turf; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT fk_turf_knocks_turf FOREIGN KEY (turf_id) REFERENCES public.turfs(id) ON DELETE CASCADE;


--
-- Name: turf_knocks fk_turf_knocks_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turf_knocks
    ADD CONSTRAINT fk_turf_knocks_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: turfs fk_turfs_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs
    ADD CONSTRAINT fk_turfs_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: turfs fk_turfs_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs
    ADD CONSTRAINT fk_turfs_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: turfs fk_turfs_list; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs
    ADD CONSTRAINT fk_turfs_list FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE SET NULL;


--
-- Name: turfs fk_turfs_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs
    ADD CONSTRAINT fk_turfs_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: turfs fk_turfs_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.turfs
    ADD CONSTRAINT fk_turfs_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: user_activity fk_user_activity_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT fk_user_activity_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: user_activity fk_user_activity_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT fk_user_activity_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: user_activity fk_user_activity_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT fk_user_activity_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: user_activity fk_user_activity_user; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT fk_user_activity_user FOREIGN KEY (user_id) REFERENCES public.authusers(id);


--
-- Name: map_campaigns_users fk_user_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_campaigns_users
    ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES public.authusers(id);


--
-- Name: web_forms fk_web_forms_campaign; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.web_forms
    ADD CONSTRAINT fk_web_forms_campaign FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: web_forms fk_web_forms_createdby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.web_forms
    ADD CONSTRAINT fk_web_forms_createdby_id FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: web_forms fk_web_forms_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.web_forms
    ADD CONSTRAINT fk_web_forms_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: web_forms fk_web_forms_updatedby_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.web_forms
    ADD CONSTRAINT fk_web_forms_updatedby_id FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: webhook_events fk_webhook_events_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT fk_webhook_events_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_enrollments fk_workflow_enrollments_person; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_enrollments
    ADD CONSTRAINT fk_workflow_enrollments_person FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: workflow_enrollments fk_workflow_enrollments_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_enrollments
    ADD CONSTRAINT fk_workflow_enrollments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_enrollments fk_workflow_enrollments_workflow; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_enrollments
    ADD CONSTRAINT fk_workflow_enrollments_workflow FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_runs fk_workflow_runs_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT fk_workflow_runs_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflow_runs fk_workflow_runs_workflow_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_runs
    ADD CONSTRAINT fk_workflow_runs_workflow_id FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_steps fk_workflow_steps_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT fk_workflow_steps_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflow_steps fk_workflow_steps_workflow; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflow_steps
    ADD CONSTRAINT fk_workflow_steps_workflow FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflows fk_workflows_createdby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT fk_workflows_createdby FOREIGN KEY (createdby_id) REFERENCES public.authusers(id);


--
-- Name: workflows fk_workflows_tenant; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT fk_workflows_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: workflows fk_workflows_updatedby; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT fk_workflows_updatedby FOREIGN KEY (updatedby_id) REFERENCES public.authusers(id);


--
-- Name: map_households_tags map_households_tags_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_households_tags
    ADD CONSTRAINT map_households_tags_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;


--
-- Name: map_households_tags map_households_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_households_tags
    ADD CONSTRAINT map_households_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: map_lists_households map_lists_households_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_households
    ADD CONSTRAINT map_lists_households_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;


--
-- Name: map_lists_households map_lists_households_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_households
    ADD CONSTRAINT map_lists_households_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE;


--
-- Name: map_lists_persons map_lists_persons_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_persons
    ADD CONSTRAINT map_lists_persons_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE;


--
-- Name: map_lists_persons map_lists_persons_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_lists_persons
    ADD CONSTRAINT map_lists_persons_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: map_peoples_tags map_peoples_tags_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_peoples_tags
    ADD CONSTRAINT map_peoples_tags_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: map_peoples_tags map_peoples_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_peoples_tags
    ADD CONSTRAINT map_peoples_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: map_teams_lists map_teams_lists_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_lists
    ADD CONSTRAINT map_teams_lists_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE CASCADE;


--
-- Name: map_teams_lists map_teams_lists_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_lists
    ADD CONSTRAINT map_teams_lists_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: map_teams_persons map_teams_persons_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_persons
    ADD CONSTRAINT map_teams_persons_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: map_teams_persons map_teams_persons_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.map_teams_persons
    ADD CONSTRAINT map_teams_persons_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: passkeys passkeys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.authusers(id) ON DELETE CASCADE;


--
-- Name: person_connections pc_from_person_fk; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.person_connections
    ADD CONSTRAINT pc_from_person_fk FOREIGN KEY (from_person_id, tenant_id) REFERENCES public.persons(id, tenant_id) ON DELETE CASCADE;


--
-- Name: person_connections pc_to_person_fk; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.person_connections
    ADD CONSTRAINT pc_to_person_fk FOREIGN KEY (to_person_id, tenant_id) REFERENCES public.persons(id, tenant_id) ON DELETE CASCADE;


--
-- Name: potential_duplicates potential_duplicates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.potential_duplicates
    ADD CONSTRAINT potential_duplicates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: potential_duplicates potential_duplicates_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.potential_duplicates
    ADD CONSTRAINT potential_duplicates_household_id_fkey FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_auth_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES public.authusers(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_avatar_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_avatar_file_id_fkey FOREIGN KEY (avatar_file_id) REFERENCES public.files(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.authusers(id) ON DELETE CASCADE;


--
-- Name: task_attachments task_attachments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_comments task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_subtasks task_subtasks_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.task_subtasks
    ADD CONSTRAINT task_subtasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: tenants tenants_placeholder_household_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_placeholder_household_id_fkey FOREIGN KEY (placeholder_household_id) REFERENCES public.households(id) ON DELETE SET NULL;


--
-- Name: zapier_subscriptions zapier_subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.zapier_subscriptions
    ADD CONSTRAINT zapier_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workspace_api_keys workspace_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workspace_api_keys
    ADD CONSTRAINT workspace_api_keys_pkey PRIMARY KEY (id);


--
-- Name: workspace_api_keys uq_workspace_api_keys_tenant_id; Type: CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workspace_api_keys
    ADD CONSTRAINT uq_workspace_api_keys_tenant_id UNIQUE (tenant_id);


--
-- Name: workspace_api_keys fk_workspace_api_keys_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE ONLY public.workspace_api_keys
    ADD CONSTRAINT fk_workspace_api_keys_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: authusers; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.authusers ENABLE ROW LEVEL SECURITY;

--
-- Name: background_jobs; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_person_facts; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.campaign_person_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_subscriptions; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.campaign_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: data_exports; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.data_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: data_imports; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.data_imports ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_requests; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.delivery_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_route_stops; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.delivery_route_stops ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_routes; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: dismissed_duplicate_groups; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.dismissed_duplicate_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: donation_periods; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.donation_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: donation_pledges; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.donation_pledges ENABLE ROW LEVEL SECURITY;

--
-- Name: donations; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

--
-- Name: email_attachments; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: email_bodies; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_bodies ENABLE ROW LEVEL SECURITY;

--
-- Name: email_comments; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: email_drafts; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: email_headers; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_headers ENABLE ROW LEVEL SECURITY;

--
-- Name: email_read_states; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_read_states ENABLE ROW LEVEL SECURITY;

--
-- Name: email_recipients; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: email_suppressions; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

--
-- Name: email_trash; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.email_trash ENABLE ROW LEVEL SECURITY;

--
-- Name: emails; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

--
-- Name: event_registrations; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: event_ticket_types; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.event_ticket_types ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: files; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

--
-- Name: form_submissions; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: google_oauth_tokens; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: households; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

--
-- Name: lists; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;

--
-- Name: map_campaigns_users; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_campaigns_users ENABLE ROW LEVEL SECURITY;

--
-- Name: map_households_tags; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_households_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: map_lists_households; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_lists_households ENABLE ROW LEVEL SECURITY;

--
-- Name: map_lists_persons; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_lists_persons ENABLE ROW LEVEL SECURITY;

--
-- Name: map_newsletters_lists; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_newsletters_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: map_peoples_tags; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_peoples_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: map_teams_lists; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_teams_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: map_teams_persons; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_teams_persons ENABLE ROW LEVEL SECURITY;

--
-- Name: map_web_forms_lists; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.map_web_forms_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: ms_oauth_tokens; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.ms_oauth_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletter_events; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.newsletter_events ENABLE ROW LEVEL SECURITY;

--
-- Name: newsletters; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.newsletters ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: passkeys; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.passkeys ENABLE ROW LEVEL SECURITY;

--
-- Name: person_connections; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.person_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: person_newsletter_engagements; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.person_newsletter_engagements ENABLE ROW LEVEL SECURITY;

--
-- Name: persons; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

--
-- Name: potential_duplicates; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.potential_duplicates ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tags; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

--
-- Name: task_attachments; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_comments; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_subtasks; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: authusers tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.authusers USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: background_jobs tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.background_jobs USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: campaign_person_facts tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.campaign_person_facts USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: campaign_subscriptions tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.campaign_subscriptions USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: campaigns tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.campaigns USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: companies tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.companies USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: data_exports tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.data_exports USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: data_imports tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.data_imports USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: delivery_requests tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.delivery_requests USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: delivery_route_stops tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.delivery_route_stops USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: delivery_routes tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.delivery_routes USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: dismissed_duplicate_groups tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.dismissed_duplicate_groups USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: donation_periods tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.donation_periods USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: donation_pledges tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.donation_pledges USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: donations tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.donations USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_attachments tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_attachments USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_bodies tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_bodies USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_comments tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_comments USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_drafts tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_drafts USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_headers tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_headers USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_read_states tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_read_states USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_recipients tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_recipients USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_suppressions tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_suppressions USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: email_trash tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.email_trash USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: emails tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.emails USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: event_registrations tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.event_registrations USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: event_ticket_types tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.event_ticket_types USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: events tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.events USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: files tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.files USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: form_submissions tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.form_submissions USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: google_oauth_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.google_oauth_tokens USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: households tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.households USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: lists tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.lists USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_campaigns_users tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_campaigns_users USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_households_tags tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_households_tags USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_lists_households tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_lists_households USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_lists_persons tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_lists_persons USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_newsletters_lists tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_newsletters_lists USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_peoples_tags tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_peoples_tags USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_teams_lists tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_teams_lists USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_teams_persons tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_teams_persons USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: map_web_forms_lists tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.map_web_forms_lists USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: ms_oauth_tokens tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.ms_oauth_tokens USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: newsletter_events tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.newsletter_events USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: newsletters tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.newsletters USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: notifications tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.notifications USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: passkeys tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.passkeys USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: person_connections tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.person_connections USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: person_newsletter_engagements tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.person_newsletter_engagements USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: persons tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.persons USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: potential_duplicates tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.potential_duplicates USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: profiles tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.profiles USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: sessions tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.sessions USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: settings tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.settings USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: tags tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.tags USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: task_attachments tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.task_attachments USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: task_comments tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.task_comments USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: task_subtasks tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.task_subtasks USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: tasks tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.tasks USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: teams tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.teams USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: turf_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.turf_assignments USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: turf_households tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.turf_households USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: turf_knocks tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.turf_knocks USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: turfs tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.turfs USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: user_activity tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.user_activity USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: volunteer_events tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.volunteer_events USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: volunteer_shifts tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.volunteer_shifts USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: web_forms tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.web_forms USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: webhook_events tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.webhook_events USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: workflow_enrollments tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.workflow_enrollments USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: workflow_runs tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.workflow_runs USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: workflow_steps tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.workflow_steps USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: workflows tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.workflows USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: zapier_subscriptions tenant_isolation; Type: POLICY; Schema: public; Owner: pplcrm_owner
--

CREATE POLICY tenant_isolation ON public.zapier_subscriptions USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint))) WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)));


--
-- Name: turf_assignments; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.turf_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: turf_households; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.turf_households ENABLE ROW LEVEL SECURITY;

--
-- Name: turf_knocks; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.turf_knocks ENABLE ROW LEVEL SECURITY;

--
-- Name: turfs; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.turfs ENABLE ROW LEVEL SECURITY;

--
-- Name: user_activity; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_events; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.volunteer_events ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_shifts; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.volunteer_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: web_forms; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.web_forms ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_enrollments; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.workflow_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_runs; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_steps; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: workflows; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

--
-- Name: zapier_subscriptions; Type: ROW SECURITY; Schema: public; Owner: pplcrm_owner
--

ALTER TABLE public.zapier_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pplcrm_owner
--

GRANT USAGE ON SCHEMA public TO pplcrm_app;


--
-- Name: TABLE authusers; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.authusers TO pplcrm_app;


--
-- Name: SEQUENCE authusers_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.authusers_id_seq TO pplcrm_app;


--
-- Name: TABLE background_jobs; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.background_jobs TO pplcrm_app;


--
-- Name: SEQUENCE background_jobs_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.background_jobs_id_seq TO pplcrm_app;


--
-- Name: TABLE campaign_person_facts; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.campaign_person_facts TO pplcrm_app;


--
-- Name: SEQUENCE campaign_person_facts_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.campaign_person_facts_id_seq TO pplcrm_app;


--
-- Name: TABLE campaign_subscriptions; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.campaign_subscriptions TO pplcrm_app;


--
-- Name: SEQUENCE campaign_subscriptions_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.campaign_subscriptions_id_seq TO pplcrm_app;


--
-- Name: TABLE campaigns; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.campaigns TO pplcrm_app;


--
-- Name: SEQUENCE campaigns_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.campaigns_id_seq TO pplcrm_app;


--
-- Name: TABLE companies; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.companies TO pplcrm_app;


--
-- Name: SEQUENCE companies_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.companies_id_seq TO pplcrm_app;


--
-- Name: TABLE data_exports; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.data_exports TO pplcrm_app;


--
-- Name: SEQUENCE data_exports_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.data_exports_id_seq TO pplcrm_app;


--
-- Name: TABLE data_imports; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.data_imports TO pplcrm_app;


--
-- Name: SEQUENCE data_imports_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.data_imports_id_seq TO pplcrm_app;


--
-- Name: TABLE delivery_requests; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.delivery_requests TO pplcrm_app;


--
-- Name: SEQUENCE delivery_requests_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.delivery_requests_id_seq TO pplcrm_app;


--
-- Name: TABLE delivery_route_stops; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.delivery_route_stops TO pplcrm_app;


--
-- Name: SEQUENCE delivery_route_stops_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.delivery_route_stops_id_seq TO pplcrm_app;


--
-- Name: TABLE delivery_routes; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.delivery_routes TO pplcrm_app;


--
-- Name: SEQUENCE delivery_routes_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.delivery_routes_id_seq TO pplcrm_app;


--
-- Name: TABLE dismissed_duplicate_groups; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.dismissed_duplicate_groups TO pplcrm_app;


--
-- Name: TABLE donation_periods; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.donation_periods TO pplcrm_app;


--
-- Name: SEQUENCE donation_periods_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.donation_periods_id_seq TO pplcrm_app;


--
-- Name: TABLE donation_pledges; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.donation_pledges TO pplcrm_app;


--
-- Name: SEQUENCE donation_pledges_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.donation_pledges_id_seq TO pplcrm_app;


--
-- Name: TABLE donations; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.donations TO pplcrm_app;


--
-- Name: SEQUENCE donations_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.donations_id_seq TO pplcrm_app;


--
-- Name: TABLE email_attachments; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_attachments TO pplcrm_app;


--
-- Name: SEQUENCE email_attachments_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_attachments_id_seq TO pplcrm_app;


--
-- Name: TABLE email_bodies; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_bodies TO pplcrm_app;


--
-- Name: SEQUENCE email_bodies_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_bodies_id_seq TO pplcrm_app;


--
-- Name: TABLE email_comments; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_comments TO pplcrm_app;


--
-- Name: SEQUENCE email_comments_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_comments_id_seq TO pplcrm_app;


--
-- Name: TABLE email_drafts; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_drafts TO pplcrm_app;


--
-- Name: SEQUENCE email_drafts_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_drafts_id_seq TO pplcrm_app;


--
-- Name: TABLE email_headers; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_headers TO pplcrm_app;


--
-- Name: SEQUENCE email_headers_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_headers_id_seq TO pplcrm_app;


--
-- Name: TABLE email_read_states; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_read_states TO pplcrm_app;


--
-- Name: TABLE email_recipients; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_recipients TO pplcrm_app;


--
-- Name: SEQUENCE email_recipients_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_recipients_id_seq TO pplcrm_app;


--
-- Name: TABLE email_suppressions; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_suppressions TO pplcrm_app;


--
-- Name: SEQUENCE email_suppressions_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_suppressions_id_seq TO pplcrm_app;


--
-- Name: TABLE email_trash; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.email_trash TO pplcrm_app;


--
-- Name: SEQUENCE email_trash_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.email_trash_id_seq TO pplcrm_app;


--
-- Name: TABLE emails; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.emails TO pplcrm_app;


--
-- Name: SEQUENCE emails_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.emails_id_seq TO pplcrm_app;


--
-- Name: TABLE event_registrations; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.event_registrations TO pplcrm_app;


--
-- Name: SEQUENCE event_registrations_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.event_registrations_id_seq TO pplcrm_app;


--
-- Name: TABLE event_ticket_types; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.event_ticket_types TO pplcrm_app;


--
-- Name: SEQUENCE event_ticket_types_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.event_ticket_types_id_seq TO pplcrm_app;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.events TO pplcrm_app;


--
-- Name: SEQUENCE events_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.events_id_seq TO pplcrm_app;


--
-- Name: TABLE files; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.files TO pplcrm_app;


--
-- Name: SEQUENCE files_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.files_id_seq TO pplcrm_app;


--
-- Name: TABLE form_submissions; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.form_submissions TO pplcrm_app;


--
-- Name: TABLE google_oauth_tokens; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.google_oauth_tokens TO pplcrm_app;


--
-- Name: TABLE households; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.households TO pplcrm_app;


--
-- Name: SEQUENCE households_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.households_id_seq TO pplcrm_app;


--
-- Name: TABLE kysely_migration; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kysely_migration TO pplcrm_app;


--
-- Name: TABLE kysely_migration_lock; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kysely_migration_lock TO pplcrm_app;


--
-- Name: TABLE lists; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.lists TO pplcrm_app;


--
-- Name: SEQUENCE lists_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.lists_id_seq TO pplcrm_app;


--
-- Name: TABLE map_campaigns_users; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_campaigns_users TO pplcrm_app;


--
-- Name: TABLE map_households_tags; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_households_tags TO pplcrm_app;


--
-- Name: TABLE map_lists_households; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_lists_households TO pplcrm_app;


--
-- Name: TABLE map_lists_persons; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_lists_persons TO pplcrm_app;


--
-- Name: TABLE map_newsletters_lists; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_newsletters_lists TO pplcrm_app;


--
-- Name: TABLE map_peoples_tags; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_peoples_tags TO pplcrm_app;


--
-- Name: TABLE map_teams_lists; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_teams_lists TO pplcrm_app;


--
-- Name: TABLE map_teams_persons; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_teams_persons TO pplcrm_app;


--
-- Name: TABLE map_web_forms_lists; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.map_web_forms_lists TO pplcrm_app;


--
-- Name: TABLE ms_oauth_tokens; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ms_oauth_tokens TO pplcrm_app;


--
-- Name: TABLE newsletter_events; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.newsletter_events TO pplcrm_app;


--
-- Name: SEQUENCE newsletter_events_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.newsletter_events_id_seq TO pplcrm_app;


--
-- Name: TABLE newsletters; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.newsletters TO pplcrm_app;


--
-- Name: SEQUENCE newsletters_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.newsletters_id_seq TO pplcrm_app;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO pplcrm_app;


--
-- Name: SEQUENCE notifications_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.notifications_id_seq TO pplcrm_app;


--
-- Name: TABLE passkeys; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.passkeys TO pplcrm_app;


--
-- Name: SEQUENCE passkeys_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.passkeys_id_seq TO pplcrm_app;


--
-- Name: TABLE person_connections; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.person_connections TO pplcrm_app;


--
-- Name: SEQUENCE person_connections_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.person_connections_id_seq TO pplcrm_app;


--
-- Name: TABLE person_newsletter_engagements; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.person_newsletter_engagements TO pplcrm_app;


--
-- Name: TABLE persons; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.persons TO pplcrm_app;


--
-- Name: SEQUENCE persons_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.persons_id_seq TO pplcrm_app;


--
-- Name: TABLE potential_duplicates; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.potential_duplicates TO pplcrm_app;


--
-- Name: SEQUENCE potential_duplicates_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.potential_duplicates_id_seq TO pplcrm_app;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.profiles TO pplcrm_app;


--
-- Name: SEQUENCE profiles_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.profiles_id_seq TO pplcrm_app;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO pplcrm_app;


--
-- Name: SEQUENCE sessions_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.sessions_id_seq TO pplcrm_app;


--
-- Name: TABLE settings; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.settings TO pplcrm_app;


--
-- Name: SEQUENCE settings_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.settings_id_seq TO pplcrm_app;


--
-- Name: TABLE tags; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tags TO pplcrm_app;


--
-- Name: SEQUENCE tags_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.tags_id_seq TO pplcrm_app;


--
-- Name: TABLE task_attachments; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_attachments TO pplcrm_app;


--
-- Name: SEQUENCE task_attachments_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.task_attachments_id_seq TO pplcrm_app;


--
-- Name: TABLE task_comments; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_comments TO pplcrm_app;


--
-- Name: SEQUENCE task_comments_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.task_comments_id_seq TO pplcrm_app;


--
-- Name: TABLE task_subtasks; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_subtasks TO pplcrm_app;


--
-- Name: SEQUENCE task_subtasks_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.task_subtasks_id_seq TO pplcrm_app;


--
-- Name: TABLE tasks; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tasks TO pplcrm_app;


--
-- Name: SEQUENCE tasks_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.tasks_id_seq TO pplcrm_app;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.teams TO pplcrm_app;


--
-- Name: SEQUENCE teams_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.teams_id_seq TO pplcrm_app;


--
-- Name: TABLE tenants; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenants TO pplcrm_app;


--
-- Name: SEQUENCE tenants_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.tenants_id_seq TO pplcrm_app;


--
-- Name: TABLE turf_assignments; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.turf_assignments TO pplcrm_app;


--
-- Name: SEQUENCE turf_assignments_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.turf_assignments_id_seq TO pplcrm_app;


--
-- Name: TABLE turf_households; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.turf_households TO pplcrm_app;


--
-- Name: TABLE turf_knocks; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.turf_knocks TO pplcrm_app;


--
-- Name: SEQUENCE turf_knocks_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.turf_knocks_id_seq TO pplcrm_app;


--
-- Name: TABLE turfs; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.turfs TO pplcrm_app;


--
-- Name: SEQUENCE turfs_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.turfs_id_seq TO pplcrm_app;


--
-- Name: TABLE user_activity; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_activity TO pplcrm_app;


--
-- Name: SEQUENCE user_activity_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.user_activity_id_seq TO pplcrm_app;


--
-- Name: TABLE volunteer_events; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.volunteer_events TO pplcrm_app;


--
-- Name: SEQUENCE volunteer_events_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.volunteer_events_id_seq TO pplcrm_app;


--
-- Name: TABLE volunteer_shifts; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.volunteer_shifts TO pplcrm_app;


--
-- Name: SEQUENCE volunteer_shifts_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.volunteer_shifts_id_seq TO pplcrm_app;


--
-- Name: TABLE web_forms; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.web_forms TO pplcrm_app;


--
-- Name: TABLE webhook_events; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.webhook_events TO pplcrm_app;


--
-- Name: SEQUENCE webhook_events_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.webhook_events_id_seq TO pplcrm_app;


--
-- Name: TABLE workflow_enrollments; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workflow_enrollments TO pplcrm_app;


--
-- Name: SEQUENCE workflow_enrollments_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.workflow_enrollments_id_seq TO pplcrm_app;


--
-- Name: TABLE workflow_runs; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workflow_runs TO pplcrm_app;


--
-- Name: SEQUENCE workflow_runs_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.workflow_runs_id_seq TO pplcrm_app;


--
-- Name: TABLE workflow_steps; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workflow_steps TO pplcrm_app;


--
-- Name: SEQUENCE workflow_steps_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.workflow_steps_id_seq TO pplcrm_app;


--
-- Name: TABLE workflows; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workflows TO pplcrm_app;


--
-- Name: SEQUENCE workflows_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.workflows_id_seq TO pplcrm_app;


--
-- Name: TABLE zapier_subscriptions; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.zapier_subscriptions TO pplcrm_app;


--
-- Name: SEQUENCE zapier_subscriptions_id_seq; Type: ACL; Schema: public; Owner: pplcrm_owner
--

GRANT SELECT,USAGE ON SEQUENCE public.zapier_subscriptions_id_seq TO pplcrm_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: pplcrm_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE pplcrm_owner IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO pplcrm_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: pplcrm_owner
--

ALTER DEFAULT PRIVILEGES FOR ROLE pplcrm_owner IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO pplcrm_app;


--
-- PostgreSQL database dump complete
--

\unrestrict GhboKUqFznqkwhkamB1c46bniOml3zZWjH73ur6UjfuD98WEHRhntxz9GdHkfgK

