import Database from "better-sqlite3";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fsp from "node:fs/promises";
import path from "node:path";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_ASSETS_BUCKET || "smart-editor-assets";
const rootDir = process.cwd();
const dbPath = path.join(rootDir, "data", "app.db");
const assetsDir = path.join(rootDir, "data", "assets");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY مطلوبة لتشغيل الترحيل");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function ensureBucket() {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  if (buckets?.some((bucket) => bucket.name === bucketName)) return;
  const { error } = await supabase.storage.createBucket(bucketName, { public: false });
  if (error) throw error;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath);
      if (entry.isFile()) return [fullPath];
      return [];
    })
  );
  return files.flat();
}

async function uploadAssets() {
  await ensureBucket();
  const files = await listFiles(assetsDir);
  for (const file of files) {
    const storagePath = path.relative(assetsDir, file).split(path.sep).join("/");
    const contentType = file.toLowerCase().endsWith(".png") ? "image/png" : "application/octet-stream";
    const { error } = await supabase.storage.from(bucketName).upload(storagePath, await fsp.readFile(file), {
      contentType,
      upsert: true
    });
    if (error) throw error;
  }
  return files.length;
}

async function migrate() {
  const db = new Database(dbPath, { readonly: true });
  const profiles = db.prepare("select email, data, updated_at from profiles").all() as Array<{
    email: string;
    data: string;
    updated_at: string;
  }>;
  const reports = db.prepare("select id, email, title, level, data, created_at, updated_at from reports").all() as Array<{
    id: string;
    email: string;
    title: string;
    level: string;
    data: string;
    created_at: string;
    updated_at: string;
  }>;

  for (const row of profiles) {
    const { error } = await supabase.from("profiles").upsert(
      {
        email: row.email,
        data: JSON.parse(row.data),
        updated_at: row.updated_at
      },
      { onConflict: "email" }
    );
    if (error) throw error;
  }

  for (const row of reports) {
    const { error } = await supabase.from("reports").upsert(
      {
        id: row.id,
        email: row.email,
        title: row.title,
        level: row.level,
        data: JSON.parse(row.data),
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      { onConflict: "id" }
    );
    if (error) throw error;
  }

  const uploadedAssets = await uploadAssets();
  console.log(
    JSON.stringify(
      {
        migratedProfiles: profiles.length,
        migratedReports: reports.length,
        uploadedAssets
      },
      null,
      2
    )
  );
}

migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
