import { env } from "@reactive-resume/env/server";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

type ChatCompletionChunk = {
	id?: string;
	created?: number;
	model?: string;
	choices?: Array<{
		index?: number;
		delta?: {
			role?: string;
			content?: string | null;
		};
		finish_reason?: string | null;
	}>;
	usage?: unknown;
};

type ChatCompletion = {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: { role: string; content: string };
		finish_reason: string | null;
	}>;
	usage?: unknown;
};

export type OmniRouteFetch = (input: FetchInput, init?: FetchInit) => Promise<Response>;

function normalizeUrl(input: string) {
	const parsed = new URL(input);
	parsed.hash = "";
	return parsed.toString().replace(/\/+$/, "");
}

export function isOmniRouteBaseUrl(baseURL: string) {
	try {
		return normalizeUrl(baseURL) === normalizeUrl(env.RXRESUME_AI_BASE_URL);
	} catch {
		return false;
	}
}

function requestUrl(input: FetchInput) {
	return typeof input === "string" || input instanceof URL ? input.toString() : input.url;
}

function requestMethod(input: FetchInput, init: FetchInit) {
	return init?.method ?? (typeof input === "string" || input instanceof URL ? "GET" : input.method);
}

function withAcceptJson(input: FetchInput, init: FetchInit): [FetchInput, FetchInit] {
	const headers = new Headers(
		init?.headers ?? (typeof input === "string" || input instanceof URL ? undefined : input.headers),
	);
	headers.set("accept", "application/json");

	if (typeof input === "string" || input instanceof URL) {
		return [input, { ...init, headers }];
	}

	return [new Request(input, { headers }), init ? { ...init, headers } : { headers }];
}

async function requestBodyIsStreaming(input: FetchInput, init: FetchInit) {
	const body = init?.body;
	if (typeof body === "string") {
		try {
			return JSON.parse(body).stream === true;
		} catch {
			return false;
		}
	}

	if (body == null && !(typeof input === "string" || input instanceof URL)) {
		try {
			const parsed = (await input.clone().json()) as { stream?: unknown };
			return parsed.stream === true;
		} catch {
			return false;
		}
	}

	return false;
}

function parseSseDataLines(sse: string) {
	return sse
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trim())
		.filter((data) => data && data !== "[DONE]");
}

export function convertSseChatCompletionChunksToJson(sse: string): ChatCompletion {
	const chunks = parseSseDataLines(sse).map((data) => JSON.parse(data) as ChatCompletionChunk);
	if (chunks.length === 0) throw new Error("OMNIROUTE_EMPTY_SSE_COMPLETION");

	const first = chunks[0] as ChatCompletionChunk;
	const choiceState = new Map<number, { role: string; content: string; finish_reason: string | null }>();
	let usage: unknown;

	for (const chunk of chunks) {
		if (chunk.usage !== undefined) usage = chunk.usage;

		for (const choice of chunk.choices ?? []) {
			const index = choice.index ?? 0;
			const current = choiceState.get(index) ?? { role: "assistant", content: "", finish_reason: null };
			current.role = choice.delta?.role ?? current.role;
			current.content += choice.delta?.content ?? "";
			current.finish_reason = choice.finish_reason ?? current.finish_reason;
			choiceState.set(index, current);
		}
	}

	const choices = [...choiceState.entries()]
		.sort(([left], [right]) => left - right)
		.map(([index, choice]) => ({
			index,
			message: { role: choice.role, content: choice.content },
			finish_reason: choice.finish_reason ?? "stop",
		}));

	const completion: ChatCompletion = {
		id: first.id ?? "omniroute-chat-completion",
		object: "chat.completion",
		created: first.created ?? Math.floor(Date.now() / 1000),
		model: first.model ?? env.RXRESUME_AI_MODEL,
		choices,
	};

	if (usage !== undefined) completion.usage = usage;

	return completion;
}

async function convertSseResponseToJson(response: Response) {
	const completion = convertSseChatCompletionChunksToJson(await response.text());
	const headers = new Headers(response.headers);
	headers.set("content-type", "application/json");
	headers.delete("content-length");

	return new Response(JSON.stringify(completion), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function createOmniRouteCompatibleFetch(baseURL: string): OmniRouteFetch | undefined {
	if (!isOmniRouteBaseUrl(baseURL)) return undefined;

	return async (input: FetchInput, init?: FetchInit) => {
		const isChatCompletion = /\/chat\/completions(?:\?|$)/.test(requestUrl(input));
		const isNonStreamingCompletion =
			isChatCompletion &&
			requestMethod(input, init).toUpperCase() === "POST" &&
			!(await requestBodyIsStreaming(input, init));
		const [nextInput, nextInit] = withAcceptJson(input, init);

		const response = await fetch(nextInput, nextInit);
		if (!isNonStreamingCompletion) return response;

		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("text/event-stream")) return response;

		return convertSseResponseToJson(response);
	};
}
