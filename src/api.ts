import type { ImpactLevel, Profile, Report, SmartTemplate, StoredReportMeta, Teacher } from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "تعذر إكمال الطلب");
  }
  return payload as T;
}

export async function loadProfile(email: string): Promise<Profile> {
  const response = await fetch(`/api/profile?email=${encodeURIComponent(email)}`);
  return parseResponse<Profile>(response);
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: profile.email, profile })
  });
  return parseResponse<Profile>(response);
}

export async function importPdf(email: string, file: File) {
  const form = new FormData();
  form.set("email", email);
  form.set("pdf", file);
  const response = await fetch("/api/import-pdf", {
    method: "POST",
    body: form
  });
  return parseResponse<{
    teachers: Teacher[];
    templateAssets: { backgroundUrl?: string; signatureUrl?: string };
    schoolSettings: Partial<Profile["schoolSettings"]>;
    smartTemplateDraft?: SmartTemplate;
  }>(response);
}

export async function generateReport(input: {
  email: string;
  courseTitle: string;
  level: ImpactLevel;
  teachers: Teacher[];
  profile: Profile;
}) {
  const response = await fetch("/api/reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parseResponse<{ report: Report; source: "deepseek" }>(response);
}

export async function saveReport(report: Report): Promise<StoredReportMeta> {
  const response = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: report.email, report })
  });
  return parseResponse<StoredReportMeta>(response);
}

export async function listReports(email: string): Promise<StoredReportMeta[]> {
  const response = await fetch(`/api/reports?email=${encodeURIComponent(email)}`);
  return parseResponse<StoredReportMeta[]>(response);
}
