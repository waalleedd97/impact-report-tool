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
  very_high: ["تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة عالية"],
  high: ["تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة متوسطة"],
  medium: ["تساهم بدرجة عالية", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة"],
  low: ["تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة عالية"],
  very_low: ["تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة"]
};

const effectivenessByLevel: Record<ImpactLevel, string[]> = {
  very_high: ["فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة عالية"],
  high: ["فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة متوسطة"],
  medium: ["فاعلة بدرجة عالية", "فاعلة بدرجة متوسطة", "فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة"],
  low: ["فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة عالية"],
  very_low: ["فاعلة بدرجة منخفضة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة"]
};

const impactDegreeByLevel: Record<ImpactLevel, string> = {
  very_high: "مرتفعة جداً",
  high: "عالية",
  medium: "متوسطة",
  low: "منخفضة",
  very_low: "منخفضة جداً"
};

const percentageRanges: Record<ImpactLevel, [number, number]> = {
  very_high: [90, 100],
  high: [75, 89],
  medium: [50, 74],
  low: [25, 49],
  very_low: [5, 24]
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

function randomInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomPercent(level: ImpactLevel) {
  const [min, max] = percentageRanges[level];
  return randomInt(min, max);
}

function extractActivityTitleFromReportTitle(reportTitle?: string) {
  const title = String(reportTitle || "").replace(/\s+/g, " ").trim();
  if (!title) return "";

  const parenthesized = title.match(/[(（]([^()（）]+)[)）]\s*$/);
  if (parenthesized?.[1]?.trim()) {
    return parenthesized[1].trim();
  }

  const withoutFollowUpPrefix = title.replace(/^تقرير\s+متابعة\s+/u, "").trim();
  if (withoutFollowUpPrefix && withoutFollowUpPrefix !== title) {
    return withoutFollowUpPrefix;
  }

  return title;
}

function activityTitle(courseTitle: string, reportTitle?: string) {
  return extractActivityTitleFromReportTitle(reportTitle) || extractActivityTitleFromReportTitle(courseTitle) || "النشاط";
}

function isAppliedLessonsActivity(title: string) {
  return title.includes("الدروس التطبيقية");
}

function defaultReportTitle(courseTitle: string) {
  return `تقرير قياس أثر بعدي لنشاط تطوير مهني (${activityTitle(courseTitle)})`;
}

function implementedLessonsLabelForCourse(courseTitle: string, reportTitle?: string) {
  const title = activityTitle(courseTitle, reportTitle);
  if (isAppliedLessonsActivity(title)) {
    return "عدد الدروس التطبيقية المنفذة بالمدرسة";
  }
  return `عدد مرات تنفيذ ${title} بالمدرسة`;
}

function detailLessonsCountLabelForCourse(courseTitle: string, reportTitle?: string) {
  const title = activityTitle(courseTitle, reportTitle);
  if (isAppliedLessonsActivity(title)) {
    return "عدد الدروس التطبيقية التي حضرتها";
  }
  return `عدد مرات حضور ${title}`;
}

function contributionLabelForCourse(courseTitle: string, reportTitle?: string) {
  const title = activityTitle(courseTitle, reportTitle);
  if (isAppliedLessonsActivity(title)) {
    return `مدى مساهمة ${title} في تطوير أدائك التدريسي`;
  }
  return `مدى مساهمة ${title} في تطوير الأداء المهني`;
}

function effectivenessLabelForCourse(courseTitle: string, reportTitle?: string) {
  return `مدى فعالية الأساليب المستخدمة في تنفيذ ${activityTitle(courseTitle, reportTitle)}`;
}

function benefitsHeaderLabelForCourse(courseTitle: string, reportTitle?: string) {
  return `حددي المجالات التي استفدت منها في ${activityTitle(courseTitle, reportTitle)}`;
}

function acquiredSkillsLabelForCourse(courseTitle: string, reportTitle?: string) {
  const title = activityTitle(courseTitle, reportTitle);
  if (isAppliedLessonsActivity(title)) {
    return "المهارات والقدرات المكتسبة التي نفذتها بعد حضور الدروس التطبيقية";
  }
  return `المهارات والقدرات المكتسبة التي نفذتها بعد حضور ${title}`;
}

function impactSummaryForCourse(courseTitle: string, level: ImpactLevel) {
  const title = activityTitle(courseTitle);
  const practiceLabel = isAppliedLessonsActivity(title) ? "الممارسات التدريسية" : "الممارسات المهنية";
  if (level === "low") {
    return `تحتاج ${title} إلى دعم أكبر لرفع أثرها على ${practiceLabel}`;
  }
  if (level === "very_low") {
    return `تحتاج ${title} إلى إعادة تنظيم ومتابعة دقيقة لرفع أثرها على ${practiceLabel}`;
  }
  return `تُسهم ${title} في تحسين وتطوير ${practiceLabel} بدرجة ${impactDegreeByLevel[level]}`;
}

function randomContributionOverrides(level: ImpactLevel) {
  if (level === "very_high") {
    const high = randomInt(92, 100);
    return { high, medium: 100 - high, low: 0 };
  }
  if (level === "high") {
    const high = randomInt(76, 89);
    return { high, medium: 100 - high, low: 0 };
  }
  if (level === "medium") {
    const high = randomInt(45, 62);
    const low = randomInt(0, 8);
    return { high, medium: 100 - high - low, low };
  }
  if (level === "low") {
    const high = randomInt(15, 32);
    const low = randomInt(18, 35);
    return { high, medium: 100 - high - low, low };
  }
  const high = randomInt(4, 12);
  const low = randomInt(40, 58);
  return { high, medium: 100 - high - low, low };
}

function percentageOverridesForLevel(level: ImpactLevel, columns: BenefitColumn[]) {
  const contribution = randomContributionOverrides(level);
  return {
    attendance: randomPercent(level),
    contributionHigh: contribution.high,
    contributionMedium: contribution.medium,
    contributionLow: contribution.low,
    effectiveness: randomPercent(level),
    ...Object.fromEntries(columns.map((column) => [`benefit:${column.id}`, randomPercent(level)]))
  };
}

function rowBenefits(columns: BenefitColumn[], level: ImpactLevel, rowIndex: number) {
  const minimumByLevel: Record<ImpactLevel, number> = {
    very_high: 5,
    high: 3,
    medium: 2,
    low: 1,
    very_low: 0
  };
  const spreadByLevel: Record<ImpactLevel, number> = {
    very_high: 3,
    high: 4,
    medium: 3,
    low: 2,
    very_low: 2
  };
  const minimum = minimumByLevel[level];
  const spread = spreadByLevel[level];
  const count = Math.min(columns.length, minimum + (rowIndex % spread));
  const benefits: Record<string, boolean> = {};
  columns.forEach((column, columnIndex) => {
    benefits[column.id] = ((columnIndex + rowIndex) % columns.length) < count;
  });
  if (level !== "very_low" && !Object.values(benefits).some(Boolean) && columns[0]) {
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
    lessonsCount:
      input.level === "very_high"
        ? 3 + ((index * 2) % 4)
        : input.level === "high"
          ? 1 + ((index * 2) % 4)
          : input.level === "medium"
            ? 1 + (index % 3)
            : 1,
    contribution: choose(contributionByLevel[input.level], index),
    effectiveness: choose(effectivenessByLevel[input.level], index + 1),
    benefits: rowBenefits(benefitColumns, input.level, index),
    acquiredSkills: choose(skillPhrases, index)
  }));

  const report = composeReport({
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
  return {
    ...report,
    percentageOverrides: percentageOverridesForLevel(input.level, benefitColumns)
  };
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
    reportTitle: defaultReportTitle(input.courseTitle),
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
      implementedLessonsLabel: implementedLessonsLabelForCourse(input.courseTitle),
      impactSummary: impactSummaryForCourse(input.courseTitle, input.level),
      contributionLabel: contributionLabelForCourse(input.courseTitle),
      effectivenessLabel: effectivenessLabelForCourse(input.courseTitle),
      benefitsHeaderLabel: benefitsHeaderLabelForCourse(input.courseTitle),
      detailLessonsCountLabel: detailLessonsCountLabelForCourse(input.courseTitle),
      acquiredSkillsLabel: acquiredSkillsLabelForCourse(input.courseTitle),
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
