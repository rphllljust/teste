import type { AvailableCommand } from "../contracts";

export type GovernedAction = {
  id: string;
  label: string;
  objectType: string;
  state: string;
  permission: string;
  precondition: string;
  endpoint: string | null;
  confirmation: "required" | "none";
  refreshPolicy: readonly string[];
  audit: "required";
};

export type ActionContext = {
  objectType: string;
  state: string;
  permission: string;
  endpointByCommand?: Record<string, string>;
};

export function governedActions(
  commands: readonly AvailableCommand[],
  context: ActionContext,
): GovernedAction[] {
  return commands.map((command) => ({
    id: command.id,
    label: command.label,
    objectType: context.objectType,
    state: context.state,
    permission: context.permission,
    precondition: command.requiredInputs?.length
      ? "required-inputs"
      : "state-and-permission",
    endpoint: context.endpointByCommand?.[command.id] ?? null,
    confirmation: command.primary ? "required" : "none",
    refreshPolicy: command.refreshPolicy ?? [],
    audit: "required",
  }));
}

export function canExecuteGovernedAction(
  action: GovernedAction,
  input: { permission: string; state: string; requiredInputsProvided: boolean },
): boolean {
  return action.permission === input.permission
    && action.state === input.state
    && input.requiredInputsProvided;
}
