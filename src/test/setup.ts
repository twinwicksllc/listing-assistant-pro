import "@testing-library/jest-dom";

// jsdom has no ResizeObserver, but recharts' ResponsiveContainer requires
// one to mount at all -- without this, any test rendering a recharts chart
// (e.g. QuotaMonitoringCard) throws "ResizeObserver is not defined".
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error -- test-only global polyfill, not a real ResizeObserver
window.ResizeObserver = ResizeObserverStub;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
