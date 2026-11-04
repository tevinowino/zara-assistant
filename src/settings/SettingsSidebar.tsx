import { useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, RefreshCw, Search } from "../icons/glyphs";
import type { SettingsTab } from "./types";
import {
	searchSettingsTabs,
	type SettingsTabDefinition,
	type SettingsTabGroup
} from "./settingsTabs";

export interface SettingsSidebarProps {
	tabs: readonly SettingsTabDefinition[];
	active: SettingsTab;
	onSelect: (tab: SettingsTab) => void;
	/** Shown on the updates card, e.g. "0.2.0". */
	appVersion?: string;
}

const COLLAPSED_STORAGE_KEY = "zara-settings-sidebar-collapsed";

const GROUP_LABELS: Record<SettingsTabGroup, string | null> = {
	main: null,
	other: "Other"
};

function readCollapsed(): boolean {
	try {
		return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

/**
 * The list of sections, after a product sidebar: the Zara name with a button that folds the
 * sidebar down to icons, a search box (Ctrl+F) that narrows the sections, the sections in
 * groups with the current one glowing in the accent, and an updates card at the foot.
 *
 * In a narrow window the same navigation becomes a strip across the top (see Settings.css):
 * the brand, search and card are dropped, and no section is ever an unlabelled icon. When
 * folded, the labels are hidden from the eye but stay as each button's accessible name.
 */
export function SettingsSidebar({ tabs, active, onSelect, appVersion }: SettingsSidebarProps) {
	const [collapsed, setCollapsed] = useState(readCollapsed);
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const visibleTabs = searchSettingsTabs(tabs, query);

	useEffect(() => {
		const focusSearchOnCtrlF = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
			event.preventDefault();
			setCollapsed(false);
			searchRef.current?.focus();
			searchRef.current?.select();
		};
		window.addEventListener("keydown", focusSearchOnCtrlF);
		return () => window.removeEventListener("keydown", focusSearchOnCtrlF);
	}, []);

	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		try {
			localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
		} catch {
			// The sidebar still folds; it just opens unfolded next time.
		}
	};

	const openFirstMatch = () => {
		if (visibleTabs.length === 0) return;
		onSelect(visibleTabs[0].id);
		setQuery("");
	};

	const renderTab = ({ id, label, icon: Icon }: SettingsTabDefinition) => (
		<button
			key={id}
			type="button"
			className={`sidebar-tab ${active === id ? "active" : ""}`}
			aria-current={active === id ? "page" : undefined}
			title={collapsed ? label : undefined}
			onClick={() => onSelect(id)}
		>
			<span className="sidebar-tab-icon" aria-hidden="true">
				<Icon size={18} strokeWidth={1.75} />
			</span>
			<span className="sidebar-tab-label">{label}</span>
		</button>
	);

	return (
		<nav className="settings-sidebar" aria-label="Settings sections" data-collapsed={collapsed}>
			<div className="sidebar-brand">
				<img className="sidebar-brand-mark" src="/zara.png" alt="" draggable={false} />
				<strong className="sidebar-brand-name">Zara</strong>
				<button
					type="button"
					className="sidebar-collapse"
					aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					aria-expanded={!collapsed}
					title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					onClick={toggleCollapsed}
				>
					{collapsed ? (
						<PanelLeftOpen size={18} strokeWidth={1.75} />
					) : (
						<PanelLeftClose size={18} strokeWidth={1.75} />
					)}
				</button>
			</div>

			<label className="sidebar-search">
				<Search size={16} strokeWidth={1.75} aria-hidden="true" />
				<input
					ref={searchRef}
					type="search"
					value={query}
					placeholder="Search settings"
					aria-label="Search settings"
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") openFirstMatch();
						if (event.key === "Escape") setQuery("");
					}}
				/>
				<kbd aria-hidden="true">Ctrl</kbd>
				<kbd aria-hidden="true">F</kbd>
			</label>

			{visibleTabs.length === 0 && (
				<p className="sidebar-empty" role="status">
					No section matches “{query.trim()}”.
				</p>
			)}

			{(["main", "other"] as const).map((group) => {
				const inGroup = visibleTabs.filter((tab) => tab.group === group);
				if (inGroup.length === 0) return null;
				const groupLabel = GROUP_LABELS[group];
				return (
					<div key={group} className="sidebar-group" data-group={group}>
						{groupLabel && <div className="sidebar-group-label">{groupLabel}</div>}
						{inGroup.map(renderTab)}
					</div>
				);
			})}

			<div className="sidebar-footer">
				<div className="sidebar-update-card">
					<div className="sidebar-update-title">Zara{appVersion ? ` ${appVersion}` : ""}</div>
					<p>See whether a newer version is ready, and install it.</p>
					<button type="button" className="sidebar-update-button" onClick={() => onSelect("about")}>
						<RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
						Check for updates
					</button>
				</div>
			</div>
		</nav>
	);
}
