import { useEffect, useMemo, useRef } from "react";
import type { CategoryBreakdown } from "../types";
import type { Data, Layout, Config } from "plotly.js";

declare const Plotly: {
  react: (el: HTMLElement, data: Data[], layout: Partial<Layout>, config?: Partial<Config>) => void;
};

const PALETTE = [
  "#3b82f6",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#ec4899",
  "#6366f1",
  "#84cc16",
  "#ef4444",
  "#06b6d4",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#22c55e",
  "#0ea5e9",
];

export default function SpendingChart({ breakdown }: { breakdown: CategoryBreakdown[] }) {
  const divRef = useRef<HTMLDivElement>(null);

  const { trace, layout, config } = useMemo(() => {
    const ids: string[] = [];
    const labels: string[] = [];
    const parents: string[] = [];
    const values: number[] = [];
    const colors: string[] = [];

    breakdown.forEach((cat, i) => {
      const color = PALETTE[i % PALETTE.length];
      ids.push(cat.category);
      labels.push(cat.category);
      parents.push("");
      values.push(Math.abs(parseFloat(cat.total)));
      colors.push(color);

      cat.subcategories.forEach((sub) => {
        ids.push(`${cat.category}/${sub.subcategory}`);
        labels.push(sub.subcategory);
        parents.push(cat.category);
        values.push(Math.abs(parseFloat(sub.total)));
        colors.push(color);
      });
    });

    const trace: Data = {
      type: "sunburst",
      ids,
      labels,
      parents,
      values,
      branchvalues: "total",
      marker: { colors },
      hovertemplate: "%{label}<br><b>$%{value:,.2f}</b> (%{percentRoot:.1%})<extra></extra>",
      textinfo: "label+percent",
      insidetextorientation: "radial",
    } as unknown as Data;

    const layout: Partial<Layout> = {
      paper_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 0, r: 0, t: 0, b: 0 },
    };

    const config: Partial<Config> = { responsive: true, displayModeBar: false };

    return { trace, layout, config };
  }, [breakdown]);

  useEffect(() => {
    if (!divRef.current) return;
    Plotly.react(divRef.current, [trace], layout, config);
  }, [trace, layout, config]);

  return <div ref={divRef} style={{ width: "100%", height: 420 }} />;
}
