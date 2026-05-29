import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { PreviewBanner } from "@/components/layout/PreviewBanner";
import { PageViewTracker } from "@/components/layout/PageViewTracker";
import { getSession } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex h-full min-h-screen">
      <TooltipProvider>
        <Sidebar user={user} />
        <div className="ml-[64px] flex flex-1 flex-col overflow-auto">
          <PreviewBanner />
          {/* Fires PageView analytics events. Wrapped in Suspense
              because PageViewTracker uses useSearchParams() which
              defers SSR. Returns null — purely side-effects. */}
          <Suspense fallback={null}>
            <PageViewTracker />
          </Suspense>
          <div className="sticky top-0 z-30 bg-black">
            <Header />
          </div>
          <main className="flex-1 bg-black px-8 py-6">{children}</main>
        </div>
      </TooltipProvider>
    </div>
  );
}
