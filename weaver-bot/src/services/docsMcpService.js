/**
 * Discord docs MCP service.
 *
 * This is intentionally a stub right now. We're greenlit to wire it in,
 * but we still need (per the MVP doc's open questions):
 *   - the MCP server base URL
 *   - the auth scheme (Bearer? OAuth?)
 *   - confirmation of which tools to call:
 *       • search_documentation_discord
 *       • query_docs_filesystem_documentation_discord
 *
 * Once those are confirmed, fill in queryDocs() — every call site already
 * handles a null/empty return, so flipping it on is just env vars and the
 * actual HTTP shape below.
 *
 * Ship Feature 1 with ENABLE_MCP_DRAFT unset; Automated Responses stays dark until ready.
 */
const axios = require("axios");
const logger = require("../utils/logger");

class DocsMcpService {
  constructor() {
    this.baseUrl = process.env.MCP_DOCS_BASE_URL;
    this.authToken = process.env.MCP_DOCS_AUTH_TOKEN;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.authToken);
  }

  /**
   * Returns { text, sources: [{ title, url }] } or null if disabled / fails.
   *
   * Caller is expected to treat null as "no draft to post" and continue normally.
   */
  async queryDocs(query) {
    if (!this.isConfigured()) {
      logger.info("docsMcpService not configured — skipping draft.");
      return null;
    }

    try {
      // TODO(mark/clint): replace with the real MCP tool invocation once
      // the URL and auth shape are confirmed. The body shape below is a
      // placeholder modeled on a typical MCP HTTP transport.
      const res = await axios.post(
        `${this.baseUrl}/tools/search_documentation_discord`,
        { query },
        {
          headers: { Authorization: `Bearer ${this.authToken}` },
          timeout: 20000,
        },
      );

      return {
        text: res.data?.answer ?? "",
        sources: res.data?.sources ?? [],
      };
    } catch (err) {
      logger.error("docsMcpService.queryDocs failed:", err.message);
      return null;
    }
  }
}

module.exports = new DocsMcpService();