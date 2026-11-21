import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

expect.extend(matchers);

function createPolyfillStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(String(key));
    },
    setItem(key: string, value: string) {
      data.set(String(key), String(value));
    },
  };
}

if (typeof window !== "undefined") {
  const currentLs = (() => {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  })();

  if (!currentLs || typeof currentLs.getItem !== "function") {
    const polyfill = createPolyfillStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: polyfill,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: polyfill,
    });
  }
}

afterEach(() => {
  cleanup();
});
