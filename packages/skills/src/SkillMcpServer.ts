/**
 * @license Apache-2.0
 * @geminiclaw/skills — SkillMcpServer
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { SkillRegistry } from './SkillRegistry.js';
import { Type } from '@google/genai';

/**
 * Maps a Gemini Schema to a JSON Schema object for MCP tools.
 */
function mapGeminiSchemaToJsonSchema(schema: any): any {
    if (!schema) return {};

    // Simplistic mapping, as genai Schema is similar to JSON Schema
    const result: any = { type: schema.type === Type.OBJECT ? 'object' : schema.type?.toLowerCase() || 'string' };

    if (schema.description) result.description = schema.description;
    if (schema.properties) {
        result.properties = {};
        for (const [key, val] of Object.entries(schema.properties)) {
            result.properties[key] = mapGeminiSchemaToJsonSchema(val);
        }
    }
    if (schema.required) result.required = schema.required;
    if (schema.items) result.items = mapGeminiSchemaToJsonSchema(schema.items);
    if (schema.enum) result.enum = schema.enum;

    return result;
}

export class SkillMcpServer {
    private registry: SkillRegistry;
    private transports: Map<string, any> = new Map(); // Store active transports

    constructor(registry: SkillRegistry) {
        this.registry = registry;
    }

    private setupHandlers(server: Server) {
        server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
            // Retrieve agentName from SSE headers if available
            const agentName = (extra as any)?.agentName;
            const whitelist = (extra as any)?.whitelist as string[] | undefined;

            let declarations = this.registry.getDeclarations() || [];

            // Filter declarations based on agent whitelist if provided
            if (whitelist && whitelist.length > 0) {
                declarations = declarations.filter(d => d.name && whitelist.includes(d.name));
            }

            const tools = declarations.map(decl => ({
                name: decl.name,
                description: decl.description,
                inputSchema: mapGeminiSchemaToJsonSchema(decl.parameters)
            }));

            return { tools };
        });

        server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            try {
                const whitelist = (extra as any)?.whitelist as string[] | undefined;

                // Security: Verify skill is in whitelist if whitelist exists
                if (whitelist && whitelist.length > 0 && !whitelist.includes(request.params.name)) {
                    throw new Error(`[skills/mcp] Skill '${request.params.name}' is not authorized for this agent.`);
                }

                const args = (request.params.arguments as Record<string, unknown>) || {};
                const result = await this.registry.execute(request.params.name, args);

                return {
                    content: [
                        {
                            type: 'text',
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                        }
                    ]
                };
            } catch (error) {
                return {
                    isError: true,
                    content: [
                        {
                            type: 'text',
                            text: error instanceof Error ? error.message : String(error)
                        }
                    ]
                };
            }
        });
    }

    /**
     * Handle the initial SSE connection (GET request)
     */
    async handleSse(req: any, res: any) {
        console.log('[skills/mcp] Incoming SSE connection');
        const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');

        // Create a new transport and server for this connection
        const transport = new SSEServerTransport('/api/mcp/messages', res);

        const server = new Server({
            name: 'geminiclaw-skills',
            version: '1.0.0'
        }, {
            capabilities: { tools: {} }
        });

        this.setupHandlers(server);
        await server.connect(transport);

        this.transports.set(transport.sessionId, transport);
        console.log(`[skills/mcp] SSE connection established, sessionId: ${transport.sessionId}`);

        // Cleanup on disconnect
        res.on('close', () => {
            console.log(`[skills/mcp] SSE connection closed, sessionId: ${transport.sessionId}`);
            this.transports.delete(transport.sessionId);
        });
    }

    /**
     * Handle incoming JSON-RPC messages (POST request)
     */
    async handleMessage(req: any, res: any) {
        const sessionId = req.query.sessionId;
        const transport = this.transports.get(sessionId);

        if (!transport) {
            console.warn(`[skills/mcp] Transport not found for session ${sessionId}`);
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        // Extract agent context from headers (passed by Gateway/AgentRuntime)
        const agentName = req.headers['x-agent-name'] as string;
        const whitelistStr = req.headers['x-agent-skills'] as string;
        const whitelist = whitelistStr ? whitelistStr.split(',') : undefined;

        // The MCP SDK doesn't natively support passing context through handlePostMessage easily
        // but we can "hijack" the request to include it for our handlers.
        (req as any).agentContext = { agentName, whitelist };

        await transport.handlePostMessage(req, res);
    }
}
