declare namespace Cloudflare {
  interface Env {
    BUCKET?: R2Bucket;
    CONNECTORS?: import("./lib/connector-contract.mts").ConnectorBinding;
  }
}
