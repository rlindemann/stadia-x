// Font wiring for the Specification design system.
//
// Three families, one job each (see DESIGN.md § Typography). This is the
// Next.js `next/font` version, copied from the app's root layout. The CSS
// variable names MUST match what tokens.css / tailwind-theme.css expect:
//   --font-public-sans   body + UI
//   --font-archivo       .font-display (structural caps: labels, titles)
//   --font-martian-mono  .font-ident   (identifiers: IDs, refs, provenance)
//
// Not on Next.js? Load the same three families however your stack does it
// (self-hosted @font-face, Fontsource, a <link> to Google Fonts) and expose
// them under those three variable names on :root. Archivo needs the `wdth`
// axis — the expanded width is what makes it read as a drawing-sheet stamp.

import { Archivo, Martian_Mono, Public_Sans } from "next/font/google";

const publicSans = Public_Sans({
    variable: "--font-public-sans",
    subsets: ["latin"],
});

const archivo = Archivo({
    variable: "--font-archivo",
    subsets: ["latin"],
    axes: ["wdth"],
});

const martianMono = Martian_Mono({
    variable: "--font-martian-mono",
    subsets: ["latin"],
});

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body
                className={`${publicSans.variable} ${archivo.variable} ${martianMono.variable} font-sans antialiased`}
            >
                {children}
            </body>
        </html>
    );
}

// Dark mode: the token file inverts on a `.dark` class on <html>. Set it
// before first paint to avoid a flash of the wrong theme:
//
//   const t = localStorage.getItem("theme");
//   const dark = t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches);
//   document.documentElement.classList.toggle("dark", dark);
