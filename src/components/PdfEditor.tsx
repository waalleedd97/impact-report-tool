import { FileText, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PdfEditorDocument,
  PdfEditorField,
  PdfEditorTable,
  PdfEditorTableCell,
  PdfEditorTableRow
} from "../types";

type Selection =
  | { type: "field"; fieldId: string }
  | { type: "table"; tableId: string }
  | { type: "cell"; tableId: string; rowId: string; columnId: string }
  | null;

type DragState = {
  kind: "field" | "table";
  id: string;
  pageId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function updateField(document: PdfEditorDocument, fieldId: string, patch: Partial<PdfEditorField>): PdfEditorDocument {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    fields: document.fields.map((field) =>
      field.id === fieldId
        ? {
            ...field,
            originalText: patch.text !== undefined && field.originalText === undefined ? field.text : field.originalText,
            ...patch
          }
        : field
    )
  };
}

function updateTable(document: PdfEditorDocument, tableId: string, patch: Partial<PdfEditorTable>): PdfEditorDocument {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    tables: document.tables.map((table) => (table.id === tableId ? { ...table, ...patch } : table))
  };
}

function cellDefaults(columnId: string, rowId: string, text = ""): PdfEditorTableCell {
  return {
    id: `${rowId}-${columnId}-${uid("cell")}`,
    columnId,
    text,
    originalText: "",
    fontSize: 12,
    fontWeight: 400,
    color: "#111111",
    textAlign: "right"
  };
}

function rowDefaults(columns: PdfEditorTable["columns"]): PdfEditorTableRow {
  const rowId = uid("row");
  return {
    id: rowId,
    height: 28,
    cells: columns.map((column) => cellDefaults(column.id, rowId))
  };
}

function tableDefaults(pageId: string, x: number, y: number): PdfEditorTable {
  const columns = [
    { id: "col-1", width: 110 },
    { id: "col-2", width: 110 },
    { id: "col-3", width: 110 }
  ];
  const rows = [rowDefaults(columns), rowDefaults(columns), rowDefaults(columns)];
  return {
    id: uid("table"),
    pageId,
    x,
    y,
    width: columns.reduce((sum, column) => sum + column.width, 0),
    height: rows.reduce((sum, row) => sum + row.height, 0),
    columns,
    rows,
    borderColor: "#777777",
    backgroundColor: "#ffffff"
  };
}

function fieldDefaults(pageId: string, type: "text" | "checkmark", x: number, y: number): PdfEditorField {
  return {
    id: uid(type === "checkmark" ? "check" : "field"),
    pageId,
    type,
    x,
    y,
    width: type === "checkmark" ? 28 : 160,
    height: type === "checkmark" ? 28 : 32,
    text: type === "checkmark" ? "✓" : "نص جديد",
    originalText: "",
    fontSize: type === "checkmark" ? 22 : 14,
    fontFamily: '"Sakkal Majalla", "Arial", "Tahoma", sans-serif',
    fontWeight: type === "checkmark" ? 700 : 400,
    color: type === "checkmark" ? "#28743d" : "#111111",
    textAlign: "right",
    direction: "rtl"
  };
}

function selectedTable(document: PdfEditorDocument | undefined, selection: Selection) {
  if (!selection || (selection.type !== "table" && selection.type !== "cell")) return undefined;
  return document?.tables.find((table) => table.id === selection.tableId);
}

function safeFilename(value: string) {
  return (value || "pdf-document").replace(/[\\/:*?"<>|]+/g, "-").trim() || "pdf-document";
}

function fieldChanged(field: PdfEditorField) {
  return field.originalText !== undefined && field.text !== field.originalText;
}

function cellChanged(cell: PdfEditorTableCell) {
  return cell.originalText !== undefined && cell.text !== cell.originalText;
}

function tableChanged(table: PdfEditorTable) {
  return table.rows.some((row) => row.cells.some(cellChanged));
}

export default function PdfEditor({
  document,
  onChange,
  onSave,
  onGenerate,
  disabled
}: {
  document?: PdfEditorDocument;
  onChange: (document: PdfEditorDocument) => void;
  onSave: () => void;
  onGenerate: () => void;
  disabled?: boolean;
}) {
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (document?.pages.length && !document.pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(document.pages[0].id);
    }
  }, [document?.id, document?.pages, selectedPageId]);

  const page = useMemo(
    () => document?.pages.find((item) => item.id === selectedPageId) || document?.pages[0],
    [document, selectedPageId]
  );
  const table = selectedTable(document, selection);
  const selectedField = selection?.type === "field" ? document?.fields.find((field) => field.id === selection.fieldId) : undefined;
  const selectedRow = table && selection?.type === "cell" ? table.rows.find((row) => row.id === selection.rowId) : undefined;
  const selectedColumn = table && selection?.type === "cell" ? table.columns.find((column) => column.id === selection.columnId) : undefined;
  const selectedCell = selectedRow && selection?.type === "cell"
    ? selectedRow.cells.find((cell) => cell.columnId === selection.columnId)
    : undefined;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !document) return;
      const pageElement = window.document.querySelector<HTMLElement>(`[data-pdf-page-id="${drag.pageId}"]`);
      if (!pageElement) return;
      const rect = pageElement.getBoundingClientRect();
      const pageMeta = document.pages.find((item) => item.id === drag.pageId);
      if (!pageMeta) return;
      const scale = pageMeta.width / Math.max(1, rect.width);
      const dx = (event.clientX - drag.startX) * scale;
      const dy = (event.clientY - drag.startY) * scale;
      if (drag.kind === "field") {
        onChange(updateField(document, drag.id, { x: drag.originX + dx, y: drag.originY + dy }));
      } else {
        onChange(updateTable(document, drag.id, { x: drag.originX + dx, y: drag.originY + dy }));
      }
    };
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [document, onChange]);

  if (!document || !page) {
    return (
      <div className="pdf-editor-empty">
        <FileText size={34} />
        <span>ارفع ملف PDF من تبويب محرر PDF للبدء</span>
      </div>
    );
  }

  const updateSelectedField = (patch: Partial<PdfEditorField>) => {
    if (!selectedField) return;
    onChange(updateField(document, selectedField.id, patch));
  };

  const addField = (type: "text" | "checkmark") => {
    const nextField = fieldDefaults(page.id, type, page.width * 0.18, page.height * 0.18);
    onChange({ ...document, updatedAt: new Date().toISOString(), fields: [...document.fields, nextField] });
    setSelection({ type: "field", fieldId: nextField.id });
  };

  const addTable = () => {
    const nextTable = tableDefaults(page.id, page.width * 0.12, page.height * 0.2);
    onChange({ ...document, updatedAt: new Date().toISOString(), tables: [...document.tables, nextTable] });
    setSelection({ type: "table", tableId: nextTable.id });
  };

  const deleteSelected = () => {
    if (!selection) return;
    if (selection.type === "field") {
      onChange({
        ...document,
        updatedAt: new Date().toISOString(),
        fields: document.fields.filter((field) => field.id !== selection.fieldId)
      });
    } else {
      onChange({
        ...document,
        updatedAt: new Date().toISOString(),
        tables: document.tables.filter((item) => item.id !== selection.tableId)
      });
    }
    setSelection(null);
  };

  const changeCellText = (tableId: string, rowId: string, columnId: string, text: string) => {
    onChange({
      ...document,
      updatedAt: new Date().toISOString(),
      tables: document.tables.map((item) =>
        item.id === tableId
          ? {
              ...item,
              rows: item.rows.map((row) =>
                row.id === rowId
                  ? {
                      ...row,
                      cells: row.cells.map((cell) =>
                        cell.columnId === columnId
                          ? {
                              ...cell,
                              originalText: cell.originalText === undefined ? cell.text : cell.originalText,
                              text
                            }
                          : cell
                      )
                    }
                  : row
              )
            }
          : item
      )
    });
  };

  const addRow = () => {
    if (!table) return;
    const row = rowDefaults(table.columns);
    onChange(updateTable(document, table.id, {
      rows: [...table.rows, row],
      height: table.height + row.height
    }));
  };

  const addColumn = () => {
    if (!table) return;
    const column = { id: uid("col"), width: 90 };
    onChange(updateTable(document, table.id, {
      columns: [...table.columns, column],
      width: table.width + column.width,
      rows: table.rows.map((row) => ({
        ...row,
        cells: [...row.cells, cellDefaults(column.id, row.id)]
      }))
    }));
  };

  const updateSelectedRowHeight = (height: number) => {
    if (!table || !selectedRow || !Number.isFinite(height)) return;
    const nextRows = table.rows.map((row) => (row.id === selectedRow.id ? { ...row, height } : row));
    onChange(updateTable(document, table.id, {
      rows: nextRows,
      height: nextRows.reduce((sum, row) => sum + row.height, 0)
    }));
  };

  const updateSelectedColumnWidth = (width: number) => {
    if (!table || !selectedColumn || !Number.isFinite(width)) return;
    const nextColumns = table.columns.map((column) => (column.id === selectedColumn.id ? { ...column, width } : column));
    onChange(updateTable(document, table.id, {
      columns: nextColumns,
      width: nextColumns.reduce((sum, column) => sum + column.width, 0)
    }));
  };

  const updateSelectedCell = (patch: Partial<PdfEditorTableCell>) => {
    if (!table || !selectedCell || selection?.type !== "cell") return;
    onChange(updateTable(document, table.id, {
      rows: table.rows.map((row) =>
        row.id === selection.rowId
          ? {
              ...row,
              cells: row.cells.map((cell) =>
                cell.columnId === selection.columnId
                  ? {
                      ...cell,
                      originalText: patch.text !== undefined && cell.originalText === undefined ? cell.text : cell.originalText,
                      ...patch
                    }
                  : cell
              )
            }
          : row
      )
    }));
  };

  const deleteRow = () => {
    if (!table || selection?.type !== "cell") return;
    const rows = table.rows.filter((row) => row.id !== selection.rowId);
    onChange(updateTable(document, table.id, {
      rows,
      height: rows.reduce((sum, row) => sum + row.height, 0)
    }));
    setSelection({ type: "table", tableId: table.id });
  };

  const deleteColumn = () => {
    if (!table || selection?.type !== "cell") return;
    const columns = table.columns.filter((column) => column.id !== selection.columnId);
    onChange(updateTable(document, table.id, {
      columns,
      width: columns.reduce((sum, column) => sum + column.width, 0),
      rows: table.rows.map((row) => ({
        ...row,
        cells: row.cells.filter((cell) => cell.columnId !== selection.columnId)
      }))
    }));
    setSelection({ type: "table", tableId: table.id });
  };

  const exportPdf = async () => {
    const pages = Array.from(window.document.querySelectorAll<HTMLElement>(".pdf-editor-page-surface"));
    if (!pages.length) return;
    const firstPage = document.pages[0];
    const pdf = new jsPDF({
      orientation: firstPage.widthMm > firstPage.heightMm ? "landscape" : "portrait",
      unit: "mm",
      format: [firstPage.widthMm, firstPage.heightMm],
      compress: true
    });
    for (const [index, pageElement] of pages.entries()) {
      const pageMeta = document.pages[index];
      const canvas = await html2canvas(pageElement, {
        backgroundColor: "#ffffff",
        scale: Math.min(2.5, window.devicePixelRatio || 2),
        useCORS: true,
        allowTaint: true,
        logging: false,
        onclone: (clone) => clone.body.classList.add("pdf-export-mode")
      });
      if (index > 0) {
        pdf.addPage([pageMeta.widthMm, pageMeta.heightMm], pageMeta.widthMm > pageMeta.heightMm ? "landscape" : "portrait");
      }
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.96), "JPEG", 0, 0, pageMeta.widthMm, pageMeta.heightMm);
    }
    pdf.save(`${safeFilename(document.title)}.pdf`);
  };

  return (
    <div className="pdf-editor-shell" dir="rtl">
      <div className="pdf-editor-toolbar">
        <button onClick={() => addField("text")} disabled={disabled}>
          <Plus size={16} />
          خانة نص
        </button>
        <button onClick={() => addField("checkmark")} disabled={disabled}>
          <Plus size={16} />
          علامة صح
        </button>
        <button onClick={addTable} disabled={disabled}>
          <Plus size={16} />
          جدول
        </button>
        <button onClick={onGenerate} disabled={disabled}>
          <Sparkles size={16} />
          تعبئة بالذكاء
        </button>
        <button onClick={onSave} disabled={disabled}>
          <Save size={16} />
          حفظ المستند
        </button>
        <button onClick={exportPdf} disabled={disabled}>
          <FileText size={16} />
          تصدير PDF
        </button>
        <button onClick={deleteSelected} disabled={!selection || disabled} className="danger-button">
          <Trash2 size={16} />
          حذف المحدد
        </button>
      </div>

      <div className="pdf-editor-layout">
        <aside className="pdf-page-rail">
          {document.pages.map((item) => (
            <button
              key={item.id}
              className={item.id === page.id ? "active" : ""}
              onClick={() => setSelectedPageId(item.id)}
            >
              <img src={item.backgroundUrl} alt={`صفحة ${item.pageNumber}`} />
              <span>{item.pageNumber}</span>
            </button>
          ))}
        </aside>

        <section className="pdf-page-stack">
          {document.pages.map((item) => (
            <div
              key={item.id}
              data-pdf-page-id={item.id}
              className="pdf-editor-page-surface"
              style={{ width: item.width, height: item.height }}
              onPointerDown={() => setSelectedPageId(item.id)}
            >
              <img className="pdf-editor-page-bg" src={item.backgroundUrl} alt={`صفحة PDF ${item.pageNumber}`} />
              {document.fields.filter((field) => field.pageId === item.id).map((field) => (
                <div
                  key={field.id}
                  className={[
                    "pdf-edit-field",
                    field.type === "checkmark" ? "checkmark" : "",
                    fieldChanged(field) ? "changed" : "unchanged",
                    selection?.type === "field" && selection.fieldId === field.id ? "selected" : ""
                  ].join(" ")}
                  style={{
                    left: field.x,
                    top: field.y,
                    width: field.width,
                    minHeight: field.height,
                    fontSize: field.fontSize,
                    fontFamily: field.fontFamily,
                    fontWeight: field.fontWeight,
                    color: field.color,
                    textAlign: field.textAlign,
                    direction: field.direction === "auto" ? undefined : field.direction
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedPageId(field.pageId);
                    setSelection({ type: "field", fieldId: field.id });
                  }}
                >
                  <button
                    className="pdf-field-drag-handle"
                    title="تحريك"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      dragRef.current = {
                        kind: "field",
                        id: field.id,
                        pageId: field.pageId,
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: field.x,
                        originY: field.y
                      };
                    }}
                  />
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    dir={field.direction}
                    onBlur={(event) => {
                      onChange(updateField(document, field.id, { text: event.currentTarget.textContent || "" }));
                    }}
                  >
                    {field.text}
                  </span>
                </div>
              ))}

              {document.tables.filter((itemTable) => itemTable.pageId === item.id).map((itemTable) => (
                <div
                  key={itemTable.id}
                  className={[
                    "pdf-edit-table",
                    tableChanged(itemTable) ? "changed" : "unchanged",
                    selection?.type !== "field" && selection?.tableId === itemTable.id ? "selected" : ""
                  ].join(" ")}
                  style={{
                    left: itemTable.x,
                    top: itemTable.y,
                    width: itemTable.width,
                    minHeight: itemTable.height,
                    borderColor: itemTable.borderColor,
                    backgroundColor: itemTable.backgroundColor
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedPageId(itemTable.pageId);
                    setSelection({ type: "table", tableId: itemTable.id });
                  }}
                >
                  <button
                    className="pdf-table-drag-handle"
                    title="تحريك الجدول"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      dragRef.current = {
                        kind: "table",
                        id: itemTable.id,
                        pageId: itemTable.pageId,
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: itemTable.x,
                        originY: itemTable.y
                      };
                    }}
                  />
                  <table>
                    <colgroup>
                      {itemTable.columns.map((column) => (
                        <col key={column.id} style={{ width: column.width }} />
                      ))}
                    </colgroup>
                    <tbody>
                      {itemTable.rows.map((row) => (
                        <tr key={row.id} style={{ height: row.height }}>
                          {itemTable.columns.map((column) => {
                            const cell = row.cells.find((itemCell) => itemCell.columnId === column.id) || cellDefaults(column.id, row.id);
                            return (
                              <td
                                key={column.id}
                                className={
                                  selection?.type === "cell" &&
                                  selection.tableId === itemTable.id &&
                                  selection.rowId === row.id &&
                                  selection.columnId === column.id
                                    ? "selected"
                                    : ""
                                }
                                style={{
                                  fontSize: cell.fontSize,
                                  fontWeight: cell.fontWeight,
                                  color: cell.color,
                                  textAlign: cell.textAlign
                                }}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  setSelectedPageId(itemTable.pageId);
                                  setSelection({ type: "cell", tableId: itemTable.id, rowId: row.id, columnId: column.id });
                                }}
                                contentEditable
                                suppressContentEditableWarning
                                dir="rtl"
                                onBlur={(event) => changeCellText(itemTable.id, row.id, column.id, event.currentTarget.textContent || "")}
                              >
                                {cell.text}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </section>

        <aside className="pdf-editor-inspector">
          <h3>خصائص المحدد</h3>
          {selectedField ? (
            <>
              <label>
                الحجم
                <input type="number" value={selectedField.fontSize} onChange={(event) => updateSelectedField({ fontSize: Number(event.target.value) })} />
              </label>
              <label>
                اللون
                <input type="color" value={selectedField.color} onChange={(event) => updateSelectedField({ color: event.target.value })} />
              </label>
              <label>
                العرض
                <input type="number" value={Math.round(selectedField.width)} onChange={(event) => updateSelectedField({ width: Number(event.target.value) })} />
              </label>
              <label>
                الارتفاع
                <input type="number" value={Math.round(selectedField.height)} onChange={(event) => updateSelectedField({ height: Number(event.target.value) })} />
              </label>
              <button onClick={() => updateSelectedField({ fontWeight: selectedField.fontWeight >= 700 ? 400 : 700 })}>
                {selectedField.fontWeight >= 700 ? "وزن عادي" : "وزن عريض"}
              </button>
            </>
          ) : table ? (
            <>
              <button onClick={addRow}>إضافة صف</button>
              <button onClick={addColumn}>إضافة عمود</button>
              <button onClick={deleteRow} disabled={selection?.type !== "cell" || table.rows.length <= 1}>حذف صف الخلية</button>
              <button onClick={deleteColumn} disabled={selection?.type !== "cell" || table.columns.length <= 1}>حذف عمود الخلية</button>
              {selection?.type === "cell" && selectedRow && selectedColumn ? (
                <>
                  <label>
                    عرض العمود
                    <input
                      type="number"
                      value={Math.round(selectedColumn.width)}
                      onChange={(event) => updateSelectedColumnWidth(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    ارتفاع الصف
                    <input
                      type="number"
                      value={Math.round(selectedRow.height)}
                      onChange={(event) => updateSelectedRowHeight(Number(event.target.value))}
                    />
                  </label>
                </>
              ) : null}
              {selectedCell ? (
                <>
                  <label>
                    حجم خط الخلية
                    <input
                      type="number"
                      value={selectedCell.fontSize}
                      onChange={(event) => updateSelectedCell({ fontSize: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    لون خط الخلية
                    <input type="color" value={selectedCell.color} onChange={(event) => updateSelectedCell({ color: event.target.value })} />
                  </label>
                  <button onClick={() => updateSelectedCell({ fontWeight: selectedCell.fontWeight >= 700 ? 400 : 700 })}>
                    {selectedCell.fontWeight >= 700 ? "وزن خلية عادي" : "وزن خلية عريض"}
                  </button>
                </>
              ) : null}
              <label>
                لون الحدود
                <input type="color" value={table.borderColor} onChange={(event) => onChange(updateTable(document, table.id, { borderColor: event.target.value }))} />
              </label>
            </>
          ) : (
            <p className="muted">اختر خانة أو جدولاً لتعديل خصائصه.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
