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

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
}));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	aiProvider: {
		id: "ai_provider.id",
		userId: "ai_provider.user_id",
		enabled: "ai_provider.enabled",
		testStatus: "ai_provider.test_status",
		lastUsedAt: "ai_provider.last_used_at",
		createdAt: "ai_provider.created_at",
	},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ type: "and", conditions }),
	asc: (column: unknown) => ({ type: "asc", column }),
	desc: (column: unknown) => ({ type: "desc", column }),
	eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings, values })),
}));
vi.mock("../ai/service", () => ({ testConnection: vi.fn() }));
vi.mock("../ai/url-policy", () => ({ resolveAiBaseUrl: vi.fn(({ baseURL }) => baseURL) }));

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
