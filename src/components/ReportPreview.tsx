import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { createDefaultSmartTemplate, defaultPrintSettings, fontFamilyOptions, fontWeightOptions } from "../defaults";
import type {
  CheckmarkOffset,
  PrintSettings,
  Report,
  ReportRow,
  SchoolSettings,
  SmartTemplate,
  TableRegion,
  TableRegionId,
  TemplateAssets,
  TextStyleOverride
} from "../types";

const pageWidthMm = 210;
const pageHeightMm = 297;
const detailColumnWidths = {
  number: 6.84,
  name: 31.69,
  lessons: 9.88,
  contribution: 27.31,
  effectiveness: 24.91,
  skills: 52.37,
  benefitTotal: 39.88
};
const defaultBenefitColumnWidths: Record<string, number> = {
  subject: 4.87,
  teaching: 7.35,
  confidence: 4.87,
  teamwork: 7.34,
  classroom: 4.87,
  technology: 4.88,
  motivation: 4.87
};
const contributionOptions = {
  high: "تساهم بدرجة عالية",
  medium: "تساهم بدرجة متوسطة"
} as const;
type ContributionTone = keyof typeof contributionOptions;

type EditableTarget = "letterhead" | "principalName" | "signatureImage";
type ResizeCorner = "nw" | "ne" | "sw" | "se";
type PrintSettingsChangeOptions = {
  persist?: boolean;
  pageKey?: string;
};
type PrintSettingsChangeHandler = (
  patch: Partial<PrintSettings>,
  options?: PrintSettingsChangeOptions
) => void;
type SmartTemplateChangeHandler = (template: SmartTemplate, options?: { persist?: boolean }) => void;
type ReportChangeHandler = (
  patch: Partial<Report>,
  options?: {
    persist?: boolean;
  }
) => void;
type SelectedEditable = {
  pageKey: string;
  target: EditableTarget;
};
type TextStyleDefaults = {
  fontFamily: string;
  fontSizePt: number;
  fontWeight: number;
  color: string;
};
type SelectedText = {
  key: string;
  defaults: TextStyleDefaults;
  rect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
};
type SelectedPercentage = {
  key: string;
  label: string;
  fallbackValue: number;
  rect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
};
type SelectedSummaryNumber = {
  key: string;
  label: string;
  fallbackValue: number;
  min: number;
  max: number;
  rect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
};
type SelectedCheckmark = {
  key: string;
};
type SelectedRegion = {
  id: TableRegionId;
};

type BoxMetrics = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const resizeLimits = {
  letterhead: {
    minWidth: 45,
    minHeight: 22,
    maxWidth: 100,
    maxHeight: 50
  },
  principalName: {
    minWidth: 28,
    minHeight: 5,
    maxWidth: 135,
    maxHeight: 24
  },
  signatureImage: {
    minWidth: 12,
    minHeight: 5,
    maxWidth: 95,
    maxHeight: 42
  }
};

function chunkRows(rows: ReportRow[], size: number) {
  const chunks: ReportRow[][] = [];
  const chunkSize = Math.max(1, size);
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks.length ? chunks : [[]];
}

function smartTemplateForReport(report: Report) {
  return report.smartTemplate || createDefaultSmartTemplate(report.templateAssets);
}

function rowsPerPageForTemplate(template: SmartTemplate) {
  const region = template.tableRegions.details;
  const availableHeight = Math.max(region.rowHeightMm, region.heightMm - (region.headerHeightMm || 32));
  return Math.max(1, Math.floor(availableHeight / Math.max(1, region.rowHeightMm)));
}

function regionStyle(region: TableRegion): CSSProperties {
  return {
    top: `${region.topMm}mm`,
    left: `${region.leftMm}mm`,
    width: `${region.widthMm}mm`,
    height: region.id === "summary" || region.id === "details" ? undefined : `${region.heightMm}mm`,
    fontSize: region.fontSizePt ? `${region.fontSizePt}pt` : undefined,
    "--smart-region-border-color": region.borderColor || "#777777",
    "--smart-region-bg": region.backgroundColor || "transparent",
    "--smart-region-row-height": `${region.rowHeightMm}mm`
  } as CSSProperties;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundMm(value: number) {
  return Math.round(value * 10) / 10;
}

function pointOnPage(event: PointerEvent | ReactPointerEvent<HTMLElement>, page: HTMLElement) {
  const rect = page.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * pageWidthMm,
    y: ((event.clientY - rect.top) / rect.height) * pageHeightMm
  };
}

function metricsForTarget(target: EditableTarget, settings: PrintSettings): BoxMetrics {
  if (target === "letterhead") {
    return {
      left: pageWidthMm - settings.letterheadRightMm - settings.letterheadWidthMm,
      top: settings.letterheadTopMm,
      width: settings.letterheadWidthMm,
      height: 35
    };
  }

  if (target === "principalName") {
    return {
      left: settings.principalNameLeftMm,
      top: settings.principalNameTopMm,
      width: settings.principalNameWidthMm,
      height: settings.principalNameHeightMm
    };
  }

  return {
    left: settings.signatureImageAbsLeftMm,
    top: settings.signatureImageAbsTopMm,
    width: settings.signatureImageAbsWidthMm,
    height: settings.signatureImageAbsHeightMm
  };
}

function settingsForPage(printSettings: Partial<PrintSettings> | undefined, pageKey: string): PrintSettings {
  const baseSettings = {
    ...defaultPrintSettings,
    ...printSettings,
    pageOverrides: {
      ...defaultPrintSettings.pageOverrides,
      ...printSettings?.pageOverrides
    },
    textStyleOverrides: {
      ...defaultPrintSettings.textStyleOverrides,
      ...printSettings?.textStyleOverrides
    },
    checkmarkOffsets: {
      ...defaultPrintSettings.checkmarkOffsets,
      ...printSettings?.checkmarkOffsets
    }
  };
  return {
    ...baseSettings,
    ...baseSettings.pageOverrides[pageKey],
    pageOverrides: baseSettings.pageOverrides,
    textStyleOverrides: baseSettings.textStyleOverrides,
    checkmarkOffsets: baseSettings.checkmarkOffsets
  };
}

function textOverrideStyle(override?: TextStyleOverride): CSSProperties | undefined {
  if (!override) return undefined;
  return {
    fontFamily: override.fontFamily,
    fontSize: override.fontSizePt ? `${override.fontSizePt}pt` : undefined,
    fontWeight: override.fontWeight,
    color: override.color
  };
}

function floatingToolbarPosition(rect: DOMRect, width: number, height: number) {
  const margin = 12;
  const gap = 12;
  const belowTop = rect.bottom + gap;
  const aboveTop = rect.top - height - gap;
  const top = belowTop + height <= window.innerHeight - margin ? belowTop : Math.max(margin, aboveTop);
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  return {
    top: Math.round(top),
    left: Math.round(clamp(rect.left, margin, maxLeft))
  };
}

function selectTextTarget(
  element: HTMLElement,
  key: string,
  defaults: TextStyleDefaults,
  onSelectText: (selection: SelectedText) => void
) {
  const rect = element.getBoundingClientRect();
  const position = floatingToolbarPosition(rect, 320, 180);
  onSelectText({
    key,
    defaults,
    rect: {
      ...position,
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right)
    }
  });
}

function selectPercentageTarget(
  element: HTMLElement,
  key: string,
  label: string,
  fallbackValue: number,
  onSelectPercentage: (selection: SelectedPercentage) => void
) {
  const rect = element.getBoundingClientRect();
  const position = floatingToolbarPosition(rect, 300, 128);
  onSelectPercentage({
    key,
    label,
    fallbackValue,
    rect: {
      ...position,
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right)
    }
  });
}

function selectSummaryNumberTarget(
  element: HTMLElement,
  key: string,
  label: string,
  fallbackValue: number,
  min: number,
  max: number,
  onSelectNumber: (selection: SelectedSummaryNumber) => void
) {
  const rect = element.getBoundingClientRect();
  const position = floatingToolbarPosition(rect, 300, 128);
  onSelectNumber({
    key,
    label,
    fallbackValue,
    min,
    max,
    rect: {
      ...position,
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right)
    }
  });
}

function StyleTarget({
  as,
  styleKey,
  defaults,
  overrides,
  selected,
  onSelectText,
  className,
  children
}: {
  as?: ElementType;
  styleKey: string;
  defaults: TextStyleDefaults;
  overrides: Record<string, TextStyleOverride>;
  selected: boolean;
  onSelectText: (selection: SelectedText) => void;
  className?: string;
  children: ReactNode;
}) {
  const Tag = as || "span";
  const classNames = ["text-style-target", selected ? "selected" : "", className || ""].filter(Boolean).join(" ");
  return (
    <Tag
      className={classNames}
      style={textOverrideStyle(overrides[styleKey])}
      onPointerDown={(event: ReactPointerEvent<HTMLElement>) => {
        selectTextTarget(event.currentTarget, styleKey, defaults, onSelectText);
      }}
    >
      {children}
    </Tag>
  );
}

function percentValue(report: Report, key: string, fallbackValue: number) {
  const override = report.percentageOverrides?.[key];
  return Number.isFinite(override) ? override : fallbackValue;
}

function clampPercentage(value: number) {
  return clamp(Math.round(value), 0, 100);
}

function PercentageTarget({
  report,
  percentKey,
  label,
  fallbackValue,
  selected,
  onSelectPercentage
}: {
  report: Report;
  percentKey: string;
  label: string;
  fallbackValue: number;
  selected: boolean;
  onSelectPercentage: (selection: SelectedPercentage) => void;
}) {
  const value = percentValue(report, percentKey, fallbackValue);
  return (
    <span
      className={["percentage-target", "text-style-target", selected ? "selected" : ""].filter(Boolean).join(" ")}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        selectPercentageTarget(event.currentTarget, percentKey, label, fallbackValue, onSelectPercentage);
      }}
      title="اضغط لتعديل النسبة"
    >
      {formatPercent(value)}
    </span>
  );
}

function summaryNumberValue(report: Report, key: string, fallbackValue: number) {
  const override = report.summaryNumberOverrides?.[key];
  return Number.isFinite(override) ? override : fallbackValue;
}

function clampSummaryNumber(value: number, min: number, max: number) {
  return clamp(Math.round(Number.isFinite(value) ? value : min), min, max);
}

function contributionTone(value: string): ContributionTone {
  return value.includes("عالية") ? "high" : "medium";
}

function normalizedContribution(value: string) {
  return contributionOptions[contributionTone(value)];
}

function EditableSkillsText({
  value,
  label,
  onChange
}: {
  value: string;
  label: string;
  onChange: (value: string, persist?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (document.activeElement === ref.current) return;
    if (ref.current && ref.current.textContent !== value) {
      ref.current.textContent = value;
    }
  }, [value]);

  const readValue = () => ref.current?.textContent || "";

  return (
    <div
      ref={ref}
      className="skills-edit-input"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onInput={() => onChange(readValue(), false)}
      onBlur={() => onChange(readValue(), true)}
    >
      {value}
    </div>
  );
}

function SummaryNumberTarget({
  report,
  numberKey,
  label,
  fallbackValue,
  min,
  max,
  selected,
  onSelectNumber
}: {
  report: Report;
  numberKey: string;
  label: string;
  fallbackValue: number;
  min: number;
  max: number;
  selected: boolean;
  onSelectNumber: (selection: SelectedSummaryNumber) => void;
}) {
  const value = summaryNumberValue(report, numberKey, fallbackValue);
  return (
    <span
      className={["summary-number-target", "text-style-target", selected ? "selected" : ""].filter(Boolean).join(" ")}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        selectSummaryNumberTarget(event.currentTarget, numberKey, label, fallbackValue, min, max, onSelectNumber);
      }}
      title="اضغط لتعديل الرقم"
    >
      {value}
    </span>
  );
}

const defaultCheckmarkOffset: CheckmarkOffset = {
  x: 50,
  y: 50
};

function roundOffset(value: number) {
  return Math.round(value * 10) / 10;
}

function DraggableCheckmark({
  offsetKey,
  settings,
  selected,
  onSelect,
  onChange,
  onToggle
}: {
  offsetKey: string;
  settings: PrintSettings;
  selected: boolean;
  onSelect: (selection: SelectedCheckmark) => void;
  onChange?: PrintSettingsChangeHandler;
  onToggle?: () => void;
}) {
  const offset = settings.checkmarkOffsets[offsetKey] || defaultCheckmarkOffset;
  const editable = Boolean(onChange);
  const movedRef = useRef(false);

  return (
    <span
      className={["checkmark-control", selected ? "selected" : "", editable ? "is-editable" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        left: `${offset.x}%`,
        top: `${offset.y}%`
      }}
      title={editable ? "اسحب علامة الصح داخل الخلية" : undefined}
      onPointerDown={(event) => {
        if (!onChange) return;
        const cell = event.currentTarget.closest(".check-cell") as HTMLElement | null;
        if (!cell) return;

        event.preventDefault();
        event.stopPropagation();
        onSelect({ key: offsetKey });
        movedRef.current = false;

        const cellRect = cell.getBoundingClientRect();
        const markerRect = event.currentTarget.getBoundingClientRect();
        const minX = clamp((markerRect.width / 2 / cellRect.width) * 100, 4, 45);
        const minY = clamp((markerRect.height / 2 / cellRect.height) * 100, 8, 45);
        const maxX = 100 - minX;
        const maxY = 100 - minY;
        const startX = event.clientX;
        const startY = event.clientY;
        const startOffset = settings.checkmarkOffsets[offsetKey] || defaultCheckmarkOffset;
        let lastOffset: CheckmarkOffset | null = null;

        const move = (moveEvent: PointerEvent) => {
          moveEvent.preventDefault();
          if (Math.abs(moveEvent.clientX - startX) > 2 || Math.abs(moveEvent.clientY - startY) > 2) {
            movedRef.current = true;
          }
          const deltaX = ((moveEvent.clientX - startX) / cellRect.width) * 100;
          const deltaY = ((moveEvent.clientY - startY) / cellRect.height) * 100;
          const nextOffset = {
            x: roundOffset(clamp(startOffset.x + deltaX, minX, maxX)),
            y: roundOffset(clamp(startOffset.y + deltaY, minY, maxY))
          };
          lastOffset = nextOffset;
          onChange(
            {
              checkmarkOffsets: {
                ...settings.checkmarkOffsets,
                [offsetKey]: nextOffset
              }
            },
            { persist: false }
          );
        };

        const up = () => {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          if (!movedRef.current && onToggle) {
            onToggle();
            return;
          }
          if (lastOffset) {
            onChange(
              {
                checkmarkOffsets: {
                  ...settings.checkmarkOffsets,
                  [offsetKey]: lastOffset
                }
              },
              { persist: true }
            );
          }
        };

        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up, { once: true });
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      √
    </span>
  );
}

function SmartRegionHandle({
  region,
  template,
  selected,
  onSelect,
  onChange
}: {
  region: TableRegion;
  template: SmartTemplate;
  selected: boolean;
  onSelect: (selection: SelectedRegion) => void;
  onChange?: SmartTemplateChangeHandler;
}) {
  if (!onChange) return null;

  return (
    <button
      type="button"
      className={["smart-region-handle", selected ? "selected" : ""].filter(Boolean).join(" ")}
      style={{
        top: `${region.topMm}mm`,
        left: `${region.leftMm}mm`
      }}
      title={`اسحب ${region.label}`}
      onPointerDown={(event) => {
        const page = event.currentTarget.closest(".report-page") as HTMLElement | null;
        if (!page) return;

        event.preventDefault();
        event.stopPropagation();
        onSelect({ id: region.id });

        const startPoint = pointOnPage(event, page);
        const startLeft = region.leftMm;
        const startTop = region.topMm;
        let lastTemplate: SmartTemplate | null = null;

        const move = (moveEvent: PointerEvent) => {
          moveEvent.preventDefault();
          const nextPoint = pointOnPage(moveEvent, page);
          const nextRegion = {
            ...region,
            leftMm: roundMm(clamp(startLeft + nextPoint.x - startPoint.x, 0, pageWidthMm - region.widthMm)),
            topMm: roundMm(clamp(startTop + nextPoint.y - startPoint.y, 0, pageHeightMm - region.heightMm))
          };
          lastTemplate = {
            ...template,
            tableRegions: {
              ...template.tableRegions,
              [region.id]: nextRegion
            }
          };
          onChange(lastTemplate, { persist: false });
        };

        const up = () => {
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          if (lastTemplate) {
            onChange(lastTemplate, { persist: true });
          }
        };

        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up, { once: true });
      }}
    >
      {region.label}
    </button>
  );
}

function resizeBox(start: BoxMetrics, deltaX: number, deltaY: number, corner: ResizeCorner, target: EditableTarget) {
  const limits = resizeLimits[target];
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;

  if (corner.includes("e")) {
    right = clamp(start.left + start.width + deltaX, start.left + limits.minWidth, pageWidthMm);
  }
  if (corner.includes("w")) {
    left = clamp(start.left + deltaX, 0, start.left + start.width - limits.minWidth);
  }
  if (corner.includes("s")) {
    bottom = clamp(start.top + start.height + deltaY, start.top + limits.minHeight, pageHeightMm);
  }
  if (corner.includes("n")) {
    top = clamp(start.top + deltaY, 0, start.top + start.height - limits.minHeight);
  }

  if (right - left > limits.maxWidth) {
    if (corner.includes("w")) {
      left = right - limits.maxWidth;
    } else {
      right = left + limits.maxWidth;
    }
  }

  if (bottom - top > limits.maxHeight) {
    if (corner.includes("n")) {
      top = bottom - limits.maxHeight;
    } else {
      bottom = top + limits.maxHeight;
    }
  }

  return {
    left: roundMm(left),
    top: roundMm(top),
    width: roundMm(right - left),
    height: roundMm(bottom - top)
  };
}

function patchForTarget(target: EditableTarget, metrics: BoxMetrics, settings: PrintSettings): Partial<PrintSettings> {
  if (target === "letterhead") {
    return {
      letterheadRightMm: roundMm(pageWidthMm - metrics.left - settings.letterheadWidthMm),
      letterheadTopMm: metrics.top
    };
  }

  if (target === "principalName") {
    const nextFontSize = clamp(
      settings.principalNameFontSizePt * (metrics.height / settings.principalNameHeightMm),
      7,
      28
    );
    return {
      principalNameLeftMm: metrics.left,
      principalNameTopMm: metrics.top,
      principalNameWidthMm: metrics.width,
      principalNameHeightMm: metrics.height,
      principalNameFontSizePt: Math.round(nextFontSize * 10) / 10
    };
  }

  return {
    signatureImageAbsLeftMm: metrics.left,
    signatureImageAbsTopMm: metrics.top,
    signatureImageAbsWidthMm: metrics.width,
    signatureImageAbsHeightMm: metrics.height
  };
}

function beginEditablePointerAction({
  event,
  target,
  mode,
  corner,
  pageKey,
  settings,
  onChange,
  onSelect
}: {
  event: ReactPointerEvent<HTMLElement>;
  target: EditableTarget;
  mode: "move" | "resize";
  corner?: ResizeCorner;
  pageKey: string;
  settings: PrintSettings;
  onChange?: PrintSettingsChangeHandler;
  onSelect: (selection: SelectedEditable) => void;
}) {
  if (!onChange) return;
  const page = event.currentTarget.closest(".report-page") as HTMLElement | null;
  if (!page) return;

  event.preventDefault();
  event.stopPropagation();
  onSelect({ pageKey, target });

  const startPoint = pointOnPage(event, page);
  const startMetrics = metricsForTarget(target, settings);
  let lastPatch: Partial<PrintSettings> | null = null;

  const move = (moveEvent: PointerEvent) => {
    moveEvent.preventDefault();
    const nextPoint = pointOnPage(moveEvent, page);
    const deltaX = nextPoint.x - startPoint.x;
    const deltaY = nextPoint.y - startPoint.y;
    let nextMetrics: BoxMetrics;

    if (mode === "move") {
      nextMetrics = {
        left: roundMm(clamp(startMetrics.left + deltaX, 0, pageWidthMm - startMetrics.width)),
        top: roundMm(clamp(startMetrics.top + deltaY, 0, pageHeightMm - startMetrics.height)),
        width: startMetrics.width,
        height: startMetrics.height
      };
    } else {
      nextMetrics = resizeBox(startMetrics, deltaX, deltaY, corner || "se", target);
    }

    lastPatch = patchForTarget(target, nextMetrics, settings);
    onChange(lastPatch, { persist: false, pageKey });
  };

  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    if (lastPatch) {
      onChange(lastPatch, { persist: true, pageKey });
    }
  };

  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
}

function EditableBox({
  target,
  pageKey,
  className,
  title,
  selected,
  settings,
  onChange,
  onSelect,
  resizable = true,
  textStyleKey,
  textDefaults,
  textOverrides,
  selectedTextKey,
  onSelectText,
  children
}: {
  target: EditableTarget;
  pageKey: string;
  className: string;
  title: string;
  selected: boolean;
  settings: PrintSettings;
  onChange?: PrintSettingsChangeHandler;
  onSelect: (selection: SelectedEditable) => void;
  resizable?: boolean;
  textStyleKey?: string;
  textDefaults?: TextStyleDefaults;
  textOverrides?: Record<string, TextStyleOverride>;
  selectedTextKey?: string;
  onSelectText?: (selection: SelectedText) => void;
  children: ReactNode;
}) {
  const editable = Boolean(onChange);
  const classNames = [
    "editable-control",
    className,
    selected ? "selected" : "",
    textStyleKey && selectedTextKey === textStyleKey ? "text-selected" : "",
    editable ? "is-editable" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      title={editable ? title : undefined}
      onPointerDown={(event) => {
        if (textStyleKey && textDefaults && onSelectText) {
          selectTextTarget(event.currentTarget, textStyleKey, textDefaults, onSelectText);
        }
        beginEditablePointerAction({
          event,
          target,
          mode: "move",
          pageKey,
          settings,
          onChange,
          onSelect
        });
      }}
      style={
        textStyleKey && textOverrides
          ? textOverrideStyle(textOverrides[textStyleKey])
          : undefined
      }
    >
      {children}
      {resizable ? (["nw", "ne", "sw", "se"] as ResizeCorner[]).map((item) => (
        <span
          key={item}
          className={`resize-handle ${item}`}
          onPointerDown={(event) =>
            beginEditablePointerAction({
              event,
              target,
              mode: "resize",
              corner: item,
              pageKey,
              settings,
              onChange,
              onSelect
            })
          }
        />
      )) : null}
    </div>
  );
}

function PageChrome({
  assets,
  settings,
  pageKey,
  printSettings,
  selectedEditable,
  onSelectEditable,
  selectedText,
  onSelectText,
  onPrintSettingsChange,
  children
}: {
  assets: TemplateAssets;
  settings: SchoolSettings;
  pageKey: string;
  printSettings?: Partial<PrintSettings>;
  selectedEditable: SelectedEditable | null;
  onSelectEditable: (selection: SelectedEditable) => void;
  selectedText: SelectedText | null;
  onSelectText: (selection: SelectedText) => void;
  onPrintSettingsChange?: PrintSettingsChangeHandler;
  children: ReactNode;
}) {
  const mergedPrintSettings = settingsForPage(printSettings, pageKey);
  const textOverrides = mergedPrintSettings.textStyleOverrides;
  const letterheadTextStyle: TextStyleDefaults = {
    fontFamily: mergedPrintSettings.fontFamily,
    fontSizePt: mergedPrintSettings.letterheadFontSizePt,
    fontWeight: 700,
    color: mergedPrintSettings.textColor
  };
  const principalTextStyle: TextStyleDefaults = {
    fontFamily: mergedPrintSettings.fontFamily,
    fontSizePt: mergedPrintSettings.principalNameFontSizePt,
    fontWeight: mergedPrintSettings.principalNameFontWeight,
    color: mergedPrintSettings.signatureColor
  };
  const footerTextStyle: TextStyleDefaults = {
    fontFamily: mergedPrintSettings.fontFamily,
    fontSizePt: 16,
    fontWeight: 800,
    color: "#ffffff"
  };
  const pageStyle = {
    "--report-font-family": mergedPrintSettings.fontFamily,
    "--report-font-size": `${mergedPrintSettings.fontSizePt}pt`,
    "--report-font-weight": mergedPrintSettings.textFontWeight,
    "--report-text-color": mergedPrintSettings.textColor,
    "--report-title-font-size": `${mergedPrintSettings.titleFontSizePt}pt`,
    "--report-title-font-weight": mergedPrintSettings.titleFontWeight,
    "--report-title-color": mergedPrintSettings.titleColor,
    "--report-accent-color": mergedPrintSettings.accentColor,
    "--letterhead-top": `${mergedPrintSettings.letterheadTopMm}mm`,
    "--letterhead-right": `${mergedPrintSettings.letterheadRightMm}mm`,
    "--letterhead-width": `${mergedPrintSettings.letterheadWidthMm}mm`,
    "--letterhead-font-size": `${mergedPrintSettings.letterheadFontSizePt}pt`,
    "--principal-name-left": `${mergedPrintSettings.principalNameLeftMm}mm`,
    "--principal-name-top": `${mergedPrintSettings.principalNameTopMm}mm`,
    "--principal-name-width": `${mergedPrintSettings.principalNameWidthMm}mm`,
    "--principal-name-height": `${mergedPrintSettings.principalNameHeightMm}mm`,
    "--principal-name-font-size": `${mergedPrintSettings.principalNameFontSizePt}pt`,
    "--principal-name-font-weight": mergedPrintSettings.principalNameFontWeight,
    "--signature-image-abs-left": `${mergedPrintSettings.signatureImageAbsLeftMm}mm`,
    "--signature-image-abs-top": `${mergedPrintSettings.signatureImageAbsTopMm}mm`,
    "--signature-image-abs-width": `${mergedPrintSettings.signatureImageAbsWidthMm}mm`,
    "--signature-image-abs-height": `${mergedPrintSettings.signatureImageAbsHeightMm}mm`,
    "--signature-left": `${mergedPrintSettings.signatureLeftMm}mm`,
    "--signature-bottom": `${mergedPrintSettings.signatureBottomMm}mm`,
    "--signature-box-width": `${mergedPrintSettings.signatureBoxWidthMm}mm`,
    "--signature-image-left": `${mergedPrintSettings.signatureImageLeftMm}mm`,
    "--signature-image-top": `${mergedPrintSettings.signatureImageTopMm}mm`,
    "--signature-image-width": `${mergedPrintSettings.signatureImageWidthMm}mm`,
    "--signature-font-size": `${mergedPrintSettings.signatureFontSizePt}pt`,
    "--signature-color": mergedPrintSettings.signatureColor
  } as CSSProperties;

  return (
    <section className="report-page" style={pageStyle}>
      {assets.backgroundUrl ? <img className="page-background" src={assets.backgroundUrl} alt="" /> : <FallbackFrame />}
      <EditableBox
        target="letterhead"
        pageKey={pageKey}
        className="letterhead letterhead-control"
        title="اسحب بيانات الوزارة لتحريكها ككتلة واحدة"
        selected={selectedEditable?.pageKey === pageKey && selectedEditable.target === "letterhead"}
        settings={mergedPrintSettings}
        onChange={onPrintSettingsChange}
        onSelect={onSelectEditable}
        resizable={false}
        textStyleKey={`${pageKey}:letterhead`}
        textDefaults={letterheadTextStyle}
        textOverrides={textOverrides}
        selectedTextKey={selectedText?.key}
        onSelectText={onSelectText}
      >
        <div>{settings.country}</div>
        <div>{settings.ministry}</div>
        <div>{settings.department}</div>
        <div>{settings.schoolName}</div>
      </EditableBox>
      {children}
      <EditableBox
        target="principalName"
        pageKey={pageKey}
        className="principal-name-control"
        title="اسحب اسم المديرة للتحريك، أو اسحب الزوايا لتغيير حجمه"
        selected={selectedEditable?.pageKey === pageKey && selectedEditable.target === "principalName"}
        settings={mergedPrintSettings}
        onChange={onPrintSettingsChange}
        onSelect={onSelectEditable}
        textStyleKey={`${pageKey}:principal-name`}
        textDefaults={principalTextStyle}
        textOverrides={textOverrides}
        selectedTextKey={selectedText?.key}
        onSelectText={onSelectText}
      >
        <span>مديرة المدرسة/</span>
        <strong>{settings.principalName}</strong>
      </EditableBox>
      {assets.signatureUrl ? (
        <EditableBox
          target="signatureImage"
          pageKey={pageKey}
          className="signature-image-control"
          title="اسحب التوقيع للتحريك، أو اسحب الزوايا لتغيير حجمه"
          selected={selectedEditable?.pageKey === pageKey && selectedEditable.target === "signatureImage"}
          settings={mergedPrintSettings}
          onChange={onPrintSettingsChange}
          onSelect={onSelectEditable}
        >
          <img src={assets.signatureUrl} alt="توقيع مديرة المدرسة" />
        </EditableBox>
      ) : null}
      <StyleTarget
        as="div"
        className="footer-school"
        styleKey={`${pageKey}:footer-school`}
        defaults={footerTextStyle}
        overrides={textOverrides}
        selected={selectedText?.key === `${pageKey}:footer-school`}
        onSelectText={onSelectText}
      >
        {settings.schoolName}
      </StyleTarget>
    </section>
  );
}

function FallbackFrame() {
  return (
    <div className="fallback-frame" aria-hidden="true">
      <div className="top-strip" />
      <div className="fallback-logo">وزارة التعليم</div>
      <div className="bottom-strip" />
    </div>
  );
}

function formatPercent(value: number) {
  return `%${Number.isFinite(value) ? value : 0}`;
}

function visibleColumns(report: Report) {
  return report.benefitColumns.filter((column) => report.visibleColumnIds.includes(column.id));
}

function benefitColumnWidths(columns: ReturnType<typeof visibleColumns>) {
  if (!columns.length) return [];
  const knownWidths = columns.map((column) => defaultBenefitColumnWidths[column.id]);
  if (knownWidths.every((width) => width)) {
    const total = knownWidths.reduce((sum, width) => sum + width, 0);
    return knownWidths.map((width) => (width / total) * detailColumnWidths.benefitTotal);
  }
  return columns.map(() => detailColumnWidths.benefitTotal / columns.length);
}

function SummaryPage({
  report,
  smartTemplate,
  selectedEditable,
  onSelectEditable,
  selectedRegion,
  onSelectRegion,
  selectedText,
  onSelectText,
  selectedPercentage,
  onSelectPercentage,
  selectedNumber,
  onSelectNumber,
  onPrintSettingsChange,
  onSmartTemplateChange
}: {
  report: Report;
  smartTemplate: SmartTemplate;
  selectedEditable: SelectedEditable | null;
  onSelectEditable: (selection: SelectedEditable) => void;
  selectedRegion: SelectedRegion | null;
  onSelectRegion: (selection: SelectedRegion) => void;
  selectedText: SelectedText | null;
  onSelectText: (selection: SelectedText) => void;
  selectedPercentage: SelectedPercentage | null;
  onSelectPercentage: (selection: SelectedPercentage) => void;
  selectedNumber: SelectedSummaryNumber | null;
  onSelectNumber: (selection: SelectedSummaryNumber) => void;
  onPrintSettingsChange?: PrintSettingsChangeHandler;
  onSmartTemplateChange?: SmartTemplateChangeHandler;
}) {
  const pageKey = "summary";
  const pageSettings = settingsForPage(report.printSettings, pageKey);
  const textOverrides = pageSettings.textStyleOverrides;
  const titleDefaults = {
    fontFamily: pageSettings.fontFamily,
    fontSizePt: pageSettings.titleFontSizePt,
    fontWeight: pageSettings.titleFontWeight,
    color: pageSettings.titleColor
  };
  const bodyDefaults = {
    fontFamily: pageSettings.fontFamily,
    fontSizePt: pageSettings.fontSizePt,
    fontWeight: pageSettings.textFontWeight,
    color: pageSettings.textColor
  };
  const labelDefaults = {
    fontFamily: pageSettings.fontFamily,
    fontSizePt: pageSettings.fontSizePt,
    fontWeight: 700,
    color: pageSettings.accentColor
  };
  const smallLabelDefaults = {
    ...labelDefaults,
    fontSizePt: pageSettings.fontSizePt * 0.54
  };
  const sectionLabelDefaults = {
    ...labelDefaults,
    fontSizePt: pageSettings.fontSizePt * 1.08,
    fontWeight: 500
  };
  const smallBodyDefaults = {
    ...bodyDefaults,
    fontSizePt: pageSettings.fontSizePt * 0.83
  };
  const improvementDefaults = smallBodyDefaults;
  const text = (styleKey: string, children: ReactNode, defaults: TextStyleDefaults = bodyDefaults) => (
    <StyleTarget
      styleKey={`${pageKey}:${styleKey}`}
      defaults={defaults}
      overrides={textOverrides}
      selected={selectedText?.key === `${pageKey}:${styleKey}`}
      onSelectText={onSelectText}
    >
      {children}
    </StyleTarget>
  );
  const percent = (percentKey: string, label: string, fallbackValue: number) => (
    <PercentageTarget
      report={report}
      percentKey={percentKey}
      label={label}
      fallbackValue={fallbackValue}
      selected={selectedPercentage?.key === percentKey}
      onSelectPercentage={onSelectPercentage}
    />
  );
  const number = (numberKey: string, label: string, fallbackValue: number, min: number, max: number) => (
    <SummaryNumberTarget
      report={report}
      numberKey={numberKey}
      label={label}
      fallbackValue={fallbackValue}
      min={min}
      max={max}
      selected={selectedNumber?.key === numberKey}
      onSelectNumber={onSelectNumber}
    />
  );
  const columns = visibleColumns(report);
  const summaryRegion = smartTemplate.tableRegions.summary;
  const strengthsRegion = smartTemplate.tableRegions.strengths;
  const improvementsRegion = smartTemplate.tableRegions.improvements;
  const dataSpan = Math.max(3, columns.length);
  const fillerSpan = Math.max(0, dataSpan - columns.length);
  const splitA = Math.max(1, Math.floor(dataSpan / 3));
  const splitB = Math.max(1, Math.floor(dataSpan / 3));
  const splitC = Math.max(1, dataSpan - splitA - splitB);
  const halfA = Math.max(1, Math.floor(dataSpan / 2));
  const halfB = Math.max(1, dataSpan - halfA - 1);
  return (
    <PageChrome
      assets={{ ...report.templateAssets, ...smartTemplate.assets }}
      settings={report.schoolSettings}
      pageKey={pageKey}
      printSettings={report.printSettings}
      selectedEditable={selectedEditable}
      onSelectEditable={onSelectEditable}
      selectedText={selectedText}
      onSelectText={onSelectText}
      onPrintSettingsChange={onPrintSettingsChange}
    >
      <h1 className="report-title">
        {text("title", `تقرير قياس أثر بعدي لنشاط تطوير مهني (${report.courseTitle})`, titleDefaults)}
      </h1>
      <table className="summary-table" style={regionStyle(summaryRegion)}>
        <colgroup>
          <col className="summary-label-col" style={{ width: `${summaryRegion.labelWidthMm || 70}mm` }} />
          {Array.from({ length: dataSpan }).map((_, index) => (
            <col key={columns[index]?.id ?? `filler-${index}`} />
          ))}
        </colgroup>
        <tbody>
          <tr>
            <th>{text("summary-head-total-teachers", "عدد معلمات المدرسة", labelDefaults)}</th>
            <td colSpan={dataSpan}>
              {number("totalTeachers", "عدد معلمات المدرسة", report.summary.totalTeachers, 0, 200)}
            </td>
          </tr>
          <tr>
            <th>{text("summary-head-participants", "عدد المعلمات المشاركات بالحضور", labelDefaults)}</th>
            <td colSpan={halfA}>
              {number("participantsCount", "عدد المعلمات المشاركات بالحضور", report.summary.participantsCount, 0, 200)}
            </td>
            <th>{text("summary-head-attendance", "النسبة", labelDefaults)}</th>
            <td colSpan={halfB}>{percent("attendance", "النسبة", report.summary.attendancePercentage)}</td>
          </tr>
          <tr>
            <th>{text("summary-head-lessons", "عدد الدروس التطبيقية المنفذة بالمدرسة", labelDefaults)}</th>
            <td colSpan={dataSpan}>
              {number("implementedLessons", "عدد الدروس التطبيقية المنفذة بالمدرسة", report.summary.implementedLessons, 0, 500)}
            </td>
          </tr>
          <tr>
            <th>{text("summary-head-impact", "ملخص نتائج قياس الأثر", labelDefaults)}</th>
            <td colSpan={dataSpan}>{text("summary-value-impact", report.summary.impactSummary)}</td>
          </tr>
          <tr>
            <th rowSpan={2}>
              {text("summary-head-contribution", "مدى مساهمة الدروس التطبيقية في تطوير أدائك التدريسي", labelDefaults)}
            </th>
            <th colSpan={splitA}>{text("summary-contribution-high-label", "تساهم بدرجة عالية", labelDefaults)}</th>
            <th colSpan={splitB}>{text("summary-contribution-medium-label", "تساهم بدرجة متوسطة", labelDefaults)}</th>
            <th colSpan={splitC}>{text("summary-contribution-low-label", "تساهم بدرجة منخفضة", labelDefaults)}</th>
          </tr>
          <tr>
            <td colSpan={splitA}>
              {percent("contributionHigh", "تساهم بدرجة عالية", report.summary.contributionHighPercent)}
            </td>
            <td colSpan={splitB}>
              {percent("contributionMedium", "تساهم بدرجة متوسطة", report.summary.contributionMediumPercent)}
            </td>
            <td colSpan={splitC}>
              {percent("contributionLow", "تساهم بدرجة منخفضة", report.summary.contributionLowPercent)}
            </td>
          </tr>
          <tr>
            <th>{text("summary-head-effectiveness", "فعالية مدى فعالية الأساليب المستخدمة في تنفيذ الدروس التطبيقية", labelDefaults)}</th>
            <td colSpan={dataSpan}>
              {percent("effectiveness", "فعالية الأساليب المستخدمة", report.summary.effectivenessHighPercent)}
            </td>
          </tr>
          <tr>
            <th rowSpan={2}>{text("summary-head-benefits", "مجالات الاستفادة", labelDefaults)}</th>
            {columns.map((column) => (
              <th className="benefit-head" key={column.id}>
                {text(`summary-benefit-label-${column.id}`, column.label, smallLabelDefaults)}
              </th>
            ))}
            {fillerSpan ? <th colSpan={fillerSpan} className="benefit-head" /> : null}
          </tr>
          <tr>
            {columns.map((column) => (
              <td key={column.id}>
                {percent(
                  `benefit:${column.id}`,
                  column.label,
                  report.summary.benefitPercentages[column.id] ?? 0
                )}
              </td>
            ))}
            {fillerSpan ? <td colSpan={fillerSpan} /> : null}
          </tr>
        </tbody>
      </table>

      <section className="narrative-section strengths-section" style={regionStyle(strengthsRegion)}>
        <h2>{text("strengths-title", "نقاط القوة", sectionLabelDefaults)}</h2>
        <div>
          {report.strengths.map((item, index) => (
            <p key={`${item}-${index}`}>{text(`strength-${index}`, item, smallBodyDefaults)}</p>
          ))}
        </div>
      </section>

      <section className="narrative-section improvements-section" style={regionStyle(improvementsRegion)}>
        <h2>{text("improvements-title", "فرص التحسين", sectionLabelDefaults)}</h2>
        <div>
          {report.improvements.map((item, index) => (
            <p key={`${item}-${index}`}>{text(`improvement-${index}`, item, improvementDefaults)}</p>
          ))}
        </div>
      </section>
    </PageChrome>
  );
}

function DetailPage({
  report,
  smartTemplate,
  rows,
  pageIndex,
  rowsPerPage,
  selectedEditable,
  onSelectEditable,
  selectedRegion,
  onSelectRegion,
  selectedText,
  onSelectText,
  selectedCheckmark,
  onSelectCheckmark,
  onReportChange,
  onPrintSettingsChange,
  onSmartTemplateChange
}: {
  report: Report;
  smartTemplate: SmartTemplate;
  rows: ReportRow[];
  pageIndex: number;
  rowsPerPage: number;
  selectedEditable: SelectedEditable | null;
  onSelectEditable: (selection: SelectedEditable) => void;
  selectedRegion: SelectedRegion | null;
  onSelectRegion: (selection: SelectedRegion) => void;
  selectedText: SelectedText | null;
  onSelectText: (selection: SelectedText) => void;
  selectedCheckmark: SelectedCheckmark | null;
  onSelectCheckmark: (selection: SelectedCheckmark) => void;
  onReportChange?: ReportChangeHandler;
  onPrintSettingsChange?: PrintSettingsChangeHandler;
  onSmartTemplateChange?: SmartTemplateChangeHandler;
}) {
  const pageKey = `detail-${pageIndex}`;
  const pageSettings = settingsForPage(report.printSettings, pageKey);
  const textOverrides = pageSettings.textStyleOverrides;
  const titleDefaults = {
    fontFamily: pageSettings.fontFamily,
    fontSizePt: pageSettings.titleFontSizePt * 0.91,
    fontWeight: pageSettings.titleFontWeight,
    color: pageSettings.titleColor
  };
  const headDefaults = {
    fontFamily: pageSettings.fontFamily,
    fontSizePt: pageSettings.fontSizePt * 0.57,
    fontWeight: 800,
    color: pageSettings.accentColor
  };
  const cellDefaults = {
    fontFamily: pageSettings.fontFamily,
    fontSizePt: pageSettings.fontSizePt * 0.57,
    fontWeight: pageSettings.textFontWeight,
    color: pageSettings.textColor
  };
  const text = (styleKey: string, children: ReactNode, defaults: TextStyleDefaults = cellDefaults) => (
    <StyleTarget
      styleKey={`${pageKey}:${styleKey}`}
      defaults={defaults}
      overrides={textOverrides}
      selected={selectedText?.key === `${pageKey}:${styleKey}`}
      onSelectText={onSelectText}
    >
      {children}
    </StyleTarget>
  );
  const columns = visibleColumns(report);
  const benefitWidths = benefitColumnWidths(columns);
  const detailRegion = smartTemplate.tableRegions.details;
  const start = pageIndex * rowsPerPage;
  const updateContribution = (absoluteIndex: number, contribution: string) => {
    if (!onReportChange) return;
    onReportChange({
      rows: report.rows.map((row, index) => (index === absoluteIndex ? { ...row, contribution } : row))
    });
  };
  const updateLessonsCount = (absoluteIndex: number, value: number) => {
    if (!onReportChange) return;
    const lessonsCount = clamp(Math.round(Number.isFinite(value) ? value : 0), 0, 999);
    onReportChange({
      rows: report.rows.map((row, index) => (index === absoluteIndex ? { ...row, lessonsCount } : row))
    });
  };
  const updateAcquiredSkills = (absoluteIndex: number, acquiredSkills: string, persist = true) => {
    if (!onReportChange) return;
    onReportChange(
      {
        rows: report.rows.map((row, index) => (index === absoluteIndex ? { ...row, acquiredSkills } : row))
      },
      { persist }
    );
  };
  const toggleBenefit = (absoluteIndex: number, columnId: string) => {
    if (!onReportChange) return;
    onReportChange({
      rows: report.rows.map((row, index) =>
        index === absoluteIndex
          ? {
              ...row,
              benefits: {
                ...row.benefits,
                [columnId]: !Boolean(row.benefits[columnId])
              }
            }
          : row
      )
    });
  };
  return (
    <PageChrome
      assets={{ ...report.templateAssets, ...smartTemplate.assets }}
      settings={report.schoolSettings}
      pageKey={pageKey}
      printSettings={report.printSettings}
      selectedEditable={selectedEditable}
      onSelectEditable={onSelectEditable}
      selectedText={selectedText}
      onSelectText={onSelectText}
      onPrintSettingsChange={onPrintSettingsChange}
    >
      <h1 className="report-title detail-title">
        {text("title", `${pageIndex === 0 ? "تابع " : ""}تقرير قياس أثر بعدي لنشاط تطوير مهني (${report.courseTitle})`, titleDefaults)}
      </h1>
      <table className="details-table" style={regionStyle(detailRegion)}>
        <colgroup>
          <col style={{ width: `${detailColumnWidths.number}mm` }} />
          <col style={{ width: `${detailColumnWidths.name}mm` }} />
          <col style={{ width: `${detailColumnWidths.lessons}mm` }} />
          <col style={{ width: `${detailColumnWidths.contribution}mm` }} />
          <col style={{ width: `${detailColumnWidths.effectiveness}mm` }} />
          {columns.map((column, index) => (
            <col key={column.id} style={{ width: `${benefitWidths[index]}mm` }} />
          ))}
          <col style={{ width: `${detailColumnWidths.skills}mm` }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} className="number-cell">
              {text("head-number", "م", headDefaults)}
            </th>
            <th rowSpan={2} className="name-cell">
              {text("head-name", "الاسم", headDefaults)}
            </th>
            <th rowSpan={2} className="lessons-cell">
              {text("head-lessons", "عدد الدروس التطبيقية التي حضرتها", headDefaults)}
            </th>
            <th rowSpan={2} className="rating-cell contribution-cell">
              {text("head-contribution", "مدى مساهمة الدروس التطبيقية في تطوير أدائك التدريسي", headDefaults)}
            </th>
            <th rowSpan={2} className="rating-cell effectiveness-cell">
              {text("head-effectiveness", "ما فعالية مدى فعالية الأساليب المستخدمة في تنفيذ الدروس التطبيقية", headDefaults)}
            </th>
            <th colSpan={columns.length} className="benefit-group">
              {text("head-benefits", "حددي المجالات التي استفدت منها في الدروس التطبيقية", headDefaults)}
            </th>
            <th rowSpan={2} className="skills-cell">
              {text("head-skills", "المهارات والقدرات المكتسبة التي نفذتها بعد حضور الدروس التطبيقية", headDefaults)}
            </th>
          </tr>
          <tr>
            {columns.map((column) => (
              <th className="vertical-head" key={column.id}>
                <span>{text(`head-benefit-${column.id}`, column.label, { ...headDefaults, fontSizePt: 5.3 })}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const absoluteIndex = start + index;
            const contribution = normalizedContribution(row.contribution);
            const tone = contributionTone(contribution);
            return (
              <tr key={row.teacherId || `${row.teacherName}-${index}`}>
                <td className="number-cell">{text(`row-${absoluteIndex}-number`, absoluteIndex + 1)}</td>
                <td className="name-cell">{text(`row-${absoluteIndex}-name`, row.teacherName)}</td>
                <td className="lessons-cell">
                  <input
                    className="lessons-count-input"
                    type="number"
                    min={0}
                    max={999}
                    step={1}
                    value={row.lessonsCount}
                    aria-label={`عدد الدروس التطبيقية التي حضرتها - ${row.teacherName}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => updateLessonsCount(absoluteIndex, Number(event.currentTarget.value))}
                    onBlur={(event) => updateLessonsCount(absoluteIndex, Number(event.currentTarget.value))}
                  />
                </td>
                <td className={`rating-cell contribution-cell contribution-${tone}`}>
                  <select
                    className="contribution-select"
                    value={contribution}
                    aria-label={`مدى مساهمة الدروس التطبيقية - ${row.teacherName}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => updateContribution(absoluteIndex, event.currentTarget.value)}
                  >
                    <option value={contributionOptions.high}>{contributionOptions.high}</option>
                    <option value={contributionOptions.medium}>{contributionOptions.medium}</option>
                  </select>
                </td>
                <td className="rating-cell effectiveness-cell">
                  {text(`row-${absoluteIndex}-effectiveness`, row.effectiveness)}
                </td>
                {columns.map((column) => {
                  const checkmarkKey = `${pageKey}:teacher-${row.teacherId || absoluteIndex}:benefit-${column.id}`;
                  const checked = Boolean(row.benefits[column.id]);
                  return (
                    <td
                      className={["check-cell", checked ? "is-checked" : "is-empty", onReportChange ? "is-clickable" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      key={column.id}
                      role={onReportChange ? "button" : undefined}
                      tabIndex={onReportChange ? 0 : undefined}
                      aria-pressed={checked}
                      title={checked ? "اضغط لإزالة علامة الصح" : "اضغط لإضافة علامة صح"}
                      onClick={() => toggleBenefit(absoluteIndex, column.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleBenefit(absoluteIndex, column.id);
                        }
                      }}
                    >
                      {checked ? (
                        <DraggableCheckmark
                          offsetKey={checkmarkKey}
                          settings={pageSettings}
                          selected={selectedCheckmark?.key === checkmarkKey}
                          onSelect={onSelectCheckmark}
                          onChange={onPrintSettingsChange}
                          onToggle={() => toggleBenefit(absoluteIndex, column.id)}
                        />
                      ) : null}
                    </td>
                  );
                })}
                <td className="skills-cell">
                  <EditableSkillsText
                    value={row.acquiredSkills}
                    label={`المهارات والقدرات المكتسبة - ${row.teacherName}`}
                    onChange={(value, persist) => updateAcquiredSkills(absoluteIndex, value, persist)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PageChrome>
  );
}

function TextStyleToolbar({
  selectedText,
  printSettings,
  onPrintSettingsChange
}: {
  selectedText: SelectedText | null;
  printSettings?: Partial<PrintSettings>;
  onPrintSettingsChange?: PrintSettingsChangeHandler;
}) {
  if (!selectedText || !onPrintSettingsChange) return null;

  const mergedPrintSettings = {
    ...defaultPrintSettings,
    ...printSettings,
    textStyleOverrides: {
      ...defaultPrintSettings.textStyleOverrides,
      ...printSettings?.textStyleOverrides
    }
  };
  const currentOverride = mergedPrintSettings.textStyleOverrides[selectedText.key] || {};
  const current = {
    ...selectedText.defaults,
    ...currentOverride
  };
  const updateOverride = (patch: TextStyleOverride) => {
    onPrintSettingsChange({
      textStyleOverrides: {
        ...mergedPrintSettings.textStyleOverrides,
        [selectedText.key]: {
          ...currentOverride,
          ...patch
        }
      }
    });
  };
  const resetOverride = () => {
    const nextOverrides = { ...mergedPrintSettings.textStyleOverrides };
    delete nextOverrides[selectedText.key];
    onPrintSettingsChange({ textStyleOverrides: nextOverrides });
  };

  return (
    <div
      className="text-style-toolbar"
      style={{
        top: `${selectedText.rect.top}px`,
        left: `${selectedText.rect.left}px`
      }}
      onPointerDown={(event) => event.stopPropagation()}
      dir="rtl"
    >
      <label>
        نوع الخط
        <select value={current.fontFamily} onChange={(event) => updateOverride({ fontFamily: event.target.value })}>
          {fontFamilyOptions.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        الوزن
        <select
          value={current.fontWeight}
          onChange={(event) => updateOverride({ fontWeight: Number(event.target.value) })}
        >
          {fontWeightOptions.map((weight) => (
            <option key={weight.value} value={weight.value}>
              {weight.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        الحجم
        <input
          type="number"
          min={4}
          max={32}
          step={0.5}
          value={Math.round(current.fontSizePt * 10) / 10}
          onChange={(event) => updateOverride({ fontSizePt: Number(event.target.value) })}
        />
      </label>
      <label>
        اللون
        <input type="color" value={current.color} onChange={(event) => updateOverride({ color: event.target.value })} />
      </label>
      <button type="button" onClick={resetOverride}>
        إعادة ضبط النص
      </button>
    </div>
  );
}

function PercentageToolbar({
  selectedPercentage,
  report,
  onReportChange
}: {
  selectedPercentage: SelectedPercentage | null;
  report?: Report;
  onReportChange?: ReportChangeHandler;
}) {
  if (!selectedPercentage || !report || !onReportChange) return null;

  const overrides = { ...report.percentageOverrides };
  const currentValue = clampPercentage(
    Number.isFinite(overrides[selectedPercentage.key])
      ? overrides[selectedPercentage.key]
      : selectedPercentage.fallbackValue
  );
  const updateValue = (value: number, persist = false) => {
    onReportChange(
      {
        percentageOverrides: {
          ...overrides,
          [selectedPercentage.key]: clampPercentage(value)
        }
      },
      { persist }
    );
  };
  const resetValue = () => {
    const nextOverrides = { ...overrides };
    delete nextOverrides[selectedPercentage.key];
    onReportChange({ percentageOverrides: nextOverrides });
  };

  return (
    <div
      className="percentage-toolbar"
      style={{
        top: `${selectedPercentage.rect.top}px`,
        left: `${selectedPercentage.rect.left}px`
      }}
      onPointerDown={(event) => event.stopPropagation()}
      dir="rtl"
    >
      <div className="percentage-toolbar-header">
        <span>{selectedPercentage.label}</span>
        <strong>{formatPercent(currentValue)}</strong>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={currentValue}
        onChange={(event) => updateValue(Number(event.target.value), false)}
        onPointerUp={(event) => updateValue(Number(event.currentTarget.value), true)}
        onBlur={(event) => updateValue(Number(event.currentTarget.value), true)}
      />
      <div className="percentage-toolbar-actions">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={currentValue}
          onChange={(event) => updateValue(Number(event.target.value), false)}
          onBlur={(event) => updateValue(Number(event.currentTarget.value), true)}
        />
        <button type="button" onClick={resetValue}>
          إعادة النسبة
        </button>
      </div>
    </div>
  );
}

function SummaryNumberToolbar({
  selectedNumber,
  report,
  onReportChange
}: {
  selectedNumber: SelectedSummaryNumber | null;
  report?: Report;
  onReportChange?: ReportChangeHandler;
}) {
  if (!selectedNumber || !report || !onReportChange) return null;

  const overrides = { ...report.summaryNumberOverrides };
  const currentValue = clampSummaryNumber(
    Number.isFinite(overrides[selectedNumber.key]) ? overrides[selectedNumber.key] : selectedNumber.fallbackValue,
    selectedNumber.min,
    selectedNumber.max
  );
  const updateValue = (value: number, persist = false) => {
    onReportChange(
      {
        summaryNumberOverrides: {
          ...overrides,
          [selectedNumber.key]: clampSummaryNumber(value, selectedNumber.min, selectedNumber.max)
        }
      },
      { persist }
    );
  };
  const resetValue = () => {
    const nextOverrides = { ...overrides };
    delete nextOverrides[selectedNumber.key];
    onReportChange({ summaryNumberOverrides: nextOverrides });
  };

  return (
    <div
      className="number-toolbar"
      style={{
        top: `${selectedNumber.rect.top}px`,
        left: `${selectedNumber.rect.left}px`
      }}
      onPointerDown={(event) => event.stopPropagation()}
      dir="rtl"
    >
      <div className="number-toolbar-header">
        <span>{selectedNumber.label}</span>
        <strong>{currentValue}</strong>
      </div>
      <input
        type="range"
        min={selectedNumber.min}
        max={selectedNumber.max}
        step={1}
        value={currentValue}
        onChange={(event) => updateValue(Number(event.target.value), false)}
        onPointerUp={(event) => updateValue(Number(event.currentTarget.value), true)}
        onBlur={(event) => updateValue(Number(event.currentTarget.value), true)}
      />
      <div className="number-toolbar-actions">
        <input
          type="number"
          min={selectedNumber.min}
          max={selectedNumber.max}
          step={1}
          value={currentValue}
          onChange={(event) => updateValue(Number(event.target.value), false)}
          onBlur={(event) => updateValue(Number(event.currentTarget.value), true)}
        />
        <button type="button" onClick={resetValue}>
          إعادة الرقم
        </button>
      </div>
    </div>
  );
}

export default function ReportPreview({
  report,
  onPrintSettingsChange,
  onReportChange,
  onSmartTemplateChange
}: {
  report?: Report;
  onPrintSettingsChange?: PrintSettingsChangeHandler;
  onReportChange?: ReportChangeHandler;
  onSmartTemplateChange?: SmartTemplateChangeHandler;
}) {
  const [selectedEditable, setSelectedEditable] = useState<SelectedEditable | null>(null);
  const [selectedText, setSelectedText] = useState<SelectedText | null>(null);
  const [selectedPercentage, setSelectedPercentage] = useState<SelectedPercentage | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<SelectedSummaryNumber | null>(null);
  const [selectedCheckmark, setSelectedCheckmark] = useState<SelectedCheckmark | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<SelectedRegion | null>(null);

  const selectEditable = (selection: SelectedEditable) => {
    setSelectedEditable(selection);
    setSelectedRegion(null);
    setSelectedPercentage(null);
    setSelectedNumber(null);
    setSelectedCheckmark(null);
  };
  const selectText = (selection: SelectedText) => {
    setSelectedEditable(null);
    setSelectedRegion(null);
    setSelectedText(selection);
    setSelectedPercentage(null);
    setSelectedNumber(null);
    setSelectedCheckmark(null);
  };
  const selectPercentage = (selection: SelectedPercentage) => {
    setSelectedEditable(null);
    setSelectedRegion(null);
    setSelectedText(null);
    setSelectedCheckmark(null);
    setSelectedNumber(null);
    setSelectedPercentage(selection);
  };
  const selectNumber = (selection: SelectedSummaryNumber) => {
    setSelectedEditable(null);
    setSelectedRegion(null);
    setSelectedText(null);
    setSelectedPercentage(null);
    setSelectedCheckmark(null);
    setSelectedNumber(selection);
  };
  const selectCheckmark = (selection: SelectedCheckmark) => {
    setSelectedEditable(null);
    setSelectedRegion(null);
    setSelectedText(null);
    setSelectedPercentage(null);
    setSelectedNumber(null);
    setSelectedCheckmark(selection);
  };
  const selectRegion = (selection: SelectedRegion) => {
    setSelectedEditable(null);
    setSelectedText(null);
    setSelectedPercentage(null);
    setSelectedNumber(null);
    setSelectedCheckmark(null);
    setSelectedRegion(selection);
  };

  useEffect(() => {
    const clearSelection = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(".editable-control") ||
          target.closest(".text-style-target") ||
          target.closest(".text-style-toolbar") ||
          target.closest(".percentage-target") ||
          target.closest(".percentage-toolbar") ||
          target.closest(".summary-number-target") ||
          target.closest(".number-toolbar") ||
          target.closest(".smart-region-handle") ||
          target.closest(".checkmark-control"))
      ) {
        return;
      }
      setSelectedEditable(null);
      setSelectedRegion(null);
      setSelectedText(null);
      setSelectedPercentage(null);
      setSelectedNumber(null);
      setSelectedCheckmark(null);
    };

    document.addEventListener("pointerdown", clearSelection);
    return () => document.removeEventListener("pointerdown", clearSelection);
  }, []);

  if (!report) {
    return (
      <div className="preview-empty">
        <div>لا يوجد تقرير للمعاينة</div>
      </div>
    );
  }
  const smartTemplate = smartTemplateForReport(report);
  const rowsPerPage = rowsPerPageForTemplate(smartTemplate);

  return (
    <div className="print-zone" dir="rtl">
      <SummaryPage
        report={report}
        smartTemplate={smartTemplate}
        selectedEditable={selectedEditable}
        onSelectEditable={selectEditable}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
        selectedText={selectedText}
        onSelectText={selectText}
        selectedPercentage={selectedPercentage}
        onSelectPercentage={selectPercentage}
        selectedNumber={selectedNumber}
        onSelectNumber={selectNumber}
        onPrintSettingsChange={onPrintSettingsChange}
        onSmartTemplateChange={onSmartTemplateChange}
      />
      {chunkRows(report.rows, rowsPerPage).map((rows, index) => (
        <DetailPage
          key={index}
          report={report}
          smartTemplate={smartTemplate}
          rows={rows}
          pageIndex={index}
          rowsPerPage={rowsPerPage}
          selectedEditable={selectedEditable}
          onSelectEditable={selectEditable}
          selectedRegion={selectedRegion}
          onSelectRegion={selectRegion}
          selectedText={selectedText}
          onSelectText={selectText}
          selectedCheckmark={selectedCheckmark}
          onSelectCheckmark={selectCheckmark}
          onReportChange={onReportChange}
          onPrintSettingsChange={onPrintSettingsChange}
          onSmartTemplateChange={onSmartTemplateChange}
        />
      ))}
      <TextStyleToolbar
        selectedText={selectedText}
        printSettings={report.printSettings}
        onPrintSettingsChange={onPrintSettingsChange}
      />
      <PercentageToolbar
        selectedPercentage={selectedPercentage}
        report={report}
        onReportChange={onReportChange}
      />
      <SummaryNumberToolbar
        selectedNumber={selectedNumber}
        report={report}
        onReportChange={onReportChange}
      />
    </div>
  );
}
