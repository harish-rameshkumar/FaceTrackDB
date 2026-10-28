// Where each role lands after signing in, and where "/" sends a signed-in user.
// Plain constants (no "use client"), so server and client code can both import them.
export const HOME_BY_ROLE: Record<string, string> = {
  student: "/student",
  parent: "/parent",
  warden: "/warden",
  security: "/security",
  admin: "/admin",
};

export const homeFor = (role: string): string => HOME_BY_ROLE[role] ?? "/login";
