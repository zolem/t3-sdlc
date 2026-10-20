// @ts-check
// Fallback values for the T3 theme variables the factory's pages use. T3 injects
// its theme when a page is rendered inline; opened by link (preview pane or any
// browser) the variables are missing, so these fill in, light or dark. They sit in
// a cascade layer, so T3's own (unlayered) theme always wins.

export const THEME_FALLBACK = `@layer fallback{
:root{color-scheme:light dark;--background:#ffffff;--foreground:#1f2328;--muted-foreground:#59636e;--border:#d1d9e0;--card:#ffffff;--accent:#0969da;--destructive:#cf222e;--radius:8px;--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;--chart-1:#0969da;--chart-2:#1a7f37;--chart-3:#9a6700;--chart-4:#8250df;--chart-5:#cf222e;--chart-6:#bc4c00}
@media (prefers-color-scheme:dark){:root{--background:#0d1117;--foreground:#e6edf3;--muted-foreground:#9198a1;--border:#3d444d;--card:#151b23;--accent:#4493f8;--destructive:#f85149;--chart-1:#4493f8;--chart-2:#3fb950;--chart-3:#d29922;--chart-4:#ab7df8;--chart-5:#f85149;--chart-6:#db6d28}}
html{background:var(--background);color:var(--foreground);padding:16px 20px}
}
`;
