/** 输出格式：stdout 只放结果（--json 时为结构化数据），解释性文字走 stderr。 */

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/** 中英混排显示宽度：CJK 字符按 2 列计。 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[ᄀ-ᅟ⺀-鿿가-힯豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  }
  return w;
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ""))));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join("  ").trimEnd();
  const sep = widths.map((w) => "-".repeat(Math.min(w, 60))).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}
