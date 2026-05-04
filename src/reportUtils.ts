import { defaultBenefitColumns, defaultPrintSettings, defaultSchoolSettings } from "./defaults";
import type {
  BenefitColumn,
  ImpactLevel,
  Profile,
  Report,
  ReportRow,
  SchoolSettings,
  Teacher,
  TemplateAssets
} from "./types";

const contributionByLevel: Record<ImpactLevel, string[]> = {
  high: ["تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة متوسطة"],
  medium: ["تساهم بدرجة عالية", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة"],
  low: ["تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة عالية"]
};

const effectivenessByLevel: Record<ImpactLevel, string[]> = {
  high: ["فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة متوسطة"],
  medium: ["فاعلة بدرجة عالية", "فاعلة بدرجة متوسطة", "فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة"],
  low: ["فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة عالية"]
};

const skillPhrases = [
  "التخطيط والتنفيذ والتقويم والتغذية الراجعة",
  "تطبيق استراتيجيات تدريس متنوعة داخل الصف",
  "توظيف التطبيقات التقنية بما يخدم أهداف الدرس",
  "تحسين إدارة الصف وتنظيم العمل الجماعي",
  "ربط الأنشطة بنواتج التعلم وأساليب التقويم",
  "تنويع أساليب التعزيز والتحفيز للمتعلمين",
  "رفع جودة التفاعل بين المعلمة والطلاب",
  "بناء أنشطة صفية ولاصفية أكثر فاعلية"
];

const strengths = [
  "الإلمام بالمادة العلمية ووضوح الأهداف التعليمية التربوية",
  "تحسين الممارسات التدريسية بتنفيذ الاستراتيجيات الملائمة وأدوات التقويم المتنوعة",
  "التنويع في الأنشطة الصفية واللاصفية",
  "تنمية مهارات التفكير الإبداعي والناقد",
  "تنمية الثقة بالنفس لدى المتعلم",
  "مهارات الإدارة الصفية",
  "التفاعل الإيجابي بين المعلمة والطلبة وبين الطلاب أنفسهم",
  "وضوح البيئة الصفية الآمنة",
  "الالتزام بضوابط ومعايير التعلم التعاوني وروح الفريق",
  "التفعيل الإيجابي للتقنية في مراحل مختلفة من الحصة الدراسية",
  "التنوع في أساليب التحفيز والتعزيز للطلبة"
];

const improvements = [
  "تطبيق الدروس التطبيقية في العام القادم بشكل أكبر للاستفادة والوقوف على بعض الفجوات ومعالجتها",
  "عمل دروس لتخصصات أخرى",
  "تطبيقها في أوقات متباعدة بعد قياس الأثر لما سبقها",
  "زيادة توظيف الوسائل التعليمية والتقنية الحديثة",
  "إتاحة وقت أطول للتطبيق العملي لجميع المتعلمين",
  "تعزيز دور المتعلم وجعله محور العملية التعليمية",
  "تطبيق أساليب تدريس تركز على رفع نواتج التعلم",
  "زيادة الوقت للتطبيق العملي وتنويع الأساليب بما يناسب مستويات الطلاب"
];

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function choose<T>(items: T[], index: number) {
  return items[index % items.length];
}

function rowBenefits(columns: BenefitColumn[], level: ImpactLevel, rowIndex: number) {
  const minimum = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const spread = level === "high" ? 4 : level === "medium" ? 3 : 2;
  const count = Math.min(columns.length, minimum + (rowIndex % spread));
  const benefits: Record<string, boolean> = {};
  columns.forEach((column, columnIndex) => {
    benefits[column.id] = ((columnIndex + rowIndex) % columns.length) < count;
  });
  if (!Object.values(benefits).some(Boolean) && columns[0]) {
    benefits[columns[0].id] = true;
  }
  return benefits;
}

export function localGeneratedReport(input: {
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  teachers: Teacher[];
  schoolSettings?: SchoolSettings;
  benefitColumns?: BenefitColumn[];
  visibleColumnIds?: string[];
  templateAssets?: TemplateAssets;
  smartTemplate?: Profile["smartTemplates"][number];
  printSettings?: Partial<typeof defaultPrintSettings>;
}): Report {
  const benefitColumns = input.benefitColumns?.length ? input.benefitColumns : defaultBenefitColumns;
  const visibleColumnIds = input.visibleColumnIds?.length
    ? input.visibleColumnIds
    : benefitColumns.map((column) => column.id);
  const schoolSettings = {
    ...defaultSchoolSettings,
    ...input.schoolSettings,
    totalTeachers: Math.max(input.schoolSettings?.totalTeachers ?? 0, input.teachers.length)
  };

  const rows: ReportRow[] = input.teachers.map((teacher, index) => ({
    teacherId: teacher.id,
    teacherName: teacher.name,
    lessonsCount: input.level === "high" ? 1 + ((index * 2) % 4) : input.level === "medium" ? 1 + (index % 3) : 1,
    contribution: choose(contributionByLevel[input.level], index),
    effectiveness: choose(effectivenessByLevel[input.level], index + 1),
    benefits: rowBenefits(benefitColumns, input.level, index),
    acquiredSkills: choose(skillPhrases, index)
  }));

  return composeReport({
    id: makeId("report"),
    email: input.email,
    courseTitle: input.courseTitle || "نشاط تطوير مهني",
    level: input.level,
    schoolSettings,
    templateAssets: input.templateAssets ?? {},
    smartTemplate: input.smartTemplate,
    printSettings: { ...defaultPrintSettings, ...input.printSettings },
    benefitColumns,
    visibleColumnIds,
    rows,
    strengths,
    improvements
  });
}

export function composeReport(input: {
  id: string;
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  schoolSettings: SchoolSettings;
  templateAssets: TemplateAssets;
  smartTemplate?: Profile["smartTemplates"][number];
  printSettings?: Partial<typeof defaultPrintSettings>;
  benefitColumns: BenefitColumn[];
  visibleColumnIds: string[];
  rows: ReportRow[];
  strengths: string[];
  improvements: string[];
}): Report {
  const now = new Date().toISOString();
  const participantsCount = input.rows.length;
  const totalTeachers = Math.max(input.schoolSettings.totalTeachers || participantsCount, participantsCount);
  const implementedLessons = input.rows.reduce((sum, row) => sum + Math.max(0, Number(row.lessonsCount) || 0), 0);
  const contributionHighCount = input.rows.filter((row) => row.contribution.includes("عالية")).length;
  const contributionMediumCount = input.rows.filter((row) => row.contribution.includes("متوسطة")).length;
  const contributionLowCount = input.rows.filter((row) => row.contribution.includes("منخفضة")).length;
  const effectivenessHighCount = input.rows.filter((row) => row.effectiveness.includes("عالية")).length;
  const benefitPercentages = Object.fromEntries(
    input.benefitColumns.map((column) => {
      const count = input.rows.filter((row) => row.benefits[column.id]).length;
      return [column.id, participantsCount ? Math.round((count / participantsCount) * 1000) / 10 : 0];
    })
  );

  return {
    id: input.id,
    email: input.email,
    courseTitle: input.courseTitle,
    level: input.level,
    createdAt: now,
    updatedAt: now,
    schoolSettings: input.schoolSettings,
    templateAssets: input.templateAssets,
    smartTemplate: input.smartTemplate,
    printSettings: { ...defaultPrintSettings, ...input.printSettings },
    benefitColumns: input.benefitColumns,
    visibleColumnIds: input.visibleColumnIds,
    rows: input.rows,
    summary: {
      totalTeachers,
      participantsCount,
      attendancePercentage: totalTeachers ? Math.round((participantsCount / totalTeachers) * 100) : 0,
      implementedLessons,
      impactSummary:
        input.level === "high"
          ? "تُسهم الدروس التطبيقية في تحسن وتطوير الممارسات التدريسية بدرجة عالية"
          : input.level === "medium"
            ? "تُسهم الدروس التطبيقية في تطوير الممارسات التدريسية بدرجة متوسطة"
            : "تحتاج الدروس التطبيقية إلى دعم أكبر لرفع أثرها على الممارسات التدريسية",
      contributionHighPercent: participantsCount ? Math.round((contributionHighCount / participantsCount) * 100) : 0,
      contributionMediumPercent: participantsCount ? Math.round((contributionMediumCount / participantsCount) * 100) : 0,
      contributionLowPercent: participantsCount ? Math.round((contributionLowCount / participantsCount) * 100) : 0,
      effectivenessHighPercent: participantsCount ? Math.round((effectivenessHighCount / participantsCount) * 100) : 0,
      benefitPercentages
    },
    percentageOverrides: {},
    summaryNumberOverrides: {},
    strengths: input.strengths,
    improvements: input.improvements
  };
}

export function reportFromProfile(profile: Profile, courseTitle: string, level: ImpactLevel) {
  const activeSmartTemplate =
    profile.smartTemplates.find((template) => template.id === profile.activeSmartTemplateId) || profile.smartTemplates[0];
  return localGeneratedReport({
    email: profile.email,
    courseTitle,
    level,
    teachers: profile.teachers,
    schoolSettings: profile.schoolSettings,
    benefitColumns: profile.benefitColumns,
    visibleColumnIds: profile.visibleColumnIds,
    templateAssets: profile.templateAssets,
    smartTemplate: activeSmartTemplate,
    printSettings: profile.printSettings
  });
}
