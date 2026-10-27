import AppHeader from "@/components/AppHeader";
import { RoleGate } from "@/components/RoleGate";
import ParentLeave from "./ParentLeave";

export const metadata = { title: "Leave requests | FaceTrackDB" };

export default function ParentLeavePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-2xl font-semibold">Leave requests</h1>
        <RoleGate roles={["parent"]}>
          <ParentLeave />
        </RoleGate>
      </main>
    </>
  );
}
