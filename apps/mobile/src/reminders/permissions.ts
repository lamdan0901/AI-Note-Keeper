export const checkStartupPermissions = async (): Promise<void> => {
  // Intentionally disabled: offline reminder permission prompts are no longer supported.
  return Promise.resolve();
};
