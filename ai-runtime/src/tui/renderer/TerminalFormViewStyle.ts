export type TerminalFormViewStyle = {
  accent(value: string): string;
  bold(value: string): string;
  muted(value: string): string;
  error(value: string): string;
  header(detail: string): string[];
};
