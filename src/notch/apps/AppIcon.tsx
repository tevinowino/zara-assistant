import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QuickApp } from "./quickApps";

export interface AppIconProps {
	app: QuickApp;
	/** Width and height in CSS pixels. */
	size?: number;
}

/** What is known of an app's icon: still being looked up, found (a data URL), or not to be had. */
type IconState = { status: "loading" } | { status: "found"; source: string } | { status: "missing" };

/**
 * An app's own icon, as the system shows it. While it is being looked up an empty tile holds
 * the place, so no letter flashes before the real icon arrives; only an app whose icon cannot
 * be found is drawn as its first letter. Decorative: the app is named by whatever holds the icon.
 */
export function AppIcon({ app, size = 28 }: AppIconProps) {
	const [icon, setIcon] = useState<IconState>({ status: "loading" });

	useEffect(() => {
		let alive = true;
		setIcon({ status: "loading" });
		invoke<string | null>("get_app_icon", { path: app.target, name: app.name, hwnd: null })
			.then((data) => {
				if (alive) setIcon(data ? { status: "found", source: data } : { status: "missing" });
			})
			.catch(() => {
				if (alive) setIcon({ status: "missing" });
			});
		return () => {
			alive = false;
		};
	}, [app.target, app.name]);

	if (icon.status === "found") {
		return (
			<img
				className="app-icon"
				src={icon.source}
				alt=""
				width={size}
				height={size}
				draggable={false}
			/>
		);
	}
	const isMissing = icon.status === "missing";
	return (
		<span
			className={`app-icon app-icon--fallback${isMissing ? "" : " app-icon--loading"}`}
			style={{ width: size, height: size, fontSize: size * 0.5 }}
			aria-hidden="true"
		>
			{isMissing ? app.name.trim().charAt(0).toUpperCase() : null}
		</span>
	);
}
