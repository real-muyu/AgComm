import type { RuntimeInputField, RuntimeInputRequest } from "./renderer.ts";

type FormIo = { ask(prompt: string, signal: AbortSignal): Promise<string>; write(value: string): void; text(value: unknown): string; valueText(value: unknown): string };
const selectedButton = (fields: RuntimeInputField[], values: Readonly<Record<string, unknown>>) => fields.findIndex((field) => Object.hasOwn(values, field.variable) && String(values[field.variable]) === String(field.buttonValue ?? "true"));

async function checkbox(field: RuntimeInputField, values: Record<string, unknown>, request: RuntimeInputRequest, io: FormIo) {
  const selected = values[field.variable] === true || String(values[field.variable]).toLowerCase() === "true" || values[field.variable] === 1;
  for (;;) {
    const answer = (await io.ask(`${io.text(field.label)} (${io.text(field.variable)}) [${selected ? "Y/n" : "y/N"}]: `, request.signal)).trim().toLowerCase();
    if (!answer) { values[field.variable] = selected; return; }
    if (["y", "yes", "1", "true"].includes(answer)) { values[field.variable] = true; return; }
    if (["n", "no", "0", "false"].includes(answer)) { values[field.variable] = false; return; }
    io.write("请输入 y/yes/1/true 或 n/no/0/false。\n");
  }
}

async function ordinaryFields(request: RuntimeInputRequest, values: Record<string, unknown>, io: FormIo) {
  for (const field of request.form.fields.filter((item) => item.component !== "button")) {
    const hasCurrent = Object.hasOwn(request.variables, field.variable);
    if (field.component === "checkbox") { await checkbox(field, values, request, io); continue; }
    const current = hasCurrent ? io.valueText(values[field.variable]) : "";
    const suffix = hasCurrent ? ` [${current}]` : field.placeholder ? ` [${io.text(field.placeholder)}]` : "";
    const answer = await io.ask(`${io.text(field.label)} (${io.text(field.variable)}:${io.text(field.variableType)})${suffix}: `, request.signal);
    values[field.variable] = answer === "" && hasCurrent ? values[field.variable] : answer;
  }
}

async function buttonField(request: RuntimeInputRequest, values: Record<string, unknown>, io: FormIo) {
  const buttons = request.form.fields.filter((field) => field.component === "button");
  if (!buttons.length) return;
  const selected = selectedButton(buttons, values);
  for (;;) {
    const answer = (await io.ask(`请选择按钮 1-${buttons.length}${selected >= 0 ? ` [${selected + 1}]` : ""}: `, request.signal)).trim();
    if (!answer && selected >= 0) return;
    const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    if (index >= 0 && index < buttons.length) { const field = buttons[index]; values[field.variable] = field.buttonValue ?? "true"; return; }
    io.write(`请输入 1-${buttons.length} 的编号。\n`);
  }
}

export async function requestLineForm(request: RuntimeInputRequest, values: Record<string, unknown>, io: FormIo) {
  await ordinaryFields(request, values, io);
  await buttonField(request, values, io);
  return values;
}
