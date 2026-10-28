// Reads the colour tokens from app/globals.css and checks the WCAG contrast ratio of every
// text/background pair the UI uses, in the light and the dark theme. Text needs at least 4.5:1.
//   npm run check:contrast
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "app", "globals.css"), "utf8");
const lightBlock = /:root\s*\{([^}]*)\}/.exec(css)![1];
const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)![1];
const parse = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
const light = parse(lightBlock);
const dark = { ...light, ...parse(darkBlock) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [text token, background token, where it is used]
const PAIRS: [string, string, string][] = [
  ["fg", "bg", "body text on the page"], ["fg", "surface", "text on cards"], ["fg", "surface-2", "text on hovered rows and buttons"],
  ["muted", "bg", "secondary text on the page"], ["muted", "surface", "secondary text on cards"], ["muted", "surface-2", "secondary text on tinted areas"],
  ["primary", "bg", "links on the page"], ["primary", "surface", "links on cards"], ["primary-hover", "surface", "hovered links"],
  ["primary-fg", "primary", "primary button label"], ["primary-fg", "primary-hover", "hovered primary button"],
  ["danger-fg", "danger", "danger button label"], ["danger-fg", "danger-hover", "hovered danger button"],
  ["danger", "surface", "error text on cards"], ["danger", "bg", "error text on the page"],
  ["success-text", "success-bg", "success pill / notice"], ["warning-text", "warning-bg", "warning pill / notice"],
  ["danger-text", "danger-bg", "danger pill / notice"], ["info-text", "info-bg", "info pill / notice"], ["neutral-text", "neutral-bg", "neutral pill"],
  ["mark-text", "mark-bg", "search highlight"], ["chart-fg", "surface", "chart axis text"], ["chart-fg", "bg", "chart axis text on the page"],
];

let bad = 0;
for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  console.log(`\n${name} theme`);
  for (const [fg, bg, use] of PAIRS) {
    const r = ratio(theme[fg], theme[bg]);
    const ok = r >= 4.5;
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1  ${fg} on ${bg}  (${use})`);
  }
}
console.log(bad ? `\n${bad} pair(s) below 4.5:1` : "\nAll pairs are at least 4.5:1 in both themes.");
process.exit(bad ? 1 : 0);
