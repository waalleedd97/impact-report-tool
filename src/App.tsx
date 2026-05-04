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
  generateReport,
  importPdf,
  listReports,
  loadProfile,
  saveProfile,
  saveReport
} from "./api";
import ReportPreview from "./components/ReportPreview";
import { createDefaultSmartTemplate, defaultPrintSettings, emptyProfile } from "./defaults";
import { reportFromProfile } from "./reportUtils";
import type { ImpactLevel, PrintSettings, Profile, Report, SmartTemplate, StoredReportMeta, Teacher } from "./types";

const rememberedEmailKey = "impact-report-email";

function makeTeacher(name = ""): Teacher {
  return {
    id: `teacher-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name
  };
}

function levelLabel(level: ImpactLevel) {
  if (level === "high") return "نسبة مرتفعة";
  if (level === "medium") return "نسبة متوسطة";
  return "نسبة منخفضة";
}

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ") || "report";
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
    printSettings: normalizePrintSettings(fallbackPrintSettings, report.printSettings),
    smartTemplate: report.smartTemplate || fallbackSmartTemplate,
    percentageOverrides: { ...report.percentageOverrides },
    summaryNumberOverrides: { ...report.summaryNumberOverrides }
  };
}

function normalizeProfile(email: string, loadedProfile: Partial<Profile>): Profile {
  const smartTemplateState = normalizeSmartTemplates(loadedProfile);
  const mergedProfile: Profile = {
    ...emptyProfile(email),
    ...loadedProfile,
    email,
    smartTemplates: smartTemplateState.smartTemplates,
    activeSmartTemplateId: smartTemplateState.activeSmartTemplateId,
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
  const [emailInput, setEmailInput] = useState(localStorage.getItem(rememberedEmailKey) || "");
  const [email, setEmail] = useState(localStorage.getItem(rememberedEmailKey) || "");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courseTitle, setCourseTitle] = useState("الدروس التطبيقية");
  const [level, setLevel] = useState<ImpactLevel>("high");
  const [activeTab, setActiveTab] = useState<"report" | "teachers" | "settings" | "saved">("report");
  const [reports, setReports] = useState<StoredReportMeta[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [importedNames, setImportedNames] = useState<Teacher[] | null>(null);

  useEffect(() => {
    if (!email) return;
    setBusy("تحميل الملف الشخصي");
    Promise.all([loadProfile(email), listReports(email)])
      .then(([loadedProfile, loadedReports]) => {
        const mergedProfile = normalizeProfile(email, loadedProfile);
        setProfile(mergedProfile);
        setReports(loadedReports);
        if (!mergedProfile.currentReport && mergedProfile.teachers.length) {
          const reportProfile = {
            ...mergedProfile,
            currentReport: reportFromProfile(mergedProfile, courseTitle, level)
          };
          setProfile(reportProfile);
        }
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setBusy(""));
  }, [email]);

  const currentReport = profile?.currentReport;

  const teacherNamesValid = useMemo(
    () => Boolean(profile?.teachers.length && profile.teachers.every((teacher) => teacher.name.trim())),
    [profile?.teachers]
  );

  async function persistProfile(nextProfile: Profile) {
    setProfile(nextProfile);
    await saveProfile(nextProfile);
  }

  function login(event: React.FormEvent) {
    event.preventDefault();
    const normalized = emailInput.trim().toLowerCase();
    if (!normalized.includes("@")) {
      setMessage("أدخل بريد صحيح");
      return;
    }
    localStorage.setItem(rememberedEmailKey, normalized);
    setEmail(normalized);
    setMessage("");
  }

  async function handleImport(file?: File) {
    if (!file || !profile) return;
    setBusy("استيراد ملف PDF");
    setMessage("");
    try {
      const imported = await importPdf(profile.email, file);
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

  async function handleGenerate() {
    if (!profile || !teacherNamesValid) {
      setMessage("أضف أسماء المعلمات أولاً");
      return;
    }
    setBusy("توليد التقرير");
    setMessage("");
    try {
      const result = await generateReport({
        email: profile.email,
        courseTitle,
        level,
        teachers: profile.teachers,
        profile
      });
      const nextProfile = {
        ...profile,
        currentReport: normalizeReport(result.report, profile.printSettings, activeSmartTemplate(profile))
      };
      await persistProfile(nextProfile);
      setMessage(
        result.source === "deepseek"
          ? "تم توليد التقرير عبر DeepSeek"
          : result.warning || "تم توليد تقرير محلي مؤقت"
      );
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
      const saved = await saveReport(profile.currentReport);
      setReports((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setMessage("تم حفظ التقرير");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ التقرير");
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

      pdf.save(`${safeFilename(profile.currentReport.courseTitle)}.pdf`);
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
      void saveProfile(nextProfile).catch((error) => {
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
      void saveProfile(nextProfile).catch((error) => {
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
      void saveProfile(nextProfile).catch((error) => {
        setMessage(error instanceof Error ? error.message : "تعذر حفظ التقرير");
      });
    }
  }

  if (!email) {
    return (
      <main className="login-screen" dir="rtl">
        <form className="login-panel" onSubmit={login}>
          <FileText size={34} />
          <h1>أداة تقرير قياس الأثر</h1>
          <label>
            البريد
            <input
              dir="ltr"
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <button type="submit">دخول</button>
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
          <div>
            <h1>تقرير قياس الأثر</h1>
            <p>{email}</p>
          </div>
          <button
            className="icon-button"
            onClick={() => {
              localStorage.removeItem(rememberedEmailKey);
              setEmail("");
              setProfile(null);
            }}
            title="خروج"
          >
            <LogOut size={18} />
          </button>
        </header>

        <nav className="tabs">
          {[
            ["report", "التقرير"],
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
            <div className="field-group">
              <span>مستوى النسبة</span>
              <div className="segmented">
                {(["high", "medium", "low"] as ImpactLevel[]).map((item) => (
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
                PDF A4
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
          />
        ) : null}

        {activeTab === "saved" ? (
          <section className="panel-section saved-list">
            {reports.length ? (
              reports.map((item) => (
                <button
                  key={item.id}
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
        <ReportPreview
          report={currentReport}
          onPrintSettingsChange={applyPrintSettings}
          onReportChange={applyReportPatch}
          onSmartTemplateChange={applySmartTemplate}
        />
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
  onSmartTemplateChange
}: {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => Promise<void>;
  onReportChange: (report: Report) => Promise<void>;
  onSmartTemplateChange: (template: SmartTemplate) => void;
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
