-- ─────────────────────────────────────────────────────────────────────────────
-- AEM Employee Onboarding — Supabase Schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ─────────────────────────────────────────────────────────────────────────────

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── 1. Profiles (extends auth.users) ─────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text        not null,
  aem_email   text        not null unique,
  role        text        not null default 'newhire' check (role in ('hr', 'newhire')),
  position    text,
  start_date  date,
  status      text        not null default 'not-started'
              check (status in ('not-started','in-progress','needs-review','approved','flagged')),
  progress    integer     not null default 0 check (progress >= 0 and progress <= 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, aem_email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'newhire')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 2. Personal Information ───────────────────────────────────────────────────
create table if not exists public.personal_info (
  id                      uuid        primary key default uuid_generate_v4(),
  user_id                 uuid        not null unique references public.profiles(id) on delete cascade,
  first_name              text        not null,
  last_name               text        not null,
  date_of_birth           date        not null,
  phone                   text        not null,
  personal_email          text        not null,
  street                  text        not null,
  city                    text        not null,
  province                text        not null,
  postal_code             text        not null,
  emergency_name          text        not null,
  emergency_relationship  text        not null,
  emergency_phone         text        not null,
  form_status             text        not null default 'review'
                          check (form_status in ('pending','review','approved','flagged')),
  submitted_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ── 3. Banking Information (encrypted sensitive fields) ───────────────────────
create table if not exists public.banking_info (
  id                      uuid        primary key default uuid_generate_v4(),
  user_id                 uuid        not null unique references public.profiles(id) on delete cascade,
  bank_name               text        not null,
  account_type            text        not null check (account_type in ('Chequing','Savings')),
  institution_number_enc  text        not null,  -- AES-256 encrypted ciphertext
  transit_number_enc      text        not null,  -- AES-256 encrypted ciphertext
  account_number_enc      text        not null,  -- AES-256 encrypted ciphertext
  void_cheque_path        text,                  -- Supabase Storage path
  form_status             text        not null default 'review'
                          check (form_status in ('pending','review','approved','flagged')),
  submitted_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ── 4. Social Insurance Number (encrypted) ───────────────────────────────────
create table if not exists public.sin_info (
  id           uuid        primary key default uuid_generate_v4(),
  user_id      uuid        not null unique references public.profiles(id) on delete cascade,
  sin_enc      text        not null,  -- AES-256 encrypted ciphertext
  form_status  text        not null default 'review'
               check (form_status in ('pending','review','approved','flagged')),
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── 5. Policy Acknowledgements ────────────────────────────────────────────────
create table if not exists public.policy_acknowledgements (
  id           uuid        primary key default uuid_generate_v4(),
  user_id      uuid        not null unique references public.profiles(id) on delete cascade,
  signature    text        not null,
  agreed_at    timestamptz not null default now(),
  form_status  text        not null default 'review'
               check (form_status in ('pending','review','approved','flagged')),
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── 6. Equipment Provisioning ─────────────────────────────────────────────────
create table if not exists public.equipment_provisioning (
  id       uuid        primary key default uuid_generate_v4(),
  user_id  uuid        not null unique references public.profiles(id) on delete cascade,
  items    jsonb       not null default '{}',
  saved_by uuid        references public.profiles(id),
  saved_at timestamptz not null default now()
);

-- ── 7. HR Notes ───────────────────────────────────────────────────────────────
create table if not exists public.hr_notes (
  id         uuid        primary key default uuid_generate_v4(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  note_text  text        not null,
  created_by uuid        not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ── 8. Audit Log ──────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id           uuid        primary key default uuid_generate_v4(),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  action_type  text        not null check (action_type in ('green','amber','navy','red')),
  message      text        not null,
  performed_by uuid        references public.profiles(id),
  created_at   timestamptz not null default now()
);

-- ── 9. OTP Codes (HR two-factor) ──────────────────────────────────────────────
create table if not exists public.otp_codes (
  id         uuid        primary key default uuid_generate_v4(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  code       text        not null,
  expires_at timestamptz not null,
  used       boolean     not null default false,
  created_at timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_personal_info_user_id  on public.personal_info(user_id);
create index if not exists idx_banking_info_user_id   on public.banking_info(user_id);
create index if not exists idx_sin_info_user_id       on public.sin_info(user_id);
create index if not exists idx_policy_user_id         on public.policy_acknowledgements(user_id);
create index if not exists idx_equipment_user_id      on public.equipment_provisioning(user_id);
create index if not exists idx_hr_notes_user_id       on public.hr_notes(user_id);
create index if not exists idx_audit_log_user_id      on public.audit_log(user_id);
create index if not exists idx_otp_codes_user_id      on public.otp_codes(user_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table public.profiles                enable row level security;
alter table public.personal_info           enable row level security;
alter table public.banking_info            enable row level security;
alter table public.sin_info                enable row level security;
alter table public.policy_acknowledgements enable row level security;
alter table public.equipment_provisioning  enable row level security;
alter table public.hr_notes                enable row level security;
alter table public.audit_log               enable row level security;
alter table public.otp_codes               enable row level security;

-- Helper: is the current user an HR member?
create or replace function public.is_hr()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'hr'
  );
$$;

-- profiles
create policy "Users can view own profile"    on public.profiles for select using (id = auth.uid());
create policy "HR can view all profiles"      on public.profiles for select using (public.is_hr());
create policy "HR can update all profiles"    on public.profiles for update using (public.is_hr());
create policy "Users can update own profile"  on public.profiles for update using (id = auth.uid());

-- personal_info
create policy "Newhire can insert own"        on public.personal_info for insert with check (user_id = auth.uid());
create policy "Newhire can update own"        on public.personal_info for update using (user_id = auth.uid());
create policy "Users can view own"            on public.personal_info for select using (user_id = auth.uid());
create policy "HR can view all personal_info" on public.personal_info for select using (public.is_hr());
create policy "HR can update personal_info"   on public.personal_info for update using (public.is_hr());

-- banking_info
create policy "Newhire can insert own banking"  on public.banking_info for insert with check (user_id = auth.uid());
create policy "Newhire can update own banking"  on public.banking_info for update using (user_id = auth.uid());
create policy "HR can view all banking_info"    on public.banking_info for select using (public.is_hr());
create policy "HR can update banking_info"      on public.banking_info for update using (public.is_hr());

-- sin_info
create policy "Newhire can insert own sin"    on public.sin_info for insert with check (user_id = auth.uid());
create policy "Newhire can update own sin"    on public.sin_info for update using (user_id = auth.uid());
create policy "HR can view all sin_info"      on public.sin_info for select using (public.is_hr());
create policy "HR can update sin_info"        on public.sin_info for update using (public.is_hr());

-- policy_acknowledgements
create policy "Newhire can insert own policy"  on public.policy_acknowledgements for insert with check (user_id = auth.uid());
create policy "Newhire can update own policy"  on public.policy_acknowledgements for update using (user_id = auth.uid());
create policy "HR can view all policies"       on public.policy_acknowledgements for select using (public.is_hr());
create policy "HR can update policies"         on public.policy_acknowledgements for update using (public.is_hr());

-- equipment_provisioning
create policy "HR can manage equipment"  on public.equipment_provisioning for all using (public.is_hr());

-- hr_notes
create policy "HR full access to notes"  on public.hr_notes for all using (public.is_hr());

-- audit_log
create policy "HR can read audit log"    on public.audit_log for select using (public.is_hr());
create policy "Service can insert audit" on public.audit_log for insert with check (true);

-- otp_codes: service role only (no client-accessible policies)

-- ── Supabase Storage bucket for void cheques ──────────────────────────────────
-- Run this separately if not using the Storage UI:
-- insert into storage.buckets (id, name, public) values ('void-cheques', 'void-cheques', false);
-- create policy "Newhire can upload own cheque"
--   on storage.objects for insert with check (bucket_id = 'void-cheques' and auth.uid()::text = (storage.foldername(name))[1]);
-- create policy "HR can view cheques"
--   on storage.objects for select using (bucket_id = 'void-cheques' and public.is_hr());

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DATA — delete this section after initial setup
-- To test, create users via Supabase Auth UI, then update profiles manually.
-- ─────────────────────────────────────────────────────────────────────────────
