# app/

This folder is the Next.js 16 application (pages, API routes, scripts) for FaceTrackDB. It is not a standalone project: the database, the vector store and the embedding service live in the repository root.

- **What the project is, how to set it up, demo accounts and a demo script:** [../README.md](../README.md)
- **How the pieces fit together:** [../docs/architecture.md](../docs/architecture.md)
- **Face recognition design and thresholds:** [../docs/vector-design.md](../docs/vector-design.md)
- **Tests and their results:** [../docs/test-results.md](../docs/test-results.md)

Next.js 16 differs from older versions (see [AGENTS.md](AGENTS.md)): database reads must run in a dynamic context, `searchParams` is a Promise, and `export const dynamic` is not allowed.

Common commands (run from this folder, after the root setup): `npm run dev`, `npm run build`, `npm run lint`, `npx tsc --noEmit`, and the `npm run test:*` and `npm run qdrant:*` scripts listed in the root README.
