import Link from "next/link";
import { Notice } from "@/components/ui/Notice";

// Shown when an API call fails: 401 -> ask to sign in, 403 -> wrong role.
export default function StateMessage({ status, error }: { status: number | null; error: string | null }) {
  if (status === 401) {
    return (
      <Notice tone="warning" title="Please sign in">
        <Link href="/login" className="font-medium underline">Sign in</Link> to continue.
      </Notice>
    );
  }
  if (status === 403) return <Notice tone="warning" title="Not available">This page is not available for your role.</Notice>;
  return <Notice tone="danger">{error ?? "Something went wrong"}</Notice>;
}
