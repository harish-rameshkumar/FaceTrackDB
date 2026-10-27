import AppHeader from "@/components/AppHeader";
import { RoleGate } from "@/components/RoleGate";
import StudentHistory from "./StudentHistory";

export const metadata = { title: "My history | FaceTrackDB" };

export default function StudentHistoryPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-2xl font-semibold">My attendance and gate history</h1>
        <RoleGate roles={["student"]}>
          <StudentHistory />
        </RoleGate>
      </main>
    </>
  );
}
