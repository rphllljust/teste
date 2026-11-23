/**
 * Tipos e regras de apresentação para ações empresariais.
 *
 * Este catálogo descreve a experiência no frontend; não concede autorização
 * e não substitui a validação do backend.
 */

export type EnterpriseObjectType =
  | 'client' | 'proposal' | 'contract' | 'service-request' | 'purchase'
  | 'work-order' | 'resource' | 'equipment' | 'vehicle' | 'measurement'
  | 'invoice' | 'payable' | 'fiscal-document' | 'accounting-entry' | (string & {});

export type EnterpriseActionState = string;

export type EnterprisePermission = string;

export type EnterprisePreconditionContext = {
  objectType: EnterpriseObjectType;
  state?: EnterpriseActionState | null;
  permissions?: readonly EnterprisePermission[];
  values?: Readonly<Record<string, unknown>>;
};

export type EnterprisePrecondition = {
  id: string;
  label: string;
  evaluate: (context: EnterprisePreconditionContext) => boolean;
};

export type EnterpriseConfirmation = {
  required: boolean;
  title?: string;
  message?: string;
  destructive?: boolean;
};

export type EnterpriseEndpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  operation: string;
};

export type EnterpriseUpdatePolicy = {
  invalidate: readonly string[];
  refetch?: readonly string[];
  navigateTo?: 'same-object' | 'related-object' | 'list' | 'none';
  preserveContext?: boolean;
};

export type EnterpriseActionDefinition = {
  id: string;
  label: string;
  objectType: EnterpriseObjectType;
  eligibleStates?: readonly EnterpriseActionState[];
  requiredPermissions?: readonly EnterprisePermission[];
  preconditions?: readonly EnterprisePrecondition[];
  confirmation?: EnterpriseConfirmation;
  endpoint: EnterpriseEndpoint;
  updatePolicy: EnterpriseUpdatePolicy;
};

export type EnterpriseActionEvaluation = {
  visible: boolean;
  enabled: boolean;
  reasons: readonly string[];
};

export function evaluateEnterpriseAction(
  action: EnterpriseActionDefinition,
  context: EnterprisePreconditionContext,
): EnterpriseActionEvaluation {
  const reasons: string[] = [];
  const visible = context.objectType === action.objectType;
  if (!visible) reasons.push('A ação não pertence a este tipo de objeto.');

  const stateEligible = !action.eligibleStates?.length || action.eligibleStates.includes(context.state ?? '');
  if (!stateEligible) reasons.push('O estado atual não permite esta ação.');

  const permissions = new Set(context.permissions ?? []);
  const permissionsPresent = (action.requiredPermissions ?? []).every((permission) => permissions.has(permission));
  if (!permissionsPresent) reasons.push('As permissões necessárias não estão presentes no contexto.');

  const failed = (action.preconditions ?? []).filter((precondition) => !precondition.evaluate(context));
  reasons.push(...failed.map((precondition) => precondition.label));

  return { visible, enabled: visible && stateEligible && permissionsPresent && failed.length === 0, reasons };
}

export function isEnterpriseActionVisible(action: EnterpriseActionDefinition, context: EnterprisePreconditionContext): boolean {
  return evaluateEnterpriseAction(action, context).visible;
}

export function isEnterpriseActionEnabled(action: EnterpriseActionDefinition, context: EnterprisePreconditionContext): boolean {
  return evaluateEnterpriseAction(action, context).enabled;
}
