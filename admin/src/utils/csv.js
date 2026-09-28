// CSV export shared by the Logs and Financial screens.

// Spreadsheet apps execute a cell that starts with = + - or @. Exported text
// carries names people typed, so neutralise it.
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

// Numbers stay numbers: a leading minus on an amount is data, not a formula,
// and quoting it would make the spreadsheet read it as text.
export function csvNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '""';
}

// header: string[]; rows: already-encoded cells. The BOM makes Excel read the
// file as UTF-8, so accented names survive; CRLF is what it expects.
export function csvText(header, rows) {
  return `﻿${[header.join(","), ...rows.map((cells) => cells.join(","))].join("\r\n")}`;
}

export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
