// Pool sockets belong to the Worker request that opened them.
// node-postgres maxUses=1 releases the client after each acquisition, while
// database.transaction()/batch() keep one acquired client throughout their
// internal BEGIN/COMMIT lifecycle. Do not silently retain sockets in Railway.
export function workerSafePoolMaxUses(env=process.env){
  const name=env.RAILWAY_ENVIRONMENT_NAME;
  return typeof name==='string'&&name.length>0 ? 1 : 10000;
}
