import { CP2StoreProvider } from "./_store";

export default function CapacityPlanningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CP2StoreProvider>{children}</CP2StoreProvider>;
}
