const identities = new WeakMap();

/** Test-process-only request identity injection; never derived from HTTP data. */
export function setTestIdentity(request, actorId) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test identity is only available in NODE_ENV=test');
  if (!(request instanceof Request) || typeof actorId !== 'string' || !actorId.trim()) throw new TypeError('Invalid test identity binding');
  identities.set(request, actorId);
  return request;
}

export function getTestIdentity(request) {
  if (process.env.NODE_ENV !== 'test') return undefined;
  return identities.get(request);
}
