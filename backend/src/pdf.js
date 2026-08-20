function escapePdf(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrapLine(value, width = 88) {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function pageCommands(lines, pageIndex) {
  const commands = [];
  let y = 760;
  lines.forEach((line, index) => {
    const size = pageIndex === 0 && index === 0 ? 16 : 10;
    commands.push(`BT /F1 ${size} Tf 50 ${y} Td (${escapePdf(line)}) Tj ET`);
    y -= pageIndex === 0 && index === 0 ? 24 : 16;
  });
  return commands.join("\n");
}

export function renderPdf({ title, lines }) {
  const wrapped = [title, ...lines].flatMap((line) => wrapLine(line));
  const pageSize = 42;
  const pages = [];
  for (let index = 0; index < wrapped.length; index += pageSize) {
    pages.push(wrapped.slice(index, index + pageSize));
  }
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const pageIds = pages.map((_, index) => 3 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const pageObjectId = pageIds[index];
    const contentObjectId = pageObjectId + 1;
    const fontObjectId = 3 + pages.length * 2;
    const commands = pageCommands(page, index);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const chunks = ["%PDF-1.4\n"];
  const offsets = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xref = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return Buffer.from(chunks.join(""));
}
