import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type {
  PdfEditorDocument,
  PdfEditorField,
  PdfEditorPage,
  PdfEditorTable,
  PdfEditorTableCell,
  PdfEditorTableRow
} from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type AssetUploader = (input: {
  documentId: string;
  pageId: string;
  file: Blob;
  filename: string;
}) => Promise<string>;

type TextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
  fontName?: string;
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("تعذر تجهيز صورة صفحة PDF"));
    }, type, quality);
  });
}

function isArabic(value: string) {
  return /[\u0600-\u06ff]/.test(value);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function fieldFromTextItem(item: TextItem, viewport: pdfjsLib.PageViewport, pageId: string): PdfEditorField | null {
  const text = normalizeText(item.str || "");
  if (!text) return null;
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const rawHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 12;
  const width = Math.max(8, Math.abs(item.width || 0) * viewport.scale);
  const height = Math.max(8, rawHeight * 1.25);
  const x = tx[4];
  const y = tx[5] - height * 0.86;
  const checkmark = /^[√✓✔]+$/.test(text);
  return {
    id: uid(checkmark ? "check" : "field"),
    pageId,
    type: checkmark ? "checkmark" : "text",
    x,
    y,
    width: checkmark ? Math.max(12, height) : width,
    height: checkmark ? Math.max(12, height) : height,
    text,
    originalText: text,
    fontSize: Math.max(7, Math.min(42, rawHeight)),
    fontFamily: '"Sakkal Majalla", "Arial", "Tahoma", sans-serif',
    fontWeight: checkmark ? 700 : 400,
    color: checkmark ? "#28743d" : "#111111",
    textAlign: isArabic(text) ? "right" : "left",
    direction: isArabic(text) ? "rtl" : "auto"
  };
}

type RowCluster = {
  y: number;
  fields: PdfEditorField[];
};

function groupFieldsIntoRows(fields: PdfEditorField[]) {
  const rows: RowCluster[] = [];
  for (const field of fields.filter((item) => item.type === "text").sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - field.y) < 7);
    if (row) {
      row.fields.push(field);
      row.y = (row.y + field.y) / 2;
    } else {
      rows.push({ y: field.y, fields: [field] });
    }
  }
  return rows.map((row) => ({ ...row, fields: row.fields.sort((a, b) => a.x - b.x) }));
}

function tableCell(rowId: string, columnId: string, text: string, index: number): PdfEditorTableCell {
  return {
    id: `${rowId}-${columnId}-${index}`,
    columnId,
    text,
    originalText: text,
    fontSize: 12,
    fontWeight: 400,
    color: "#111111",
    textAlign: isArabic(text) ? "right" : "center"
  };
}

function detectTables(fields: PdfEditorField[], page: PdfEditorPage) {
  const rows = groupFieldsIntoRows(fields)
    .filter((row) => row.fields.length >= 3)
    .filter((row) => {
      const minX = Math.min(...row.fields.map((field) => field.x));
      const maxX = Math.max(...row.fields.map((field) => field.x + field.width));
      return maxX - minX > page.width * 0.28;
    });
  const tables: PdfEditorTable[] = [];
  const usedFieldIds = new Set<string>();
  let index = 0;

  while (index < rows.length) {
    const cluster = [rows[index]];
    index += 1;
    while (index < rows.length) {
      const previous = cluster[cluster.length - 1];
      const next = rows[index];
      const gap = next.y - previous.y;
      const similarSize = Math.abs(next.fields.length - previous.fields.length) <= 2;
      if (gap > 4 && gap < 34 && similarSize) {
        cluster.push(next);
        index += 1;
      } else {
        break;
      }
    }
    if (cluster.length < 3) continue;

    const allFields = cluster.flatMap((row) => row.fields);
    const x = Math.max(0, Math.min(...allFields.map((field) => field.x)) - 4);
    const y = Math.max(0, Math.min(...allFields.map((field) => field.y)) - 4);
    const right = Math.min(page.width, Math.max(...allFields.map((field) => field.x + field.width)) + 4);
    const bottom = Math.min(page.height, Math.max(...allFields.map((field) => field.y + field.height)) + 4);
    const width = right - x;
    const height = bottom - y;
    if (width < page.width * 0.32 || height < 34) continue;

    const longestRow = [...cluster].sort((a, b) => b.fields.length - a.fields.length)[0];
    const columnSeeds = longestRow.fields.slice(0, 12).map((field) => field.x + field.width / 2).sort((a, b) => a - b);
    if (columnSeeds.length < 3) continue;

    const columns = columnSeeds.map((center, columnIndex) => {
      const leftBoundary = columnIndex === 0 ? x : (columnSeeds[columnIndex - 1] + center) / 2;
      const rightBoundary = columnIndex === columnSeeds.length - 1 ? right : (center + columnSeeds[columnIndex + 1]) / 2;
      return {
        id: `col-${columnIndex + 1}`,
        width: Math.max(18, rightBoundary - leftBoundary)
      };
    });

    const tableRows: PdfEditorTableRow[] = cluster.map((row, rowIndex) => {
      const rowId = `row-${rowIndex + 1}`;
      const cells = columns.map((column, columnIndex) => {
        const seed = columnSeeds[columnIndex];
        const candidates = row.fields.filter((field) => {
          const center = field.x + field.width / 2;
          const previous = columnIndex === 0 ? -Infinity : (columnSeeds[columnIndex - 1] + seed) / 2;
          const next = columnIndex === columnSeeds.length - 1 ? Infinity : (seed + columnSeeds[columnIndex + 1]) / 2;
          return center >= previous && center < next;
        });
        const text = candidates.map((field) => field.text).join(" ").trim();
        candidates.forEach((field) => usedFieldIds.add(field.id));
        return tableCell(rowId, column.id, text, columnIndex);
      });
      const nextRow = cluster[rowIndex + 1];
      const rowHeight = nextRow ? Math.max(18, nextRow.y - row.y) : Math.max(18, row.fields[0]?.height + 8 || 24);
      return { id: rowId, height: rowHeight, cells };
    });

    tables.push({
      id: uid("table"),
      pageId: page.id,
      x,
      y,
      width,
      height,
      columns,
      rows: tableRows,
      borderColor: "#777777",
      backgroundColor: "#ffffff"
    });
  }

  return {
    tables,
    remainingFields: fields.filter((field) => !usedFieldIds.has(field.id))
  };
}

export async function buildPdfEditorDocument(input: {
  file: File;
  email: string;
  uploadAsset: AssetUploader;
  onProgress?: (message: string) => void;
}): Promise<PdfEditorDocument> {
  const id = uid("pdf-doc");
  const createdAt = new Date().toISOString();
  const data = await input.file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  const pdf = await loadingTask.promise;
  const pages: PdfEditorPage[] = [];
  let fields: PdfEditorField[] = [];
  let tables: PdfEditorTable[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      input.onProgress?.(`قراءة الصفحة ${pageNumber} من ${pdf.numPages}`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const renderScale = Math.min(2, Math.max(1.35, window.devicePixelRatio || 1.5));
      const renderViewport = page.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error("تعذر تجهيز معاينة PDF");
      }
      await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
      const pageId = `page-${pageNumber}`;
      const blob = await canvasToBlob(canvas);
      const backgroundUrl = await input.uploadAsset({
        documentId: id,
        pageId,
        file: blob,
        filename: `${pageId}.jpg`
      });
      const textContent = await page.getTextContent();
      const pageFields = (textContent.items as TextItem[])
        .map((item) => fieldFromTextItem(item, viewport, pageId))
        .filter((field): field is PdfEditorField => Boolean(field));
      const pageMeta: PdfEditorPage = {
        id: pageId,
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        widthMm: viewport.width * 25.4 / 72,
        heightMm: viewport.height * 25.4 / 72,
        backgroundUrl,
        textLayerExtracted: pageFields.length > 0
      };
      const detected = detectTables(pageFields, pageMeta);
      pages.push(pageMeta);
      fields = [...fields, ...detected.remainingFields];
      tables = [...tables, ...detected.tables];
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  return {
    id,
    email: input.email,
    title: input.file.name.replace(/\.pdf$/i, "") || "مستند PDF",
    sourceFilename: input.file.name,
    createdAt,
    updatedAt: createdAt,
    pages,
    fields,
    tables
  };
}
