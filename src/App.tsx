import {
  Check,
  FileText,
  Loader2,
  LogOut,
  Plus,
  Printer,
  Save,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import {
  deleteReport,
  deletePdfDocument,
  generatePdfDocument,
  generateReport,
  importPdfDocument,
  importPdf,
  listPdfDocuments,
  listReports,
  loadProfile,
  loginWithSubscription,
  renewSubscription,
  savePdfDocument,
  saveProfile,
  saveReport,
  uploadPdfDocumentAsset
} from "./api";
import PdfEditor from "./components/PdfEditor";
import ReportPreview from "./components/ReportPreview";
import { createDefaultSmartTemplate, defaultDetailColumnIds, defaultPrintSettings, emptyProfile } from "./defaults";
import { buildPdfEditorDocument } from "./pdfEditorImport";
import { reportFromProfile } from "./reportUtils";
import type {
  GenerationOptions,
  DetailColumnId,
  ImpactLevel,
  PdfEditorDocument,
  PrintSettings,
  Profile,
  Report,
  SmartTemplate,
  StoredPdfEditorDocumentMeta,
  StoredReportMeta,
  TemplateAssets,
  SubscriptionLoginResult,
  SubscriptionSession,
  Teacher
} from "./types";

const rememberedSubscriptionCodeKey = "smart-editor-subscription-code";
const appName = "المحرر الذكي";
const appLogoSrc = "/smart-editor-logo.png";

function profileBackupKey(email: string) {
  return `impact-report-profile:${email}`;
}

function reportsBackupKey(email: string) {
  return `impact-report-reports:${email}`;
}

function readJsonBackup<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeJsonBackup(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage can be disabled or full; the server save remains the source of truth.
  }
}

function reportTime(report?: Report) {
  return report?.updatedAt ? Date.parse(report.updatedAt) || 0 : 0;
}

function preferLocalProfile(remote: Profile, local: Profile | null) {
  if (!local) return remote;
  const remoteHasWork = Boolean(remote.currentReport || remote.teachers.length);
  const localHasWork = Boolean(local.currentReport || local.teachers.length);
  if (!remoteHasWork && localHasWork) return local;
  if (reportTime(local.currentReport) > reportTime(remote.currentReport)) return local;
  return remote;
}

function mergeReportBackups(remoteReports: StoredReportMeta[], localReports: StoredReportMeta[] | null) {
  if (!localReports?.length) return remoteReports;
  const byId = new Map<string, StoredReportMeta>();
  for (const report of [...remoteReports, ...localReports]) {
    const existing = byId.get(report.id);
    if (!existing || Date.parse(report.updatedAt) > Date.parse(existing.updatedAt)) {
      byId.set(report.id, report);
    }
  }
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function makeTeacher(name = ""): Teacher {
  return {
    id: `teacher-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name
  };
}

function levelLabel(level: ImpactLevel) {
  if (level === "very_high") return "نسبة مرتفعة جداً";
  if (level === "high") return "نسبة مرتفعة";
  if (level === "medium") return "نسبة متوسطة";
  if (level === "low") return "نسبة منخفضة";
  return "نسبة منخفضة جداً";
}

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ") || "report";
}

function defaultReportTitle(courseTitle: string) {
  return `تقرير قياس أثر بعدي لنشاط تطوير مهني (${courseTitle.trim() || "النشاط"})`;
}

function normalizePrintSettings(...settings: Array<Partial<PrintSettings> | undefined>): PrintSettings {
  let merged: PrintSettings = {
    ...defaultPrintSettings,
    pageOverrides: { ...defaultPrintSettings.pageOverrides },
    textStyleOverrides: { ...defaultPrintSettings.textStyleOverrides },
    checkmarkOffsets: { ...defaultPrintSettings.checkmarkOffsets }
  };

  for (const item of settings) {
    if (!item) continue;
    merged = {
      ...merged,
      ...item,
      pageOverrides: {
        ...merged.pageOverrides,
        ...item.pageOverrides
      },
      textStyleOverrides: {
        ...merged.textStyleOverrides,
        ...item.textStyleOverrides
      },
      checkmarkOffsets: {
        ...merged.checkmarkOffsets,
        ...item.checkmarkOffsets
      }
    };
  }

  return merged;
}

function normalizeSmartTemplates(profile: Partial<Profile>): {
  smartTemplates: SmartTemplate[];
  activeSmartTemplateId: string;
} {
  const fallbackTemplate = createDefaultSmartTemplate(profile.templateAssets || {});
  const smartTemplates = profile.smartTemplates?.length ? profile.smartTemplates : [fallbackTemplate];
  const activeSmartTemplateId =
    profile.activeSmartTemplateId && smartTemplates.some((template) => template.id === profile.activeSmartTemplateId)
      ? profile.activeSmartTemplateId
      : smartTemplates[0].id;
  return { smartTemplates, activeSmartTemplateId };
}

function activeSmartTemplate(profile: Profile) {
  return profile.smartTemplates.find((template) => template.id === profile.activeSmartTemplateId) || profile.smartTemplates[0];
}

function normalizeReport(
  report: Report,
  fallbackPrintSettings: Partial<PrintSettings>,
  fallbackSmartTemplate?: SmartTemplate
): Report {
  return {
    ...report,
    reportTitle: report.reportTitle || defaultReportTitle(report.courseTitle),
    printSettings: normalizePrintSettings(fallbackPrintSettings, report.printSettings),
    smartTemplate: report.smartTemplate || fallbackSmartTemplate,
    visibleDetailColumnIds: report.visibleDetailColumnIds?.length ? report.visibleDetailColumnIds : defaultDetailColumnIds,
    percentageOverrides: { ...report.percentageOverrides },
    summaryNumberOverrides: { ...report.summaryNumberOverrides }
  };
}

function withoutSignatureAsset(assets: TemplateAssets): TemplateAssets {
  const { signatureUrl: _signatureUrl, ...rest } = assets;
  return rest;
}

function withoutTemplateSignature(template: SmartTemplate): SmartTemplate {
  return {
    ...template,
    assets: withoutSignatureAsset(template.assets)
  };
}

function hasSignatureAsset(profile: Profile) {
  return Boolean(
    profile.templateAssets.signatureUrl ||
      profile.currentReport?.templateAssets.signatureUrl ||
      profile.currentReport?.smartTemplate?.assets.signatureUrl ||
      profile.smartTemplates.some((template) => template.assets.signatureUrl)
  );
}

function normalizeProfile(email: string, loadedProfile: Partial<Profile>): Profile {
  const smartTemplateState = normalizeSmartTemplates(loadedProfile);
  const mergedProfile: Profile = {
    ...emptyProfile(email),
    ...loadedProfile,
    email,
    smartTemplates: smartTemplateState.smartTemplates,
    activeSmartTemplateId: smartTemplateState.activeSmartTemplateId,
    visibleDetailColumnIds: loadedProfile.visibleDetailColumnIds?.length
      ? loadedProfile.visibleDetailColumnIds
      : defaultDetailColumnIds,
    printSettings: normalizePrintSettings(loadedProfile.printSettings)
  };

  if (mergedProfile.currentReport) {
    mergedProfile.currentReport = normalizeReport(
      mergedProfile.currentReport,
      mergedProfile.printSettings,
      activeSmartTemplate(mergedProfile)
    );
  }

  return mergedProfile;
}

export default function App() {
  const [subscriptionCodeInput, setSubscriptionCodeInput] = useState(
    localStorage.getItem(rememberedSubscriptionCodeKey) || ""
  );
  const [subscriptionCode, setSubscriptionCode] = useState(localStorage.getItem(rememberedSubscriptionCodeKey) || "");
  const [renewalCodeInput, setRenewalCodeInput] = useState("");
  const [expiredSubscriptionCode, setExpiredSubscriptionCode] = useState("");
  const [subscription, setSubscription] = useState<SubscriptionSession | null>(null);
  const [accountId, setAccountId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courseTitle, setCourseTitle] = useState("الدروس التطبيقية");
  const [level, setLevel] = useState<ImpactLevel>("high");
  const [strengthCount, setStrengthCount] = useState("");
  const [improvementCount, setImprovementCount] = useState("");
  const [benefitColumnCount, setBenefitColumnCount] = useState("");
  const [agentNotes, setAgentNotes] = useState("");
  const [activeTab, setActiveTab] = useState<"report" | "pdf" | "teachers" | "settings" | "saved">("report");
  const [reports, setReports] = useState<StoredReportMeta[]>([]);
  const [pdfDocuments, setPdfDocuments] = useState<StoredPdfEditorDocumentMeta[]>([]);
  const [currentPdfDocument, setCurrentPdfDocument] = useState<PdfEditorDocument | undefined>();
  const [pdfActivityTitle, setPdfActivityTitle] = useState("");
  const [pdfAgentNotes, setPdfAgentNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [importedNames, setImportedNames] = useState<Teacher[] | null>(null);

  useEffect(() => {
    if (!subscriptionCode) return;
    setBusy("التحقق من الاشتراك");
    loginWithSubscription(subscriptionCode)
      .then((result) => {
        completeSubscriptionLogin(result);
      })
      .catch((error) => {
        const code = normalizeSubscriptionInput(subscriptionCode);
        if ((error as Error & { expired?: boolean }).expired) {
          setExpiredSubscriptionCode(code);
        }
        localStorage.removeItem(rememberedSubscriptionCodeKey);
        setSubscriptionCode("");
        setAccountId("");
        setSubscription(null);
        setProfile(null);
        setReports([]);
        setPdfDocuments([]);
        setCurrentPdfDocument(undefined);
        setMessage(error instanceof Error ? error.message : "تعذر التحقق من الاشتراك");
      })
      .finally(() => setBusy(""));
  }, [subscriptionCode]);

  useEffect(() => {
    if (!accountId || !subscription?.code) return;
    setBusy("تحميل الملف الشخصي");
    Promise.all([
      loadProfile(accountId, subscription.code),
      listReports(accountId, subscription.code),
      listPdfDocuments(accountId, subscription.code)
    ])
      .then(([loadedProfile, loadedReports, loadedPdfDocuments]) => {
        const localProfile = readJsonBackup<Profile>(profileBackupKey(accountId));
        const normalizedRemote = normalizeProfile(accountId, loadedProfile);
        const normalizedLocal = localProfile ? normalizeProfile(accountId, localProfile) : null;
        const mergedProfile = preferLocalProfile(normalizedRemote, normalizedLocal);
        const mergedReports = mergeReportBackups(
          loadedReports,
          readJsonBackup<StoredReportMeta[]>(reportsBackupKey(accountId))
        );
        setProfile(mergedProfile);
        setReports(mergedReports);
        setPdfDocuments(loadedPdfDocuments);
        setCurrentPdfDocument(loadedPdfDocuments[0]?.document);
        writeJsonBackup(profileBackupKey(accountId), mergedProfile);
        writeJsonBackup(reportsBackupKey(accountId), mergedReports);
        if (!mergedProfile.currentReport && mergedProfile.teachers.length) {
          const reportProfile = {
            ...mergedProfile,
            currentReport: reportFromProfile(mergedProfile, courseTitle, level)
          };
          setProfile(reportProfile);
          writeJsonBackup(profileBackupKey(accountId), reportProfile);
        }
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setBusy(""));
  }, [accountId, subscription?.code]);

  const currentReport = profile?.currentReport;

  const teacherNamesValid = useMemo(
    () => Boolean(profile?.teachers.length && profile.teachers.every((teacher) => teacher.name.trim())),
    [profile?.teachers]
  );

  async function persistProfile(nextProfile: Profile) {
    if (!subscription?.code) {
      throw new Error("يلزم تسجيل الدخول برقم اشتراك");
    }
    setProfile(nextProfile);
    writeJsonBackup(profileBackupKey(nextProfile.email), nextProfile);
    await saveProfile(nextProfile, subscription.code);
  }

  function normalizeSubscriptionInput(value: string) {
    return value.trim().toUpperCase().replace(/\s+/g, "");
  }

  function completeSubscriptionLogin(result: SubscriptionLoginResult) {
    localStorage.setItem(rememberedSubscriptionCodeKey, result.subscription.code);
    setSubscriptionCodeInput(result.subscription.code);
    setSubscription(result.subscription);
    setAccountId(result.accountId);
    setExpiredSubscriptionCode("");
    setRenewalCodeInput("");
    setMessage("");
  }

  function login(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeSubscriptionInput(subscriptionCodeInput);
    if (normalized.length < 8) {
      setMessage("أدخل رقم اشتراك صحيح");
      return;
    }
    setProfile(null);
    setSubscription(null);
    setAccountId("");
    setSubscriptionCode(normalized);
    setMessage("");
  }

  async function renewExpiredSubscription(event: React.FormEvent) {
    event.preventDefault();
    const oldCode = normalizeSubscriptionInput(expiredSubscriptionCode || subscriptionCodeInput);
    const newCode = normalizeSubscriptionInput(renewalCodeInput);
    if (!oldCode || newCode.length < 8) {
      setMessage("أدخل رقم الاشتراك الجديد");
      return;
    }
    setBusy("تجديد الاشتراك");
    setMessage("");
    try {
      const result = await renewSubscription(oldCode, newCode);
      setSubscriptionCode(newCode);
      completeSubscriptionLogin(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تجديد الاشتراك");
    } finally {
      setBusy("");
    }
  }

  async function handleImport(file?: File) {
    if (!file || !profile) return;
    setBusy("استيراد ملف PDF");
    setMessage("");
    try {
      const imported = await importPdf(profile.email, file, subscription?.code || "");
      const importedSmartTemplate = imported.smartTemplateDraft;
      const smartTemplates = importedSmartTemplate
        ? [
            ...profile.smartTemplates.filter((template) => template.id !== importedSmartTemplate.id),
            importedSmartTemplate
          ]
        : profile.smartTemplates;
      const nextProfile: Profile = {
        ...profile,
        teachers: imported.teachers.length ? imported.teachers : profile.teachers,
        schoolSettings: {
          ...profile.schoolSettings,
          ...imported.schoolSettings
        },
        templateAssets: {
          ...profile.templateAssets,
          ...imported.templateAssets
        },
        smartTemplates,
        activeSmartTemplateId: importedSmartTemplate?.id || profile.activeSmartTemplateId
      };
      nextProfile.currentReport = reportFromProfile(nextProfile, courseTitle, level);
      setImportedNames(nextProfile.teachers);
      await persistProfile(nextProfile);
      setActiveTab("teachers");
      setMessage(`تم استخراج ${nextProfile.teachers.length} اسم`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر استيراد الملف");
    } finally {
      setBusy("");
    }
  }

  async function handleGenericPdfImport(file?: File) {
    if (!file || !profile || !subscription?.code) return;
    setBusy("قراءة ملف PDF");
    setMessage("");
    try {
      const document = await buildPdfEditorDocument({
        file,
        email: profile.email,
        uploadAsset: async ({ documentId, pageId, file, filename }) => {
          const result = await uploadPdfDocumentAsset(
            {
              email: profile.email,
              documentId,
              pageId,
              file,
              filename
            },
            subscription.code
          );
          return result.url;
        },
        onProgress: setBusy
      });
      const saved = await importPdfDocument(document, subscription.code);
      setPdfDocuments((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setCurrentPdfDocument(saved.document);
      setPdfActivityTitle(saved.document.title);
      setActiveTab("pdf");
      setMessage(
        saved.document.fields.length || saved.document.tables.length
          ? `تم تجهيز ${saved.document.pages.length} صفحة و${saved.document.fields.length} خانة و${saved.document.tables.length} جدول`
          : "تم تجهيز الصفحات كخلفية. الملف يبدو ممسوحاً؛ أضف الخانات والجداول يدوياً."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تجهيز محرر PDF");
    } finally {
      setBusy("");
    }
  }

  async function handleSavePdfDocument() {
    if (!currentPdfDocument || !subscription?.code) return;
    setBusy("حفظ مستند PDF");
    setMessage("");
    try {
      const saved = await savePdfDocument(currentPdfDocument, subscription.code);
      setPdfDocuments((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setCurrentPdfDocument(saved.document);
      setMessage("تم حفظ مستند PDF");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ مستند PDF");
    } finally {
      setBusy("");
    }
  }

  async function handleGeneratePdfDocument() {
    if (!currentPdfDocument || !profile || !subscription?.code) return;
    setBusy("تعبئة مستند PDF بالذكاء الاصطناعي");
    setMessage("");
    try {
      const result = await generatePdfDocument(
        {
          email: profile.email,
          document: currentPdfDocument,
          activityTitle: pdfActivityTitle || currentPdfDocument.title,
          notes: pdfAgentNotes
        },
        subscription.code
      );
      setCurrentPdfDocument(result.document);
      setPdfDocuments((items) => [
        {
          id: result.document.id,
          email: result.document.email,
          title: result.document.title,
          sourceFilename: result.document.sourceFilename,
          createdAt: result.document.createdAt,
          updatedAt: result.document.updatedAt,
          document: result.document
        },
        ...items.filter((item) => item.id !== result.document.id)
      ]);
      setMessage("تمت تعبئة مستند PDF");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تعبئة مستند PDF");
    } finally {
      setBusy("");
    }
  }

  async function handleDeletePdfDocument(item: StoredPdfEditorDocumentMeta) {
    if (!profile || !subscription?.code) return;
    const confirmed = window.confirm(`حذف "${item.title}" من مستندات PDF؟`);
    if (!confirmed) return;
    setBusy("حذف مستند PDF");
    setMessage("");
    try {
      await deletePdfDocument(item.id, profile.email, subscription.code);
      setPdfDocuments((items) => items.filter((document) => document.id !== item.id));
      if (currentPdfDocument?.id === item.id) {
        const next = pdfDocuments.find((document) => document.id !== item.id);
        setCurrentPdfDocument(next?.document);
      }
      setMessage("تم حذف مستند PDF");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حذف مستند PDF");
    } finally {
      setBusy("");
    }
  }

  async function handleGenerate() {
    if (!profile || !teacherNamesValid) {
      setMessage("أضف أسماء المعلمات أولاً");
      return;
    }
    setBusy("يقوم الذكاء الاصطناعي بتعبئة التقرير بالكامل، قد يستغرق حتى دقيقة");
    setMessage("");
    try {
      const generationOptions: GenerationOptions = {};
      const parsedStrengthCount = Number(strengthCount);
      const parsedImprovementCount = Number(improvementCount);
      const parsedBenefitColumnCount = Number(benefitColumnCount);
      if (Number.isFinite(parsedStrengthCount) && parsedStrengthCount > 0) {
        generationOptions.strengthCount = Math.round(parsedStrengthCount);
      }
      if (Number.isFinite(parsedImprovementCount) && parsedImprovementCount > 0) {
        generationOptions.improvementCount = Math.round(parsedImprovementCount);
      }
      if (Number.isFinite(parsedBenefitColumnCount) && parsedBenefitColumnCount > 0) {
        generationOptions.benefitColumnCount = Math.round(parsedBenefitColumnCount);
      }
      if (agentNotes.trim()) {
        generationOptions.notes = agentNotes.trim();
      }
      const customReportTitle =
        profile.currentReport?.reportTitle &&
        profile.currentReport.reportTitle !== defaultReportTitle(profile.currentReport.courseTitle)
          ? profile.currentReport.reportTitle
          : "";
      if (customReportTitle.trim()) {
        generationOptions.reportTitle = customReportTitle.trim();
      }
      const result = await generateReport(
        {
          email: profile.email,
          courseTitle,
          level,
          teachers: profile.teachers,
          profile,
          generationOptions
        },
        subscription?.code || ""
      );
      const nextReport = normalizeReport(result.report, profile.printSettings, activeSmartTemplate(profile));
      const nextProfile = {
        ...profile,
        visibleColumnIds: nextReport.visibleColumnIds,
        currentReport: nextReport
      };
      await persistProfile(nextProfile);
      setMessage("تم توليد التقرير عبر الذكاء الاصطناعي");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر توليد التقرير");
    } finally {
      setBusy("");
    }
  }

  async function handleSaveReport() {
    if (!profile?.currentReport) return;
    setBusy("حفظ التقرير");
    try {
      const saved = await saveReport(profile.currentReport, subscription?.code || "");
      setReports((items) => {
        const nextReports = [saved, ...items.filter((item) => item.id !== saved.id)];
        writeJsonBackup(reportsBackupKey(profile.email), nextReports);
        return nextReports;
      });
      setMessage("تم حفظ التقرير");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ التقرير");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteSavedReport(item: StoredReportMeta) {
    if (!profile) return;
    const confirmed = window.confirm(`حذف "${item.title}" من المحفوظات؟`);
    if (!confirmed) return;

    setBusy("حذف التقرير");
    setMessage("");
    try {
      await deleteReport(item.id, profile.email, subscription?.code || "");
      setReports((items) => {
        const nextReports = items.filter((report) => report.id !== item.id);
        writeJsonBackup(reportsBackupKey(profile.email), nextReports);
        return nextReports;
      });
      setMessage("تم حذف التقرير من المحفوظات");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حذف التقرير");
    } finally {
      setBusy("");
    }
  }

  async function handleRemoveSignature() {
    if (!profile) return;
    setBusy("حذف التوقيع");
    setMessage("");
    try {
      const smartTemplates = profile.smartTemplates.map(withoutTemplateSignature);
      const activeTemplate =
        smartTemplates.find((template) => template.id === profile.activeSmartTemplateId) || smartTemplates[0];
      const currentReport = profile.currentReport
        ? normalizeReport(
            {
              ...profile.currentReport,
              templateAssets: withoutSignatureAsset(profile.currentReport.templateAssets),
              smartTemplate: profile.currentReport.smartTemplate
                ? withoutTemplateSignature(profile.currentReport.smartTemplate)
                : activeTemplate,
              updatedAt: new Date().toISOString()
            },
            profile.printSettings,
            activeTemplate
          )
        : undefined;
      await persistProfile({
        ...profile,
        templateAssets: withoutSignatureAsset(profile.templateAssets),
        smartTemplates,
        currentReport
      });
      setMessage("تم حذف التوقيع");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حذف التوقيع");
    } finally {
      setBusy("");
    }
  }

  async function exportA4Pdf() {
    if (!profile?.currentReport) return;
    const pages = Array.from(document.querySelectorAll<HTMLElement>(".report-page"));
    if (!pages.length) {
      setMessage("لا توجد صفحات للتصدير");
      return;
    }

    setBusy("تجهيز PDF");
    setMessage("");
    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true
      });

      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          backgroundColor: "#ffffff",
          scale: Math.min(3, window.devicePixelRatio || 2),
          useCORS: true,
          allowTaint: true,
          logging: false,
          onclone: (documentClone) => {
            documentClone.body.classList.add("pdf-export-mode");
          }
        });
        const image = canvas.toDataURL("image/jpeg", 0.98);
        if (index > 0) {
          pdf.addPage("a4", "portrait");
        }
        pdf.addImage(image, "JPEG", 0, 0, 210, 297);
      }

      pdf.save(`${safeFilename(profile.currentReport.reportTitle || profile.currentReport.courseTitle)}.pdf`);
      setMessage("تم تنزيل ملف PDF");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تصدير PDF");
    } finally {
      setBusy("");
    }
  }

  async function updateProfile(patch: Partial<Profile>) {
    if (!profile) return;
    const nextProfile = { ...profile, ...patch };
    if (patch.printSettings) {
      nextProfile.printSettings = normalizePrintSettings(profile.printSettings, patch.printSettings);
    }
    if (nextProfile.currentReport) {
      const nextSmartTemplate = activeSmartTemplate(nextProfile);
      nextProfile.currentReport = {
        ...nextProfile.currentReport,
        schoolSettings: nextProfile.schoolSettings,
        benefitColumns: nextProfile.benefitColumns,
        visibleColumnIds: nextProfile.visibleColumnIds,
        visibleDetailColumnIds: nextProfile.visibleDetailColumnIds,
        templateAssets: nextProfile.templateAssets,
        smartTemplate: nextSmartTemplate,
        printSettings: nextProfile.printSettings
      };
    }
    await persistProfile(nextProfile);
  }

  async function updateReport(report: Report) {
    if (!profile) return;
    const nextReport = normalizeReport(report, profile.printSettings, activeSmartTemplate(profile));
    await persistProfile({ ...profile, printSettings: nextReport.printSettings, currentReport: nextReport });
  }

  function applySmartTemplate(template: SmartTemplate, options: { persist?: boolean } = {}) {
    if (!profile) return;
    const nextTemplates = profile.smartTemplates.some((item) => item.id === template.id)
      ? profile.smartTemplates.map((item) => (item.id === template.id ? template : item))
      : [...profile.smartTemplates, template];
    const nextProfile: Profile = {
      ...profile,
      smartTemplates: nextTemplates,
      activeSmartTemplateId: template.id,
      currentReport: profile.currentReport
        ? {
            ...profile.currentReport,
            smartTemplate: template,
            templateAssets: {
              ...profile.currentReport.templateAssets,
              ...template.assets
            }
          }
        : undefined
    };

    setProfile(nextProfile);
    if (options.persist !== false) {
      void saveProfile(nextProfile, subscription?.code || "").catch((error) => {
        setMessage(error instanceof Error ? error.message : "تعذر حفظ القالب الذكي");
      });
    }
  }

  function applyPrintSettings(
    patch: Partial<PrintSettings>,
    options: {
      persist?: boolean;
      pageKey?: string;
    } = {}
  ) {
    if (!profile) return;
    const basePrintSettings = normalizePrintSettings(profile.printSettings);
    const pagePatch: Partial<PrintSettings> = { ...patch };
    delete pagePatch.pageOverrides;
    delete pagePatch.textStyleOverrides;
    const nextPrintSettings = options.pageKey
      ? {
          ...basePrintSettings,
          pageOverrides: {
            ...basePrintSettings.pageOverrides,
            [options.pageKey]: {
              ...basePrintSettings.pageOverrides[options.pageKey],
              ...pagePatch
            }
          }
        }
      : normalizePrintSettings(basePrintSettings, patch);
    const nextProfile: Profile = {
      ...profile,
      printSettings: nextPrintSettings,
      currentReport: profile.currentReport
        ? {
            ...profile.currentReport,
            printSettings: nextPrintSettings
          }
        : undefined
    };

    setProfile(nextProfile);
    if (options.persist !== false) {
      void saveProfile(nextProfile, subscription?.code || "").catch((error) => {
        setMessage(error instanceof Error ? error.message : "تعذر حفظ إعدادات الطباعة");
      });
    }
  }

  function applyReportPatch(
    patch: Partial<Report>,
    options: {
      persist?: boolean;
    } = {}
  ) {
    if (!profile?.currentReport) return;
    const nextReport = normalizeReport(
      {
        ...profile.currentReport,
        ...patch,
        updatedAt: new Date().toISOString()
      },
      profile.printSettings
    );
    const nextProfile: Profile = {
      ...profile,
      currentReport: nextReport
    };

    setProfile(nextProfile);
    if (options.persist !== false) {
      void saveProfile(nextProfile, subscription?.code || "").catch((error) => {
        setMessage(error instanceof Error ? error.message : "تعذر حفظ التقرير");
      });
    }
  }

  if (!accountId) {
    return (
      <main className="login-screen" dir="rtl">
        <form className="login-panel" onSubmit={login}>
          <div className="login-brand">
            <img src={appLogoSrc} alt={appName} />
            <h1>{appName}</h1>
          </div>
          <label>
            رقم الاشتراك
            <input
              dir="ltr"
              type="text"
              value={subscriptionCodeInput}
              onChange={(event) => setSubscriptionCodeInput(event.target.value)}
              placeholder="SMART-XXXX-XXXX"
              autoComplete="off"
            />
          </label>
          <button type="submit">دخول</button>
          {expiredSubscriptionCode ? (
            <div className="renewal-box">
              <p>انتهى هذا الاشتراك. أدخل رقم اشتراك جديد لربطه بنفس بياناتك السابقة.</p>
              <label>
                رقم الاشتراك الجديد
                <input
                  dir="ltr"
                  type="text"
                  value={renewalCodeInput}
                  onChange={(event) => setRenewalCodeInput(event.target.value)}
                  placeholder="SMART-XXXX-XXXX"
                  autoComplete="off"
                />
              </label>
              <button type="button" onClick={renewExpiredSubscription} disabled={Boolean(busy)}>
                ربط وتجديد
              </button>
            </div>
          ) : null}
          {busy ? (
            <p className="busy-line login-busy">
              <Loader2 className="spin" size={16} />
              {busy}
            </p>
          ) : null}
          {message ? <p className="status-message error">{message}</p> : null}
        </form>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="loading-screen" dir="rtl">
        <Loader2 className="spin" />
        <span>{busy || "تحميل"}</span>
      </main>
    );
  }

  return (
    <main className="app-shell" dir="rtl">
      <aside className="control-panel">
        <header className="app-header">
          <div className="app-brand">
            <img src={appLogoSrc} alt={appName} className="app-logo" />
            <div>
              <h1>{appName}</h1>
              <p>{subscription ? `${subscription.code} • ${subscription.daysRemaining} يوم` : accountId}</p>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={() => {
              localStorage.removeItem(rememberedSubscriptionCodeKey);
              setSubscriptionCode("");
              setSubscriptionCodeInput("");
              setSubscription(null);
              setAccountId("");
              setExpiredSubscriptionCode("");
              setProfile(null);
              setPdfDocuments([]);
              setCurrentPdfDocument(undefined);
            }}
            title="خروج"
          >
            <LogOut size={18} />
          </button>
        </header>

        <nav className="tabs">
          {[
            ["report", "التقرير"],
            ["pdf", "محرر PDF"],
            ["teachers", "المعلمات"],
            ["settings", "الإعدادات"],
            ["saved", "المحفوظات"]
          ].map(([tab, label]) => (
            <button
              key={tab}
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab as typeof activeTab)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === "report" ? (
          <section className="panel-section">
            <label>
              عنوان النشاط
              <input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} />
            </label>
            {currentReport ? (
              <label>
                عنوان التقرير كامل
                <input
                  value={currentReport.reportTitle || defaultReportTitle(currentReport.courseTitle)}
                  onChange={(event) => applyReportPatch({ reportTitle: event.target.value }, { persist: false })}
                  onBlur={(event) => applyReportPatch({ reportTitle: event.target.value })}
                />
              </label>
            ) : null}
            <div className="field-group">
              <span>مستوى النسبة</span>
              <div className="segmented level-segmented">
                {(["very_high", "high", "medium", "low", "very_low"] as ImpactLevel[]).map((item) => (
                  <button
                    key={item}
                    className={level === item ? "active" : ""}
                    onClick={() => setLevel(item)}
                  >
                    {levelLabel(item)}
                  </button>
                ))}
              </div>
            </div>
            <div className="ai-generation-options">
              <div className="ai-generation-title">
                <span>تخصيص الذكاء الاصطناعي</span>
                <small>اختياري</small>
              </div>
              <div className="generation-count-grid">
                <label>
                  عدد نقاط القوة
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={strengthCount}
                    onChange={(event) => setStrengthCount(event.target.value)}
                    placeholder="الوكيل يحدد"
                  />
                </label>
                <label>
                  عدد فرص التحسين
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={improvementCount}
                    onChange={(event) => setImprovementCount(event.target.value)}
                    placeholder="الوكيل يحدد"
                  />
                </label>
                <label>
                  عدد مجالات الاستفادة
                  <input
                    type="number"
                    min={1}
                    max={profile.benefitColumns.length}
                    value={benefitColumnCount}
                    onChange={(event) => setBenefitColumnCount(event.target.value)}
                    placeholder={`${profile.benefitColumns.length} كحد أقصى`}
                  />
                </label>
              </div>
              <label>
                ملاحظات عامة للوكيل
                <textarea
                  value={agentNotes}
                  onChange={(event) => setAgentNotes(event.target.value)}
                  placeholder="مثال: أعطِ المعلمات التقييم الكامل جميعهم، واجعل نقاط القوة مركزة على الأداء الوظيفي."
                />
              </label>
            </div>
            {busy ? (
              <div className="ai-working-banner">
                <Loader2 className="spin" size={16} />
                <span>{busy}</span>
              </div>
            ) : null}
            <div className="action-grid">
              <button onClick={handleGenerate} disabled={Boolean(busy)}>
                <Sparkles size={17} />
                توليد
              </button>
              <button onClick={handleSaveReport} disabled={!currentReport || Boolean(busy)}>
                <Save size={17} />
                حفظ
              </button>
              <button onClick={() => window.print()} disabled={!currentReport}>
                <Printer size={17} />
                طباعة
              </button>
              <button onClick={exportA4Pdf} disabled={!currentReport}>
                <FileText size={17} />
                استخراج بصيغة PDF
              </button>
            </div>
            <label className="file-picker">
              <Upload size={17} />
              رفع PDF
              <input type="file" accept="application/pdf" onChange={(event) => handleImport(event.target.files?.[0])} />
            </label>
            <ColumnToggles profile={profile} onChange={updateProfile} />
          </section>
        ) : null}

        {activeTab === "pdf" ? (
          <section className="panel-section pdf-control-section">
            <label className="file-picker">
              <Upload size={17} />
              رفع PDF جديد للتحرير
              <input type="file" accept="application/pdf" onChange={(event) => handleGenericPdfImport(event.target.files?.[0])} />
            </label>
            <label>
              عنوان النشاط أو الغرض
              <input
                value={pdfActivityTitle}
                onChange={(event) => setPdfActivityTitle(event.target.value)}
                placeholder="مثال: ورشة عمل بنود الأداء الوظيفي"
              />
            </label>
            <label>
              ملاحظات للذكاء الاصطناعي
              <textarea
                value={pdfAgentNotes}
                onChange={(event) => setPdfAgentNotes(event.target.value)}
                placeholder="اكتب تعليمات التعبئة المطلوبة لهذا المستند."
              />
            </label>
            <div className="action-grid">
              <button onClick={handleGeneratePdfDocument} disabled={!currentPdfDocument || Boolean(busy)}>
                <Sparkles size={17} />
                تعبئة
              </button>
              <button onClick={handleSavePdfDocument} disabled={!currentPdfDocument || Boolean(busy)}>
                <Save size={17} />
                حفظ
              </button>
            </div>
            <div className="pdf-document-list">
              <span>مستندات PDF</span>
              {pdfDocuments.length ? (
                pdfDocuments.map((item) => (
                  <div className="saved-item" key={item.id}>
                    <button
                      className={currentPdfDocument?.id === item.id ? "saved-report-button active" : "saved-report-button"}
                      onClick={() => {
                        setCurrentPdfDocument(item.document);
                        setPdfActivityTitle(item.document.title);
                      }}
                    >
                      <FileText size={16} />
                      <span>{item.title}</span>
                      <small>{new Date(item.updatedAt).toLocaleDateString("ar-SA")}</small>
                    </button>
                    <button
                      className="saved-delete-button"
                      onClick={() => void handleDeletePdfDocument(item)}
                      title="حذف مستند PDF"
                      aria-label={`حذف ${item.title}`}
                      disabled={Boolean(busy)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">لا توجد مستندات PDF محفوظة</p>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "teachers" ? (
          <TeacherEditor
            profile={profile}
            importedNames={importedNames}
            onChange={(teachers) => updateProfile({ teachers })}
          />
        ) : null}

        {activeTab === "settings" ? (
          <SettingsEditor
            profile={profile}
            onChange={updateProfile}
            onReportChange={updateReport}
            onSmartTemplateChange={applySmartTemplate}
            hasSignature={hasSignatureAsset(profile)}
            onRemoveSignature={handleRemoveSignature}
          />
        ) : null}

        {activeTab === "saved" ? (
          <section className="panel-section saved-list">
            {reports.length ? (
              reports.map((item) => (
                <div className="saved-item" key={item.id}>
                  <button
                    className="saved-report-button"
                    onClick={() => {
                      const nextReport = normalizeReport(item.report, profile.printSettings, activeSmartTemplate(profile));
                      setProfile({
                        ...profile,
                        printSettings: nextReport.printSettings,
                        currentReport: nextReport
                      });
                      setCourseTitle(nextReport.courseTitle);
                      setLevel(nextReport.level);
                    }}
                  >
                    <FileText size={16} />
                    <span>{item.title}</span>
                    <small>{new Date(item.updatedAt).toLocaleDateString("ar-SA")}</small>
                  </button>
                  <button
                    className="saved-delete-button"
                    onClick={() => void handleDeleteSavedReport(item)}
                    title="حذف من المحفوظات"
                    aria-label={`حذف ${item.title} من المحفوظات`}
                    disabled={Boolean(busy)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">لا توجد تقارير محفوظة</p>
            )}
          </section>
        ) : null}

        {busy ? (
          <div className="busy-line">
            <Loader2 className="spin" size={16} />
            {busy}
          </div>
        ) : null}
        {message ? <div className="status-message">{message}</div> : null}
      </aside>

      <section className="preview-panel">
        {activeTab === "pdf" ? (
          <PdfEditor
            document={currentPdfDocument}
            onChange={setCurrentPdfDocument}
            onSave={handleSavePdfDocument}
            onGenerate={handleGeneratePdfDocument}
            disabled={Boolean(busy)}
          />
        ) : (
          <ReportPreview
            report={currentReport}
            onPrintSettingsChange={applyPrintSettings}
            onReportChange={applyReportPatch}
            onSmartTemplateChange={applySmartTemplate}
          />
        )}
      </section>
    </main>
  );
}

function ColumnToggles({
  profile,
  onChange
}: {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => Promise<void>;
}) {
  return (
    <div className="column-toggles">
      <span>أعمدة مجالات الاستفادة</span>
      {profile.benefitColumns.map((column) => {
        const active = profile.visibleColumnIds.includes(column.id);
        return (
          <button
            key={column.id}
            className={active ? "active" : ""}
            onClick={() => {
              const next = active
                ? profile.visibleColumnIds.filter((id) => id !== column.id)
                : [...profile.visibleColumnIds, column.id];
              onChange({ visibleColumnIds: next.length ? next : [column.id] });
            }}
          >
            <Check size={14} />
            {column.label}
          </button>
        );
      })}
    </div>
  );
}

const detailColumnOptions: Array<{ id: DetailColumnId; label: string }> = [
  { id: "number", label: "م" },
  { id: "name", label: "الاسم" },
  { id: "lessons", label: "عدد الحضور/التنفيذ" },
  { id: "contribution", label: "مساهمة النشاط" },
  { id: "effectiveness", label: "فعالية الأساليب" },
  { id: "benefits", label: "مجالات الاستفادة" },
  { id: "skills", label: "المهارات المكتسبة" }
];

function DetailColumnToggles({
  profile,
  onChange
}: {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => Promise<void>;
}) {
  const activeIds = profile.visibleDetailColumnIds?.length ? profile.visibleDetailColumnIds : defaultDetailColumnIds;
  return (
    <div className="column-toggles">
      <span>أعمدة جدول المعلمات</span>
      {detailColumnOptions.map((column) => {
        const active = activeIds.includes(column.id);
        return (
          <button
            key={column.id}
            className={active ? "active" : ""}
            onClick={() => {
              const next = active ? activeIds.filter((id) => id !== column.id) : [...activeIds, column.id];
              onChange({ visibleDetailColumnIds: next.length ? next : [column.id] });
            }}
          >
            <Check size={14} />
            {column.label}
          </button>
        );
      })}
    </div>
  );
}

function TeacherEditor({
  profile,
  importedNames,
  onChange
}: {
  profile: Profile;
  importedNames: Teacher[] | null;
  onChange: (teachers: Teacher[]) => Promise<void>;
}) {
  const teachers = profile.teachers;
  return (
    <section className="panel-section teachers-editor">
      {importedNames ? <p className="muted">آخر استيراد: {importedNames.length} اسم</p> : null}
      <button className="inline-add" onClick={() => onChange([...teachers, makeTeacher()])}>
        <Plus size={16} />
        إضافة معلمة
      </button>
      <div className="teacher-list">
        {teachers.map((teacher, index) => (
          <div className="teacher-row" key={teacher.id}>
            <span>{index + 1}</span>
            <input
              value={teacher.name}
              onChange={(event) => {
                const next = teachers.map((item) =>
                  item.id === teacher.id ? { ...item, name: event.target.value } : item
                );
                onChange(next);
              }}
            />
            <button
              className="icon-button"
              onClick={() => onChange(teachers.filter((item) => item.id !== teacher.id))}
              title="حذف"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsEditor({
  profile,
  onChange,
  onReportChange,
  onSmartTemplateChange,
  hasSignature,
  onRemoveSignature
}: {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => Promise<void>;
  onReportChange: (report: Report) => Promise<void>;
  onSmartTemplateChange: (template: SmartTemplate) => void;
  hasSignature: boolean;
  onRemoveSignature: () => Promise<void>;
}) {
  const settings = profile.schoolSettings;
  const report = profile.currentReport;
  const smartTemplate = activeSmartTemplate(profile);
  const updateRegion = (
    regionId: keyof SmartTemplate["tableRegions"],
    patch: Partial<SmartTemplate["tableRegions"][typeof regionId]>
  ) => {
    const nextTemplate: SmartTemplate = {
      ...smartTemplate,
      tableRegions: {
        ...smartTemplate.tableRegions,
        [regionId]: {
          ...smartTemplate.tableRegions[regionId],
          ...patch
        }
      }
    };
    onSmartTemplateChange(nextTemplate);
  };
  return (
    <section className="panel-section">
      {[
        ["department", "الإدارة"],
        ["schoolName", "المدرسة"],
        ["principalName", "مديرة المدرسة"]
      ].map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            value={String(settings[key as keyof typeof settings])}
            onChange={(event) =>
              onChange({
                schoolSettings: {
                  ...settings,
                  [key]: event.target.value
                }
              })
            }
          />
        </label>
      ))}
      <label>
        عدد معلمات المدرسة
        <input
          type="number"
          min={0}
          value={settings.totalTeachers}
          onChange={(event) =>
            onChange({
              schoolSettings: {
                ...settings,
                totalTeachers: Number(event.target.value)
              }
            })
          }
        />
      </label>
      <div className="settings-group">
        <h2>التحكم من المعاينة</h2>
        <p className="interactive-hint">
          اضغط على بيانات الوزارة أو اسم المديرة أو التوقيع داخل المعاينة، ثم اسحب العنصر لتحريكه.
          اسحب زوايا اسم المديرة أو التوقيع لتغيير حجمهما. ولتعديل الخط، اضغط على أي نص داخل المعاينة.
        </p>
        <div className="signature-action-row">
          <div>
            <strong>التوقيع</strong>
            <small>يحذف صورة التوقيع فقط من التقرير والقالب الحالي.</small>
          </div>
          <button type="button" onClick={() => void onRemoveSignature()} disabled={!hasSignature}>
            <Trash2 size={16} />
            حذف التوقيع
          </button>
        </div>
      </div>
      <div className="settings-group">
        <h2>القالب الذكي</h2>
        <p className="interactive-hint">
          اسحب أزرار الجداول الصغيرة داخل المعاينة لتحريك المنطقة، أو اضبط القياسات هنا بدقة.
          الجداول تُعاد رسمها بعدد الصفوف الفعلي ولا تعتمد على صفوف PDF الأصلية.
        </p>
        <RangeField
          label="ارتفاع صف جدول المعلمات"
          value={smartTemplate.tableRegions.details.rowHeightMm}
          min={4.2}
          max={8}
          step={0.1}
          unit="mm"
          onChange={(value) => updateRegion("details", { rowHeightMm: value })}
        />
        <RangeField
          label="ارتفاع منطقة جدول المعلمات"
          value={smartTemplate.tableRegions.details.heightMm}
          min={120}
          max={205}
          step={1}
          unit="mm"
          onChange={(value) => updateRegion("details", { heightMm: value })}
        />
        <RangeField
          label="ارتفاع منطقة نقاط القوة"
          value={smartTemplate.tableRegions.strengths.heightMm}
          min={45}
          max={90}
          step={0.5}
          unit="mm"
          onChange={(value) => updateRegion("strengths", { heightMm: value })}
        />
        <RangeField
          label="ارتفاع منطقة فرص التحسين"
          value={smartTemplate.tableRegions.improvements.heightMm}
          min={25}
          max={70}
          step={0.5}
          unit="mm"
          onChange={(value) => updateRegion("improvements", { heightMm: value })}
        />
        <ColorField
          label="لون خلفية نقاط القوة"
          value={smartTemplate.tableRegions.strengths.backgroundColor || "#f9e3d2"}
          onChange={(value) => updateRegion("strengths", { backgroundColor: value })}
        />
        <ColorField
          label="لون خلفية فرص التحسين"
          value={smartTemplate.tableRegions.improvements.backgroundColor || "#d9e4f5"}
          onChange={(value) => updateRegion("improvements", { backgroundColor: value })}
        />
      </div>
      <div className="settings-group">
        <h2>أعمدة جدول المعلمات</h2>
        <DetailColumnToggles profile={profile} onChange={onChange} />
        <ColumnToggles profile={profile} onChange={onChange} />
      </div>
      {report ? (
        <>
          <label>
            نقاط القوة
            <textarea
              value={report.strengths.join("\n")}
              onChange={(event) => onReportChange({ ...report, strengths: event.target.value.split("\n") })}
            />
          </label>
          <label>
            فرص التحسين
            <textarea
              value={report.improvements.join("\n")}
              onChange={(event) => onReportChange({ ...report, improvements: event.target.value.split("\n") })}
            />
          </label>
        </>
      ) : null}
    </section>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>
        {label}
        <strong>
          {value}
          {unit}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
