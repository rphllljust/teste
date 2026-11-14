// Fail closed: a Node.js build must never emulate Cloudflare D1.
//
// This export exists only to let the isolated Node build resolve legacy
// imports while the repository's persistence layer is migrated. If an API
// attempts to use env.DB under Railway it will fail, not return mock data.
export const env: {DB?: never} = Object.freeze({});
