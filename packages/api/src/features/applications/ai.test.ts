import { describe, expect, it, vi } from "vitest";

const protectedProcedureMock = vi.hoisted(() => {
	const chain = {
		route: vi.fn(() => chain),
		input: vi.fn(() => chain),
		use: vi.fn(() => chain),
		output: vi.fn(() => chain),
		handler: vi.fn(() => chain),
	};
	return chain;
});

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("../../context", () => ({ protectedProcedure: protectedProcedureMock }));
vi.mock("../../middleware/rate-limit", () => ({ aiRequestRateLimit: vi.fn() }));
vi.mock("../ai/service", () => ({ getModel: vi.fn() }));
vi.mock("../ai-providers/service", () => ({ aiProvidersService: { getDefaultRunnable: vi.fn() } }));
vi.mock("../resume/service", () => ({ resumeService: { getById: vi.fn(), create: vi.fn() } }));
vi.mock("./service", () => ({
	applicationService: { getById: vi.fn(), setAiResult: vi.fn(), update: vi.fn(), addNote: vi.fn() },
}));

const { autofillInputSchema } = await import("./ai");

describe("autofillInputSchema", () => {
	it("rejects oversized pasted job descriptions", () => {
		expect(() => autofillInputSchema.parse({ jobDescription: "x".repeat(20_001) })).toThrow();
	});

	it("rejects blank pasted job descriptions", () => {
		expect(() => autofillInputSchema.parse({ jobDescription: "   " })).toThrow();
		expect(() => autofillInputSchema.parse({})).toThrow();
	});

	it("accepts a pasted posting", () => {
		expect(autofillInputSchema.parse({ jobDescription: "  Senior Engineer at Acme  " }).jobDescription).toBe(
			"Senior Engineer at Acme",
		);
	});
});
