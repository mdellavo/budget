import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ComboBox from "./ComboBox";

describe("ComboBox", () => {
  it("renders with the given value", () => {
    render(<ComboBox value="hello" onChange={vi.fn()} suggestions={[]} />);
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("calls onChange when the user types", async () => {
    const onChange = vi.fn();
    render(<ComboBox value="" onChange={onChange} suggestions={[]} />);
    await userEvent.type(screen.getByRole("textbox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows the suggestions dropdown when focused with suggestions present", async () => {
    render(<ComboBox value="" onChange={vi.fn()} suggestions={["Starbucks", "Target"]} />);
    await userEvent.click(screen.getByRole("textbox"));
    expect(screen.getByText("Starbucks")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
  });

  it("does not show a dropdown when the suggestions list is empty", async () => {
    const { container } = render(<ComboBox value="test" onChange={vi.fn()} suggestions={[]} />);
    await userEvent.click(screen.getByRole("textbox"));
    expect(container.querySelector("ul")).not.toBeInTheDocument();
  });

  it("calls onChange with the suggestion and closes the dropdown on click", async () => {
    const onChange = vi.fn();
    render(<ComboBox value="" onChange={onChange} suggestions={["Starbucks", "Target"]} />);
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.click(screen.getByText("Starbucks"));
    expect(onChange).toHaveBeenCalledWith("Starbucks");
    expect(screen.queryByText("Target")).not.toBeInTheDocument();
  });

  it("selects the first suggestion and closes the dropdown on Enter", async () => {
    const onChange = vi.fn();
    render(<ComboBox value="" onChange={onChange} suggestions={["Starbucks", "Target"]} />);
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("Starbucks");
    expect(screen.queryByText("Target")).not.toBeInTheDocument();
  });

  it("closes the dropdown on Escape without calling onChange", async () => {
    const onChange = vi.fn();
    render(<ComboBox value="" onChange={onChange} suggestions={["Starbucks"]} />);
    await userEvent.click(screen.getByRole("textbox"));
    expect(screen.getByText("Starbucks")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Starbucks")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders as disabled when the disabled prop is set", () => {
    render(<ComboBox value="" onChange={vi.fn()} suggestions={[]} disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("applies the className prop to the input element", () => {
    render(<ComboBox value="" onChange={vi.fn()} suggestions={[]} className="my-class" />);
    expect(screen.getByRole("textbox")).toHaveClass("my-class");
  });

  it("renders the placeholder text", () => {
    render(<ComboBox value="" onChange={vi.fn()} suggestions={[]} placeholder="Search…" />);
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
  });
});
