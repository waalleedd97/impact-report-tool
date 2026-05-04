import cors from "cors";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

type ImpactLevel = "very_high" | "high" | "medium" | "low" | "very_low";

type Teacher = {
  id: string;
  name: string;
};

type BenefitColumn = {
  id: string;
  label: string;
};

type SchoolSettings = {
  country: string;
  ministry: string;
  department: string;
  schoolName: string;
  principalName: string;
  totalTeachers: number;
};

type TemplateAssets = {
  backgroundUrl?: string;
  signatureUrl?: string;
};

type TableRegionId = "summary" | "strengths" | "improvements" | "details";

type TableColumnTemplate = {
  id: string;
  label: string;
  widthMm?: number;
  visible?: boolean;
};

type TableRegion = {
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

type SmartTemplate = {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  assets: TemplateAssets;
  tableRegions: Record<TableRegionId, TableRegion>;
};

type PagePrintOverride = {
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

type TextStyleOverride = {
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: number;
  color?: string;
};

type CheckmarkOffset = {
  x: number;
  y: number;
};

type PrintSettings = {
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

type ReportRow = {
  teacherId: string;
  teacherName: string;
  lessonsCount: number;
  contribution: string;
  effectiveness: string;
  benefits: Record<string, boolean>;
  acquiredSkills: string;
};

type Profile = {
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

type Report = {
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
  summary: {
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
  percentageOverrides: Record<string, number>;
  summaryNumberOverrides: Record<string, number>;
  strengths: string[];
  improvements: string[];
};

type StoredReportMeta = {
  id: string;
  email: string;
  title: string;
  level: ImpactLevel;
  createdAt: string;
  updatedAt: string;
  report: Report;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.VERCEL ? path.join("/tmp", "impact-report-tool") : path.join(rootDir, "data");
const uploadDir = path.join(dataDir, "uploads");
const assetDir = path.join(dataDir, "assets");
const dbPath = path.join(dataDir, "app.db");
const port = Number(process.env.PORT || 5174);

await fsp.mkdir(uploadDir, { recursive: true });
await fsp.mkdir(assetDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    email TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    title TEXT NOT NULL,
    level TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS reports_email_updated_idx
    ON reports (email, updated_at DESC);
`);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceRoleKey);
const supabaseConfigIssue = supabaseUrl && !supabaseServiceRoleKey ? "missing-service-role-key" : null;
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;
const supabaseDataBucket = (process.env.SUPABASE_DATA_BUCKET || "smart-editor-data").trim();
let supabaseDataBucketReady = false;
let supabaseDataMode: "postgres" | "storage-json" =
  process.env.SUPABASE_DATA_MODE?.trim() === "storage" ? "storage-json" : "postgres";

function storageLabel() {
  return supabase ? `supabase-${supabaseDataMode}` : "sqlite";
}

function isMissingSupabaseTable(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === "PGRST205" || Boolean(candidate?.message?.includes("Could not find the table"));
}

function isStorageNotFound(error: unknown) {
  const candidate = error as { statusCode?: string | number; message?: string } | null;
  return candidate?.statusCode === "404" || candidate?.statusCode === 404 || Boolean(candidate?.message?.includes("not found"));
}

function safeStorageKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9@._-]/gi, "_");
}

function profileStoragePath(email: string) {
  return `profiles/${safeStorageKey(email)}.json`;
}

function reportStorageFolder(email: string) {
  return `reports/${safeStorageKey(email)}`;
}

function reportStoragePath(email: string, reportId: string) {
  return `${reportStorageFolder(email)}/${safeStorageKey(reportId)}.json`;
}

async function ensureSupabaseDataBucket() {
  if (!supabase || supabaseDataBucketReady) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`تعذر فحص مساحة بيانات Supabase: ${listError.message}`);
  }
  if (!buckets?.some((bucket) => bucket.name === supabaseDataBucket)) {
    const { error } = await supabase.storage.createBucket(supabaseDataBucket, { public: false });
    if (error) {
      throw new Error(`تعذر إنشاء مساحة بيانات Supabase: ${error.message}`);
    }
  }
  supabaseDataBucketReady = true;
}

async function downloadSupabaseJson<T>(storagePath: string): Promise<T | undefined> {
  if (!supabase) return undefined;
  await ensureSupabaseDataBucket();
  const { data, error } = await supabase.storage.from(supabaseDataBucket).download(storagePath);
  if (error) {
    if (isStorageNotFound(error)) return undefined;
    throw new Error(error.message);
  }
  if (!data) return undefined;
  return JSON.parse(await data.text()) as T;
}

async function uploadSupabaseJson(storagePath: string, data: unknown) {
  if (!supabase) return;
  await ensureSupabaseDataBucket();
  const { error } = await supabase.storage.from(supabaseDataBucket).upload(
    storagePath,
    Buffer.from(JSON.stringify(data, null, 2)),
    {
      contentType: "application/json; charset=utf-8",
      upsert: true
    }
  );
  if (error) {
    throw new Error(error.message);
  }
}

async function loadProfileFromSupabaseStorage(email: string) {
  return downloadSupabaseJson<Partial<Profile>>(profileStoragePath(email));
}

async function saveProfileToSupabaseStorage(email: string, profile: Profile) {
  await uploadSupabaseJson(profileStoragePath(email), profile);
  return profile;
}

async function listReportsFromSupabaseStorage(email: string) {
  if (!supabase) return [];
  await ensureSupabaseDataBucket();
  const { data, error } = await supabase.storage.from(supabaseDataBucket).list(reportStorageFolder(email), {
    limit: 200,
    sortBy: { column: "updated_at", order: "desc" }
  });
  if (error) {
    if (isStorageNotFound(error)) return [];
    throw new Error(error.message);
  }
  const reports = await Promise.all(
    (data || [])
      .filter((item) => item.name.endsWith(".json"))
      .map((item) => downloadSupabaseJson<StoredReportMeta>(`${reportStorageFolder(email)}/${item.name}`))
  );
  return reports
    .filter((report): report is StoredReportMeta => Boolean(report))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function saveReportToSupabaseStorage(email: string, meta: StoredReportMeta) {
  await uploadSupabaseJson(reportStoragePath(email, meta.id), meta);
  return meta;
}

async function loadProfileData(email: string) {
  if (supabase) {
    if (supabaseDataMode === "storage-json") {
      return loadProfileFromSupabaseStorage(email);
    }
    const { data, error } = await supabase.from("profiles").select("data").eq("email", email).maybeSingle();
    if (error) {
      if (isMissingSupabaseTable(error)) {
        supabaseDataMode = "storage-json";
        return loadProfileFromSupabaseStorage(email);
      }
      throw new Error(error.message);
    }
    return data?.data as Partial<Profile> | undefined;
  }

  const row = db.prepare("SELECT data FROM profiles WHERE email = ?").get(email) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Partial<Profile>) : undefined;
}

async function saveProfileData(email: string, profile: Profile) {
  if (supabase) {
    if (supabaseDataMode === "storage-json") {
      return saveProfileToSupabaseStorage(email, profile);
    }
    const { error } = await supabase.from("profiles").upsert(
      {
        email,
        data: profile,
        updated_at: nowIso()
      },
      { onConflict: "email" }
    );
    if (error) {
      if (isMissingSupabaseTable(error)) {
        supabaseDataMode = "storage-json";
        return saveProfileToSupabaseStorage(email, profile);
      }
      throw new Error(error.message);
    }
    return profile;
  }

  db.prepare(
    `INSERT INTO profiles (email, data, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(email, JSON.stringify(profile), nowIso());
  return profile;
}

function reportMetaFromReport(report: Report): StoredReportMeta {
  return {
    id: report.id,
    email: report.email,
    title: report.courseTitle,
    level: report.level,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    report
  };
}

async function listReportData(email: string) {
  if (supabase) {
    if (supabaseDataMode === "storage-json") {
      return listReportsFromSupabaseStorage(email);
    }
    const { data, error } = await supabase
      .from("reports")
      .select("id,email,title,level,data,created_at,updated_at")
      .eq("email", email)
      .order("updated_at", { ascending: false });
    if (error) {
      if (isMissingSupabaseTable(error)) {
        supabaseDataMode = "storage-json";
        return listReportsFromSupabaseStorage(email);
      }
      throw new Error(error.message);
    }
    return (data || []).map((row: any) => ({
      id: row.id,
      email: row.email,
      title: row.title,
      level: row.level as ImpactLevel,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      report: row.data as Report
    }));
  }

  const rows = db
    .prepare("SELECT id, email, title, level, data, created_at, updated_at FROM reports WHERE email = ? ORDER BY updated_at DESC")
    .all(email) as Array<{
    id: string;
    email: string;
    title: string;
    level: ImpactLevel;
    data: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    title: row.title,
    level: row.level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    report: JSON.parse(row.data) as Report
  }));
}

async function upsertReportData(email: string, report: Report) {
  if (!report?.id) {
    throw new Error("تقرير غير صحيح");
  }

  const updatedAt = nowIso();
  const nextReport = { ...report, email, updatedAt };
  const meta = reportMetaFromReport({
    ...nextReport,
    createdAt: nextReport.createdAt || updatedAt
  });

  if (supabase) {
    if (supabaseDataMode === "storage-json") {
      return saveReportToSupabaseStorage(email, meta);
    }
    const { error } = await supabase.from("reports").upsert(
      {
        id: meta.id,
        email,
        title: meta.title,
        level: meta.level,
        data: meta.report,
        created_at: meta.createdAt,
        updated_at: meta.updatedAt
      },
      { onConflict: "id" }
    );
    if (error) {
      if (isMissingSupabaseTable(error)) {
        supabaseDataMode = "storage-json";
        return saveReportToSupabaseStorage(email, meta);
      }
      throw new Error(error.message);
    }
    return meta;
  }

  db.prepare(
    `INSERT INTO reports (id, email, title, level, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       level = excluded.level,
       data = excluded.data,
       updated_at = excluded.updated_at`
  ).run(meta.id, email, meta.title, meta.level, JSON.stringify(meta.report), meta.createdAt, meta.updatedAt);
  return meta;
}

const defaultBenefitColumns: BenefitColumn[] = [
  { id: "subject", label: "فهم المادة الدراسية" },
  { id: "teaching", label: "تطوير المهارات التدريسية" },
  { id: "confidence", label: "تعزيز الثقة بالنفس" },
  { id: "teamwork", label: "تحسين العمل الجماعي" },
  { id: "classroom", label: "الإدارة الصفية" },
  { id: "technology", label: "التطبيقات التقنية" },
  { id: "motivation", label: "التعزيز والتحفيز" }
];

const defaultSchoolSettings: SchoolSettings = {
  country: "المملكة العربية السعودية",
  ministry: "وزارة التعليم",
  department: "الإدارة العامة للتعليم بالمنطقة الشرقية",
  schoolName: "الابتدائية الثالثة والعشرون الطفولة المبكرة",
  principalName: "فاطمه القحطاني",
  totalTeachers: 32
};

const defaultPrintSettings: PrintSettings = {
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

function createDefaultSmartTemplate(assets: TemplateAssets = {}, name = "قالب تقرير قياس الأثر"): SmartTemplate {
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

function emptyProfile(email: string): Profile {
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

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("بريد غير صحيح");
  }
  return email;
}

function nowIso() {
  return new Date().toISOString();
}

function assetUrl(filename: string) {
  return `/assets/templates/${filename.split("/").map(encodeURIComponent).join("/")}`;
}

const supabaseAssetsBucket = (process.env.SUPABASE_ASSETS_BUCKET || "smart-editor-assets").trim();
let supabaseAssetsBucketReady = false;

async function ensureSupabaseAssetsBucket() {
  if (!supabase || supabaseAssetsBucketReady) return;
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`تعذر فحص مساحة ملفات Supabase: ${listError.message}`);
  }
  if (!buckets?.some((bucket) => bucket.name === supabaseAssetsBucket)) {
    const { error } = await supabase.storage.createBucket(supabaseAssetsBucket, { public: false });
    if (error) {
      throw new Error(`تعذر إنشاء مساحة ملفات Supabase: ${error.message}`);
    }
  }
  supabaseAssetsBucketReady = true;
}

async function saveTemplateAsset(profileKey: string, filename: string, localFilePath: string) {
  const safeFilename = path.basename(filename);
  const storagePath = `${profileKey}/${safeFilename}`;
  if (supabase) {
    await ensureSupabaseAssetsBucket();
    const contentType = safeFilename.toLowerCase().endsWith(".png") ? "image/png" : "application/octet-stream";
    const { error } = await supabase.storage
      .from(supabaseAssetsBucket)
      .upload(storagePath, await fsp.readFile(localFilePath), {
        contentType,
        upsert: true
      });
    if (error) {
      throw new Error(`تعذر حفظ أصل القالب في Supabase: ${error.message}`);
    }
  }
  return assetUrl(storagePath);
}

function runPythonImport(pdfPath: string, profileAssetDir: string): Promise<{
  teachers: Teacher[];
  templateAssets: TemplateAssets;
  schoolSettings: Partial<SchoolSettings>;
}> {
  return new Promise((resolve, reject) => {
    const script = path.join(rootDir, "scripts", "import_pdf.py");
    const child = spawn("python3", [script, pdfPath, profileAssetDir], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "تعذر قراءة ملف PDF"));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (error) {
        reject(new Error(`تعذر تحليل نتيجة PDF: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function percentage(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0;
}

const impactLevels: ImpactLevel[] = ["very_high", "high", "medium", "low", "very_low"];

const impactSummaryByLevel: Record<ImpactLevel, string> = {
  very_high: "تُسهم الدروس التطبيقية في تحسن وتطوير الممارسات التدريسية بدرجة مرتفعة جداً",
  high: "تُسهم الدروس التطبيقية في تحسن وتطوير الممارسات التدريسية بدرجة عالية",
  medium: "تُسهم الدروس التطبيقية في تطوير الممارسات التدريسية بدرجة متوسطة",
  low: "تحتاج الدروس التطبيقية إلى دعم أكبر لرفع أثرها على الممارسات التدريسية",
  very_low: "تحتاج الدروس التطبيقية إلى إعادة تنظيم ومتابعة دقيقة لرفع أثرها على الممارسات التدريسية"
};

const levelMeaningByLevel: Record<ImpactLevel, string> = {
  very_high: "النسبة العامة مرتفعة جداً؛ اجعل معظم المؤشرات والنسب بين 90 و100",
  high: "النسبة العامة مرتفعة؛ اجعل معظم المؤشرات والنسب بين 75 و89",
  medium: "النسبة العامة متوسطة؛ اجعل معظم المؤشرات والنسب بين 50 و74",
  low: "النسبة العامة منخفضة؛ اجعل معظم المؤشرات والنسب بين 25 و49",
  very_low: "النسبة العامة منخفضة جداً؛ اجعل معظم المؤشرات والنسب بين 5 و24"
};

const percentageRanges: Record<ImpactLevel, [number, number]> = {
  very_high: [90, 100],
  high: [75, 89],
  medium: [50, 74],
  low: [25, 49],
  very_low: [5, 24]
};

function randomInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomPercent(level: ImpactLevel) {
  const [min, max] = percentageRanges[level];
  return randomInt(min, max);
}

function clampNumber(value: unknown, min: number, max: number) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return undefined;
  return Math.max(min, Math.min(max, number));
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

function percentageOverridesForLevel(level: ImpactLevel, columns: BenefitColumn[], aiOverrides?: Record<string, unknown>) {
  const [min, max] = percentageRanges[level];
  const contribution = randomContributionOverrides(level);
  const defaults: Record<string, number> = {
    attendance: randomPercent(level),
    contributionHigh: contribution.high,
    contributionMedium: contribution.medium,
    contributionLow: contribution.low,
    effectiveness: randomPercent(level)
  };
  for (const column of columns) {
    defaults[`benefit:${column.id}`] = randomPercent(level);
  }

  const next: Record<string, number> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key.startsWith("contribution")) {
      next[key] = fallback;
      continue;
    }
    next[key] = clampNumber(aiOverrides?.[key], min, max) ?? fallback;
  }
  return next;
}

function composeReport(input: {
  id?: string;
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  schoolSettings: SchoolSettings;
  templateAssets: TemplateAssets;
  smartTemplate?: SmartTemplate;
  printSettings?: Partial<PrintSettings>;
  benefitColumns: BenefitColumn[];
  visibleColumnIds: string[];
  rows: ReportRow[];
  strengths: string[];
  improvements: string[];
}): Report {
  const createdAt = nowIso();
  const rows = input.rows;
  const participantsCount = rows.length;
  const totalTeachers = Math.max(input.schoolSettings.totalTeachers || participantsCount, participantsCount);
  const implementedLessons = rows.reduce((sum, row) => sum + Math.max(0, Number(row.lessonsCount) || 0), 0);
  const benefitPercentages: Record<string, number> = {};
  for (const column of input.benefitColumns) {
    benefitPercentages[column.id] = percentage(rows.filter((row) => row.benefits?.[column.id]).length, participantsCount);
  }

  return {
    id: input.id || randomUUID(),
    email: input.email,
    courseTitle: input.courseTitle,
    level: input.level,
    createdAt,
    updatedAt: createdAt,
    schoolSettings: input.schoolSettings,
    templateAssets: input.templateAssets,
    smartTemplate: input.smartTemplate,
    printSettings: { ...defaultPrintSettings, ...input.printSettings },
    benefitColumns: input.benefitColumns,
    visibleColumnIds: input.visibleColumnIds,
    rows,
    summary: {
      totalTeachers,
      participantsCount,
      attendancePercentage: percentage(participantsCount, totalTeachers),
      implementedLessons,
      impactSummary: impactSummaryByLevel[input.level],
      contributionHighPercent: percentage(rows.filter((row) => row.contribution.includes("عالية")).length, participantsCount),
      contributionMediumPercent: percentage(
        rows.filter((row) => row.contribution.includes("متوسطة")).length,
        participantsCount
      ),
      contributionLowPercent: percentage(rows.filter((row) => row.contribution.includes("منخفضة")).length, participantsCount),
      effectivenessHighPercent: percentage(rows.filter((row) => row.effectiveness.includes("عالية")).length, participantsCount),
      benefitPercentages
    },
    percentageOverrides: {},
    summaryNumberOverrides: {},
    strengths: input.strengths,
    improvements: input.improvements
  };
}

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

function localGeneratedReport(input: {
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  teachers: Teacher[];
  profile: Profile;
}) {
  const activeSmartTemplate =
    input.profile.smartTemplates.find((template) => template.id === input.profile.activeSmartTemplateId) ||
    input.profile.smartTemplates[0];
  const contributionOptions: Record<ImpactLevel, string[]> = {
    very_high: ["تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة عالية"],
    high: ["تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة عالية", "تساهم بدرجة متوسطة"],
    medium: ["تساهم بدرجة عالية", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة"],
    low: ["تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة عالية"],
    very_low: ["تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة", "تساهم بدرجة متوسطة"]
  };
  const effectivenessOptions: Record<ImpactLevel, string[]> = {
    very_high: ["فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة عالية"],
    high: ["فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة عالية", "فاعلة بدرجة متوسطة"],
    medium: ["فاعلة بدرجة عالية", "فاعلة بدرجة متوسطة", "فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة"],
    low: ["فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة عالية"],
    very_low: ["فاعلة بدرجة منخفضة", "فاعلة بدرجة منخفضة", "فاعلة بدرجة متوسطة", "فاعلة بدرجة منخفضة"]
  };
  const rows = input.teachers.map((teacher, index) => {
    const benefits: Record<string, boolean> = {};
    const countByLevel: Record<ImpactLevel, number> = {
      very_high: 5 + (index % 3),
      high: 4 + (index % 3),
      medium: 2 + (index % 3),
      low: 1 + (index % 2),
      very_low: index % 4 === 0 ? 1 : 0
    };
    const count = Math.min(input.profile.benefitColumns.length, countByLevel[input.level]);
    input.profile.benefitColumns.forEach((column, columnIndex) => {
      benefits[column.id] = ((columnIndex + index) % input.profile.benefitColumns.length) < count;
    });
    return {
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
      contribution: contributionOptions[input.level][index % contributionOptions[input.level].length],
      effectiveness: effectivenessOptions[input.level][(index + 1) % effectivenessOptions[input.level].length],
      benefits,
      acquiredSkills: skillPhrases[index % skillPhrases.length]
    };
  });
  const report = composeReport({
    email: input.email,
    courseTitle: input.courseTitle || "الدروس التطبيقية",
    level: input.level,
    schoolSettings: {
      ...input.profile.schoolSettings,
      totalTeachers: Math.max(input.profile.schoolSettings.totalTeachers, input.teachers.length)
    },
    templateAssets: input.profile.templateAssets,
    smartTemplate: activeSmartTemplate,
    printSettings: input.profile.printSettings,
    benefitColumns: input.profile.benefitColumns,
    visibleColumnIds: input.profile.visibleColumnIds,
    rows,
    strengths: [
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
    ],
    improvements: [
      "تطبيق الدروس التطبيقية في العام القادم بشكل أكبر للاستفادة والوقوف على بعض الفجوات ومعالجتها",
      "عمل دروس لتخصصات أخرى",
      "تطبيقها في أوقات متباعدة بعد قياس الأثر لما سبقها",
      "زيادة توظيف الوسائل التعليمية والتقنية الحديثة",
      "إتاحة وقت أطول للتطبيق العملي لجميع المتعلمين",
      "تعزيز دور المتعلم وجعله محور العملية التعليمية",
      "تطبيق أساليب تدريس تركز على رفع نواتج التعلم",
      "زيادة الوقت للتطبيق العملي وتنويع الأساليب بما يناسب مستويات الطلاب"
    ]
  });
  return {
    ...report,
    percentageOverrides: percentageOverridesForLevel(input.level, input.profile.benefitColumns)
  };
}

function allowedContribution(value: unknown) {
  const text = String(value || "");
  if (text.includes("متوسطة") || text.includes("متوسط")) return "تساهم بدرجة متوسطة";
  return "تساهم بدرجة عالية";
}

function allowedEffectiveness(value: unknown) {
  const text = String(value || "");
  if (text.includes("منخفضة")) return "فاعلة بدرجة منخفضة";
  if (text.includes("متوسطة") || text.includes("متوسط")) return "فاعلة بدرجة متوسطة";
  return "فاعلة بدرجة عالية";
}

function sanitizeAiReport(payload: any, input: {
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  teachers: Teacher[];
  profile: Profile;
}) {
  const fallback = localGeneratedReport(input);
  const aiRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const rows = input.teachers.map((teacher, index) => {
    const aiRow = aiRows[index] || {};
    const benefits: Record<string, boolean> = {};
    for (const column of input.profile.benefitColumns) {
      benefits[column.id] = Boolean(aiRow?.benefits?.[column.id]);
    }
    if (!Object.values(benefits).some(Boolean)) {
      Object.assign(benefits, fallback.rows[index]?.benefits || {});
    }
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      lessonsCount: Math.max(1, Math.min(999, Number(aiRow.lessonsCount) || fallback.rows[index]?.lessonsCount || 1)),
      contribution: allowedContribution(aiRow.contribution),
      effectiveness: allowedEffectiveness(aiRow.effectiveness),
      benefits,
      acquiredSkills: String(aiRow.acquiredSkills || fallback.rows[index]?.acquiredSkills || "").slice(0, 180)
    };
  });

  const report = composeReport({
    email: input.email,
    courseTitle: input.courseTitle,
    level: input.level,
    schoolSettings: input.profile.schoolSettings,
    templateAssets: input.profile.templateAssets,
    smartTemplate:
      input.profile.smartTemplates.find((template) => template.id === input.profile.activeSmartTemplateId) ||
      input.profile.smartTemplates[0],
    printSettings: input.profile.printSettings,
    benefitColumns: input.profile.benefitColumns,
    visibleColumnIds: input.profile.visibleColumnIds,
    rows,
    strengths: Array.isArray(payload?.strengths) && payload.strengths.length ? payload.strengths.slice(0, 12) : fallback.strengths,
    improvements:
      Array.isArray(payload?.improvements) && payload.improvements.length ? payload.improvements.slice(0, 8) : fallback.improvements
  });
  return {
    ...report,
    percentageOverrides: percentageOverridesForLevel(input.level, input.profile.benefitColumns, payload?.percentageOverrides)
  };
}

async function generateWithDeepSeek(input: {
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  teachers: Teacher[];
  profile: Profile;
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("لم يتم ضبط DEEPSEEK_API_KEY");
  }

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const system = `
أنت وكيل لإعداد تقرير قياس أثر بعدي لنشاط تطوير مهني باللغة العربية.
أخرج JSON صالح فقط. لا تضف شرحاً خارج JSON.
لا تغير أسماء المعلمات ولا تضف أسماء.
اجعل المحتوى مناسباً لبيئة تعليم ابتدائي وبعبارات رسمية مختصرة.
المستخدمون المستهدفون في المملكة العربية السعودية هم: مديرو ومديرات المدارس، الموجهون والموجهات الطلابيات، والمعلمون والمعلمات.
استخدم لغة مهنية مناسبة للتقارير المدرسية السعودية، ومفردات مألوفة في بيئة وزارة التعليم مثل: نواتج التعلم، الممارسات التدريسية، البيئة الصفية، التحصيل، التقويم، الدعم، المتابعة، الإرشاد الطلابي.
راعِ أن التقرير قد يقرأه قيادي مدرسي أو مشرف/موجه أو معلم، لذلك اجعل العبارات دقيقة، قابلة للنسخ في تقرير رسمي، ولا تذكر أنك نموذج ذكاء اصطناعي.
اجعل نقاط القوة تعكس الأثر الإيجابي للنشاط على الممارسات أو الدعم المدرسي، واجعل فرص التحسين عملية وقابلة للتنفيذ داخل المدرسة.
حقل contribution يقبل قيمتين فقط: "تساهم بدرجة عالية" أو "تساهم بدرجة متوسطة".
اكتب نقاط القوة وفرص التحسين بناءً على عنوان النشاط، ولا تجعلها عامة جداً.
اكتب percentageOverrides كنسب عشوائية من 0 إلى 100 ضمن النطاق المطلوب للدرجة المختارة.
صيغة JSON:
{
  "rows": [
    {
      "lessonsCount": 1,
      "contribution": "تساهم بدرجة عالية",
      "effectiveness": "فاعلة بدرجة عالية",
      "benefits": { "subject": true },
      "acquiredSkills": "نص عربي مختصر"
    }
  ],
  "strengths": ["نص"],
  "improvements": ["نص"],
  "percentageOverrides": {
    "attendance": 92,
    "effectiveness": 91,
    "benefit:subject": 93
  }
}`.trim();
  const user = {
    courseTitle: input.courseTitle,
    level: input.level,
    levelMeaning: levelMeaningByLevel[input.level],
    allowedPercentageRange: percentageRanges[input.level],
    percentageOverrideKeys: [
      "attendance",
      "effectiveness",
      ...input.profile.benefitColumns.map((column) => `benefit:${column.id}`)
    ],
    benefitColumns: input.profile.benefitColumns,
    teacherNames: input.teachers.map((teacher) => teacher.name)
  };

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `json\n${JSON.stringify(user)}` }
    ],
    response_format: { type: "json_object" },
    temperature: 0.9,
    max_tokens: 5000
  };
  if (model.startsWith("deepseek-v4")) {
    body.thinking = { type: "disabled" };
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "فشل اتصال DeepSeek");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("استجابة DeepSeek فارغة");
  }
  return sanitizeAiReport(JSON.parse(content), input);
}

const upload = multer({ dest: uploadDir });
const app = express();

app.use(cors());
app.use(express.json({ limit: "4mb" }));
app.get(/^\/assets\/templates\/(.+)$/, async (req, res, next) => {
  if (!supabase) {
    next();
    return;
  }
  try {
    const storagePath = decodeURIComponent(String(req.params[0] || ""));
    const { data, error } = await supabase.storage.from(supabaseAssetsBucket).download(storagePath);
    if (error || !data) {
      next();
      return;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.type(path.extname(storagePath) || "application/octet-stream");
    res.send(buffer);
  } catch {
    next();
  }
});
app.use("/assets/templates", express.static(assetDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    storage: storageLabel(),
    assets: supabase ? "supabase-storage" : "local-files",
    supabaseConfigured,
    supabaseConfigIssue
  });
});

app.get("/api/profile", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    const profile = await loadProfileData(email);
    if (!profile) {
      res.json(emptyProfile(email));
      return;
    }
    res.json({ ...emptyProfile(email), ...profile, email });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "طلب غير صحيح" });
  }
});

app.put("/api/profile", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const profile = { ...emptyProfile(email), ...req.body.profile, email };
    res.json(await saveProfileData(email, profile));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر حفظ الملف الشخصي" });
  }
});

app.post("/api/import-pdf", upload.single("pdf"), async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!req.file) {
      res.status(400).json({ error: "لم يتم رفع ملف PDF" });
      return;
    }
    const profileKey = email.replace(/[^a-z0-9_-]/gi, "_");
    const profileAssetDir = path.join(assetDir, profileKey);
    await fsp.mkdir(profileAssetDir, { recursive: true });
    const imported = await runPythonImport(req.file.path, profileAssetDir);
    const templateAssets: TemplateAssets = {};
    if (imported.templateAssets.backgroundUrl) {
      const filename = path.basename(imported.templateAssets.backgroundUrl);
      templateAssets.backgroundUrl = await saveTemplateAsset(profileKey, filename, path.join(profileAssetDir, filename));
    }
    if (imported.templateAssets.signatureUrl) {
      const filename = path.basename(imported.templateAssets.signatureUrl);
      templateAssets.signatureUrl = await saveTemplateAsset(profileKey, filename, path.join(profileAssetDir, filename));
    }
    const smartTemplateDraft = {
      ...createDefaultSmartTemplate(templateAssets, "قالب PDF مستورد"),
      id: `smart-template-${randomUUID()}`,
      assets: templateAssets
    };
    res.json({
      teachers: imported.teachers,
      templateAssets,
      schoolSettings: imported.schoolSettings,
      smartTemplateDraft
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "تعذر استيراد ملف PDF" });
  } finally {
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => undefined);
    }
  }
});

app.post("/api/reports/generate", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const teachers = Array.isArray(req.body.teachers) ? req.body.teachers : [];
    if (!teachers.length) {
      res.status(400).json({ error: "لا توجد أسماء معلمات" });
      return;
    }
    const input: {
      email: string;
      courseTitle: string;
      level: ImpactLevel;
      teachers: Teacher[];
      profile: Profile;
    } = {
      email,
      courseTitle: String(req.body.courseTitle || "الدروس التطبيقية"),
      level: (impactLevels.includes(req.body.level) ? req.body.level : "high") as ImpactLevel,
      teachers: teachers.map((teacher: Teacher, index: number) => ({
        id: teacher.id || `teacher-${index + 1}`,
        name: String(teacher.name || "").trim()
      })),
      profile: { ...emptyProfile(email), ...req.body.profile, email }
    };
    if (input.teachers.some((teacher: Teacher) => !teacher.name)) {
      res.status(400).json({ error: "يوجد اسم معلمة فارغ" });
      return;
    }
    try {
      const report = await generateWithDeepSeek(input);
      res.json({ report, source: "deepseek" });
    } catch (error) {
      const report = localGeneratedReport(input);
      res.json({
        report,
        source: "local-fallback",
        warning: `تعذر استخدام DeepSeek، وتم توليد نسخة محلية: ${
          error instanceof Error ? error.message : "خطأ غير معروف"
        }`
      });
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر توليد التقرير" });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    res.json(await listReportData(email));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر تحميل التقارير" });
  }
});

app.post("/api/reports", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    res.json(await upsertReportData(email, req.body.report as Report));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر حفظ التقرير" });
  }
});

app.put("/api/reports/:id", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    res.json(await upsertReportData(email, { ...(req.body.report as Report), id: req.params.id }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر حفظ التقرير" });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Impact report server listening on http://localhost:${port}`);
  });
}

export default app;
