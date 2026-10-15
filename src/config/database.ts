// The Vercel Prisma integration uses this project-specific prefix. Prefer its
// managed connection over the obsolete localhost DATABASE_URL on that project.
export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
    return env.nobel_book_api_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || undefined;
}

export function assertDatabaseUrl(value: string | undefined, hosted = false): asserts value is string {
    if (!value) throw new Error("Set a PostgreSQL DATABASE_URL or connect the Prisma Postgres integration.");
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("The database connection URL is invalid."); }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        throw new Error("This release requires a PostgreSQL TCP connection, not MySQL or an Accelerate URL.");
    }
    if (hosted && ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(url.hostname)) {
        throw new Error("Vercel cannot use a local database. Connect the hosted Prisma Postgres database.");
    }
}
