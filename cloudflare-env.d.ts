declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CONNECTORS?: import("./lib/connector-contract.mts").ConnectorBinding;
  }
}
