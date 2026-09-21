// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public browser-hash implementation and private validation for navigation-state adapters.
 *
 * Package consumers use the package-root
 * `createHashNavigationStateAdapter` export to persist navigation destination IDs
 * without replacing unrelated hash parameters. The adapter is host policy; the
 * viewer does not claim ownership of the application router or unrelated hash state.
 *
 * For maintainers, this module also validates custom adapters at the facade
 * boundary. It does not own document destination resolution or navigation
 * selection. See the [architecture guide](../ARCHITECTURE.md) for the
 * authoritative persistence and navigation ownership model.
 *
 * @author Lari Natri <lari.natri@iki.fi>
 * @copyright 2022-2026 Lari Natri
 * @license Apache-2.0
 * @packageDocumentation
 * @module hash-navigation-state
 */

import type {
  PdfjsViewerHashNavigationOptions,
  PdfjsViewerNavigationStateAdapter,
} from "./viewer-contracts.js";

/** Validates an application-supplied navigation-state adapter at the facade boundary. */
export function validateNavigationStateAdapter(adapter: PdfjsViewerNavigationStateAdapter): void {
  if (!adapter || typeof adapter !== "object")
    throw new TypeError("PdfjsViewer: navigationState must be an object");
  if (typeof adapter.readNavigationDestinationId !== "function")
    throw new TypeError(
      "PdfjsViewer: navigationState.readNavigationDestinationId must be a function",
    );
  if (typeof adapter.writeNavigationDestinationId !== "function")
    throw new TypeError(
      "PdfjsViewer: navigationState.writeNavigationDestinationId must be a function",
    );
}

/** Creates a browser hash adapter without changing unrelated hash parameters. */
export function createHashNavigationStateAdapter(
  options: PdfjsViewerHashNavigationOptions,
  ownerWindow: Window,
): PdfjsViewerNavigationStateAdapter {
  if (!options || typeof options !== "object")
    throw new TypeError("PdfjsViewer: hash navigation options must be an object");
  if (
    typeof options.navigationDestinationParam !== "string" ||
    !options.navigationDestinationParam.trim()
  ) {
    throw new TypeError("PdfjsViewer: navigationDestinationParam must be a non-empty string");
  }
  const navigationDestinationParam = options.navigationDestinationParam.trim();
  /** Parses the current hash while accepting hashes with or without a leading marker. */
  const readParams = () => new URLSearchParams(ownerWindow.location.hash.replace(/^#/, ""));
  return {
    readNavigationDestinationId: () => readParams().get(navigationDestinationParam)?.trim() || null,
    writeNavigationDestinationId: navigationDestinationId => {
      if (navigationDestinationId !== null && typeof navigationDestinationId !== "string") {
        throw new TypeError("PdfjsViewer: navigation destination ID must be a string or null");
      }
      const url = new URL(ownerWindow.location.href);
      const params = readParams();
      if (navigationDestinationId) params.set(navigationDestinationParam, navigationDestinationId);
      else params.delete(navigationDestinationParam);
      const nextHash = params.toString();
      if (ownerWindow.location.hash === (nextHash ? `#${nextHash}` : "")) return;
      url.hash = nextHash;
      ownerWindow.history.replaceState(ownerWindow.history.state, "", url);
    },
  };
}
