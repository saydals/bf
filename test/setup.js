import { JSDOM } from "jsdom";
import { vi } from "vitest";

// jsdom's localStorage can come through the vitest global bridge without a working Storage
// implementation (opaque origin -> SecurityError swallowed into an empty object). ConfigStorage
// and anything constructed at module import time (port_handler, gui, ...) dereference
// localStorage.getItem, so back it with an in-memory Storage when it is not functional.
try {
    if (typeof globalThis.localStorage?.getItem !== "function") {
        const store = new Map();
        const storage = {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(String(key), String(value)),
            removeItem: (key) => store.delete(key),
            clear: () => store.clear(),
            key: (index) => Array.from(store.keys())[index] ?? null,
            get length() {
                return store.size;
            },
        };
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            writable: true,
            value: storage,
        });
    }
} catch {
    // Nothing to do — localStorage already functional.
}

const { window } = new JSDOM("");

Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

if (globalThis.HTMLDialogElement && !globalThis.HTMLDialogElement.prototype.showModal) {
    globalThis.HTMLDialogElement.prototype.showModal = function showModal() {
        this.open = true;
    };
}

if (globalThis.HTMLDialogElement && !globalThis.HTMLDialogElement.prototype.close) {
    globalThis.HTMLDialogElement.prototype.close = function close() {
        this.open = false;
        this.dispatchEvent(new Event("close"));
    };
}
