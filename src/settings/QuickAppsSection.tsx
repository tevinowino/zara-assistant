import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronUp, FolderOpen, Plus, X } from "../icons/glyphs";
import { AppIcon } from "../notch/apps/AppIcon";
import {
	appNameFromPath,
	hasQuickApp,
	isQuickAppsFull,
	MAX_QUICK_APPS,
	type QuickApp
} from "../notch/apps/quickApps";

interface InstalledApp {
	name: string;
	path: string;
}

export interface QuickAppsSectionProps {
	apps: readonly QuickApp[];
	onAdd: (app: QuickApp) => void;
	onRemove: (target: string) => void;
	onMove: (target: string, direction: -1 | 1) => void;
}

/**
 * Where the user chooses the apps pinned to the command center, up to four: the chosen ones
 * with arrows to reorder them, a searchable list of the apps installed on this PC, and a
 * way to browse for a program that is not in the Start Menu.
 */
export function QuickAppsSection({ apps, onAdd, onRemove, onMove }: QuickAppsSectionProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const full = isQuickAppsFull(apps);

	return (
		<div className="setting-group">
			{apps.map((app, index) => (
				<div key={app.target} className="setting-item quick-app-row">
					<span className="quick-app-icon">
						<AppIcon app={app} size={28} />
					</span>
					<div className="setting-info">
						<span className="setting-label">{app.name}</span>
					</div>
					<span className="widget-move" role="group" aria-label={`Move ${app.name}`}>
						<button
							type="button"
							className="widget-move-button"
							aria-label={`Move ${app.name} earlier`}
							disabled={index === 0}
							onClick={() => onMove(app.target, -1)}
						>
							<ChevronUp size={14} strokeWidth={2.4} />
						</button>
						<button
							type="button"
							className="widget-move-button"
							aria-label={`Move ${app.name} later`}
							disabled={index === apps.length - 1}
							onClick={() => onMove(app.target, 1)}
						>
							<ChevronDown size={14} strokeWidth={2.4} />
						</button>
					</span>
					<button
						type="button"
						className="widget-move-button"
						aria-label={`Remove ${app.name}`}
						onClick={() => onRemove(app.target)}
					>
						<X size={14} strokeWidth={2.4} />
					</button>
				</div>
			))}

			{apps.length > 0 && <div className="setting-divider" />}

			<div className="setting-item">
				<div className="setting-icon-bg">
					<Plus size={14} strokeWidth={1.5} />
				</div>
				<div className="setting-info">
					<span className="setting-label">Add an app</span>
					<span className="setting-desc">
						{full
							? `You can pin up to ${MAX_QUICK_APPS} apps. Remove one to add another.`
							: `Pin up to ${MAX_QUICK_APPS} apps you use every day (${apps.length} of ${MAX_QUICK_APPS} chosen).`}
					</span>
				</div>
				<button
					type="button"
					className="settings-button quiet"
					disabled={full}
					aria-expanded={pickerOpen}
					onClick={() => setPickerOpen((open) => !open)}
				>
					{pickerOpen ? "Done" : "Choose…"}
				</button>
			</div>

			{pickerOpen && !full && (
				<AppPicker chosen={apps} onAdd={onAdd} onFinished={() => setPickerOpen(false)} />
			)}
		</div>
	);
}

function AppPicker({
	chosen,
	onAdd,
	onFinished
}: {
	chosen: readonly QuickApp[];
	onAdd: (app: QuickApp) => void;
	onFinished: () => void;
}) {
	const [installed, setInstalled] = useState<InstalledApp[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");

	useEffect(() => {
		let alive = true;
		invoke<InstalledApp[]>("apps_list_installed")
			.then((apps) => alive && setInstalled(apps))
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
		};
	}, []);

	const matches = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return (installed ?? []).filter(
			(app) => needle === "" || app.name.toLowerCase().includes(needle)
		);
	}, [installed, query]);

	const add = (app: QuickApp) => {
		onAdd(app);
		// Choosing the last free place ends the choosing.
		if (chosen.length + 1 >= MAX_QUICK_APPS) onFinished();
	};

	const browse = async () => {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const picked = await open({
				multiple: false,
				directory: false,
				title: "Choose an app",
				filters: [{ name: "Programs and shortcuts", extensions: ["exe", "lnk"] }]
			});
			if (typeof picked === "string") add({ name: appNameFromPath(picked), target: picked });
		} catch {
			// Closing the dialog, or no dialog available, is not an error worth showing.
		}
	};

	return (
		<div className="quick-app-picker">
			<div className="quick-app-picker-tools">
				<input
					type="search"
					className="settings-input wide"
					placeholder="Search apps"
					aria-label="Search apps"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					autoFocus
				/>
				<button type="button" className="settings-button quiet" onClick={() => void browse()}>
					<FolderOpen size={13} strokeWidth={2} /> Browse…
				</button>
			</div>

			{failed && <p className="settings-note problem">The list of apps could not be read.</p>}
			{!failed && installed === null && <p className="settings-note">Looking for your apps…</p>}
			{installed !== null && matches.length === 0 && (
				<p className="settings-note">No app matches “{query}”.</p>
			)}

			<ul className="quick-app-choices" aria-label="Installed apps">
				{matches.map((app) => {
					const already = hasQuickApp(chosen, app.path);
					return (
						<li key={app.path}>
							<button
								type="button"
								className="quick-app-choice"
								disabled={already}
								aria-label={already ? `${app.name}, already pinned` : `Add ${app.name}`}
								onClick={() => add({ name: app.name, target: app.path })}
							>
								<AppIcon app={{ name: app.name, target: app.path }} size={22} />
								<span>{app.name}</span>
								{already && <span className="quick-app-pinned">Pinned</span>}
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
