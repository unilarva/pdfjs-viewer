// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { createPdfjsViewerUi, PDFJS_VIEWER_STATE_CLASSES } from "@unilarva/pdfjs-viewer";
import "@unilarva/pdfjs-viewer/default-ui.css";

const app = document.querySelector("#app");
if (!app) throw new Error("Missing package smoke root");
app.append(createPdfjsViewerUi({ id: "webpack-package-smoke", controls: { print: false } }));
app.classList.add(PDFJS_VIEWER_STATE_CLASSES.documentProgressVisible);
