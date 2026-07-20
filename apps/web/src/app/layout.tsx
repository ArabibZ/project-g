import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Project G", template: "%s | Project G" },
  description: "Private job monitor administration"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
