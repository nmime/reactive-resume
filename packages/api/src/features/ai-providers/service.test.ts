import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/client";

const envMock = vi.hoisted(() => ({
	ENCRYPTION_SECRET: "test-secret-with-enough-entropy",
	REDIS_URL: "redis://localhost:6379",
	RXRESUME_AI_API_KEY: "test-provider-credential",
	RXRESUME_AI_MODEL: "cx/test-model",
	RXRESUME_AI_BASE_URL: "https://omni-route.funfiesta.games/v1",
	RXRESUME_AI_LABEL: "Test OmniRoute",
}));

const { dbMock, queryMock, queryState } = vi.hoisted(() => {
	const state = {
		rows: [] as unknown[],
		whereArg: undefined as unknown,
		orderByArgs: [] as unknown[],
	};
	const query = {
		from: vi.fn(() => query),
		where: vi.fn((arg: unknown) => {
			state.whereArg = arg;
			return query;
		}),
		orderBy: vi.fn((...args: unknown[]) => {
			state.orderByArgs = args;
			return query;
		}),
		limit: vi.fn(async () => state.rows),
	};

	return {
		dbMock: { select: vi.fn(() => query), update: vi.fn(), delete: vi.fn() },
		queryMock: query,
		queryState: state,
	};
});

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	aiProvider: {
		id: "ai_provider.id",
		userId: "ai_provider.user_id",
		label: "ai_provider.label",
		provider: "ai_provider.provider",
		model: "ai_provider.model",
		baseUrl: "ai_provider.base_url",
		encryptedApiKey: "ai_provider.encrypted_api_key",
		apiKeySalt: "ai_provider.api_key_salt",
		apiKeyHash: "ai_provider.api_key_hash",
		apiKeyPreview: "ai_provider.api_key_preview",
		testStatus: "ai_provider.test_status",
		testError: "ai_provider.test_error",
		lastTestedAt: "ai_provider.last_tested_at",
		lastUsedAt: "ai_provider.last_used_at",
		enabled: "ai_provider.enabled",
		createdAt: "ai_provider.created_at",
		updatedAt: "ai_provider.updated_at",
	},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	asc: (value: unknown) => ({ type: "asc", value }),
	desc: (value: unknown) => ({ type: "desc", value }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings: [...strings], values }),
}));
vi.mock("../ai/credentials", () => ({
	assertCredentialEncryptionConfigured: vi.fn(),
	decryptCredential: vi.fn(() => "decrypted-key"),
	encryptCredential: vi.fn(),
	redactEncryptedCredential: vi.fn(() => ({
		apiKeyFingerprint: "fingerprint",
		apiKeyPreview: "sk-...test",
	})),
}));
vi.mock("../ai/service", () => ({ testConnection: vi.fn() }));
vi.mock("../ai/url-policy", () => ({ resolveAiBaseUrl: vi.fn(({ baseURL }: { baseURL?: string }) => baseURL) }));

const { SERVER_OMNIROUTE_PROVIDER_ID, aiProvidersService } = await import("./service");

describe("server-managed OmniRoute AI provider", () => {
	beforeEach(() => {
		envMock.ENCRYPTION_SECRET = "";
		envMock.RXRESUME_AI_API_KEY = "test-provider-credential";
		envMock.RXRESUME_AI_MODEL = "cx/test-model";
		envMock.RXRESUME_AI_BASE_URL = "https://omni-route.funfiesta.games/v1";
		envMock.RXRESUME_AI_LABEL = "Test OmniRoute";
		for (const mock of Object.values(dbMock)) mock.mockReset();
	});

	afterEach(() => {
		envMock.ENCRYPTION_SECRET = "test-secret-with-enough-entropy";
		envMock.REDIS_URL = "redis://localhost:6379";
		envMock.RXRESUME_AI_API_KEY = "test-provider-credential";
		dbMock.select.mockImplementation(() => queryMock);
	});

	it("lists a redacted synthetic provider without requiring ENCRYPTION_SECRET", async () => {
		const providers = await aiProvidersService.list({ userId: "user-1" });

		expect(providers).toHaveLength(1);
		expect(providers[0]).toMatchObject({
			id: SERVER_OMNIROUTE_PROVIDER_ID,
			label: "Test OmniRoute",
			provider: "openai",
			model: "cx/test-model",
			baseURL: "https://omni-route.funfiesta.games/v1",
			enabled: true,
			testStatus: "success",
			apiKeyPreview: "server-managed",
			apiKeyFingerprint: "server-managed",
		});
		expect(JSON.stringify(providers)).not.toContain("test-provider-credential");
		expect(dbMock.select).not.toHaveBeenCalled();
	});

	it("returns the synthetic provider first when encrypted DB providers are available", async () => {
		envMock.ENCRYPTION_SECRET = "test-secret-with-enough-entropy";
		const dbRows = [
			{
				id: "db-provider-1",
				label: "Saved Provider",
				provider: "openai",
				model: "gpt-5",
				baseUrl: "https://api.openai.com/v1",
				enabled: true,
				testStatus: "success",
				testError: null,
				encryptedApiKey: "encrypted",
				apiKeySalt: "salt",
				apiKeyHash: "fingerprint",
				apiKeyPreview: "sk-t...cret",
				lastTestedAt: null,
				lastUsedAt: null,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		];
		dbMock.select.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockResolvedValue(dbRows),
				}),
			}),
		});

		const providers = await aiProvidersService.list({ userId: "user-1" });

		expect(providers.map((provider) => provider.id)).toEqual([SERVER_OMNIROUTE_PROVIDER_ID, "db-provider-1"]);
	});

	it("returns runnable synthetic provider with API key only through runnable methods", async () => {
		const byId = await aiProvidersService.getRunnableById({ id: SERVER_OMNIROUTE_PROVIDER_ID, userId: "user-1" });
		const byDefault = await aiProvidersService.getDefaultRunnable({ userId: "user-1" });

		expect(byId.apiKey).toBe("test-provider-credential");
		expect(byDefault?.apiKey).toBe("test-provider-credential");
		expect(byId.apiKeyPreview).toBe("server-managed");
		expect(dbMock.select).not.toHaveBeenCalled();
	});

	it("does not expose a runnable synthetic provider when the env key is unset", async () => {
		envMock.RXRESUME_AI_API_KEY = "";

		await expect(
			aiProvidersService.getRunnableById({ id: SERVER_OMNIROUTE_PROVIDER_ID, userId: "user-1" }),
		).rejects.toThrow(ORPCError);
		await expect(aiProvidersService.getDefaultRunnable({ userId: "user-1" })).rejects.toThrow(
			"AI_CREDENTIAL_ENCRYPTION_UNAVAILABLE",
		);
	});

	it("safely rejects or ignores mutations against the synthetic id", async () => {
		await expect(
			aiProvidersService.update({ id: SERVER_OMNIROUTE_PROVIDER_ID, userId: "user-1", label: "Other" }),
		).rejects.toThrow(ORPCError);
		await expect(aiProvidersService.test({ id: SERVER_OMNIROUTE_PROVIDER_ID, userId: "user-1" })).rejects.toThrow(
			ORPCError,
		);
		await expect(
			aiProvidersService.delete({ id: SERVER_OMNIROUTE_PROVIDER_ID, userId: "user-1" }),
		).resolves.toBeUndefined();
		await expect(
			aiProvidersService.markUsed({ id: SERVER_OMNIROUTE_PROVIDER_ID, userId: "user-1" }),
		).resolves.toBeUndefined();
		expect(dbMock.delete).not.toHaveBeenCalled();
		expect(dbMock.update).not.toHaveBeenCalled();
	});
});

function providerRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "provider-1",
		userId: "user-1",
		label: "OpenAI",
		provider: "openai",
		model: "gpt-5-mini",
		baseUrl: null,
		encryptedApiKey: "encrypted-key",
		apiKeySalt: "salt",
		apiKeyHash: "hash",
		apiKeyPreview: "preview",
		testStatus: "success",
		testError: null,
		lastTestedAt: new Date("2026-07-01T00:00:00Z"),
		lastUsedAt: new Date("2026-07-07T00:00:00Z"),
		enabled: true,
		createdAt: new Date("2026-07-01T00:00:00Z"),
		updatedAt: new Date("2026-07-01T00:00:00Z"),
		...overrides,
	};
}

describe("aiProvidersService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		envMock.RXRESUME_AI_API_KEY = "";
		queryState.rows = [];
		queryState.whereArg = undefined;
		queryState.orderByArgs = [];
	});

	afterEach(() => {
		envMock.RXRESUME_AI_API_KEY = "test-provider-credential";
	});

	it("gets the first enabled and tested provider by creation order", async () => {
		queryState.rows = [providerRow({ id: "first-created" })];

		await expect(aiProvidersService.getDefaultRunnable({ userId: "user-1" })).resolves.toMatchObject({
			id: "first-created",
			apiKey: "decrypted-key",
		});

		expect(queryState.whereArg).toEqual({
			type: "and",
			conditions: [
				{ type: "eq", left: "ai_provider.user_id", right: "user-1" },
				{ type: "eq", left: "ai_provider.enabled", right: true },
				{ type: "eq", left: "ai_provider.test_status", right: "success" },
			],
		});
		expect(queryState.orderByArgs).toEqual([{ type: "asc", value: "ai_provider.created_at" }]);
		expect(queryMock.limit).toHaveBeenCalledWith(1);
	});
});
