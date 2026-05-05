import type {
  GenerationOptions,
  ImpactLevel,
  Profile,
  Report,
  SmartTemplate,
  StoredReportMeta,
  SubscriptionLoginResult,
  Teacher
} from "./types";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || "تعذر إكمال الطلب");
    Object.assign(error, payload);
    throw error;
  }
  return payload as T;
}

export async function loginWithSubscription(code: string): Promise<SubscriptionLoginResult> {
  const response = await fetch("/api/subscriptions/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  return parseResponse<SubscriptionLoginResult>(response);
}

export async function renewSubscription(expiredCode: string, newCode: string): Promise<SubscriptionLoginResult> {
  const response = await fetch("/api/subscriptions/renew", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiredCode, newCode })
  });
  return parseResponse<SubscriptionLoginResult>(response);
}

function subscriptionHeaders(subscriptionCode: string) {
  return { "x-subscription-code": subscriptionCode };
}

export async function loadProfile(accountId: string, subscriptionCode: string): Promise<Profile> {
  const response = await fetch(`/api/profile?email=${encodeURIComponent(accountId)}`, {
    headers: subscriptionHeaders(subscriptionCode)
  });
  return parseResponse<Profile>(response);
}

export async function saveProfile(profile: Profile, subscriptionCode: string): Promise<Profile> {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...subscriptionHeaders(subscriptionCode) },
    body: JSON.stringify({ email: profile.email, profile })
  });
  return parseResponse<Profile>(response);
}

export async function importPdf(email: string, file: File, subscriptionCode: string) {
  const form = new FormData();
  form.set("email", email);
  form.set("pdf", file);
  const response = await fetch("/api/import-pdf", {
    method: "POST",
    headers: subscriptionHeaders(subscriptionCode),
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
  generationOptions?: GenerationOptions;
}, subscriptionCode: string) {
  const response = await fetch("/api/reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...subscriptionHeaders(subscriptionCode) },
    body: JSON.stringify(input)
  });
  return parseResponse<{ report: Report; source: "deepseek" }>(response);
}

export async function saveReport(report: Report, subscriptionCode: string): Promise<StoredReportMeta> {
  const response = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...subscriptionHeaders(subscriptionCode) },
    body: JSON.stringify({ email: report.email, report })
  });
  return parseResponse<StoredReportMeta>(response);
}

export async function deleteReport(reportId: string, accountId: string, subscriptionCode: string): Promise<{ id: string }> {
  const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...subscriptionHeaders(subscriptionCode) },
    body: JSON.stringify({ email: accountId })
  });
  return parseResponse<{ id: string }>(response);
}

export async function listReports(email: string, subscriptionCode: string): Promise<StoredReportMeta[]> {
  const response = await fetch(`/api/reports?email=${encodeURIComponent(email)}`, {
    headers: subscriptionHeaders(subscriptionCode)
  });
  return parseResponse<StoredReportMeta[]>(response);
}
