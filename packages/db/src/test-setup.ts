// Integration tests run against a real Postgres (research.md D9).
process.env.DATABASE_URL ??= 'postgres://postgres@localhost:5432/factory_test';
