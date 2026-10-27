import AppHeader from "@/components/AppHeader";
import { RoleGate } from "@/components/RoleGate";
import ViolationsList from "./ViolationsList";

export const metadata = { title: "Violations | FaceTrackDB" };

export default function ViolationsPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-2xl font-semibold">Violations</h1>
        <RoleGate roles={["student", "parent", "warden", "admin"]}>
          <ViolationsList />
        </RoleGate>
      </main>
    </>
  );
}
