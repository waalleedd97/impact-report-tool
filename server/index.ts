import cors from "cors";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
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
type DetailColumnId = "number" | "name" | "lessons" | "contribution" | "effectiveness" | "benefits" | "skills";

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
  visibleDetailColumnIds: DetailColumnId[];
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
  reportTitle?: string;
  level: ImpactLevel;
  createdAt: string;
  updatedAt: string;
  schoolSettings: SchoolSettings;
  templateAssets: TemplateAssets;
  smartTemplate?: SmartTemplate;
  printSettings: PrintSettings;
  benefitColumns: BenefitColumn[];
  visibleColumnIds: string[];
  visibleDetailColumnIds: DetailColumnId[];
  rows: ReportRow[];
  summary: {
    totalTeachers: number;
    participantsCount: number;
    attendancePercentage: number;
    implementedLessons: number;
    implementedLessonsLabel?: string;
    impactSummary: string;
    contributionLabel?: string;
    effectivenessLabel?: string;
    benefitsHeaderLabel?: string;
    detailLessonsCountLabel?: string;
    acquiredSkillsLabel?: string;
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

type GenerationOptions = {
  strengthCount?: number;
  improvementCount?: number;
  benefitColumnCount?: number;
  notes?: string;
  reportTitle?: string;
};

type SubscriptionRecord = {
  code: string;
  durationDays: number;
  accountId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  expiresAt?: string;
  renewedFromCode?: string;
  renewedToCode?: string;
};

type SubscriptionSession = {
  code: string;
  accountId: string;
  expiresAt: string;
  daysRemaining: number;
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

  CREATE TABLE IF NOT EXISTS subscriptions (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
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

function subscriptionStoragePath(code: string) {
  return `subscriptions/${safeStorageKey(code)}.json`;
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

async function deleteReportFromSupabaseStorage(email: string, reportId: string) {
  if (!supabase) return { id: reportId };
  await ensureSupabaseDataBucket();
  const { error } = await supabase.storage.from(supabaseDataBucket).remove([reportStoragePath(email, reportId)]);
  if (error && !isStorageNotFound(error)) {
    throw new Error(error.message);
  }
  return { id: reportId };
}

async function loadSubscriptionData(code: string) {
  if (supabase) {
    return downloadSupabaseJson<SubscriptionRecord>(subscriptionStoragePath(code));
  }

  const row = db.prepare("SELECT data FROM subscriptions WHERE code = ?").get(code) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as SubscriptionRecord) : undefined;
}

async function saveSubscriptionData(subscription: SubscriptionRecord) {
  const next = { ...subscription, updatedAt: nowIso() };
  if (supabase) {
    await uploadSupabaseJson(subscriptionStoragePath(next.code), next);
    return next;
  }

  db.prepare(
    `INSERT INTO subscriptions (code, data, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(next.code, JSON.stringify(next), next.updatedAt);
  return next;
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
    title: report.reportTitle || report.courseTitle,
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

async function deleteReportData(email: string, reportId: string) {
  const safeReportId = String(reportId || "").trim();
  if (!safeReportId) {
    throw new Error("معرّف التقرير غير صحيح");
  }

  if (supabase) {
    if (supabaseDataMode === "storage-json") {
      return deleteReportFromSupabaseStorage(email, safeReportId);
    }
    const { error } = await supabase.from("reports").delete().eq("email", email).eq("id", safeReportId);
    if (error) {
      if (isMissingSupabaseTable(error)) {
        supabaseDataMode = "storage-json";
        return deleteReportFromSupabaseStorage(email, safeReportId);
      }
      throw new Error(error.message);
    }
    return { id: safeReportId };
  }

  db.prepare("DELETE FROM reports WHERE email = ? AND id = ?").run(email, safeReportId);
  return { id: safeReportId };
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

const defaultDetailColumnIds: DetailColumnId[] = [
  "number",
  "name",
  "lessons",
  "contribution",
  "effectiveness",
  "benefits",
  "skills"
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
    visibleDetailColumnIds: defaultDetailColumnIds,
    templateAssets: {},
    smartTemplates: [createDefaultSmartTemplate()],
    activeSmartTemplateId: "impact-report-smart-template",
    printSettings: defaultPrintSettings
  };
}

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 180 || !/^[a-z0-9@._:-]+$/i.test(email)) {
    throw new Error("معرّف الحساب غير صحيح");
  }
  return email;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSubscriptionCode(value: unknown) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{8,40}$/.test(code)) {
    throw new Error("رقم الاشتراك غير صحيح");
  }
  return code;
}

function addDaysIso(baseIso: string, days: number) {
  const date = new Date(baseIso);
  date.setUTCDate(date.getUTCDate() + Math.max(1, Math.round(days)));
  return date.toISOString();
}

function isExpired(expiresAt?: string) {
  return Boolean(expiresAt && Date.now() > Date.parse(expiresAt));
}

function daysRemaining(expiresAt: string) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000));
}

function publicSubscriptionSession(subscription: SubscriptionRecord): SubscriptionSession {
  if (!subscription.accountId || !subscription.expiresAt) {
    throw new Error("اشتراك غير مفعل");
  }
  return {
    code: subscription.code,
    accountId: subscription.accountId,
    expiresAt: subscription.expiresAt,
    daysRemaining: daysRemaining(subscription.expiresAt)
  };
}

function createReadableSubscriptionCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let raw = "";
  for (const byte of bytes) {
    raw += alphabet[byte % alphabet.length];
  }
  return `SMART-${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}

async function createSubscriptionRecord(input: { days: number; note?: string; accountId?: string }) {
  const durationDays = Math.max(1, Math.min(730, Math.round(input.days || 30)));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createReadableSubscriptionCode();
    const existing = await loadSubscriptionData(code);
    if (existing) continue;
    const createdAt = nowIso();
    return saveSubscriptionData({
      code,
      durationDays,
      accountId: input.accountId ? normalizeEmail(input.accountId) : undefined,
      note: input.note?.trim().slice(0, 240) || undefined,
      createdAt,
      updatedAt: createdAt
    });
  }
  throw new Error("تعذر إنشاء رقم اشتراك فريد");
}

async function activateOrLoadSubscription(code: string) {
  const subscription = await loadSubscriptionData(code);
  if (!subscription) {
    throw new Error("رقم الاشتراك غير موجود");
  }
  if (subscription.expiresAt && isExpired(subscription.expiresAt)) {
    const error = new Error("انتهى الاشتراك. أدخل رقم اشتراك جديد للربط بنفس البيانات.") as Error & {
      expired?: boolean;
      subscription?: SubscriptionRecord;
    };
    error.expired = true;
    error.subscription = subscription;
    throw error;
  }
  if (subscription.activatedAt && subscription.accountId && subscription.expiresAt) {
    return subscription;
  }

  const activatedAt = nowIso();
  return saveSubscriptionData({
    ...subscription,
    accountId: subscription.accountId || `account-${randomUUID()}`,
    activatedAt,
    expiresAt: addDaysIso(activatedAt, subscription.durationDays)
  });
}

async function renewSubscriptionRecord(expiredCodeInput: unknown, newCodeInput: unknown) {
  const expiredCode = normalizeSubscriptionCode(expiredCodeInput);
  const newCode = normalizeSubscriptionCode(newCodeInput);
  if (expiredCode === newCode) {
    throw new Error("رقم الاشتراك الجديد يجب أن يكون مختلفاً");
  }

  const oldSubscription = await loadSubscriptionData(expiredCode);
  if (!oldSubscription?.accountId) {
    throw new Error("رقم الاشتراك السابق غير مرتبط ببيانات محفوظة");
  }
  const newSubscription = await loadSubscriptionData(newCode);
  if (!newSubscription) {
    throw new Error("رقم الاشتراك الجديد غير موجود");
  }
  if (newSubscription.activatedAt || newSubscription.accountId) {
    throw new Error("رقم الاشتراك الجديد مستخدم من قبل");
  }

  const activatedAt = nowIso();
  const savedNewSubscription = await saveSubscriptionData({
    ...newSubscription,
    accountId: oldSubscription.accountId,
    activatedAt,
    expiresAt: addDaysIso(activatedAt, newSubscription.durationDays),
    renewedFromCode: oldSubscription.code
  });
  await saveSubscriptionData({
    ...oldSubscription,
    renewedToCode: savedNewSubscription.code
  });
  return savedNewSubscription;
}

type HeaderCarrier = {
  get?: (name: string) => string | string[] | undefined;
};

async function requireSubscriptionAccess(req: HeaderCarrier, accountId: string) {
  const headerValue = req.get?.("x-subscription-code");
  const code = normalizeSubscriptionCode(Array.isArray(headerValue) ? headerValue[0] : headerValue);
  const subscription = await activateOrLoadSubscription(code);
  if (subscription.accountId !== accountId) {
    throw new Error("رقم الاشتراك لا يطابق هذا الحساب");
  }
  return subscription;
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

const impactDegreeByLevel: Record<ImpactLevel, string> = {
  very_high: "مرتفعة جداً",
  high: "عالية",
  medium: "متوسطة",
  low: "منخفضة",
  very_low: "منخفضة جداً"
};

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

function sanitizeGenerationOptions(value: unknown): GenerationOptions {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const strengthCount = clampNumber(source.strengthCount, 1, 12);
  const improvementCount = clampNumber(source.improvementCount, 1, 10);
  const benefitColumnCount = clampNumber(source.benefitColumnCount, 1, 12);
  const notes = String(source.notes || "").trim().slice(0, 900);
  const reportTitle = String(source.reportTitle || "").trim().slice(0, 140);
  return {
    ...(strengthCount ? { strengthCount } : {}),
    ...(improvementCount ? { improvementCount } : {}),
    ...(benefitColumnCount ? { benefitColumnCount } : {}),
    ...(notes ? { notes } : {}),
    ...(reportTitle ? { reportTitle } : {})
  };
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

function normalizeContributionOverrides(
  level: ImpactLevel,
  defaults: { high: number; medium: number; low: number },
  aiOverrides?: Record<string, unknown>
) {
  const high = clampNumber(aiOverrides?.contributionHigh, 0, 100);
  const medium = clampNumber(aiOverrides?.contributionMedium, 0, 100);
  const low = clampNumber(aiOverrides?.contributionLow, 0, 100);
  if (high === undefined || medium === undefined || low === undefined) {
    return defaults;
  }

  const total = high + medium + low;
  if (!total) {
    return defaults;
  }

  const normalizedHigh = Math.round((high / total) * 100);
  const normalizedMedium = Math.round((medium / total) * 100);
  const normalizedLow = Math.max(0, 100 - normalizedHigh - normalizedMedium);
  const candidate = { high: normalizedHigh, medium: normalizedMedium, low: normalizedLow };

  const dominantKey: Record<ImpactLevel, keyof typeof candidate> = {
    very_high: "high",
    high: "high",
    medium: "medium",
    low: "low",
    very_low: "low"
  };
  const dominant = dominantKey[level];
  const dominantMinimum: Record<ImpactLevel, number> = {
    very_high: 80,
    high: 65,
    medium: 35,
    low: 30,
    very_low: 40
  };

  if (candidate[dominant] < dominantMinimum[level]) {
    return defaults;
  }
  return candidate;
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

  const contributionOverrides = normalizeContributionOverrides(level, contribution, aiOverrides);
  const next: Record<string, number> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const aiValue = clampNumber(aiOverrides?.[key], key.startsWith("contribution") ? 0 : min, key.startsWith("contribution") ? 100 : max);
    next[key] = aiValue ?? fallback;
  }
  next.contributionHigh = contributionOverrides.high;
  next.contributionMedium = contributionOverrides.medium;
  next.contributionLow = contributionOverrides.low;
  return next;
}

function summaryNumberOverridesFromAi(
  payload: any,
  input: {
    teachers: Teacher[];
    profile: Profile;
  },
  rows: ReportRow[]
) {
  const source = payload?.summaryNumberOverrides;
  if (!source || typeof source !== "object") return {};

  const participantsCount = clampNumber(source.participantsCount, 0, 999);
  const totalTeachers = clampNumber(source.totalTeachers, input.teachers.length, 999);
  const implementedLessons = clampNumber(source.implementedLessons, 0, 999);
  const overrides: Record<string, number> = {};
  if (totalTeachers !== undefined) {
    overrides.totalTeachers = Math.max(totalTeachers, participantsCount ?? input.teachers.length);
  }
  if (participantsCount !== undefined) {
    overrides.participantsCount = participantsCount;
  }
  if (implementedLessons !== undefined) {
    overrides.implementedLessons = implementedLessons;
  } else if (payload?.summaryNumberOverrides === true) {
    overrides.implementedLessons = rows.reduce((sum, row) => sum + row.lessonsCount, 0);
  }
  return overrides;
}

function sanitizeTextList(items: unknown[], fallback: string[], maxLength: number) {
  const seen = new Set<string>();
  const cleaned = items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  if (cleaned.length) {
    return cleaned.slice(0, maxLength);
  }
  return fallback.slice(0, Math.min(fallback.length, maxLength));
}

function fitTextListToRequestedCount(items: string[], fallback: string[], requestedCount?: number) {
  if (!requestedCount) return items;
  const next = [...items];
  const seen = new Set(next);
  for (const item of fallback) {
    if (next.length >= requestedCount) break;
    if (!seen.has(item)) {
      next.push(item);
      seen.add(item);
    }
  }
  return next.slice(0, requestedCount);
}

function sanitizeSummaryText(value: unknown, fallback: string, maxLength = 180) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, maxLength);
}

function sanitizeContextLabel(value: unknown, fallback: string, activityTitle: string, maxLength = 180) {
  const text = sanitizeSummaryText(value, fallback, maxLength);
  if (!isAppliedLessonsActivity(activityTitle) && text.includes("الدروس التطبيقية")) {
    return fallback;
  }
  if (/فعالية\s+مدى\s+فعالية/.test(text)) {
    return text.replace(/فعالية\s+مدى\s+فعالية/g, "مدى فعالية").slice(0, maxLength);
  }
  return text;
}

function sanitizeBenefitLabel(value: unknown, fallback: string) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 42);
}

const genericBenefitLabels = new Set(defaultBenefitColumns.map((column) => column.label));

function conciseActivityTitle(title: string) {
  return title
    .replace(/^ورشة\s+عمل\s+/u, "")
    .replace(/^برنامج\s+/u, "")
    .replace(/^دورة\s+/u, "")
    .trim();
}

function benefitColumnLabelForActivity(column: BenefitColumn, activityTitle: string) {
  if (isAppliedLessonsActivity(activityTitle)) {
    return column.label;
  }
  const conciseTitle = conciseActivityTitle(activityTitle);
  const labels: Record<string, string> = {
    subject: `فهم محاور ${conciseTitle}`,
    teaching: `تطبيق ${conciseTitle}`,
    confidence: "وضوح متطلبات الأداء",
    teamwork: "تبادل الخبرات المهنية",
    classroom: "تحسين الممارسات المهنية",
    technology: "توثيق الشواهد والأدلة",
    motivation: "التغذية الراجعة والمتابعة"
  };
  return labels[column.id] || column.label;
}

function isGenericBenefitLabel(label: string) {
  return (
    genericBenefitLabels.has(label) ||
    /المادة الدراسية|المهارات التدريسية|الإدارة الصفية|الدروس التطبيقية/.test(label)
  );
}

function benefitColumnsFromAi(columns: BenefitColumn[], payload: any, activityTitle: string) {
  const source = payload?.benefitColumnLabels || payload?.benefitColumns;
  return columns.map((column, index) => {
    let value: unknown;
    if (Array.isArray(source)) {
      const found = source.find((item) => item && typeof item === "object" && item.id === column.id);
      const indexed = source[index];
      value = found?.label ?? (indexed && typeof indexed === "object" ? indexed.label : indexed);
    } else if (source && typeof source === "object") {
      value = source[column.id];
    }
    const fallback = benefitColumnLabelForActivity(column, activityTitle);
    const label = sanitizeBenefitLabel(value, fallback);
    return {
      ...column,
      label: !isAppliedLessonsActivity(activityTitle) && isGenericBenefitLabel(label) ? fallback.slice(0, 42) : label
    };
  });
}

function visibleColumnIdsForReport(input: {
  columns: BenefitColumn[];
  currentVisibleColumnIds: string[];
  payload: any;
  requestedCount?: number;
}) {
  const validIds = new Set(input.columns.map((column) => column.id));
  const fallbackIds = input.currentVisibleColumnIds.filter((id) => validIds.has(id));
  const defaultIds = fallbackIds.length ? fallbackIds : input.columns.map((column) => column.id);

  if (!input.requestedCount) {
    return defaultIds;
  }

  const count = Math.max(1, Math.min(input.columns.length, input.requestedCount));
  const aiIds = Array.isArray(input.payload?.visibleColumnIds) ? input.payload.visibleColumnIds : [];
  const selectedIds: string[] = [];
  for (const id of aiIds) {
    const value = String(id || "");
    if (validIds.has(value) && !selectedIds.includes(value)) {
      selectedIds.push(value);
    }
  }
  for (const column of input.columns) {
    if (selectedIds.length >= count) break;
    if (!selectedIds.includes(column.id)) {
      selectedIds.push(column.id);
    }
  }
  return selectedIds.slice(0, count);
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
  labelActivityTitle?: string;
  benefitColumns: BenefitColumn[];
  visibleColumnIds: string[];
  visibleDetailColumnIds: DetailColumnId[];
  rows: ReportRow[];
  strengths: string[];
  improvements: string[];
}): Report {
  const createdAt = nowIso();
  const rows = input.rows;
  const participantsCount = rows.length;
  const labelActivityTitle = input.labelActivityTitle || activityTitle(input.courseTitle);
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
    reportTitle: defaultReportTitle(input.courseTitle),
    level: input.level,
    createdAt,
    updatedAt: createdAt,
    schoolSettings: input.schoolSettings,
    templateAssets: input.templateAssets,
    smartTemplate: input.smartTemplate,
    printSettings: { ...defaultPrintSettings, ...input.printSettings },
    benefitColumns: input.benefitColumns,
    visibleColumnIds: input.visibleColumnIds,
    visibleDetailColumnIds: input.visibleDetailColumnIds,
    rows,
    summary: {
      totalTeachers,
      participantsCount,
      attendancePercentage: percentage(participantsCount, totalTeachers),
      implementedLessons,
      implementedLessonsLabel: implementedLessonsLabelForCourse(labelActivityTitle),
      impactSummary: impactSummaryForCourse(labelActivityTitle, input.level),
      contributionLabel: contributionLabelForCourse(labelActivityTitle),
      effectivenessLabel: effectivenessLabelForCourse(labelActivityTitle),
      benefitsHeaderLabel: benefitsHeaderLabelForCourse(labelActivityTitle),
      detailLessonsCountLabel: detailLessonsCountLabelForCourse(labelActivityTitle),
      acquiredSkillsLabel: acquiredSkillsLabelForCourse(labelActivityTitle),
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
    visibleDetailColumnIds: input.profile.visibleDetailColumnIds,
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
      "التنوع في أساليب التحفيز والتعزيز للطلبة",
      "تحسين جودة الأداء المهني من خلال تبادل الخبرات"
    ],
    improvements: [
      "تطبيق الدروس التطبيقية في العام القادم بشكل أكبر للاستفادة والوقوف على بعض الفجوات ومعالجتها",
      "عمل دروس لتخصصات أخرى",
      "تطبيقها في أوقات متباعدة بعد قياس الأثر لما سبقها",
      "زيادة توظيف الوسائل التعليمية والتقنية الحديثة",
      "إتاحة وقت أطول للتطبيق العملي لجميع المتعلمين",
      "تعزيز دور المتعلم وجعله محور العملية التعليمية",
      "تطبيق أساليب تدريس تركز على رفع نواتج التعلم",
      "زيادة الوقت للتطبيق العملي وتنويع الأساليب بما يناسب مستويات الطلاب",
      "توسيع فرص التغذية الراجعة بعد التطبيق",
      "تنويع أدوات قياس الأثر بعد انتهاء النشاط"
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

function weightedChoice<T>(choices: Array<{ value: T; weight: number }>) {
  const total = choices.reduce((sum, choice) => sum + Math.max(0, choice.weight), 0);
  if (!total) return choices[0]?.value;
  let ticket = Math.random() * total;
  for (const choice of choices) {
    ticket -= Math.max(0, choice.weight);
    if (ticket <= 0) return choice.value;
  }
  return choices[choices.length - 1]?.value;
}

function shuffled<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function notesRequestFullRating(notes?: string) {
  const normalized = String(notes || "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي");
  const asksForAll = /(كلهم|جميعهم|الجميع|كافة|كل المعلمات|كل المدرسات)/.test(normalized);
  const asksForFull = /(التقييم الكامل|تقييم كامل|الدرجة الكاملة|كامل|اعلي تقييم|اعلى تقييم|تقييم مرتفع|تقييم عالي)/.test(
    normalized
  );
  return asksForAll && asksForFull;
}

function contributionForLevel(level: ImpactLevel) {
  const highChance: Record<ImpactLevel, number> = {
    very_high: 94,
    high: 82,
    medium: 54,
    low: 26,
    very_low: 12
  };
  return Math.random() * 100 < highChance[level] ? "تساهم بدرجة عالية" : "تساهم بدرجة متوسطة";
}

function effectivenessForLevel(level: ImpactLevel) {
  const choices: Record<ImpactLevel, Array<{ value: string; weight: number }>> = {
    very_high: [
      { value: "فاعلة بدرجة عالية", weight: 94 },
      { value: "فاعلة بدرجة متوسطة", weight: 6 }
    ],
    high: [
      { value: "فاعلة بدرجة عالية", weight: 82 },
      { value: "فاعلة بدرجة متوسطة", weight: 16 },
      { value: "فاعلة بدرجة منخفضة", weight: 2 }
    ],
    medium: [
      { value: "فاعلة بدرجة عالية", weight: 44 },
      { value: "فاعلة بدرجة متوسطة", weight: 44 },
      { value: "فاعلة بدرجة منخفضة", weight: 12 }
    ],
    low: [
      { value: "فاعلة بدرجة عالية", weight: 15 },
      { value: "فاعلة بدرجة متوسطة", weight: 44 },
      { value: "فاعلة بدرجة منخفضة", weight: 41 }
    ],
    very_low: [
      { value: "فاعلة بدرجة عالية", weight: 5 },
      { value: "فاعلة بدرجة متوسطة", weight: 23 },
      { value: "فاعلة بدرجة منخفضة", weight: 72 }
    ]
  };
  return weightedChoice(choices[level]) || "فاعلة بدرجة متوسطة";
}

function lessonsCountForLevel(level: ImpactLevel) {
  const choices: Record<ImpactLevel, Array<{ value: number; weight: number }>> = {
    very_high: [
      { value: 2, weight: 18 },
      { value: 3, weight: 30 },
      { value: 4, weight: 32 },
      { value: 5, weight: 20 }
    ],
    high: [
      { value: 1, weight: 22 },
      { value: 2, weight: 31 },
      { value: 3, weight: 28 },
      { value: 4, weight: 14 },
      { value: 5, weight: 5 }
    ],
    medium: [
      { value: 1, weight: 32 },
      { value: 2, weight: 43 },
      { value: 3, weight: 25 }
    ],
    low: [
      { value: 1, weight: 62 },
      { value: 2, weight: 29 },
      { value: 3, weight: 9 }
    ],
    very_low: [
      { value: 1, weight: 83 },
      { value: 2, weight: 17 }
    ]
  };
  return weightedChoice(choices[level]) || 1;
}

function benefitCountForLevel(level: ImpactLevel, totalColumns: number) {
  if (!totalColumns) return 0;
  const choices: Record<ImpactLevel, Array<{ value: number; weight: number }>> = {
    very_high: [
      { value: 5, weight: 18 },
      { value: 6, weight: 34 },
      { value: 7, weight: 48 }
    ],
    high: [
      { value: 4, weight: 26 },
      { value: 5, weight: 38 },
      { value: 6, weight: 27 },
      { value: 7, weight: 9 }
    ],
    medium: [
      { value: 2, weight: 24 },
      { value: 3, weight: 42 },
      { value: 4, weight: 27 },
      { value: 5, weight: 7 }
    ],
    low: [
      { value: 1, weight: 47 },
      { value: 2, weight: 36 },
      { value: 3, weight: 17 }
    ],
    very_low: [
      { value: 0, weight: 34 },
      { value: 1, weight: 46 },
      { value: 2, weight: 20 }
    ]
  };
  return Math.min(totalColumns, weightedChoice(choices[level]) || 0);
}

function randomizedBenefits(level: ImpactLevel, columns: BenefitColumn[]) {
  const count = benefitCountForLevel(level, columns.length);
  const selected = new Set(shuffled(columns.map((column) => column.id)).slice(0, count));
  const benefits: Record<string, boolean> = {};
  for (const column of columns) {
    benefits[column.id] = selected.has(column.id);
  }
  return benefits;
}

function applyRealisticRowDistribution(
  rows: ReportRow[],
  input: {
    level: ImpactLevel;
    profile: Profile;
    generationOptions?: GenerationOptions;
  }
) {
  if (notesRequestFullRating(input.generationOptions?.notes)) {
    return rows.map((row) => ({
      ...row,
      lessonsCount: Math.max(1, Math.min(999, Number(row.lessonsCount) || lessonsCountForLevel(input.level))),
      contribution: "تساهم بدرجة عالية",
      effectiveness: "فاعلة بدرجة عالية",
      benefits: Object.fromEntries(input.profile.benefitColumns.map((column) => [column.id, true]))
    }));
  }

  return rows.map((row) => ({
    ...row,
    lessonsCount: lessonsCountForLevel(input.level),
    contribution: contributionForLevel(input.level),
    effectiveness: effectivenessForLevel(input.level),
    benefits: randomizedBenefits(input.level, input.profile.benefitColumns)
  }));
}

function sanitizeAiReport(payload: any, input: {
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  teachers: Teacher[];
  profile: Profile;
  generationOptions?: GenerationOptions;
}) {
  const fallback = localGeneratedReport(input);
  const requestedReportTitle = input.generationOptions?.reportTitle || payload?.reportTitle;
  const labelActivityTitle = activityTitle(input.courseTitle, requestedReportTitle);
  const aiRows = Array.isArray(payload?.rows) ? payload.rows : [];
  const rows = input.teachers.map((teacher, index) => {
    const aiRow = aiRows[index] || {};
    const aiBenefits = aiRow?.benefits && typeof aiRow.benefits === "object" ? aiRow.benefits : null;
    const benefits: Record<string, boolean> = {};
    for (const column of input.profile.benefitColumns) {
      benefits[column.id] = aiBenefits ? Boolean(aiBenefits[column.id]) : Boolean(fallback.rows[index]?.benefits?.[column.id]);
    }
    if (!aiBenefits && !Object.values(benefits).some(Boolean)) {
      Object.assign(benefits, fallback.rows[index]?.benefits || {});
    }
    const acquiredSkills =
      String(aiRow.acquiredSkills || "").trim() || String(fallback.rows[index]?.acquiredSkills || "").trim();
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      lessonsCount: Math.max(1, Math.min(999, Number(aiRow.lessonsCount) || fallback.rows[index]?.lessonsCount || 1)),
      contribution: allowedContribution(aiRow.contribution),
      effectiveness: allowedEffectiveness(aiRow.effectiveness),
      benefits,
      acquiredSkills: acquiredSkills.slice(0, 220)
    };
  });
  const distributedRows = applyRealisticRowDistribution(rows, input);
  const strengths = fitTextListToRequestedCount(
    sanitizeTextList(Array.isArray(payload?.strengths) ? payload.strengths : [], fallback.strengths, 16),
    fallback.strengths,
    input.generationOptions?.strengthCount
  );
  const improvements = fitTextListToRequestedCount(
    sanitizeTextList(Array.isArray(payload?.improvements) ? payload.improvements : [], fallback.improvements, 12),
    fallback.improvements,
    input.generationOptions?.improvementCount
  );

  const generatedBenefitColumns = benefitColumnsFromAi(input.profile.benefitColumns, payload, labelActivityTitle);
  const visibleColumnIds = visibleColumnIdsForReport({
    columns: generatedBenefitColumns,
    currentVisibleColumnIds: input.profile.visibleColumnIds,
    payload,
    requestedCount: input.generationOptions?.benefitColumnCount
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
    labelActivityTitle,
    benefitColumns: generatedBenefitColumns,
    visibleColumnIds,
    visibleDetailColumnIds: input.profile.visibleDetailColumnIds,
    rows: distributedRows,
    strengths,
    improvements
  });
  const aiSummary = payload?.summary && typeof payload.summary === "object" ? payload.summary : {};
  const aiLabels = payload?.summaryLabels && typeof payload.summaryLabels === "object" ? payload.summaryLabels : {};
  return {
    ...report,
    reportTitle: sanitizeSummaryText(
      requestedReportTitle,
      report.reportTitle || defaultReportTitle(input.courseTitle),
      140
    ),
    summary: {
      ...report.summary,
      implementedLessonsLabel: sanitizeContextLabel(
        aiLabels.implementedLessonsLabel || aiSummary.implementedLessonsLabel || payload?.implementedLessonsLabel,
        report.summary.implementedLessonsLabel || implementedLessonsLabelForCourse(labelActivityTitle),
        labelActivityTitle
      ),
      impactSummary: sanitizeContextLabel(
        payload?.impactSummary || aiSummary.impactSummary,
        report.summary.impactSummary,
        labelActivityTitle
      ),
      contributionLabel: sanitizeContextLabel(
        aiLabels.contributionLabel || aiSummary.contributionLabel || payload?.contributionLabel,
        report.summary.contributionLabel || contributionLabelForCourse(labelActivityTitle),
        labelActivityTitle
      ),
      effectivenessLabel: sanitizeContextLabel(
        aiLabels.effectivenessLabel || aiSummary.effectivenessLabel || payload?.effectivenessLabel,
        report.summary.effectivenessLabel || effectivenessLabelForCourse(labelActivityTitle),
        labelActivityTitle
      ),
      benefitsHeaderLabel: sanitizeContextLabel(
        aiLabels.benefitsHeaderLabel || aiSummary.benefitsHeaderLabel || payload?.benefitsHeaderLabel,
        report.summary.benefitsHeaderLabel || benefitsHeaderLabelForCourse(labelActivityTitle),
        labelActivityTitle
      ),
      detailLessonsCountLabel: sanitizeContextLabel(
        aiLabels.detailLessonsCountLabel || aiSummary.detailLessonsCountLabel || payload?.detailLessonsCountLabel,
        report.summary.detailLessonsCountLabel || detailLessonsCountLabelForCourse(labelActivityTitle),
        labelActivityTitle
      ),
      acquiredSkillsLabel: sanitizeContextLabel(
        aiLabels.acquiredSkillsLabel || aiSummary.acquiredSkillsLabel || payload?.acquiredSkillsLabel,
        report.summary.acquiredSkillsLabel || acquiredSkillsLabelForCourse(labelActivityTitle),
        labelActivityTitle
      )
    },
    percentageOverrides: percentageOverridesForLevel(input.level, report.benefitColumns, payload?.percentageOverrides),
    summaryNumberOverrides: summaryNumberOverridesFromAi(payload, input, distributedRows)
  };
}

async function generateWithDeepSeek(input: {
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  teachers: Teacher[];
  profile: Profile;
  generationOptions?: GenerationOptions;
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("لم يتم ضبط مفتاح الذكاء الاصطناعي على الخادم");
  }

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const system = `
أنت وكيل لإعداد تقرير قياس أثر بعدي لنشاط تطوير مهني باللغة العربية.
أخرج JSON صالح فقط. لا تضف شرحاً خارج JSON.
أنت المسؤول عن تعبئة التقرير كاملاً بعد أن يكتب المستخدم عنوان النشاط ويختار مستوى النسبة.
لا تغيّر أسماء المعلمات ولا تضف أسماء ولا تحذف صفوفاً. يجب أن يكون عدد rows مساوياً تماماً لعدد teacherRows وبنفس الترتيب.
اجعل المحتوى مناسباً لبيئة تعليم ابتدائي وبعبارات رسمية مختصرة.
المستخدمون المستهدفون في المملكة العربية السعودية هم: مديرو ومديرات المدارس، الموجهون والموجهات الطلابيات، والمعلمون والمعلمات.
استخدم لغة مهنية مناسبة للتقارير المدرسية السعودية، ومفردات مألوفة في بيئة وزارة التعليم مثل: نواتج التعلم، الممارسات التدريسية، البيئة الصفية، التحصيل، التقويم، الدعم، المتابعة، الإرشاد الطلابي.
راعِ أن التقرير قد يقرأه قيادي مدرسي أو مشرف/موجه أو معلم، لذلك اجعل العبارات دقيقة، قابلة للنسخ في تقرير رسمي، ولا تذكر أنك نموذج ذكاء اصطناعي.
اجعل نقاط القوة تعكس الأثر الإيجابي للنشاط على الممارسات أو الدعم المدرسي، واجعل فرص التحسين عملية وقابلة للتنفيذ داخل المدرسة.
املأ جدول تقييم المعلمات لكل معلمة: عدد الدروس، مساهمة النشاط، فعالية الأساليب، علامات مجالات الاستفادة، والمهارة المكتسبة.
وزّع تقييمات المعلمات بعشوائية واقعية داخل مستوى النسبة المختار. لا تستخدم نمطاً دورياً واضحاً مثل صف فردي/زوجي، ولا تكرر نفس توزيع علامات الصح أو نفس تسلسل الفعالية على الصفوف.
في النسبة المنخفضة جداً اجعل علامات مجالات الاستفادة قليلة ومتفاوتة بين المعلمات، واجعل الفعالية غالباً منخفضة أو متوسطة، بدون ترتيب متكرر يمكن ملاحظته.
حقل contribution يقبل قيمتين فقط: "تساهم بدرجة عالية" أو "تساهم بدرجة متوسطة". لا تستخدم أي صيغة أخرى.
حقل effectiveness يقبل: "فاعلة بدرجة عالية" أو "فاعلة بدرجة متوسطة" أو "فاعلة بدرجة منخفضة".
اكتب عدداً مناسباً من strengths و improvements حسب عنوان النشاط ومستوى النسبة؛ ليس مطلوباً عدداً ثابتاً.
يمكن أن تكون نقاط القوة وفرص التحسين أقل أو أكثر حسب الحاجة، لكن اجعل كل عبارة قصيرة ومناسبة لخلية جدول.
إذا أرسل المستخدم strengthCount فاكتب strengths بذلك العدد بالضبط.
إذا أرسل المستخدم improvementCount فاكتب improvements بذلك العدد بالضبط.
إذا أرسل المستخدم benefitColumnCount فاختر visibleColumnIds بذلك العدد بالضبط من معرفات benefitColumns، واكتب benefitColumnLabels مناسبة لهذه المجالات المختارة حسب effectiveActivityTitle.
إذا أرسل المستخدم notes فاعتبرها ملاحظات عالية الأولوية لطريقة تعبئة التقرير والجدول، والتزم بها ما لم تخالف قواعد القيم أو ثبات أسماء المعلمات.
مثال: إذا كانت الملاحظة تطلب "التقييم الكامل" فاجعل مساهمة وفعالية المعلمات مرتفعة، وضع علامات استفادة أكثر، واجعل النسب عالية بما يناسب مستوى النسبة.
اكتب نقاط القوة وفرص التحسين بناءً على عنوان النشاط مباشرة، ولا تجعلها عامة جداً، ولا تكرر العبارات.
اكتب reportTitle كعنوان التقرير الكامل المطبوع، ويمكن أن يكون مختلفاً عن courseTitle، لكن اجعله مناسباً لعنوان النشاط. إذا أرسل المستخدم generationOptions.reportTitle فاستخدمه كما هو ولا تختصره للنص داخل القوسين.
اعتمد على effectiveActivityTitle كمرجع أساسي لكل عناوين الجداول والخلايا. إذا اختلف courseTitle عن reportTitle فالأولوية لـ effectiveActivityTitle.
اكتب impactSummary بناءً على effectiveActivityTitle مباشرة، ولا تستخدم عبارة "الدروس التطبيقية" إلا إذا كان effectiveActivityTitle يحتوي عليها.
اكتب summaryLabels.implementedLessonsLabel وsummaryLabels.contributionLabel وsummaryLabels.effectivenessLabel وsummaryLabels.benefitsHeaderLabel وsummaryLabels.detailLessonsCountLabel وsummaryLabels.acquiredSkillsLabel بحيث تستبدل اسم النشاط داخل عناوين الخلايا حسب effectiveActivityTitle.
لا تترك أي عنوان في جدول الملخص أو جدول المعلمات بصيغة الدروس التطبيقية عند توليد تقرير لورشة أو دورة أخرى.
لا تكتب "فعالية مدى فعالية"؛ الصيغة الصحيحة هي "مدى فعالية الأساليب المستخدمة في تنفيذ effectiveActivityTitle".
مثال: إذا كان effectiveActivityTitle هو "مجتمعات التعلم المهنية" فاكتب "مدى مساهمة مجتمعات التعلم المهنية في تطوير الأداء المهني".
اكتب benefitColumnLabels كمفاتيح مطابقة تماماً لمعرفات benefitColumns، واجعل كل تسمية قصيرة ومناسبة لـ effectiveActivityTitle. لا تغيّر المعرفات ولا تستخدم تسميات عامة إذا كان العنوان محدداً.
benefitColumnLabels هي المصدر الواحد لنصوص "مجالات الاستفادة": نفس النص الذي تكتبه لكل مفتاح سيظهر في جدول الملخص في الصفحة الأولى وسيظهر في الرؤوس العمودية لجدول المعلمات في الصفحة الثانية. لذلك لا تكتب تسميات مختلفة بين الجدولين.
غيّر benefitColumnLabels في كل توليد جديد حسب موضوع التقرير. لا تترك القيم العامة القديمة مثل "فهم المادة الدراسية" أو "تطوير المهارات التدريسية" أو "الإدارة الصفية" إلا إذا كان الموضوع نفسه عن الدروس التطبيقية أو التدريس الصفي.
إذا كان effectiveActivityTitle عن "بنود الأداء الوظيفي" فاكتب مجالات مثل: فهم بنود الأداء، تطبيق بنود الأداء، توثيق الشواهد، تحسين الممارسات المهنية، التغذية الراجعة، المتابعة، تبادل الخبرات.
إذا كان benefitColumnCount قليلاً مثل 3 أو 4، فاختر أهم المجالات فقط واجعل visibleColumnIds يحتوي هذه المعرفات بالضبط. لا تضف أعمدة إضافية.
اكتب percentageOverrides لكل المفاتيح المطلوبة. النسب تكون عشوائية ومتناسبة مع مستوى النسبة المختار.
اجعل contributionHigh و contributionMedium و contributionLow مجموعها 100.
استخدم مفاتيح benefitColumns كما هي تماماً داخل benefits و percentageOverrides.
summaryNumberOverrides اختياري، وإن كتبته فليكن متسقاً مع عدد المعلمات وعدد الدروس.
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
  "reportTitle": "تقرير قياس أثر بعدي لنشاط تطوير مهني (عنوان النشاط)",
  "strengths": ["نص"],
  "improvements": ["نص"],
  "impactSummary": "تُسهم عنوان النشاط في تحسين وتطوير الممارسات التدريسية بدرجة عالية",
  "summaryLabels": {
    "implementedLessonsLabel": "عدد مرات تنفيذ عنوان النشاط بالمدرسة",
    "contributionLabel": "مدى مساهمة عنوان النشاط في تطوير الأداء المهني",
    "effectivenessLabel": "مدى فعالية الأساليب المستخدمة في تنفيذ عنوان النشاط",
    "benefitsHeaderLabel": "حددي المجالات التي استفدت منها في عنوان النشاط",
    "detailLessonsCountLabel": "عدد مرات حضور عنوان النشاط",
    "acquiredSkillsLabel": "المهارات والقدرات المكتسبة التي نفذتها بعد حضور عنوان النشاط"
  },
  "benefitColumnLabels": {
    "subject": "فهم المفاهيم",
    "teaching": "تطبيق الممارسات"
  },
  "visibleColumnIds": ["subject", "teaching"],
  "percentageOverrides": {
    "attendance": 92,
    "contributionHigh": 92,
    "contributionMedium": 8,
    "contributionLow": 0,
    "effectiveness": 91,
    "benefit:subject": 93
  },
  "summaryNumberOverrides": {
    "totalTeachers": 32,
    "participantsCount": 26,
    "implementedLessons": 52
  }
}`.trim();
  const requestedReportTitle = input.generationOptions?.reportTitle || "";
  const user = {
    courseTitle: input.courseTitle,
    reportTitle: requestedReportTitle,
    effectiveActivityTitle: activityTitle(input.courseTitle, requestedReportTitle),
    level: input.level,
    levelMeaning: levelMeaningByLevel[input.level],
    allowedPercentageRange: percentageRanges[input.level],
    percentageOverrideKeys: [
      "attendance",
      "contributionHigh",
      "contributionMedium",
      "contributionLow",
      "effectiveness",
      ...input.profile.benefitColumns.map((column) => `benefit:${column.id}`)
    ],
    summaryNumberKeys: ["totalTeachers", "participantsCount", "implementedLessons"],
    schoolSettings: input.profile.schoolSettings,
    benefitColumns: input.profile.benefitColumns,
    benefitColumnContract:
      "benefitColumnLabels is shared by the first-page summary benefits row and the second-page vertical benefit headers; one label per id must fit both places.",
    requestedBenefitColumnCount: input.generationOptions?.benefitColumnCount,
    visibleColumnIds: input.profile.visibleColumnIds,
    generationOptions: input.generationOptions || {},
    teacherRows: input.teachers.map((teacher, index) => ({
      index: index + 1,
      teacherId: teacher.id,
      teacherName: teacher.name
    }))
  };

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `json\n${JSON.stringify(user)}` }
    ],
    response_format: { type: "json_object" },
    temperature: 0.9,
    max_tokens: 8000
  };
  if (model.startsWith("deepseek-v4")) {
    body.thinking = { type: "disabled" };
  }

  const timeoutMs = envNumber("DEEPSEEK_TIMEOUT_MS", 55000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("استغرق الذكاء الاصطناعي وقتاً أطول من المتوقع. جرّب التوليد مرة أخرى أو قلّل عدد المعلمات مؤقتاً.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "فشل اتصال الذكاء الاصطناعي");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("استجابة الذكاء الاصطناعي فارغة");
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

app.post("/api/subscriptions/login", async (req, res) => {
  try {
    const code = normalizeSubscriptionCode(req.body.code);
    const subscription = await activateOrLoadSubscription(code);
    const session = publicSubscriptionSession(subscription);
    res.json({
      accountId: session.accountId,
      subscription: session
    });
  } catch (error) {
    const typed = error as Error & { expired?: boolean; subscription?: SubscriptionRecord };
    res.status(typed.expired ? 403 : 400).json({
      error: typed.message || "تعذر تسجيل الدخول",
      expired: Boolean(typed.expired),
      code: typed.subscription?.code,
      expiresAt: typed.subscription?.expiresAt
    });
  }
});

app.post("/api/subscriptions/renew", async (req, res) => {
  try {
    const subscription = await renewSubscriptionRecord(req.body.expiredCode, req.body.newCode);
    const session = publicSubscriptionSession(subscription);
    res.json({
      accountId: session.accountId,
      subscription: session
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر تجديد الاشتراك" });
  }
});

app.post("/api/admin/subscriptions", async (req, res) => {
  try {
    const adminSecret = process.env.SUBSCRIPTION_ADMIN_SECRET;
    if (!adminSecret) {
      res.status(500).json({ error: "لم يتم ضبط سر إنشاء الاشتراكات على الخادم" });
      return;
    }
    if (req.header("x-admin-secret") !== adminSecret) {
      res.status(401).json({ error: "صلاحية غير كافية" });
      return;
    }
    const quantity = Math.max(1, Math.min(50, Math.round(Number(req.body.quantity) || 1)));
    const days = Math.max(1, Math.min(730, Math.round(Number(req.body.days) || 30)));
    const note = String(req.body.note || "").trim();
    const accountId = req.body.accountId ? String(req.body.accountId) : undefined;
    const subscriptions: SubscriptionRecord[] = [];
    for (let index = 0; index < quantity; index += 1) {
      subscriptions.push(await createSubscriptionRecord({ days, note, accountId }));
    }
    res.json({
      subscriptions: subscriptions.map((subscription) => ({
        code: subscription.code,
        durationDays: subscription.durationDays,
        accountId: subscription.accountId,
        createdAt: subscription.createdAt
      }))
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر إنشاء رقم الاشتراك" });
  }
});

app.get("/api/profile", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    await requireSubscriptionAccess(req, email);
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
    await requireSubscriptionAccess(req, email);
    const profile = { ...emptyProfile(email), ...req.body.profile, email };
    res.json(await saveProfileData(email, profile));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر حفظ الملف الشخصي" });
  }
});

app.post("/api/import-pdf", upload.single("pdf"), async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    await requireSubscriptionAccess(req, email);
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
    await requireSubscriptionAccess(req, email);
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
      generationOptions?: GenerationOptions;
    } = {
      email,
      courseTitle: String(req.body.courseTitle || "الدروس التطبيقية"),
      level: (impactLevels.includes(req.body.level) ? req.body.level : "high") as ImpactLevel,
      teachers: teachers.map((teacher: Teacher, index: number) => ({
        id: teacher.id || `teacher-${index + 1}`,
        name: String(teacher.name || "").trim()
      })),
      profile: { ...emptyProfile(email), ...req.body.profile, email },
      generationOptions: sanitizeGenerationOptions(req.body.generationOptions)
    };
    if (input.teachers.some((teacher: Teacher) => !teacher.name)) {
      res.status(400).json({ error: "يوجد اسم معلمة فارغ" });
      return;
    }
    try {
      const report = await generateWithDeepSeek(input);
      res.json({ report, source: "deepseek" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "خطأ غير معروف";
      const timedOut = message.includes("أطول من المتوقع");
      res.status(timedOut ? 504 : 502).json({
        error: `تعذر توليد التقرير عبر الذكاء الاصطناعي: ${message}`
      });
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر توليد التقرير" });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    await requireSubscriptionAccess(req, email);
    res.json(await listReportData(email));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر تحميل التقارير" });
  }
});

app.post("/api/reports", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    await requireSubscriptionAccess(req, email);
    res.json(await upsertReportData(email, req.body.report as Report));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر حفظ التقرير" });
  }
});

app.put("/api/reports/:id", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    await requireSubscriptionAccess(req, email);
    res.json(await upsertReportData(email, { ...(req.body.report as Report), id: req.params.id }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر حفظ التقرير" });
  }
});

app.delete("/api/reports/:id", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || req.query.email);
    await requireSubscriptionAccess(req, email);
    res.json(await deleteReportData(email, req.params.id));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر حذف التقرير" });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Impact report server listening on http://localhost:${port}`);
  });
}

export default app;
