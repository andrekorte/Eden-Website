/**
 * Eden Student and Migration Service — chat endpoint.
 *
 * eden-studentservice.com is static HTML on GitHub Pages, which means it cannot
 * keep a secret: anything shipped to the browser is public. This worker exists
 * for exactly one reason — to be the smallest piece of server that can hold the
 * Anthropic API key. Everything else it does (origin checks, rate limiting,
 * input caps) follows from the fact that this URL is public and every request
 * to it costs money.
 *
 * It has no tools, no database and no memory between requests. That is
 * deliberate: an assistant with nothing to steal and nothing to break is the
 * cheapest security control available. See chatbot/RISKS.md.
 *
 *   POST /chat  {"messages":[{"role":"user","content":"…"}]}
 *     -> text/event-stream of {"type":"text","text":"…"} then {"type":"done"}
 *
 * Deploy: see chatbot/README.md
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildSystem } from "./system-prompt";
import { KNOWLEDGE_BASE } from "./knowledge-base";

export interface Env {
  /** Set with: npx wrangler secret put ANTHROPIC_API_KEY */
  ANTHROPIC_API_KEY: string;
  /** Comma-separated origins allowed to call this worker. */
  ALLOWED_ORIGINS?: string;
  MODEL?: string;
  /** Optional rate limiter binding — the worker runs without it. */
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

/**
 * Caps chosen so one abusive caller cannot run up a bill. These bound the
 * damage; the spend limit in the Anthropic console is the real backstop.
 */
const LIMITS = {
  /** ~12 exchanges. Longer than that is a conversation for a person. */
  messages: 24,
  /** Per message. A real enquiry is a sentence or two. */
  chars: 1_000,
  /** Whole conversation, so a long history cannot be padded to the cap. */
  totalChars: 8_000,
  /** Enough for a short answer and a handover, not enough for an essay. */
  maxTokens: 700,
};

const DEFAULT_MODEL = "claude-haiku-4-5";

type ChatMessage = { role: "user" | "assistant"; content: string };

// --------------------------------------------------------------------------
// HTTP plumbing
// --------------------------------------------------------------------------

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * CORS headers for this request, or null if the origin is not allowed.
 *
 * Fails CLOSED. An unset or empty ALLOWED_ORIGINS refuses everything rather
 * than accepting everything, and a request with no Origin header is refused
 * too. The earlier version did the opposite and wrote a warning, which meant a
 * misconfigured worker was indistinguishable from a protected one on the
 * dashboard — the control was specified but not in force. That was found by
 * probing the deployed worker from an origin it should have rejected, and it
 * is the reason this now defaults to no.
 *
 * The honest limit of the control is unchanged and recorded in RISKS.md: it
 * stops another *website* embedding this worker, because browsers send Origin
 * and enforce the response. It does not stop a script, which can send any
 * Origin it likes. The console spend cap is what bounds that.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> | null {
  const origin = request.headers.get("Origin");
  const list = allowedOrigins(env);
  if (list.length === 0) {
    console.error("ALLOWED_ORIGINS is not set — refusing all requests");
    return null;
  }
  if (!origin || !list.includes(origin)) return null;
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// --------------------------------------------------------------------------
// Request validation
// --------------------------------------------------------------------------

/** Returns the messages, or a string describing why the body was rejected. */
function parseMessages(body: unknown): ChatMessage[] | string {
  if (typeof body !== "object" || body === null) return "Body must be a JSON object.";
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) return "messages must be a non-empty array.";
  if (raw.length > LIMITS.messages) return "Conversation is too long.";

  const out: ChatMessage[] = [];
  let total = 0;
  for (const m of raw) {
    if (typeof m !== "object" || m === null) return "Each message must be an object.";
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return "role must be user or assistant.";
    if (typeof content !== "string") return "content must be a string.";
    const text = content.trim();
    if (!text) return "content must not be empty.";
    if (text.length > LIMITS.chars) return "That message is too long — please shorten it.";
    total += text.length;
    if (total > LIMITS.totalChars) return "Conversation is too long.";
    out.push({ role, content: text });
  }
  if (out[out.length - 1].role !== "user") return "The last message must be from the user.";
  return out;
}

// --------------------------------------------------------------------------
// Worker
// --------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (cors === null) return json({ error: "Origin not allowed." }, 403);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/chat") {
      return json({ error: "POST /chat" }, 404, cors);
    }

    // Per-IP rate limit. Documented weakness: an office behind one NAT shares a
    // budget, and a botnet does not have the problem at all.
    //
    // Unlike the origin check this cannot fail closed — refusing all traffic
    // because a binding is missing is a self-inflicted outage, worse than the
    // risk it defends. So it fails open, but says so at error level. Some
    // controls have a safe default and some do not; for the ones that do not,
    // the absence has to be visible and something else has to compensate. Here
    // that is the spend cap.
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return json({ error: "Too many messages. Please wait a moment." }, 429, cors);
      }
    } else {
      console.error("RATE_LIMITER binding is missing — requests are NOT rate limited");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400, cors);
    }

    const parsed = parseMessages(body);
    if (typeof parsed === "string") return json({ error: parsed }, 400, cors);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const encoder = new TextEncoder();

    /**
     * The worker speaks its own protocol rather than passing Anthropic's event
     * stream through. Ten extra lines, and in exchange the widget knows nothing
     * about the provider: the model, SDK or event schema can change without
     * touching front-end code. It also lets an error be delivered *mid-stream*,
     * after the answer has started, which an HTTP status code cannot do.
     */
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: unknown) =>
          controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));

        try {
          const result = client.messages.stream({
            model: env.MODEL ?? DEFAULT_MODEL,
            max_tokens: LIMITS.maxTokens,
            system: buildSystem(KNOWLEDGE_BASE),
            messages: parsed,
          });

          for await (const event of result) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send({ type: "text", text: event.delta.text });
            }
          }

          // Token counts are the only thing logged. No conversation content is
          // stored anywhere — see the accepted risks in RISKS.md.
          const final = await result.finalMessage();
          console.log(
            JSON.stringify({
              in: final.usage.input_tokens,
              out: final.usage.output_tokens,
              cache_read: final.usage.cache_read_input_tokens ?? 0,
              cache_write: final.usage.cache_creation_input_tokens ?? 0,
            })
          );

          send({ type: "done" });
        } catch (err) {
          console.error("chat failed", err);
          send({
            type: "error",
            message: "Sorry, something went wrong. Please message the team on LINE.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...cors,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  },
};
