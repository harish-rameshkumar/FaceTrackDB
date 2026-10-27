import AppHeader from "@/components/AppHeader";
import { PasswordForm } from "./PasswordForm";

export const metadata = { title: "My account | FaceTrackDB" };

export default function AccountPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold">My account</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-600 dark:text-zinc-400">Change your password, for example to replace the temporary one you were given.</p>
        <PasswordForm />
      </main>
    </>
  );
}
