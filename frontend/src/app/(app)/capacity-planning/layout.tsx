import { CP2StoreProvider } from "./_store";
import { LeftRail } from "./_LeftRail";

export default function CapacityPlanningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CP2StoreProvider>
      <div className="flex gap-6">
        <LeftRail />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </CP2StoreProvider>
  );
}
