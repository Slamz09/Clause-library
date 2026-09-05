/**
 * Vendor type taxonomy — used by the Vendors page, the Document Parser's
 * inline "+ Add new vendor" flow, and the Clause Library's vendor-type
 * filter so all three stay in sync off one list. Each category also drives
 * a matching capabilities form — see lib/vendorCapabilities.ts.
 *
 * 'insurance_provider' is a separate, older tag (drives insurer-only
 * workflows elsewhere in the app — see app/(app)/vendors/page.tsx and the
 * Insurance Clause Library) and is kept out of this taxonomy on purpose;
 * "Insurance" also appears below as an ordinary Financial Services service
 * type for general vendor categorization, which is a distinct concept.
 */

export type VendorCategoryDef = {
  category: string;
  serviceTypes: string[];
};

export const VENDOR_CATEGORIES: VendorCategoryDef[] = [
  { category: 'Transportation', serviceTypes: ['NEMT', 'Student Transportation', 'Wheelchair Transport', 'Driver'] },
  { category: 'Technology', serviceTypes: ['AI Platform', 'AI Scribe', 'AI Assistant', 'Contract AI', 'Document AI', 'SaaS Platform', 'Cloud Infrastructure', 'API Provider', 'Data Processing Platform', 'Cybersecurity Platform', 'Identity Management Platform', 'Analytics Platform', 'Workflow Automation Platform'] },
  { category: 'Healthcare', serviceTypes: ['Hospital', 'Clinic', 'Physician Practice', 'Telehealth', 'Home Health', 'Hospice', 'Behavioral Health', 'Medical Device Provider', 'Laboratory', 'Pharmacy', 'Patient Monitoring', 'Medical Transportation'] },
  { category: 'Education', serviceTypes: ['Tutoring', 'Learning Management System', 'Special Education Services', 'Student Health Services', 'Testing Services', 'School Security', 'Food Services', 'After-School Programs'] },
  { category: 'Financial Services', serviceTypes: ['Banking', 'Payment Processing', 'Lending', 'Insurance', 'Investment Services', 'FinTech Platform', 'Accounting Services', 'Payroll Services'] },
  { category: 'Construction / Field Services', serviceTypes: ['Construction Contractor', 'Maintenance Provider', 'Utility Contractor', 'Environmental Services', 'Inspection Provider', 'Repair Services', 'Engineering Services'] },
  { category: 'Security Services', serviceTypes: ['Security Guard Services', 'Surveillance Monitoring', 'Access Control', 'Alarm Monitoring', 'Event Security'] },
  { category: 'Hospitality', serviceTypes: ['Hotel Operations', 'Property Management', 'Cleaning Services', 'Food Services', 'Guest Transportation', 'Security Services'] },
  { category: 'Staffing / Workforce', serviceTypes: ['Temporary Staffing', 'Contractor Management', 'Professional Staffing', 'Healthcare Staffing', 'Technical Staffing'] },
];

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** "Technology" -> "technology", "Construction / Field Services" -> "construction_field_services" */
export function categorySlug(category: string): string {
  return slugify(category);
}

// Values are namespaced by category ("hospitality:food_services" vs
// "education:food_services") since several service type labels repeat
// across categories (e.g. "Food Services", "Security Services").
export type VendorTypeOption = { value: string; label: string; group: string; category: string };

export const VENDOR_TYPE_OPTIONS: VendorTypeOption[] = VENDOR_CATEGORIES.flatMap(g =>
  g.serviceTypes.map(t => ({ value: `${categorySlug(g.category)}:${slugify(t)}`, label: t, group: g.category, category: g.category }))
);

/** Human label for a stored vendor_type value, or null if unset/unrecognized. */
export function vendorTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'insurance_provider') return 'Insurance Provider';
  return VENDOR_TYPE_OPTIONS.find(o => o.value === value)?.label ?? null;
}

/** Top-level category (Technology / Transportation / Healthcare / … / Insurance) for a stored vendor_type value. */
export function vendorTypeCategory(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'insurance_provider') return 'Insurance';
  return VENDOR_TYPE_OPTIONS.find(o => o.value === value)?.category ?? null;
}
