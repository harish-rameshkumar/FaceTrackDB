import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in | FaceTrackDB" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">FaceTrackDB</h1>
        <p className="text-sm text-gray-500">Sign in to continue</p>
      </div>
      <LoginForm />
    </main>
  );
}
