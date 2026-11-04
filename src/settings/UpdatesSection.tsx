import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, RefreshCw } from "lucide-react";
import {
	AUTO_UPDATE_SETTING,
	describeUpdateError,
	findUpdate,
	type AvailableUpdate
} from "../updates/updates";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

type Status =
	| { kind: "idle" }
	| { kind: "checking" }
	| { kind: "up-to-date" }
	| { kind: "available"; update: AvailableUpdate }
	| { kind: "installing"; share: number | null }
	| { kind: "problem"; text: string };

function describe(status: Status, appVersion: string): string {
	switch (status.kind) {
		case "idle":
			return `You have version ${appVersion}.`;
		case "checking":
			return "Checking…";
		case "up-to-date":
			return `Zara ${appVersion} is the latest version.`;
		case "available":
			return `Zara ${status.update.version} is available.`;
		case "installing":
			return status.share === null
				? "Downloading the update…"
				: `Downloading the update… ${Math.round(status.share * 100)}%`;
		case "problem":
			return status.text;
	}
}

interface UpdatesSectionProps {
	appVersion: string;
}

/**
 * Updating Zara by hand, and whether it checks by itself at startup. A found
 * update is installed on request: Zara downloads it, installs it and restarts.
 */
export function UpdatesSection({ appVersion }: UpdatesSectionProps) {
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	// Checking at startup is on unless the user turned it off, including when nothing is saved yet.
	const [autoCheck, setAutoCheck] = useState(true);

	useEffect(() => {
		invoke<Record<string, string>>("load_settings")
			.then((saved) => setAutoCheck(saved[AUTO_UPDATE_SETTING] !== "false"))
			.catch(() => {
				// Unreadable settings mean the default: on.
			});
	}, []);

	const checkNow = async () => {
		setStatus({ kind: "checking" });
		try {
			const update = await findUpdate();
			setStatus(update ? { kind: "available", update } : { kind: "up-to-date" });
		} catch (error) {
			setStatus({ kind: "problem", text: describeUpdateError(error) });
		}
	};

	const install = async (update: AvailableUpdate) => {
		setStatus({ kind: "installing", share: null });
		try {
			await update.install((share) => setStatus({ kind: "installing", share }));
		} catch (error) {
			setStatus({ kind: "problem", text: describeUpdateError(error) });
		}
	};

	const toggleAutoCheck = async () => {
		const next = !autoCheck;
		setAutoCheck(next);
		try {
			await invoke<void>("save_setting", { key: AUTO_UPDATE_SETTING, value: String(next) });
		} catch {
			setAutoCheck(!next);
		}
	};

	const busy = status.kind === "checking" || status.kind === "installing";

	return (
		<>
			<div className="setting-group-label setting-group-label--spaced">Updates</div>
			<div className="setting-group">
				<SettingRow
					icon={status.kind === "available" ? Download : RefreshCw}
					label="Check for updates"
					desc={describe(status, appVersion)}
				>
					{status.kind === "available" ? (
						<button
							type="button"
							className="settings-button"
							onClick={() => void install(status.update)}
						>
							{`Install ${status.update.version}`}
						</button>
					) : (
						<button
							type="button"
							className="settings-button quiet"
							onClick={() => void checkNow()}
							disabled={busy}
						>
							Check now
						</button>
					)}
				</SettingRow>
				<SettingRow
					icon={RefreshCw}
					label="Check automatically"
					desc="Looks for a new version shortly after Zara starts and asks before installing it."
					divider={false}
				>
					<SettingSwitch
						checked={autoCheck}
						onToggle={() => void toggleAutoCheck()}
						aria-label="Check for updates automatically"
					/>
				</SettingRow>
			</div>
		</>
	);
}
