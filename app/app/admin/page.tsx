import { PageShell } from "@/components/PageShell";
import { RoleGate } from "@/components/RoleGate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Home | FaceTrackDB" };

const LINKS = [
  { href: "/admin/students", title: "Students", text: "Register students and parents, enrol faces, re-enrol or delete.", action: "Open students" },
  { href: "/enrol", title: "Enrol faces", text: "Capture a student's face with guided prompts and store it for recognition.", action: "Enrol a face" },
  { href: "/warden/sessions", title: "Roll calls", text: "Create roll calls and close them after they end.", action: "Open roll calls" },
  { href: "/reports", title: "Reports", text: "Charts and a presentation mode built from SQL.", action: "Open reports" },
];

export default function AdminHomePage() {
  return (
    <PageShell>
      <PageHeader title="Home" description="Manage people, faces and roll calls." />
      <RoleGate roles={["admin"]}>
        <div className="grid gap-4 sm:grid-cols-2">
          {LINKS.map((l) => (
            <Card key={l.href} title={l.title} description={l.text}>
              <Button href={l.href} variant="primary" size="sm">{l.action}</Button>
            </Card>
          ))}
        </div>
      </RoleGate>
    </PageShell>
  );
}
