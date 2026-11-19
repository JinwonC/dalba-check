create sequence if not exists invoice_seq start 1001;

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  manager_email text not null,
  manager_name text,
  fields jsonb not null,
  clauses jsonb not null,
  billing_enc text,
  signature jsonb,
  invoice_number text,
  change_request text,
  change_requested_at timestamptz,
  stamped_pdf bytea,
  stamped_pdf_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  stamp_requested_at timestamptz,
  executed_at timestamptz,
  content_done_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists deals_manager_idx on deals (manager_email);
create index if not exists deals_created_idx on deals (created_at desc);

create table if not exists deal_events (
  id bigserial primary key,
  deal_id uuid not null references deals(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,
  type text not null,
  detail text
);
create index if not exists deal_events_deal_idx on deal_events (deal_id, at);
