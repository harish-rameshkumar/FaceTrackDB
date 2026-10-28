import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function AccessDenied({ roles }: { roles: string[] }) {
  return (
    <section className="mx-auto max-w-xl py-8">
      <Card>
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-muted">
          This page needs the role: {roles.join(" or ")}. Sign in with an account that has it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button href="/login" variant="primary">Sign in</Button>
          <Button href="/" variant="secondary">Back to home</Button>
        </div>
      </Card>
    </section>
  );
}
