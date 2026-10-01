// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/** Ordered complete local package qualification commands. */
export const TEST_EVERYTHING_COMMANDS = Object.freeze([
  "validate",
  "test:compatibility",
  "build",
  "validate:dist",
  "test:browser",
  "test:browser:mobile:chromium",
  "test:browser:mobile:firefox",
  "test:browser:webkit:docker",
  "test:browser:mobile:webkit:docker",
  "test:pack",
]);
