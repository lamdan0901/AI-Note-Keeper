let logoutInProgress = false;

export const beginLogoutTransition = (): void => {
  logoutInProgress = true;
};

export const endLogoutTransition = (): void => {
  logoutInProgress = false;
};

export const isLogoutTransitionActive = (): boolean => logoutInProgress;
