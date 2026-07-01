import type { ComposedServices } from "./compose-services-impl";

export type { ComposedServices } from "./compose-services-impl";

export {
  createReadinessProbe,
  ensureApiNextStartup,
  isDependencyDegraded,
  runInitialStartupChecks,
} from "@/server/startup";

type ComposeServicesImpl = typeof import("./compose-services-impl");

let implPromise: Promise<ComposeServicesImpl> | null = null;

const loadImpl = (): Promise<ComposeServicesImpl> => {
  if (!implPromise) {
    implPromise = import("./compose-services-impl");
  }

  return implPromise;
};

export const getComposedServices = async (): Promise<ComposedServices> => {
  const impl = await loadImpl();
  return impl.getComposedServices();
};

export const setComposedServicesForTests = async (services: ComposedServices): Promise<void> => {
  const impl = await loadImpl();
  impl.setComposedServicesForTests(services);
};

export const resetComposedServicesForTests = async (): Promise<void> => {
  const impl = await loadImpl();
  impl.resetComposedServicesForTests();
};