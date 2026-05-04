import type { BenefitColumn, PrintSettings, Profile, SchoolSettings, SmartTemplate, TemplateAssets } from "./types";

export const defaultBenefitColumns: BenefitColumn[] = [
  { id: "subject", label: "فهم المادة الدراسية" },
  { id: "teaching", label: "تطوير المهارات التدريسية" },
  { id: "confidence", label: "تعزيز الثقة بالنفس" },
  { id: "teamwork", label: "تحسين العمل الجماعي" },
  { id: "classroom", label: "الإدارة الصفية" },
  { id: "technology", label: "التطبيقات التقنية" },
  { id: "motivation", label: "التعزيز والتحفيز" }
];

export const defaultSchoolSettings: SchoolSettings = {
  country: "المملكة العربية السعودية",
  ministry: "وزارة التعليم",
  department: "الإدارة العامة للتعليم بالمنطقة الشرقية",
  schoolName: "الابتدائية الثالثة والعشرون الطفولة المبكرة",
  principalName: "فاطمه القحطاني",
  totalTeachers: 32
};

export const defaultPrintSettings: PrintSettings = {
  letterheadTopMm: 13,
  letterheadRightMm: 18,
  letterheadWidthMm: 62,
  letterheadFontSizePt: 10,
  principalNameLeftMm: 34,
  principalNameTopMm: 257,
  principalNameWidthMm: 74,
  principalNameHeightMm: 7,
  principalNameFontSizePt: 12,
  principalNameFontWeight: 700,
  signatureImageAbsLeftMm: 38,
  signatureImageAbsTopMm: 262,
  signatureImageAbsWidthMm: 38,
  signatureImageAbsHeightMm: 15,
  signatureLeftMm: 34,
  signatureBottomMm: 36,
  signatureBoxWidthMm: 74,
  signatureImageLeftMm: 4,
  signatureImageTopMm: 3.5,
  signatureImageWidthMm: 38,
  signatureFontSizePt: 12,
  signatureColor: "#111111",
  fontFamily: '"Sakkal Majalla", "Arial", "Tahoma", sans-serif',
  fontSizePt: 12,
  textFontWeight: 400,
  textColor: "#111111",
  titleFontSizePt: 22,
  titleFontWeight: 800,
  titleColor: "#285b9d",
  accentColor: "#ff0000",
  pageOverrides: {},
  textStyleOverrides: {},
  checkmarkOffsets: {}
};

export function createDefaultSmartTemplate(assets: TemplateAssets = {}, name = "قالب تقرير قياس الأثر"): SmartTemplate {
  return {
    id: "impact-report-smart-template",
    name,
    pageWidthMm: 210,
    pageHeightMm: 297,
    assets,
    tableRegions: {
      summary: {
        id: "summary",
        label: "جدول الملخص",
        leftMm: 11,
        topMm: 64,
        widthMm: 188,
        heightMm: 85,
        rowHeightMm: 8,
        labelWidthMm: 70,
        fontSizePt: 12,
        borderColor: "#777777",
        backgroundColor: "#ffffff",
        textAlign: "center"
      },
      strengths: {
        id: "strengths",
        label: "جدول نقاط القوة",
        leftMm: 11,
        topMm: 149,
        widthMm: 188,
        heightMm: 60.2,
        rowHeightMm: 5.47,
        labelWidthMm: 70,
        fontSizePt: 10,
        borderColor: "#777777",
        backgroundColor: "#f9e3d2",
        textAlign: "center"
      },
      improvements: {
        id: "improvements",
        label: "جدول فرص التحسين",
        leftMm: 11,
        topMm: 209.2,
        widthMm: 188,
        heightMm: 43.8,
        rowHeightMm: 5.47,
        labelWidthMm: 70,
        fontSizePt: 10,
        borderColor: "#777777",
        backgroundColor: "#d9e4f5",
        textAlign: "center"
      },
      details: {
        id: "details",
        label: "جدول المعلمات",
        leftMm: 8,
        topMm: 55.9,
        widthMm: 193.9,
        heightMm: 184,
        rowHeightMm: 5.82,
        headerHeightMm: 32,
        fontSizePt: 6.8,
        borderColor: "#777777",
        backgroundColor: "#ffffff",
        textAlign: "center"
      }
    }
  };
}

export const fontFamilyOptions = [
  { label: "Sakkal Majalla", value: '"Sakkal Majalla", "Arial", "Tahoma", sans-serif' },
  { label: "Simplified Arabic", value: '"Simplified Arabic", "Arial", "Tahoma", sans-serif' },
  { label: "Traditional Arabic", value: '"Traditional Arabic", "Times New Roman", serif' },
  { label: "Arial", value: '"Arial", "Tahoma", sans-serif' },
  { label: "Tahoma", value: '"Tahoma", "Arial", sans-serif' },
  { label: "Times New Roman", value: '"Times New Roman", "Arial", serif' }
];

export const fontWeightOptions = [
  { label: "خفيف", value: 300 },
  { label: "عادي", value: 400 },
  { label: "عريض", value: 700 },
  { label: "عريض جداً", value: 800 }
];

export function emptyProfile(email: string): Profile {
  return {
    email,
    schoolSettings: defaultSchoolSettings,
    teachers: [],
    benefitColumns: defaultBenefitColumns,
    visibleColumnIds: defaultBenefitColumns.map((column) => column.id),
    templateAssets: {},
    smartTemplates: [createDefaultSmartTemplate()],
    activeSmartTemplateId: "impact-report-smart-template",
    printSettings: defaultPrintSettings
  };
}
