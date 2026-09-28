declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BACKGROUND_IMAGES: R2Bucket;
    // Cloudflare Access in front of /api/ai (team domain, e.g. myteam.cloudflareaccess.com, and the
    // application AUD tags, comma-separated when workers.dev and preview URLs are separate applications).
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    // Secrets set with `wrangler secret put`; never sent to the browser.
    ANTHROPIC_API_KEY?: string;
    OPENAI_API_KEY?: string;
    // Fallback ChatGPT model when the settings card leaves it blank.
    OPENAI_MODEL?: string;
    // Contact email for the User-Agent SEC requires on EDGAR requests.
    SEC_CONTACT?: string;
  }
}
