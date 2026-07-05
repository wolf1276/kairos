import { GridBackground } from "@/components/ui/grid-background";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-bg-primary text-text-primary font-body">
      <GridBackground />
      <main className="relative z-10 px-6 pt-24 pb-8 md:px-10 md:pt-28 lg:px-14 xl:px-20">
        <div className="mx-auto max-w-[1680px]">{children}</div>
      </main>
    </div>
  );
}
