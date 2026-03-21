from __future__ import annotations

import re
import zlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PDF_PATH = ROOT / "documents" / "SongBook.pdf"
OUT_PATH = ROOT / "documents" / "SongBook-extracted.md"


@dataclass
class TextRun:
    x: float
    y: float
    text: str


@dataclass
class OutlineEntry:
    title: str
    page_object_number: int
    page_index: int


pdf_bytes = PDF_PATH.read_bytes()
pdf_text = pdf_bytes.decode("latin-1")


def get_object_match(object_number: int) -> re.Match[str]:
    pattern = re.compile(rf"(?ms)(?:^|\r?\n){object_number} 0 obj\s*(.*?)\s*endobj")
    match = pattern.search(pdf_text)
    if not match:
        raise ValueError(f"PDF object {object_number} not found.")
    return match


def get_object_body(object_number: int) -> str:
    return get_object_match(object_number).group(1)


def get_object_stream_text(object_number: int) -> str | None:
    object_match = get_object_match(object_number)
    object_start = object_match.start()
    object_end = object_match.end()

    stream_start = pdf_text.find("stream", object_start)
    if stream_start < 0 or stream_start > object_end:
        return None

    stream_end = pdf_text.find("endstream", stream_start)
    if stream_end < 0 or stream_end > object_end:
        return None

    data_start = stream_start + 6
    while pdf_bytes[data_start] in (10, 13):
        data_start += 1

    data_end = stream_end - 1
    while pdf_bytes[data_end] in (10, 13):
        data_end -= 1

    stream_bytes = pdf_bytes[data_start : data_end + 1]
    return zlib.decompress(stream_bytes).decode("latin-1")


def get_to_unicode_map(object_number: int) -> dict[str, str]:
    cmap = get_object_stream_text(object_number)
    if cmap is None:
        return {}

    mapping: dict[str, str] = {}
    for source, target in re.findall(r"<([0-9A-F]+)>\s*<([0-9A-F]+)>", cmap):
        chars: list[str] = []
        chunk = 4 if len(target) % 4 == 0 else 2
        for i in range(0, len(target), chunk):
            chars.append(chr(int(target[i : i + chunk], 16)))
        mapping[source.upper()] = "".join(chars)
    return mapping


def decode_hex_string(hex_text: str, mapping: dict[str, str]) -> str:
    parts: list[str] = []
    for i in range(0, len(hex_text), 2):
        code = hex_text[i : i + 2].upper()
        if code in mapping:
            parts.append(mapping[code])
    return "".join(parts)


def decode_outline_title(hex_text: str) -> str:
    return "".join(chr(int(hex_text[i : i + 4], 16)) for i in range(0, len(hex_text), 4)).strip()


def get_ordered_lines(runs: list[TextRun], title: str) -> list[str]:
    filtered_runs = [run for run in runs if run.text.strip().lower() != title.strip().lower()]
    if not filtered_runs:
        return []

    column_candidates = sorted((run for run in filtered_runs if run.x < 600), key=lambda run: run.x)
    split_point: float | None = None
    largest_gap = 0.0

    for prev_run, curr_run in zip(column_candidates, column_candidates[1:]):
        gap = curr_run.x - prev_run.x
        if gap > largest_gap:
            largest_gap = gap
            split_point = (curr_run.x + prev_run.x) / 2.0

    if largest_gap >= 140 and split_point is not None:
        left_column = [run for run in filtered_runs if run.x < split_point]
        right_column = [run for run in filtered_runs if run.x >= split_point]

        if len(left_column) >= 4 and len(right_column) >= 4:
            ordered = [run.text for run in sorted(left_column, key=lambda run: (-run.y, run.x))]
            ordered.append("")
            ordered.extend(run.text for run in sorted(right_column, key=lambda run: (-run.y, run.x)))
            return ordered

    return [run.text for run in sorted(filtered_runs, key=lambda run: (-run.y, run.x))]


page_tree = get_object_body(502)
page_object_numbers = [int(number) for number in re.findall(r"(\d+) 0 R", page_tree)]

font_maps = {
    "F1": get_to_unicode_map(506),
    "F2": get_to_unicode_map(511),
}

outline_entries: list[OutlineEntry] = []
outline_pattern = re.compile(r"(?ms)(?:^|\r?\n)(\d+) 0 obj\s*<</Count 0/Title<FEFF([0-9A-F]+)>\s*/Dest\[(\d+) 0 R/XYZ")
for match in outline_pattern.finditer(pdf_text):
    page_object_number = int(match.group(3))
    outline_entries.append(
        OutlineEntry(
            title=decode_outline_title(match.group(2)),
            page_object_number=page_object_number,
            page_index=page_object_numbers.index(page_object_number) + 1,
        )
    )

outline_entries.sort(key=lambda entry: entry.page_index)

song_sections = [
    "# SongBook Extraction",
    "",
    f"Generated from `SongBook.pdf` on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}.",
    "",
]

for entry in outline_entries:
    page_body = get_object_body(entry.page_object_number)
    content_match = re.search(r"/Contents\s+(\d+) 0 R", page_body)
    if not content_match:
        continue

    content_object_number = int(content_match.group(1))
    content_stream = get_object_stream_text(content_object_number)
    if not content_stream:
        continue

    text_runs: list[TextRun] = []

    for block_match in re.finditer(r"(?s)BT\s*(.*?)\s*ET", content_stream):
        block = block_match.group(1)
        position_match = re.search(r"([-\d\.]+)\s+([-\d\.]+)\s+Td", block)
        font_match = re.search(r"/(F\d+)\s+[-\d\.]+\s+Tf", block)

        x = float(position_match.group(1)) if position_match else 0.0
        y = float(position_match.group(2)) if position_match else 0.0
        font_name = font_match.group(1) if font_match else "F1"
        font_map = font_maps[font_name]

        decoded_parts = [
            decode_hex_string(hex_match.group(1), font_map)
            for hex_match in re.finditer(r"<([0-9A-F]+)>", block)
        ]
        text = "".join(decoded_parts).rstrip()
        if not text.strip():
            continue

        text_runs.append(TextRun(x=x, y=y, text=text))

    lines = get_ordered_lines(text_runs, entry.title)

    song_sections.append(f"## {entry.title}")
    song_sections.append("")
    song_sections.append("```text")
    song_sections.extend(lines)
    song_sections.append("```")
    song_sections.append("")

OUT_PATH.write_text("\n".join(song_sections), encoding="utf-8")
print(f"Wrote {OUT_PATH}")
