#!/usr/bin/env python3
import json
import os
import re
import sys
from pathlib import Path

from pypdf import PdfReader


def clean_text(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip()
    return value.replace(" ى", "ى").replace(" ي", "ي")


def make_teacher(name: str, index: int) -> dict:
    return {
        "id": f"teacher-{index}",
        "name": clean_text(name),
    }


def extract_teachers(text: str) -> list[dict]:
    teachers = []
    for index in range(1, 150):
        pattern = rf"(?:^|\n)\s*{index}\s+(.+?)\s+\d+\s+تساهم"
        match = re.search(pattern, text, flags=re.S)
        if not match:
            if index > 1:
                break
            continue
        name = clean_text(match.group(1))
        name = re.sub(r"\s+", " ", name)
        if name:
            teachers.append(make_teacher(name, index))
    return teachers


def extract_school_settings(text: str) -> dict:
    settings = {}
    if "المملكة العربية السعودية" in text:
        settings["country"] = "المملكة العربية السعودية"
    if "وزارة التعليم" in text:
        settings["ministry"] = "وزارة التعليم"
    department_match = re.search(r"(الإدارة العامة للتعليم[^\n]+)", text)
    if department_match:
        settings["department"] = clean_text(department_match.group(1))
    school_matches = re.findall(r"(الابتدائية[^\n]+الطفولة\s*المبكرة)", text)
    if school_matches:
        settings["schoolName"] = clean_text(school_matches[-1])
    principal_match = re.search(r"مديرة المدرسة\s*/\s*([^\n]+)", text)
    if principal_match:
        settings["principalName"] = clean_text(principal_match.group(1))
    total_match = re.search(r"عدد معلمات المدرسة\s+(\d+)", text)
    if total_match:
        settings["totalTeachers"] = int(total_match.group(1))
    return settings


def save_assets(reader: PdfReader, output_dir: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    assets = {}
    best_background = None
    best_signature = None

    for page in reader.pages:
        for image in page.images:
            data = image.data
            width = getattr(image.image, "width", 0)
            height = getattr(image.image, "height", 0)
            area = width * height
            if area > (best_background[0] if best_background else 0):
                best_background = (area, image)
            if 250 <= width <= 520 and 90 <= height <= 220:
                if area > (best_signature[0] if best_signature else 0):
                    best_signature = (area, image)

    if best_background:
        filename = "template-background.png"
        (output_dir / filename).write_bytes(best_background[1].data)
        assets["backgroundUrl"] = filename

    if best_signature:
        filename = "signature.png"
        (output_dir / filename).write_bytes(best_signature[1].data)
        assets["signatureUrl"] = filename

    return assets


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: import_pdf.py input.pdf output_asset_dir", file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    asset_dir = Path(sys.argv[2])
    reader = PdfReader(str(pdf_path))
    page_texts = [(page.extract_text() or "") for page in reader.pages]
    all_text = "\n".join(page_texts)
    table_text = page_texts[1] if len(page_texts) > 1 else all_text
    result = {
        "teachers": extract_teachers(table_text),
        "templateAssets": save_assets(reader, asset_dir),
        "schoolSettings": extract_school_settings(all_text),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
