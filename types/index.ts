import type { PhoneChoice, WorkPhonePlatform } from '@/lib/personal-info'

// ── Database row types ────────────────────────────────────────────────────────

export type UserRole   = 'hr' | 'newhire' | 'stakeholder' | 'payroll' | 'manager' | 'project_mgmt' | 'clearance'
export type HireStatus = 'not-started' | 'in-progress' | 'needs-review' | 'approved' | 'flagged'
export type FormStatus = 'pending' | 'review' | 'approved' | 'flagged'
export type DocStatus  = 'pending' | 'review' | 'approved' | 'rejected'

export type Profile = {
  id:                       string
  full_name:                string
  aem_email:                string
  role:                     UserRole
  roles:                    UserRole[]
  position:                 string | null
  start_date:               string | null
  status:                   HireStatus
  progress:                 number
  preferred_name:           string | null
  personal_email:           string | null
  office_location:          string | null
  reporting_manager_name:   string | null
  reporting_manager_email:  string | null
  reporting_manager_id:     string | null
  region:                   'Ontario' | 'New Brunswick' | 'Nova Scotia' | null
  form_deadline:            string | null
  probation_period:         string | null
  probation_end_date:       string | null
  probation_status:         string | null
  reminder_sent:            boolean | null
  employee_id:              string | null
  payroll_completed_at:     string | null
  entered_payroll_queue_at: string | null
  created_at:               string
  updated_at:               string
}

export type Manager = {
  id:         string
  full_name:  string
  email:      string
  user_id:    string | null
  active:     boolean
  created_at: string
  updated_at: string
}

export type ManagerPlanStatus = 'requested' | 'draft' | 'submitted'
export type ClearanceType     = 'none' | 'rcmp' | 'pspc_rcmp'

export type ManagerPlan = {
  id:                string
  newhire_id:        string
  manager_id:        string
  status:            ManagerPlanStatus
  due_date:          string | null
  assignment_seq:    number               // +1 on every change of manager; part of the request dedupe key
  // Safety training (keys from lib/training-options.ts) and the five schedule boxes
  training_items:    string[]
  training_other:    string | null
  schedule_wk1_2:    string | null
  schedule_wk2_3:    string | null
  schedule_wk3_4:    string | null
  schedule_month2:   string | null
  schedule_month3:   string | null
  day_one_contact:   string | null
  first_day_gear:    string | null
  anything_else:     string | null
  clearance_type:    ClearanceType | null
  project_number:    string | null
  project_region:    'Ontario' | 'New Brunswick' | 'Nova Scotia' | null
  submitted_at:      string | null
  created_at:        string
  updated_at:        string
}

export type ClearanceInfo = {
  id:                 string
  user_id:            string
  legal_name_enc:     string | null
  place_of_birth_enc: string | null
  dcn_enc:            string | null
  fingerprint_path:   string | null
  fingerprint_name:   string | null
  rcmp_path:          string | null
  rcmp_name:          string | null
  form_status:        FormStatus
  flag_reason:        string | null
  submitted_at:       string | null
  updated_at:         string
  // Per-form review (20261024_clearance_packages.sql)
  rcmp_review:               'pending' | 'approved' | 'rejected'
  rcmp_reject_reason:        string | null
  rcmp_reviewed_at:          string | null
  rcmp_reviewed_by:          string | null
  fingerprint_review:        'pending' | 'approved' | 'rejected'
  fingerprint_reject_reason: string | null
  fingerprint_reviewed_at:   string | null
  fingerprint_reviewed_by:   string | null
}

export type ClearanceTracking = {
  id:             string
  newhire_id:     string
  pspc_sent_at:   string | null
  pspc_sent_by:   string | null
  rcmp_sent_at:   string | null
  rcmp_sent_by:   string | null
  rcmp_recipient: string | null
  cleared_at:     string | null
  cleared_by:     string | null
  // PSPC & RCMP package (null stage until sent) and RCMP-only "Sent to BGIS"
  package_stage:    'needs_review' | 'in_process' | 'done' | 'returned' | null
  package_sent_at:  string | null
  stage_updated_at: string | null
  stage_updated_by: string | null
  returned_note:    string | null
  returned_at:      string | null
  done_at:          string | null
  sent_to_bgis:     boolean
  sent_to_bgis_at:  string | null
  sent_to_bgis_by:  string | null
  created_at:     string
  updated_at:     string
}

export type ClearanceStageHistory = {
  id:         string
  newhire_id: string
  from_stage: 'needs_review' | 'in_process' | 'done' | 'returned' | null
  to_stage:   'needs_review' | 'in_process' | 'done' | 'returned'
  actor_id:   string | null
  note:       string | null
  created_at: string
}

// Clearance form state as shown in chips and badges ('pending' = not submitted yet)
export type ClearanceStatus = FormStatus

export type RegionName = 'Ontario' | 'New Brunswick' | 'Nova Scotia'

export type RegionTeamMember = {
  id:           string
  region:       RegionName
  member_name:  string
  member_email: string
  active:       boolean
  created_at:   string
}

export type PmRequestStatus = 'open' | 'claimed' | 'done' | 'cancelled'

export type PmRequest = {
  id:           string
  newhire_id:   string
  region:       RegionName
  status:       PmRequestStatus
  claimed_by:   string | null   // region_teams.id
  claimed_at:   string | null
  completed_by: string | null   // region_teams.id
  completed_at: string | null
  // Project details entered by project management; read only by project_mgmt and HR routes
  dcc:              string | null
  standing_offer:   string | null
  project_name:     string | null
  project_location: string | null
  created_at:   string
  updated_at:   string
}

// Project-management state as shown on HR chips; null when the hire needs no request
export type PmChip = 'open' | 'claimed' | 'done' | 'needs_region'

export type OutboxStatus = 'pending' | 'sent' | 'failed'

export type NotificationOutboxRow = {
  id:         string
  dedupe_key: string
  to_emails:  string[]
  template:   string
  payload:    Record<string, unknown>
  status:     OutboxStatus
  attempts:   number
  last_error: string | null
  send_after: string
  created_at: string
  sent_at:    string | null
}

export type PersonalInfo = {
  id:                     string
  user_id:                string
  first_name:             string
  last_name:              string
  date_of_birth:          string
  phone:                  string
  personal_email:         string
  street:                 string
  city:                   string
  province:               string
  postal_code:            string
  emergency_name:         string
  emergency_relationship: string
  emergency_phone:        string
  // Phone setup (null on forms submitted before the question was added)
  phone_choice:           PhoneChoice | null
  work_phone_platform:    WorkPhonePlatform | null   // only with phone_choice 'work'
  personal_phone:         string | null              // encrypted; only with phone_choice 'personal'
  form_status:            FormStatus
  flag_reason:            string | null
  submitted_at:           string
  updated_at:             string
}

export type BankingInfo = {
  id:                     string
  user_id:                string
  bank_name:              string
  account_type:           'Chequing' | 'Savings'
  institution_number_enc: string
  transit_number_enc:     string
  account_number_enc:     string
  void_cheque_path:       string | null
  void_cheque_name:       string | null
  void_cheque_size:       number | null
  void_cheque_uploaded_at: string | null
  form_status:            FormStatus
  flag_reason:            string | null
  submitted_at:           string
  updated_at:             string
}

export type VoidChequeColumn = 'void_cheque_path' | 'void_cheque_name' | 'void_cheque_size' | 'void_cheque_uploaded_at'

export type SinInfo = {
  id:           string
  user_id:      string
  sin_enc:      string
  form_status:  FormStatus
  flag_reason:  string | null
  submitted_at: string
  updated_at:   string
}

export type PolicyAcknowledgement = {
  id:           string
  user_id:      string
  signature:    string
  agreed_at:    string
  form_status:  FormStatus
  flag_reason:  string | null
  submitted_at: string
  updated_at:   string
}

export type NewhireDocument = {
  id:                  string
  user_id:             string
  document_type:       string
  document_label:      string
  file_path:           string
  file_name:           string
  file_size:           number | null
  expiry_date:         string | null
  form_status:         DocStatus
  flag_reason:         string | null
  uploaded_at:         string
  updated_at:          string
  reviewed_at:         string | null
  reviewed_by:         string | null
  sharepoint_filed:    boolean | null
  sharepoint_filed_at: string | null
}

export type StakeholderTask = {
  id:                      string
  newhire_id:              string
  assigned_to:             string
  task_key:                string
  task_name:               string
  task_details:            string | null
  status:                  'pending' | 'confirmed'
  confirmed_at:            string | null
  completion_note_enc:     string | null
  hidden_from_stakeholder: boolean
  created_at:              string
}

// Company vehicle request (20261028_vehicle_requests.sql). details_enc is one encrypted JSON blob.
export type VehicleRequest = {
  id:                   string
  newhire_id:           string
  step:                 'rob' | 'heather' | 'marley' | 'complete'
  details_enc:          string | null
  gas_card_acquired:    boolean | null
  rob_completed_by:     string | null
  rob_completed_at:     string | null
  heather_completed_by: string | null
  heather_completed_at: string | null
  marley_confirmed_by:  string | null
  marley_confirmed_at:  string | null
  created_at:           string
  updated_at:           string
}

export type EquipmentProvisioning = {
  id:       string
  user_id:  string
  items:    Record<string, boolean>
  saved_by: string | null
  saved_at: string
}

export type HrNote = {
  id:            string
  user_id:       string
  note_text:     string
  created_by:    string
  created_at:    string
  creator_name?: string
}

export type AuditEntry = {
  id:           string
  user_id:      string
  action_type:  'green' | 'amber' | 'navy' | 'red'
  message:      string
  performed_by: string | null
  created_at:   string
}

export type OtpCode = {
  id:         string
  user_id:    string
  code:       string | null
  code_hash:  string | null
  attempts:   number
  expires_at: string
  used:       boolean
  created_at: string
}

// ── Supabase Database type (used by createClient generics) ────────────────────

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row:           Profile
        Insert:        Omit<Profile, 'created_at' | 'updated_at'>
        Update:        Partial<Omit<Profile, 'id' | 'created_at'>>
        Relationships: []
      }
      managers: {
        Row:           Manager
        Insert:        Omit<Manager, 'id' | 'created_at' | 'updated_at' | 'active' | 'user_id'> & { active?: boolean; user_id?: string | null; updated_at?: string }
        Update:        Partial<Omit<Manager, 'id' | 'created_at'>>
        Relationships: []
      }
      manager_plans: {
        Row:           ManagerPlan
        Insert:        Pick<ManagerPlan, 'newhire_id' | 'manager_id'> & Partial<Omit<ManagerPlan, 'id' | 'newhire_id' | 'manager_id'>>
        Update:        Partial<Omit<ManagerPlan, 'id' | 'newhire_id' | 'created_at'>>
        Relationships: []
      }
      clearance_info: {
        Row:           ClearanceInfo
        Insert:        Pick<ClearanceInfo, 'user_id'> & Partial<Omit<ClearanceInfo, 'id' | 'user_id'>>
        Update:        Partial<Omit<ClearanceInfo, 'id' | 'user_id'>>
        Relationships: []
      }
      clearance_stage_history: {
        Row:           ClearanceStageHistory
        Insert:        Pick<ClearanceStageHistory, 'newhire_id' | 'to_stage'> & Partial<Omit<ClearanceStageHistory, 'id' | 'newhire_id' | 'to_stage'>>
        Update:        never
        Relationships: []
      }
      clearance_tracking: {
        Row:           ClearanceTracking
        Insert:        Pick<ClearanceTracking, 'newhire_id'> & Partial<Omit<ClearanceTracking, 'id' | 'newhire_id'>>
        Update:        Partial<Omit<ClearanceTracking, 'id' | 'newhire_id' | 'created_at'>>
        Relationships: []
      }
      region_teams: {
        Row:           RegionTeamMember
        Insert:        Pick<RegionTeamMember, 'region' | 'member_name' | 'member_email'> & Partial<Pick<RegionTeamMember, 'active'>>
        Update:        Partial<Omit<RegionTeamMember, 'id' | 'created_at'>>
        Relationships: []
      }
      pm_requests: {
        Row:           PmRequest
        Insert:        Pick<PmRequest, 'newhire_id' | 'region'> & Partial<Omit<PmRequest, 'id' | 'newhire_id' | 'region'>>
        Update:        Partial<Omit<PmRequest, 'id' | 'newhire_id' | 'created_at'>>
        Relationships: []
      }
      notification_outbox: {
        Row:           NotificationOutboxRow
        Insert:        Pick<NotificationOutboxRow, 'dedupe_key' | 'to_emails' | 'template' | 'payload'> & Partial<Omit<NotificationOutboxRow, 'id' | 'dedupe_key' | 'to_emails' | 'template' | 'payload'>>
        Update:        Partial<Omit<NotificationOutboxRow, 'id' | 'dedupe_key' | 'created_at'>>
        Relationships: []
      }
      personal_info: {
        Row:           PersonalInfo
        Insert:        Omit<PersonalInfo, 'id' | 'updated_at'> & { submitted_at?: string }
        Update:        Partial<Omit<PersonalInfo, 'id'>>
        Relationships: []
      }
      banking_info: {
        Row:           BankingInfo
        // Void cheque columns are optional so an upsert that omits them leaves them untouched
        Insert:        Omit<BankingInfo, 'id' | 'updated_at' | VoidChequeColumn>
                         & Partial<Pick<BankingInfo, VoidChequeColumn>>
                         & { submitted_at?: string }
        Update:        Partial<Omit<BankingInfo, 'id'>>
        Relationships: []
      }
      sin_info: {
        Row:           SinInfo
        Insert:        Omit<SinInfo, 'id' | 'updated_at'> & { submitted_at?: string }
        Update:        Partial<Omit<SinInfo, 'id'>>
        Relationships: []
      }
      policy_acknowledgements: {
        Row:           PolicyAcknowledgement
        Insert:        Omit<PolicyAcknowledgement, 'id' | 'updated_at'> & { submitted_at?: string }
        Update:        Partial<Omit<PolicyAcknowledgement, 'id'>>
        Relationships: []
      }
      equipment_provisioning: {
        Row:           EquipmentProvisioning
        Insert:        Omit<EquipmentProvisioning, 'id'>
        Update:        Partial<Omit<EquipmentProvisioning, 'id'>>
        Relationships: []
      }
      hr_notes: {
        Row:           HrNote
        Insert:        Omit<HrNote, 'id' | 'created_at' | 'creator_name'>
        Update:        Partial<Pick<HrNote, 'note_text'>>
        Relationships: []
      }
      audit_log: {
        Row:           AuditEntry
        Insert:        Omit<AuditEntry, 'id' | 'created_at'>
        Update:        Partial<Pick<AuditEntry, 'message'>>
        Relationships: []
      }
      otp_codes: {
        Row:           OtpCode
        Insert:        Omit<OtpCode, 'id' | 'created_at' | 'attempts'>
        Update:        Partial<Pick<OtpCode, 'used'>>
        Relationships: []
      }
      newhire_documents: {
        Row:           NewhireDocument
        Insert:        Omit<NewhireDocument, 'id' | 'uploaded_at' | 'updated_at'>
        Update:        Partial<Omit<NewhireDocument, 'id' | 'user_id'>>
        Relationships: []
      }
      vehicle_requests: {
        Row:           VehicleRequest
        Insert:        Pick<VehicleRequest, 'newhire_id'> & Partial<Omit<VehicleRequest, 'id' | 'newhire_id'>>
        Update:        Partial<Omit<VehicleRequest, 'id' | 'newhire_id' | 'created_at'>>
        Relationships: []
      }
      stakeholder_tasks: {
        Row:    StakeholderTask
        Insert: Omit<StakeholderTask, 'id' | 'created_at' | 'completion_note_enc' | 'hidden_from_stakeholder'> & {
          completion_note_enc?:     string | null
          hidden_from_stakeholder?: boolean
        }
        Update: Partial<Pick<StakeholderTask, 'status' | 'confirmed_at' | 'completion_note_enc' | 'hidden_from_stakeholder'>>
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      rate_limit_hit: {
        Args:    { p_key: string; p_window_seconds: number; p_max: number }
        Returns: boolean
      }
      verify_otp: {
        Args:    { p_user_id: string; p_code_hash: string }
        Returns: 'ok' | 'bad' | 'locked' | 'none'
      }
      // Reveal codes (20261023_reveal_codes.sql; 'clearance' group from 20261024_clearance_packages.sql)
      issue_reveal_code: {
        Args:    { p_hr_user_id: string; p_hire_id: string; p_group: 'banking' | 'sin' | 'clearance' | 'personal'; p_code_hash: string; p_ttl_seconds: number }
        Returns: boolean
      }
      verify_reveal_code: {
        Args:    { p_hr_user_id: string; p_hire_id: string; p_group: 'banking' | 'sin' | 'clearance' | 'personal'; p_code_hash: string }
        Returns: 'ok' | 'bad' | 'locked' | 'none'
      }
      // 20261028_vehicle_requests.sql
      start_vehicle_request: {
        Args:    { p_newhire_id: string; p_rob_id: string; p_task_name: string }
        Returns: boolean
      }
      advance_vehicle_request: {
        Args:    {
          p_newhire_id: string; p_expected: 'rob' | 'heather' | 'marley'; p_actor_id: string
          p_details_enc: string | null; p_gas_card: boolean | null
          p_next_assignee: string | null; p_next_task_key: string | null; p_next_task_name: string | null
        }
        Returns: 'ok' | 'conflict' | 'invalid'
      }
      // 20261024_clearance_packages.sql: one conditional stage move plus its history row
      move_clearance_stage: {
        Args:    { p_newhire_id: string; p_expected: 'unsent' | 'needs_review' | 'in_process' | 'done' | 'returned'; p_to: 'needs_review' | 'in_process' | 'done' | 'returned'; p_actor_id: string | null; p_note: string | null }
        Returns: 'ok' | 'conflict' | 'invalid' | 'note_required'
      }
      reassign_manager_plan: {
        Args:    { p_newhire_id: string; p_manager_id: string }
        Returns: Array<{ outcome: 'ok' | 'unchanged' | 'no_hire' | 'no_manager'; assignment_seq: number | null }>
      }
    }
    Enums: {}
  }
}

// ── API / UI helper types ─────────────────────────────────────────────────────

export type NewHireRow = {
  id:                  string
  name:                string
  email:               string
  role:                string
  status:              HireStatus
  progress:            number       // approved items of 5 (four forms + Documents), as a percentage
  approved_items?:     number       // of total_items, from computeHireStatus
  total_items?:        number
  submitted:           string
  days:                number
  last_submitted_at:   string | null
  office_location?:    string | null
  plan_chip?:          PlanChip | null
  clearance_chip?:     ClearanceStatus | null   // null when the hire needs no clearance
  pm_chip?:            { state: PmChip; claimed_by_name: string | null } | null
}

// Manager plan state as shown on HR chips; null when no plan was requested
export type PlanChip = 'awaiting' | 'draft' | 'submitted' | 'overdue'

export type NewHireDetail = NewHireRow & {
  region:                   RegionName | null   // separate from the office; HR can change it
  phone:                    string
  start_date:               string
  address:                  string
  emergency_contact:        string
  emergency_phone:          string
  bank_name:                string
  account_type:             string
  form_statuses:            Record<string, FormStatus>
  flag_reasons:             Record<string, string | null>
  has_void_cheque:          boolean
  has_banking:              boolean   // banking numbers on file; values only through the reveal routes
  has_sin:                  boolean   // SIN on file; value only through the reveal routes
  has_date_of_birth:        boolean   // date of birth on file; value only through the 'personal' reveal
  has_personal_phone:       boolean   // personal phone on file; value only through the 'personal' reveal
  phone_choice:             PhoneChoice | null
  work_phone_platform:      WorkPhonePlatform | null
  equipment_items:          Record<string, boolean>
  notes:                    HrNote[]
  audit_log:                AuditEntry[]
  preferred_name?:          string | null
  personal_email?:          string | null
  reporting_manager_name?:  string | null
  reporting_manager_email?: string | null
  form_deadline?:           string | null
  probation_period?:        string | null
  probation_end_date?:      string | null
  probation_status?:        string | null
  employee_id?:             string | null
  payroll_completed_at?:    string | null
  form_submitted_at?:       Record<string, string | null>
}
