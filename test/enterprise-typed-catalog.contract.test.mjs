import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const catalog=await readFile(new URL("../lib/navigation/catalog.ts",import.meta.url),"utf8");
const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
test("typed catalog is consumed by the shell",()=>{assert.match(catalog,/export const moduleGroups/);assert.match(catalog,/export const moduleItems/);assert.match(page,/moduleGroups/);assert.match(page,/moduleHash/);});
test("catalog has stable unique IDs and supported hash helpers",()=>{const ids=[...catalog.matchAll(/item\("([^"]+)"/g)].map((m)=>m[1]);assert.equal(new Set(ids).size,ids.length);assert.match(catalog,/encodeURIComponent/);assert.match(catalog,/moduleFromHash/);});
