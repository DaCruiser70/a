// Maps equipment item IDs to the stakeholder email(s) responsible for them.
// Items not listed here have no stakeholder and are skipped during notification.
export const STAKEHOLDER_MAP: Record<string, string[]> = {
  access:        ['gboudreau@aemltd.com'],
  gascard:       ['melement@aemltd.com'],
  vehicle:       ['hhunter@aemltd.com', 'rlloyd@aemltd.com', 'mnorman@aemltd.com'],
  jonas_regular: ['melement@aemltd.com'],
  jonas_emobile: ['melement@aemltd.com'],
}

// Human-readable labels matching EQUIPMENT_LIST in the HR detail page.
export const EQUIPMENT_LABELS: Record<string, string> = {
  laptop:        'Laptop / Computer',
  phone:         'Mobile Phone',
  email:         'Email Account Setup',
  software:      'Software Licenses',
  access:        'Access Card / Key Fob',
  parking:       'Parking Pass',
  vpn:           'VPN Access',
  gascard:       'Gas Card',
  vehicle:       'Company Vehicle',
  tools:         'Tools & Equipment',
  ppe:           'PPE Equipment',
  training:      'Safety Training',
  jonas_regular: 'Jonas Access — Regular',
  jonas_emobile: 'Jonas Access — e-Mobile',
}
