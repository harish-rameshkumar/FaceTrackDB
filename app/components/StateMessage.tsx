import Link from "next/link";

// Shown when an API call fails: 401 -> ask to sign in, 403 -> wrong role.
export default function StateMessage({
  status,
  error,
}: {
  status: number | null;
  error: string | null;
}) {
  if (status === 401) {
    return (
      <p>
        Please{" "}
        <Link href="/login" className="underline">
          sign in
        </Link>{" "}
        to continue.
      </p>
    );
  }
  if (status === 403) {
    return <p>This page is not available for your role.</p>;
  }
  return (
    <p role="alert" className="text-red-600">
      {error ?? "Something went wrong"}
    </p>
  );
}
