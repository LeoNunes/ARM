import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./tools.js";

export function registerMcpServer(app: FastifyInstance, deps: ServerDeps): void {
  app.post("/mcp", async (req, reply) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
    await server.close();
  });

  app.get("/mcp", async (req, reply) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw);
    await server.close();
  });

  app.delete("/mcp", async (_req, reply) => {
    reply.code(405).send({ code: "bad_input", message: "stateless mode: sessions not supported" });
  });
}
