/** Full-page navigation out of the app (provider install pages). An object so tests can spy on it in jsdom. */
export const browserLocation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
