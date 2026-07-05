export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-body">
      <main className="px-6 pt-24 pb-8 md:px-12 md:pt-28 lg:px-20">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
