export type ObjectRoute = { module: string; objectId: string | null };

export function objectHash(module: string, objectId?: string): string {
  const base = "#" + encodeURIComponent(module);
  return objectId ? base + "/" + encodeURIComponent(objectId) : base;
}

export function parseObjectHash(hash: string): ObjectRoute {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [module, objectId] = raw.split("/");
  return {
    module: module ? decodeURIComponent(module) : "Visão operacional",
    objectId: objectId ? decodeURIComponent(objectId) : null,
  };
}
