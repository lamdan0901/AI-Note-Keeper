/**
 * Expo 50 (@expo/cli) creates shim dirs named after Node builtins.
 * Node 22+ exposes names like "node:sea"; Windows forbids ":" in paths → ENOENT mkdir.
 * Re-apply after every npm install until Expo is upgraded past this.
 */
const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "@expo",
  "cli",
  "build",
  "src",
  "start",
  "server",
  "metro",
  "externals.js",
);

if (!fs.existsSync(target)) {
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");
if (src.includes("Strip node: prefix")) {
  process.exit(0);
}

const needle =
  "const NODE_STDLIB_MODULES = [\n" +
  '    "fs/promises",\n' +
  "    ...(_module.builtinModules || // @ts-expect-error\n" +
  '    (process.binding ? Object.keys(process.binding("natives")) : []) || []).filter((x)=>!/^_|^(internal|v8|node-inspect)\\/|\\//.test(x) && ![\n' +
  '            "sys"\n' +
  "        ].includes(x)\n" +
  "    ), \n" +
  "].sort();";

const replacement =
  "const NODE_STDLIB_MODULES = [\n" +
  '    "fs/promises",\n' +
  "    // Strip node: prefix — Windows cannot mkdir paths like \"node:sea\" (Node 22+ builtins).\n" +
  "    ...Array.from(new Set((\n" +
  "        _module.builtinModules || // @ts-expect-error\n" +
  '        (process.binding ? Object.keys(process.binding("natives")) : []) || []\n' +
  '    ).map((x)=>x.replace(/^node:/, "")).filter((x)=>!/^_|^(internal|v8|node-inspect)\\/|\\//.test(x) && ![\n' +
  '            "sys"\n' +
  '        ].includes(x) && !x.includes(":")\n' +
  "    ))),\n" +
  "].sort();";

if (!src.includes(needle)) {
  console.warn(
    "[fix-expo-cli-windows-externals] @expo/cli externals.js shape changed; skip patch.",
  );
  process.exit(0);
}

fs.writeFileSync(target, src.replace(needle, replacement));
console.log("[fix-expo-cli-windows-externals] patched @expo/cli metro externals for Windows.");
