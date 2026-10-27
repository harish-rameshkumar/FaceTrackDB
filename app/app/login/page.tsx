import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in | FaceTrackDB" };

export default function LoginPage() {
  // Only outside production: a reminder of the seeded demo accounts (db/seed.sql, db/demo_passwords.sql).
  const showDemo = process.env.NODE_ENV !== "production";
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">FaceTrackDB</h1>
        <p className="mt-1 text-sm text-muted">Sign in to continue</p>
      </div>
      <Card className="w-full max-w-sm">
        <LoginForm />
      </Card>
      {showDemo && (
        <Notice tone="info" title="Demo accounts (development only)" className="w-full max-w-sm">
          Password for every seeded account: <code className="font-mono">FaceTrack@123</code>. For example <code className="font-mono">admin1@facetrack.test</code>,{" "}
          <code className="font-mono">warden1@facetrack.test</code>, <code className="font-mono">security1@facetrack.test</code>,{" "}
          <code className="font-mono">arun.kumar@facetrack.test</code>, <code className="font-mono">parent.senthil@facetrack.test</code>.
        </Notice>
      )}
    </main>
  );
}
