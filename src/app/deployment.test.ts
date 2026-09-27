import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as Record<string, unknown>;
const netlify = readFileSync(resolve(process.cwd(), "netlify.toml"), "utf8");
const environmentExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

describe("Phase 6 deployment configuration", () => {
  it("builds and serves Vite history routes on both providers", () => {
    expect(vercel).toMatchObject({ framework: "vite", buildCommand: "npm run build", outputDirectory: "dist" });
    expect(JSON.stringify(vercel)).toContain('"destination":"/index.html"');
    expect(netlify).toContain('command = "npm run build"');
    expect(netlify).toContain('publish = "dist"');
    expect(netlify).toContain('to = "/index.html"');
    expect(netlify).toContain("status = 200");
  });

  it("sets baseline browser security and immutable asset caching", () => {
    for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(JSON.stringify(vercel)).toContain(header);
      expect(netlify).toContain(header);
    }
    expect(JSON.stringify(vercel)).toContain("immutable");
    expect(netlify).toContain("immutable");
  });

  it("documents browser-safe variables without secret credentials", () => {
    expect(environmentExample).toContain("VITE_SUPABASE_URL");
    expect(environmentExample).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(environmentExample.toLowerCase()).not.toContain("service_role");
    expect(environmentExample.toLowerCase()).not.toContain("secret_key");
  });
});
