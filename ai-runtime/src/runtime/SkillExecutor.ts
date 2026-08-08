import type { FlowProject } from "../../../../domain/flow/types.ts";
import { AiRuntimeError } from "../errors.ts";
export function findSkill(project: Pick<FlowProject, "skills">, id: string) { const skill = project.skills.find((item) => item.id === id); if (!skill) throw new AiRuntimeError("SKILL_NOT_FOUND", `Skill not found: ${id}`); return skill; }
