import type { Metadata } from "next";
import { Abel, Source_Code_Pro } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const abel = Abel({ weight: "400", subsets: ["latin"], variable: "--font-abel", display: "swap" });
const scp = Source_Code_Pro({ subsets: ["latin"], variable: "--font-scp", display: "swap" });

export const metadata: Metadata = {
  title: "STADIA-X — Standards Query",
  description: "Query sports-venue standards, down to the clause.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${abel.variable} ${scp.variable}`}>
      <body>
        <ThemeProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
