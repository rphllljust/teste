import assert from "node:assert/strict";
import { test } from "node:test";
import { canExecuteGovernedAction, governedActions } from "../lib/governance/action-catalog.ts";

test("governed actions preserve backend command metadata", () => {
  const actions = governedActions([
    { id: "approve", label: "Aprovar", primary: true, expectedVersion: 4, requiredInputs: [], refreshPolicy: ["object"] },
    { id: "revise", label: "Revisar", primary: false, expectedVersion: 4, requiredInputs: ["reason"], refreshPolicy: ["object", "worklist"] },
  ], { objectType: "measurement", state: "draft", permission: "measurement.approve", endpointByCommand: { approve: "/api/commands" } });
  assert.deepEqual(actions.map((action) => action.id), ["approve", "revise"]);
  assert.equal(actions[0].endpoint, "/api/commands");
  assert.equal(actions[1].precondition, "required-inputs");
  assert.equal(actions[0].audit, "required");
});

test("governed execution fails closed on state, permission or inputs", () => {
  const action = { id: "approve", label: "Aprovar", objectType: "measurement", state: "draft", permission: "measurement.approve", precondition: "state-and-permission", endpoint: "/api/commands", confirmation: "required", refreshPolicy: ["object"], audit: "required" };
  assert.equal(canExecuteGovernedAction(action, { permission: "measurement.approve", state: "draft", requiredInputsProvided: true }), true);
  assert.equal(canExecuteGovernedAction(action, { permission: "measurement.read", state: "draft", requiredInputsProvided: true }), false);
  assert.equal(canExecuteGovernedAction(action, { permission: "measurement.approve", state: "approved", requiredInputsProvided: true }), false);
  assert.equal(canExecuteGovernedAction(action, { permission: "measurement.approve", state: "draft", requiredInputsProvided: false }), false);
});
