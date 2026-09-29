import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/main.js"],
  outfile: "dist/bundle.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(options);
}
