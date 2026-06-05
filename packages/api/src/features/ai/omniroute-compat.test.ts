import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
	RXRESUME_AI_BASE_URL: "https://omni-route.funfiesta.games/v1",
	RXRESUME_AI_MODEL: "cx/gpt-5.5",
}));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));

const { convertSseChatCompletionChunksToJson, createOmniRouteCompatibleFetch, isOmniRouteBaseUrl } = await import(
	"./omniroute-compat"
);

describe("OmniRoute AI compatibility", () => {
	beforeEach(() => {
		envMock.RXRESUME_AI_BASE_URL = "https://omni-route.funfiesta.games/v1";
		envMock.RXRESUME_AI_MODEL = "cx/gpt-5.5";
	});

	it("detects only the configured OmniRoute base URL", () => {
		expect(isOmniRouteBaseUrl("https://omni-route.funfiesta.games/v1/")).toBe(true);
		expect(isOmniRouteBaseUrl("https://api.openai.com/v1")).toBe(false);
	});

	it("converts SSE chat completion chunks into a non-stream JSON chat completion", () => {
		const completion = convertSseChatCompletionChunksToJson(`
 data: {"id":"chatcmpl-1","created":123,"model":"cx/test","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"},"finish_reason":null}]}
 data: {"id":"chatcmpl-1","created":123,"model":"cx/test","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}
 data: {"id":"chatcmpl-1","created":123,"model":"cx/test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}
 data: [DONE]
 `);

		expect(completion).toEqual({
			id: "chatcmpl-1",
			object: "chat.completion",
			created: 123,
			model: "cx/test",
			choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		});
	});

	it("adds accept: application/json and converts non-stream OmniRoute chat completion SSE responses", async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("accept")).toBe("application/json");

			return new Response(
				'data: {"id":"chatcmpl-2","created":456,"model":"cx/test","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n',
				{ headers: { "content-type": "text/event-stream" } },
			);
		});
		globalThis.fetch = fetchMock as typeof fetch;

		try {
			const compatFetch = createOmniRouteCompatibleFetch("https://omni-route.funfiesta.games/v1");
			expect(compatFetch).toBeDefined();

			const response = await compatFetch?.("https://omni-route.funfiesta.games/v1/chat/completions", {
				method: "POST",
				body: JSON.stringify({ model: "cx/test", messages: [{ role: "user", content: "hi" }] }),
			});

			expect(response?.headers.get("content-type")).toContain("application/json");
			expect(await response?.json()).toMatchObject({
				object: "chat.completion",
				choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("does not convert streaming requests", async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = vi.fn(
			async () => new Response("data: [DONE]\n", { headers: { "content-type": "text/event-stream" } }),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		try {
			const compatFetch = createOmniRouteCompatibleFetch("https://omni-route.funfiesta.games/v1");
			const response = await compatFetch?.("https://omni-route.funfiesta.games/v1/chat/completions", {
				method: "POST",
				body: JSON.stringify({ stream: true }),
			});

			expect(response?.headers.get("content-type")).toContain("text/event-stream");
			expect(await response?.text()).toBe("data: [DONE]\n");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
