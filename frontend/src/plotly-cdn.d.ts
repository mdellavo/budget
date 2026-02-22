// Makes the CDN-loaded window.Plotly available as a typed global.
import type * as PlotlyType from "plotly.js";
declare global {
  const Plotly: typeof PlotlyType;
}
