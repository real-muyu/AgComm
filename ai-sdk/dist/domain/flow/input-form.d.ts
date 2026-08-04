import type { FlowNode, InputField, InputFormConfig, Variable } from "./types.ts";
export declare function createInputField(variable: Variable, index?: number): InputField;
export declare function readInputForm(node: FlowNode, variables: Variable[]): InputFormConfig;
export declare function writeInputForm(node: FlowNode, form: InputFormConfig): FlowNode;
export declare function collectInputFields(nodes: FlowNode[], variables: Variable[]): InputField[];
