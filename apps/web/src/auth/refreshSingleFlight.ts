export const createRefreshSingleFlight = <T>(refresh: () => Promise<T>): (() => Promise<T>) => {
  let inFlightRefresh: Promise<T> | null = null;

  return async () => {
    if (inFlightRefresh) {
      return await inFlightRefresh;
    }

    inFlightRefresh = refresh().finally(() => {
      inFlightRefresh = null;
    });

    return await inFlightRefresh;
  };
};
