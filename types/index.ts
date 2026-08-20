// ── Database row types ────────────────────────────────────────────────────────

export type UserRole   = 'hr' | 'newhire'
export type HireStatus = 'not-started' | 'in-progress' | 'needs-review' | 'approved' | 'flagged'
export type FormStatus = 'pending' | 'review' | 'approved' | 'flagged'

export type Profile = {
  id:         string
  full_name:  string
  aem_email:  string
  role:       UserRole
  position:   string | null
  start_date: string | null
  status:     HireStatus
  progress:   number
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
  form_status:            FormStatus
  flag_reason:            string | null
  submitted_at:           string
  updated_at:             string
}

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
  code:       string
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
      personal_info: {
        Row:           PersonalInfo
        Insert:        Omit<PersonalInfo, 'id' | 'submitted_at' | 'updated_at'>
        Update:        Partial<Omit<PersonalInfo, 'id' | 'submitted_at'>>
        Relationships: []
      }
      banking_info: {
        Row:           BankingInfo
        Insert:        Omit<BankingInfo, 'id' | 'submitted_at' | 'updated_at'>
        Update:        Partial<Omit<BankingInfo, 'id' | 'submitted_at'>>
        Relationships: []
      }
      sin_info: {
        Row:           SinInfo
        Insert:        Omit<SinInfo, 'id' | 'submitted_at' | 'updated_at'>
        Update:        Partial<Omit<SinInfo, 'id' | 'submitted_at'>>
        Relationships: []
      }
      policy_acknowledgements: {
        Row:           PolicyAcknowledgement
        Insert:        Omit<PolicyAcknowledgement, 'id' | 'submitted_at' | 'updated_at'>
        Update:        Partial<Omit<PolicyAcknowledgement, 'id' | 'submitted_at'>>
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
        Insert:        Omit<OtpCode, 'id' | 'created_at'>
        Update:        Partial<Pick<OtpCode, 'used'>>
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      get_profile_by_email: {
        Args:    { p_email: string }
        Returns: Array<{ id: string; role: string; full_name: string }>
      }
      get_pending_otp: {
        Args:    { p_user_id: string }
        Returns: Array<{ id: string; code: string; expires_at: string }>
      }
    }
    Enums: {}
  }
}

// ── API / UI helper types ─────────────────────────────────────────────────────

export type NewHireRow = {
  id:        string
  name:      string
  email:     string
  role:      string
  status:    HireStatus
  progress:  number
  submitted: string
  days:      number
}

export type NewHireDetail = NewHireRow & {
  phone:             string
  start_date:        string
  address:           string
  emergency_contact: string
  emergency_phone:   string
  bank_name:         string
  account_type:      string
  form_statuses:     Record<string, FormStatus>
  flag_reasons:      Record<string, string | null>
  void_cheque_path:  string | null
  equipment_items:   Record<string, boolean>
  notes:             HrNote[]
  audit_log:         AuditEntry[]
}
