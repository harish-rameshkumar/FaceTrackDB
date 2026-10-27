import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { PasswordForm } from "./PasswordForm";

export const metadata = { title: "My account | FaceTrackDB" };

export default function AccountPage() {
  return (
    <PageShell width="narrow">
      <PageHeader title="My account" description="Change your password, for example to replace the temporary one you were given. Changing it signs you out of other browsers." />
      <PasswordForm />
    </PageShell>
  );
}
