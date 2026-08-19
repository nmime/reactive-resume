// @vitest-environment happy-dom

import type { UIMessage } from "ai";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { AskUserQuestion, AssistantMarkdown } from "./agent-chat";

describe("AssistantMarkdown", () => {
	it("renders GitHub-style pipe tables as tables", () => {
		render(
			<AssistantMarkdown
				text={
					"Before\n\n| Weak/Generic | Improved Version |\n| --- | --- |\n| Placeholder text | Mentored 3+ juniors |\n| Worked closely | Collaborated with 6+ artists |\n\nAfter"
				}
			/>,
		);

		const table = screen.getByRole("table");

		expect(within(table).getByRole("columnheader", { name: "Weak/Generic" })).toBeInTheDocument();
		expect(within(table).getByRole("columnheader", { name: "Improved Version" })).toBeInTheDocument();
		expect(within(table).getByRole("cell", { name: "Mentored 3+ juniors" })).toBeInTheDocument();
		expect(screen.getByText("Before")).toBeInTheDocument();
		expect(screen.getByText("After")).toBeInTheDocument();
	});
});

const questionPart = {
	type: "tool-ask_user_question",
	toolCallId: "call-1",
	state: "input-available",
	input: { question: "Which role are you targeting?", choices: ["Engineering manager", "Staff engineer"] },
} as unknown as UIMessage["parts"][number];

const renderQuestion = (answer: string | null, onAnswer: (toolCallId: string, value: string) => void) =>
	render(
		<I18nProvider i18n={i18n}>
			<AskUserQuestion part={questionPart} answer={answer} onAnswer={onAnswer} />
		</I18nProvider>,
	);

describe("AskUserQuestion", () => {
	beforeAll(() => {
		i18n.loadAndActivate({ locale: "en", messages: {} });
	});

	it("submits the selected choice as the tool output", () => {
		const onAnswer = vi.fn();
		renderQuestion(null, onAnswer);

		fireEvent.click(screen.getByRole("radio", { name: "Staff engineer" }));
		fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

		expect(onAnswer).toHaveBeenCalledWith("call-1", "Staff engineer");
	});

	it("submits a freeform answer when no choice fits", () => {
		const onAnswer = vi.fn();
		renderQuestion(null, onAnswer);

		fireEvent.change(screen.getByRole("textbox", { name: "Answer in your own words" }), {
			target: { value: "Product designer" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send answer" }));

		expect(onAnswer).toHaveBeenCalledWith("call-1", "Product designer");
	});

	it("renders the recorded answer once the question is answered", () => {
		const onAnswer = vi.fn();
		renderQuestion("Staff engineer", onAnswer);

		expect(screen.queryByRole("radio")).not.toBeInTheDocument();
		expect(screen.getByText("Staff engineer")).toBeInTheDocument();
	});
});
