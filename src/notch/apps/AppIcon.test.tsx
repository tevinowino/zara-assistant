import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invokeCalls, setInvokeHandler } from "../../test/shims/tauriCore";
import { AppIcon } from "./AppIcon";

describe("AppIcon", () => {
	it("shows the app's own icon once it has loaded", async () => {
		setInvokeHandler("get_app_icon", () => "data:image/png;base64,AAAA");

		const { container } = render(<AppIcon app={{ name: "Spotify", target: "C:\\s.lnk" }} />);

		await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
		expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA");
	});

	it("asks for the icon by the app's path and name", async () => {
		setInvokeHandler("get_app_icon", () => null);

		render(<AppIcon app={{ name: "Spotify", target: "C:\\Apps\\Spotify.lnk" }} />);

		await waitFor(() =>
			expect(invokeCalls.find((call) => call.command === "get_app_icon")?.args).toEqual({
				path: "C:\\Apps\\Spotify.lnk",
				name: "Spotify",
				hwnd: null
			})
		);
	});

	it("holds the place with an empty tile, not a letter, until the icon has loaded", () => {
		setInvokeHandler("get_app_icon", () => new Promise(() => {}));

		const { container } = render(<AppIcon app={{ name: "spotify", target: "C:\\s.lnk" }} />);

		expect(container.querySelector(".app-icon--loading")).toBeInTheDocument();
		expect(container.querySelector(".app-icon")).toBeEmptyDOMElement();
	});

	it("keeps the letter for an app whose icon cannot be found", async () => {
		setInvokeHandler("get_app_icon", () => null);

		const { container } = render(<AppIcon app={{ name: "Notepad", target: "C:\\n.lnk" }} />);

		await waitFor(() =>
			expect(container.querySelector(".app-icon--fallback")).toHaveTextContent("N")
		);
		expect(container.querySelector(".app-icon--loading")).toBeNull();
		expect(container.querySelector("img")).toBeNull();
	});

	it("keeps the letter when looking for the icon fails", async () => {
		setInvokeHandler("get_app_icon", () => {
			throw new Error("no icon service");
		});

		const { container } = render(<AppIcon app={{ name: "Notepad", target: "C:\\n.lnk" }} />);

		await waitFor(() =>
			expect(container.querySelector(".app-icon--fallback")).toHaveTextContent("N")
		);
	});

	it("is decorative, so it is hidden from assistive technology", async () => {
		setInvokeHandler("get_app_icon", () => "data:image/png;base64,AAAA");

		const { container } = render(<AppIcon app={{ name: "Spotify", target: "C:\\s.lnk" }} />);

		await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
		expect(container.querySelector("img")).toHaveAttribute("alt", "");
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});

	it("looks again for the icon when the app changes", async () => {
		setInvokeHandler("get_app_icon", (args) =>
			(args as { name: string }).name === "A"
				? "data:image/png;base64,AAAA"
				: "data:image/png;base64,BBBB"
		);
		const { container, rerender } = render(<AppIcon app={{ name: "A", target: "C:\\a.lnk" }} />);
		await waitFor(() =>
			expect(container.querySelector("img")?.getAttribute("src")).toContain("AAAA")
		);

		rerender(<AppIcon app={{ name: "B", target: "C:\\b.lnk" }} />);

		await waitFor(() =>
			expect(container.querySelector("img")?.getAttribute("src")).toContain("BBBB")
		);
	});
});
