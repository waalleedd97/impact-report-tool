import dotenv from "dotenv";

dotenv.config();

function argValue(name: string, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

const apiBase = argValue("--api", process.env.SUBSCRIPTION_API_BASE || "http://localhost:5174").replace(/\/$/, "");
const days = Number(argValue("--days", "30"));
const quantity = Number(argValue("--quantity", "1"));
const note = argValue("--note", "");
const accountId = argValue("--account", "");
const secret = process.env.SUBSCRIPTION_ADMIN_SECRET;

if (!secret) {
  console.error("SUBSCRIPTION_ADMIN_SECRET غير مضبوط في البيئة.");
  process.exit(1);
}

const response = await fetch(`${apiBase}/api/admin/subscriptions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-admin-secret": secret
  },
  body: JSON.stringify({
    days,
    quantity,
    note,
    ...(accountId ? { accountId } : {})
  })
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(payload?.error || "تعذر إنشاء رقم الاشتراك");
  process.exit(1);
}

for (const subscription of payload.subscriptions || []) {
  console.log(subscription.code);
}
