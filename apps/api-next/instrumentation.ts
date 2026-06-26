export async function register(): Promise<void> {
  if (process.env.API_NEXT_SKIP_STARTUP === "1") {
    return;
  }

  const { ensureApiNextStartup } = await import("./src/server/startup");
  await ensureApiNextStartup();
}