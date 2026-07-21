import type { Metadata } from "next";
import { Archivo, Martian_Mono, Public_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

// Three families, one job each — see /DESIGN.md § Typography.
// Public Sans: body + UI. Archivo (wdth axis): structural caps labels.
// Martian Mono: identifiers — clause paths, standard codes, provenance.
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const martianMono = Martian_Mono({ subsets: ["latin"], variable: "--font-martian-mono", display: "swap" });

export const metadata: Metadata = {
  title: "STADIA-X — Standards Query",
  description: "Query sports-venue standards, down to the clause.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${publicSans.variable} ${archivo.variable} ${martianMono.variable}`}
    >
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
