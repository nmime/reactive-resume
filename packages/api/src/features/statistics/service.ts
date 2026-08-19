import { count } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
const GITHUB_API_URL = "https://api.github.com/repos/amruthpillai/reactive-resume";
const GITHUB_REQUEST_TIMEOUT_MS = 5_000;
const GITHUB_REQUEST_MAX_ATTEMPTS = 2;

const LAST_KNOWN = {
	users: 978_528,
	resumes: 1_336_307,
	stars: 34_073,
} as const;

// ponytail: file-based disk cache replaced with module-level memo; LAST_KNOWN fallbacks cover restarts
const memCache = new Map<string, { value: number; cachedAt: number }>();

/** Clear all cached statistics. Exposed for test isolation only. */
export const clearStatisticsCache = () => memCache.clear();

const getCached = (key: string): number | null => {
	const entry = memCache.get(key);
	if (!entry || Date.now() - entry.cachedAt >= CACHE_DURATION_MS) return null;
	return entry.value;
};

const setCached = (key: string, value: number) => {
	memCache.set(key, { value, cachedAt: Date.now() });
};

const getCachedCount = async (
	key: string,
	lastKnown: number,
	fetcher: () => Promise<number | null>,
): Promise<number> => {
	const cached = getCached(key);
	if (cached !== null) return cached;

	try {
		const value = await fetcher();
		if (value !== null) {
			setCached(key, value);
			return value;
		}
	} catch {
		// Ignore errors, use last known value
	}

	return lastKnown;
};

const getCountFromDatabase = async (table: typeof schema.user | typeof schema.resume): Promise<number | null> => {
	const [result] = await db.select({ count: count() }).from(table);
	if (!result) return null;
	return result.count;
};

const fetchGitHubStarsOnce = async (): Promise<number | null> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(GITHUB_API_URL, {
			signal: controller.signal,
			headers: {
				Accept: "application/vnd.github+json",
			},
		});
		if (!response.ok) return null;

		const data = (await response.json()) as { stargazers_count?: unknown };
		const stars = Number(data.stargazers_count);
		return Number.isFinite(stars) && stars > 0 ? stars : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
};

const getGitHubStars = async (attempt = 1): Promise<number | null> => {
	if (attempt > GITHUB_REQUEST_MAX_ATTEMPTS) return null;

	const stars = await fetchGitHubStarsOnce();
	return stars ?? getGitHubStars(attempt + 1);
};

export const statisticsService = {
	user: {
		getCount: () => {
			return getCachedCount("users", LAST_KNOWN.users, () => getCountFromDatabase(schema.user));
		},
	},
	resume: {
		getCount: () => {
			return getCachedCount("resumes", LAST_KNOWN.resumes, () => getCountFromDatabase(schema.resume));
		},
	},
	github: {
		getStarCount: () => {
			return getCachedCount("stars", LAST_KNOWN.stars, getGitHubStars);
		},
	},
};
