import { useEffect, useState } from "react";
import { EyeOff, Globe, ShieldCheck } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { stealthSet, stealthStatus, stealthVerify, type StealthStatus } from "../ai/api";
import type { ProviderInfo } from "../ai/providers";
import { AiServiceSection } from "./AiServiceSection";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";
import { ShortcutsSection } from "./ShortcutsSection";

type Notice = { tone: "ok" | "problem"; text: string };

/** The line under the stealth toggle: what is true right now, in plain words. */
export function describeStealth(status: StealthStatus | null): Notice | null {
	if (!status) return null;
	if (!status.supported) {
		return {
			tone: "problem",
			text: "This version of Windows cannot hide windows from screen capture. Windows 10 version 2004 or newer is needed."
		};
	}
	if (!status.requested) return null;
	if (status.active) {
		return {
			tone: "ok",
			text: "Active. Zara's windows are hidden from screen capture and sharing."
		};
	}
	return { tone: "problem", text: status.problem ?? "Could not confirm that Zara is hidden." };
}

/** The setting the backend reads to decide whether Zara may search the web. */
const WEB_SEARCH_SETTING = "zara-ai-web-search";

export function AssistantTab() {
	const [stealth, setStealth] = useState<StealthStatus | null>(null);
	const [stealthBusy, setStealthBusy] = useState(false);
	// Web search is on unless the user turned it off, including when nothing is saved yet.
	const [webSearch, setWebSearch] = useState(true);
	// The AI service in use, once known: not every service can search the web.
	const [service, setService] = useState<ProviderInfo | null>(null);

	useEffect(() => {
		invoke<Record<string, string>>("load_settings")
			.then((saved) => setWebSearch(saved[WEB_SEARCH_SETTING] !== "false"))
			.catch(() => {
				// Unreadable settings mean the default: on.
			});
		stealthStatus()
			.then(setStealth)
			.catch(() => setStealth(null));
	}, []);

	const toggleWebSearch = async () => {
		const next = !webSearch;
		setWebSearch(next);
		try {
			await invoke<void>("save_setting", { key: WEB_SEARCH_SETTING, value: String(next) });
		} catch {
			setWebSearch(!next);
		}
	};

	const toggleStealth = async () => {
		if (!stealth || stealthBusy) return;
		setStealthBusy(true);
		try {
			setStealth(await stealthSet(!stealth.requested));
		} catch {
			setStealth(await stealthStatus().catch(() => stealth));
		} finally {
			setStealthBusy(false);
		}
	};

	const verifyStealth = async () => {
		setStealthBusy(true);
		try {
			setStealth(await stealthVerify());
		} finally {
			setStealthBusy(false);
		}
	};

	const stealthNotice = describeStealth(stealth);
	// Unknown until the service has loaded; a service known not to search turns the switch off.
	const searchUnavailable = service !== null && !service.supportsWebSearch;

	return (
		<>
			<AiServiceSection onServiceChange={setService} />

			<div className="setting-group-label setting-group-label--spaced">Web search</div>
			<div className="setting-group">
				<SettingRow
					icon={Globe}
					label="Let Zara search the web"
					desc={
						searchUnavailable
							? `Not available with ${service.label}. Choose OpenRouter or Google to use it.`
							: "For news, prices, scores and anything recent. Zara decides when to look something up."
					}
					divider={false}
				>
					<SettingSwitch
						checked={webSearch && !searchUnavailable}
						onToggle={() => void toggleWebSearch()}
						disabled={searchUnavailable}
						aria-label="Let Zara search the web"
					/>
				</SettingRow>
			</div>
			<p className="settings-note">
				When Zara looks something up, your question is sent to a search provider through OpenRouter.
				Each search is a small extra charge on your OpenRouter account (about a cent), and only
				happens when Zara asks for it.
			</p>

			<div className="setting-group-label setting-group-label--spaced">Privacy</div>
			<div className="setting-group">
				<SettingRow
					icon={EyeOff}
					label="Hide Zara from screen sharing"
					desc="Keeps Zara out of screenshots, recordings and shared screens"
					divider={stealth?.requested === true}
				>
					<SettingSwitch
						checked={stealth?.requested === true}
						onToggle={() => void toggleStealth()}
						disabled={!stealth || !stealth.supported || stealthBusy}
						aria-label="Hide Zara from screen sharing"
					/>
				</SettingRow>
				{stealth?.requested === true && (
					<SettingRow
						icon={ShieldCheck}
						label="Verify now"
						desc="Check every Zara window again"
						action
						divider={false}
						onClick={() => void verifyStealth()}
					/>
				)}
			</div>
			{stealthNotice && (
				<p
					className={`settings-note ${stealthNotice.tone}`}
					role={stealthNotice.tone === "problem" ? "alert" : "status"}
				>
					{stealthNotice.text}
				</p>
			)}
			<p className="settings-note">
				Limits: Zara still shows in Task Manager and in the tray menu, software that looks for
				hidden windows can still find it, and a camera pointed at the screen sees everything.
			</p>
			<ShortcutsSection />
		</>
	);
}
