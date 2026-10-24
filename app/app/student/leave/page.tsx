import AppHeader from "@/components/AppHeader";
import StudentLeave from "./StudentLeave";

export const metadata = { title: "My leave | FaceTrackDB" };

export default function StudentLeavePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-2xl font-semibold">My leave</h1>
        <StudentLeave />
      </main>
    </>
  );
}
