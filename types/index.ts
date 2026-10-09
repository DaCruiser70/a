// ── Database row types ────────────────────────────────────────────────────────

export type UserRole   = 'hr' | 'newhire' | 'stakeholder' | 'payroll' | 'manager' | 'project_mgmt'
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
  progress:            number
  submitted:           string
  days:                number
  last_submitted_at:   string | null
  office_location?:    string | null
}

export type NewHireDetail = NewHireRow & {
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
