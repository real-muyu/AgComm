const ESC = "\u001b";
const ANSI_SGR = /\u001b\[[0-9;]*m/g;

export function sanitizeTerminalText(value: unknown, multiline = true): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  return text
    .replace(/\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(multiline ? /\r\n?/g : /[\r\n]+/g, multiline ? "\n" : " ");
}

export function terminalWidth(value: string): number {
  let width = 0;
  for (const char of value.replace(ANSI_SGR, "")) {
    width += /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1;
  }
  return width;
}

export function cropTerminalText(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  let output = "";
  let visible = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] === ESC) {
      const match = /^\u001b\[[0-9;]*m/.exec(value.slice(index));
      if (match) { output += match[0]; index += match[0].length; continue; }
    }
    const point = value.codePointAt(index);
    if (point === undefined) break;
    const char = String.fromCodePoint(point);
    const charWidth = terminalWidth(char);
    if (visible + charWidth > maximum) return maximum > 1 ? `${output}${ESC}[0m…` : "…";
    output += char;
    visible += charWidth;
    index += char.length;
  }
  return output;
}

export function padTerminalText(value: string, length: number): string {
  const text = cropTerminalText(value, length);
  return text + " ".repeat(Math.max(0, length - terminalWidth(text)));
}

export function wrapTerminalText(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const source of value.split("\n")) {
    if (!source) { lines.push(""); continue; }
    let line = "";
    for (const char of source) {
      if (terminalWidth(line + char) > width) { lines.push(line); line = char; }
      else line += char;
    }
    lines.push(line);
  }
  return lines;
}

export function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
