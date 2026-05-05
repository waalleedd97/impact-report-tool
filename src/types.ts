export type ImpactLevel = "very_high" | "high" | "medium" | "low" | "very_low";

export type Teacher = {
  id: string;
  name: string;
};

export type BenefitColumn = {
  id: string;
  label: string;
};

export type SchoolSettings = {
  country: string;
  ministry: string;
  department: string;
  schoolName: string;
  principalName: string;
  totalTeachers: number;
};

export type TemplateAssets = {
  backgroundUrl?: string;
  signatureUrl?: string;
};

export type TableRegionId = "summary" | "strengths" | "improvements" | "details";

export type TableColumnTemplate = {
  id: string;
  label: string;
  widthMm?: number;
  visible?: boolean;
};

export type TableRegion = {
  id: TableRegionId;
  label: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
  rowHeightMm: number;
  headerHeightMm?: number;
  labelWidthMm?: number;
  fontSizePt?: number;
  borderColor?: string;
  backgroundColor?: string;
  textAlign?: "right" | "center" | "left";
  columns?: TableColumnTemplate[];
};

export type SmartTemplate = {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  assets: TemplateAssets;
  tableRegions: Record<TableRegionId, TableRegion>;
};

export type DynamicTableRow = Record<string, string | number | boolean | null>;

export type PagePrintOverride = {
  letterheadTopMm?: number;
  letterheadRightMm?: number;
  letterheadWidthMm?: number;
  principalNameLeftMm?: number;
  principalNameTopMm?: number;
  principalNameWidthMm?: number;
  principalNameHeightMm?: number;
  principalNameFontSizePt?: number;
  signatureImageAbsLeftMm?: number;
  signatureImageAbsTopMm?: number;
  signatureImageAbsWidthMm?: number;
  signatureImageAbsHeightMm?: number;
};

export type TextStyleOverride = {
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: number;
  color?: string;
};

export type CheckmarkOffset = {
  x: number;
  y: number;
};

export type PrintSettings = {
  letterheadTopMm: number;
  letterheadRightMm: number;
  letterheadWidthMm: number;
  letterheadFontSizePt: number;
  principalNameLeftMm: number;
  principalNameTopMm: number;
  principalNameWidthMm: number;
  principalNameHeightMm: number;
  principalNameFontSizePt: number;
  principalNameFontWeight: number;
  signatureImageAbsLeftMm: number;
  signatureImageAbsTopMm: number;
  signatureImageAbsWidthMm: number;
  signatureImageAbsHeightMm: number;
  signatureLeftMm: number;
  signatureBottomMm: number;
  signatureBoxWidthMm: number;
  signatureImageLeftMm: number;
  signatureImageTopMm: number;
  signatureImageWidthMm: number;
  signatureFontSizePt: number;
  signatureColor: string;
  fontFamily: string;
  fontSizePt: number;
  textFontWeight: number;
  textColor: string;
  titleFontSizePt: number;
  titleFontWeight: number;
  titleColor: string;
  accentColor: string;
  pageOverrides: Record<string, PagePrintOverride>;
  textStyleOverrides: Record<string, TextStyleOverride>;
  checkmarkOffsets: Record<string, CheckmarkOffset>;
};

export type ReportRow = {
  teacherId: string;
  teacherName: string;
  lessonsCount: number;
  contribution: string;
  effectiveness: string;
  benefits: Record<string, boolean>;
  acquiredSkills: string;
};

export type ReportSummary = {
  totalTeachers: number;
  participantsCount: number;
  attendancePercentage: number;
  implementedLessons: number;
  impactSummary: string;
  contributionHighPercent: number;
  contributionMediumPercent: number;
  contributionLowPercent: number;
  effectivenessHighPercent: number;
  benefitPercentages: Record<string, number>;
};

export type Report = {
  id: string;
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  createdAt: string;
  updatedAt: string;
  schoolSettings: SchoolSettings;
  templateAssets: TemplateAssets;
  smartTemplate?: SmartTemplate;
  printSettings: PrintSettings;
  benefitColumns: BenefitColumn[];
  visibleColumnIds: string[];
  rows: ReportRow[];
  summary: ReportSummary;
  percentageOverrides: Record<string, number>;
  summaryNumberOverrides: Record<string, number>;
  strengths: string[];
  improvements: string[];
};

export type GenerationOptions = {
  strengthCount?: number;
  improvementCount?: number;
  notes?: string;
};

export type Profile = {
  email: string;
  schoolSettings: SchoolSettings;
  teachers: Teacher[];
  benefitColumns: BenefitColumn[];
  visibleColumnIds: string[];
  templateAssets: TemplateAssets;
  smartTemplates: SmartTemplate[];
  activeSmartTemplateId?: string;
  printSettings: PrintSettings;
  currentReport?: Report;
};

export type StoredReportMeta = {
  id: string;
  email: string;
  title: string;
  level: ImpactLevel;
  createdAt: string;
  updatedAt: string;
  report: Report;
};
