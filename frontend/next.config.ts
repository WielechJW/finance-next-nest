import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.BROWSER_TEST_BUILD === "1"
    ? {
        distDir: ".next-browser-test",
        typescript: { tsconfigPath: "tsconfig.browser.json" },
      }
    : {}),
};

export default nextConfig;
