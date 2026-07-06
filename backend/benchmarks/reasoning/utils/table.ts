/** Minimal dependency-free console/Markdown table formatter. */
export function toMarkdownTable(headers: string[], rows: (string | number)[][]): string {
  const headerLine = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => `| ${row.join(' | ')} |`);
  return [headerLine, separator, ...rowLines].join('\n');
}
