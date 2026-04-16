import { redirect } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
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
        <Sidebar />
        <div className="ml-[240px] flex flex-1 flex-col overflow-auto">
          <div className="sticky top-0 z-30 bg-black">
            <Header user={user} />
          </div>
          <main className="flex-1 bg-black px-8 py-6">{children}</main>
        </div>
      </TooltipProvider>
    </div>
  );
}
