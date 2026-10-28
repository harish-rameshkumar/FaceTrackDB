import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { getCurrentUser } from "@/lib/auth";
import { homeFor } from "@/lib/home";

// "/" sends a signed-in user to the home page of their role, and shows a short welcome otherwise.
export default function Home() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-10">
      <Suspense fallback={<Spinner label="Loading" />}>
        <Landing />
      </Suspense>
    </main>
  );
}

async function Landing() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <Card>
      <h1 className="text-3xl font-semibold tracking-tight">FaceTrackDB</h1>
      <p className="mt-2 text-muted">Face-recognition attendance and gate tracking for hostels: roll calls, entries and exits, leave and violations in one place.</p>
      <div className="mt-6">
        <Button href="/login" variant="primary">Sign in</Button>
      </div>
    </Card>
  );
}
