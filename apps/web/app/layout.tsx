import type { ReactNode } from "react";

export const metadata = {
  title: "Post Lead",
  description: "Agency panel",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
