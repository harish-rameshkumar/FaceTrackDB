import { Suspense } from "react";
import { AccessDenied } from "@/components/AccessDenied";
import { AuthError, requireRole, type Role } from "@/lib/auth";

// Page-level access check. The API routes already refuse the wrong role; this makes the PAGE say
// "Access denied" too, instead of rendering an empty shell that fails after it loads. It checks the
// same thing the API does (a valid, un-revoked login with one of the roles) through requireRole.
async function Gate({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  try {
    await requireRole(roles);
  } catch (e) {
    if (e instanceof AuthError) return <AccessDenied roles={roles} />;
    throw e;
  }
  return <>{children}</>;
}

// Needs Suspense because it reads the request's cookies (Next.js 16, cacheComponents).
export function RoleGate({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading…</p>}>
      <Gate roles={roles}>{children}</Gate>
    </Suspense>
  );
}
