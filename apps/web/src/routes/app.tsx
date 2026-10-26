import { createFileRoute } from "@tanstack/react-router";
import { SessionGate } from "~/auth/SessionGate";
import { SnapshotProvider } from "~/offline/SnapshotProvider";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

function AppRoute() {
  return (
    <SnapshotProvider>
      <SessionGate />
    </SnapshotProvider>
  );
}
