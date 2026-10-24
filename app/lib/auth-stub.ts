// The dev-only stub that lived here has been replaced by real JWT login
// (see lib/auth.ts and lib/session.ts). This file only re-exports it, so every
// existing import of "@/lib/auth-stub" keeps working unchanged.
//
// The x-dev-role / dev_role shortcuts no longer exist: sign in at /login, or
// POST to /api/login, to act as a role.
export * from "./auth";
