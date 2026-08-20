function escapePdf(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

export function renderPdf({ title, lines }) {
  const cleanLines = [title, ...lines].map((line) => String(line ?? "").slice(0, 115));
  const commands = cleanLines
    .map((line, index) => {
      const size = index === 0 ? 16 : 10;
      const y = 760 - index * 18;
      return `BT /F1 ${size} Tf 50 ${y} Td (${escapePdf(line)}) Tj ET`;
    })
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
  ];
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
