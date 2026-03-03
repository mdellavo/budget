import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiSummaryCard from "./AiSummaryCard";
import type { ReportSummary } from "../types";

const SUMMARY: ReportSummary = {
  narrative: "You spent **$2,100** this month.",
  insights: ["**Food** was the top category.", "No recurring charges changed."],
  recommendations: ["Reduce dining out to save more."],
};

describe("AiSummaryCard", () => {
  it("shows loading skeleton when loading and no summary", () => {
    const { container } = render(
      <AiSummaryCard summary={null} loading={true} onRegenerate={vi.fn()} />
    );
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("Key Insights")).not.toBeInTheDocument();
  });

  it("shows spinner on the Regenerate button while loading", () => {
    const { container } = render(
      <AiSummaryCard summary={null} loading={true} onRegenerate={vi.fn()} />
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("disables Regenerate button while loading", () => {
    render(<AiSummaryCard summary={SUMMARY} loading={true} onRegenerate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Regenerate/i })).toBeDisabled();
  });

  it("renders section headings when summary is provided", () => {
    render(<AiSummaryCard summary={SUMMARY} loading={false} onRegenerate={vi.fn()} />);
    expect(screen.getByText("AI Summary")).toBeInTheDocument();
    expect(screen.getByText("Key Insights")).toBeInTheDocument();
    expect(screen.getByText("Recommendations")).toBeInTheDocument();
  });

  it("renders narrative text content", () => {
    render(<AiSummaryCard summary={SUMMARY} loading={false} onRegenerate={vi.fn()} />);
    expect(document.body.textContent).toContain("You spent");
    expect(document.body.textContent).toContain("$2,100");
    expect(document.body.textContent).toContain("this month.");
  });

  it("renders insights and recommendations text", () => {
    render(<AiSummaryCard summary={SUMMARY} loading={false} onRegenerate={vi.fn()} />);
    expect(document.body.textContent).toContain("No recurring charges changed.");
    expect(document.body.textContent).toContain("Reduce dining out to save more.");
  });

  it("renders **bold** markdown as <strong> elements", () => {
    const { container } = render(
      <AiSummaryCard summary={SUMMARY} loading={false} onRegenerate={vi.fn()} />
    );
    const boldTexts = Array.from(container.querySelectorAll("strong")).map((el) => el.textContent);
    expect(boldTexts).toContain("$2,100");
    expect(boldTexts).toContain("Food");
  });

  it("calls onRegenerate when Regenerate button is clicked", async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    render(<AiSummaryCard summary={SUMMARY} loading={false} onRegenerate={onRegenerate} />);
    await user.click(screen.getByRole("button", { name: /Regenerate/i }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("applies className prop to the card container", () => {
    const { container } = render(
      <AiSummaryCard summary={null} loading={false} onRegenerate={vi.fn()} className="mt-6" />
    );
    expect(container.firstChild).toHaveClass("mt-6");
  });
});
