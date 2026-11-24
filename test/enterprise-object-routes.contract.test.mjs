import assert from "node:assert/strict";
import { test } from "node:test";
import { objectHash, parseObjectHash } from "../lib/navigation/object-routes.ts";

test("object routes round-trip module and object identity", () => {
  const hash = objectHash("Ordens de serviço", "os-123");
  assert.equal(hash, "#Ordens%20de%20servi%C3%A7o/os-123");
  assert.deepEqual(parseObjectHash(hash), { module: "Ordens de serviço", objectId: "os-123" });
});

test("legacy module hashes remain supported", () => {
  assert.deepEqual(parseObjectHash("#Ordens%20de%20servi%C3%A7o"), { module: "Ordens de serviço", objectId: null });
  assert.deepEqual(parseObjectHash(""), { module: "Visão operacional", objectId: null });
});
