export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-black">
      {children}
    </div>
  );
}
