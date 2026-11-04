import { useCallback, useEffect, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRightLeft, KeyRound, Layers, LifeBuoy, RotateCw, Server } from "../icons/glyphs";
import {
	aiClearApiKey,
	aiGetSettings,
	aiListModels,
	aiSetApiKey,
	aiTestConnection,
	saveAiSetting,
	toAiError
} from "../ai/api";
import {
	AI_PROVIDER_SETTING,
	aiSettingKeys,
	readinessOf,
	shortName,
	type AiSettingsView,
	type ProviderId,
	type ProviderInfo,
	type Readiness,
	type TuningValues
} from "../ai/providers";
import { ModelPicker } from "./ModelPicker";
import { ModelTuning } from "./ModelTuning";
import { PROVIDER_TAGLINES, ProviderLogo } from "./ProviderLogo";
import { SettingRow } from "./SettingRow";

type Notice = { provider: ProviderId; tone: "ok" | "problem"; text: string };
type ModelList = { status: "loading" | "ready" | "error"; ids: string[] };

const READINESS_LABEL: Record<Readiness, string> = {
	ready: "Ready",
	"needs-key": "Needs a key",
	"needs-setup": "Needs setup"
};

/** "In use" for the service Zara uses, unless it cannot answer yet; else what the service needs. */
function statusLabel(inUse: boolean, readiness: Readiness): string {
	return inUse && readiness === "ready" ? "In use" : READINESS_LABEL[readiness];
}

/** Something pasted that could be an API key: one long word, no spaces. */
function looksLikeApiKey(text: string): boolean {
	return text.length >= 16 && !/\s/.test(text);
}

interface AiServiceSectionProps {
	/** Told which service is in use (and again when it changes), so the page can show what it can do. */
	onServiceChange?: (service: ProviderInfo) => void;
}

/**
 * Which AI service Zara uses and how. Every service is a tile; choosing a tile
 * shows its key, model and backup model without switching to it, and "Use" makes
 * it the one in use. Model, backup and address are remembered per service.
 */
export function AiServiceSection({ onServiceChange }: AiServiceSectionProps) {
	const [view, setView] = useState<AiSettingsView | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [viewing, setViewing] = useState<ProviderId | null>(null);
	const [models, setModels] = useState<Partial<Record<ProviderId, ModelList>>>({});
	const [notice, setNotice] = useState<Notice | null>(null);

	useEffect(() => {
		aiGetSettings()
			.then(setView)
			.catch((error) => setProblem(toAiError(error).message));
	}, []);

	const inUse = view?.providers.find((service) => service.id === view.provider);
	const shown = view?.providers.find((service) => service.id === (viewing ?? view.provider));

	useEffect(() => {
		if (inUse) onServiceChange?.(inUse);
	}, [inUse, onServiceChange]);

	const updateService = useCallback((id: ProviderId, changes: Partial<ProviderInfo>) => {
		setView((previous) =>
			previous
				? {
						...previous,
						providers: previous.providers.map((service) =>
							service.id === id ? { ...service, ...changes } : service
						)
					}
				: previous
		);
	}, []);

	const loadModels = useCallback(async (id: ProviderId) => {
		setModels((previous) => ({
			...previous,
			[id]: { status: "loading", ids: previous[id]?.ids ?? [] }
		}));
		try {
			const ids = await aiListModels(id);
			setModels((previous) => ({ ...previous, [id]: { status: "ready", ids } }));
		} catch {
			setModels((previous) => ({
				...previous,
				[id]: { status: "error", ids: previous[id]?.ids ?? [] }
			}));
		}
	}, []);

	// A service's full model list is loaded as soon as it can be, with nothing to press:
	// when it is on screen (or is the backup of the one on screen) and has a key, or needs none.
	const backupService = shown?.fallbackProvider
		? view?.providers.find((service) => service.id === shown.fallbackProvider)
		: undefined;
	const idsToLoad = [shown, backupService].flatMap((service) =>
		service && (!service.keyRequired || service.hasKey) && !models[service.id] ? [service.id] : []
	);
	const loadKey = idsToLoad.join(",");
	useEffect(() => {
		if (loadKey) for (const id of loadKey.split(",") as ProviderId[]) void loadModels(id);
	}, [loadKey, loadModels]);

	const saveTuning = useCallback((id: ProviderId, model: string, values: TuningValues) => {
		setView((previous) =>
			previous
				? {
						...previous,
						providers: previous.providers.map((service) => {
							if (service.id !== id) return service;
							const tuning = { ...service.tuning };
							if (Object.keys(values).length === 0) delete tuning[model];
							else tuning[model] = values;
							return { ...service, tuning };
						})
					}
				: previous
		);
	}, []);

	const useService = async (id: ProviderId): Promise<boolean> => {
		try {
			await saveAiSetting(AI_PROVIDER_SETTING, id);
			setView((previous) => (previous ? { ...previous, provider: id } : previous));
			return true;
		} catch (error) {
			setProblem(toAiError(error).message);
			return false;
		}
	};

	if (problem && !view) {
		return (
			<p className="settings-note problem" role="alert">
				{problem}
			</p>
		);
	}
	if (!view || !inUse || !shown) return null;

	const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
		const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const ids = view.providers.map((service) => service.id);
		const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
		const next = ids[(ids.indexOf(shown.id) + step + ids.length) % ids.length];
		setViewing(next);
		requestAnimationFrame(() =>
			document.querySelector<HTMLElement>(`[data-service="${next}"]`)?.focus()
		);
	};

	return (
		<>
			<div className="setting-group-label">AI service</div>
			<div
				className="service-grid"
				role="radiogroup"
				aria-label="AI service"
				onKeyDown={moveSelection}
			>
				{view.providers.map((service) => {
					const state = service.id === inUse.id ? "in-use" : readinessOf(service);
					// The service in use says what it is missing, if it cannot answer yet.
					const status = statusLabel(service.id === inUse.id, readinessOf(service));
					return (
						<button
							key={service.id}
							type="button"
							role="radio"
							aria-checked={service.id === shown.id}
							tabIndex={service.id === shown.id ? 0 : -1}
							data-service={service.id}
							data-state={state}
							className="service-tile"
							onClick={() => setViewing(service.id)}
						>
							<ProviderLogo provider={service.id} size={18} />
							<span className="service-tile-name">{shortName(service)}</span>
							<span className="service-tile-status">{status}</span>
						</button>
					);
				})}
			</div>

			<ServiceDetails
				key={shown.id}
				service={shown}
				services={view.providers}
				backupModelList={backupService ? models[backupService.id] : undefined}
				onReloadBackupModels={() => backupService && void loadModels(backupService.id)}
				onTuningSaved={saveTuning}
				inUse={shown.id === inUse.id}
				modelList={models[shown.id]}
				notice={notice?.provider === shown.id ? notice : null}
				onNotice={(next) => setNotice(next ? { provider: shown.id, ...next } : null)}
				onChange={(changes) => updateService(shown.id, changes)}
				onUse={() => useService(shown.id)}
				activeIsReady={readinessOf(inUse) === "ready"}
				onReloadModels={() => void loadModels(shown.id)}
				onForgetModels={() =>
					setModels((previous) => {
						const next = { ...previous };
						delete next[shown.id];
						return next;
					})
				}
			/>
		</>
	);
}

interface ServiceDetailsProps {
	service: ProviderInfo;
	/** Every service, for choosing where the backup model runs. */
	services: ProviderInfo[];
	/** The model list of the backup's service, when that is not this one. */
	backupModelList: ModelList | undefined;
	onReloadBackupModels: () => void;
	/** Told after one model's settings are saved, on any service. */
	onTuningSaved: (provider: ProviderId, model: string, values: TuningValues) => void;
	/** This is the service Zara uses now. */
	inUse: boolean;
	/** Whether the service in use can answer, deciding if a new key should take over. */
	activeIsReady: boolean;
	modelList: ModelList | undefined;
	notice: Omit<Notice, "provider"> | null;
	onNotice: (notice: Omit<Notice, "provider"> | null) => void;
	onChange: (changes: Partial<ProviderInfo>) => void;
	onUse: () => Promise<boolean>;
	onReloadModels: () => void;
	onForgetModels: () => void;
}

/** One service's key, model, backup model and address. Re-created for each service. */
function ServiceDetails({
	service,
	services,
	backupModelList,
	onReloadBackupModels,
	onTuningSaved,
	inUse,
	activeIsReady,
	modelList,
	notice,
	onNotice,
	onChange,
	onUse,
	onReloadModels,
	onForgetModels
}: ServiceDetailsProps) {
	const keys = aiSettingKeys(service.id);
	const name = shortName(service);
	const readiness = readinessOf(service);
	const [addressDraft, setAddressDraft] = useState(service.baseUrl ?? "");
	const [keyDraft, setKeyDraft] = useState("");
	const [replacingKey, setReplacingKey] = useState(false);
	const [addingOptionalKey, setAddingOptionalKey] = useState(false);
	const [busy, setBusy] = useState<"saving" | "testing" | "removing" | null>(null);

	const save = async (setting: string, value: string): Promise<boolean> => {
		try {
			await saveAiSetting(setting, value);
			return true;
		} catch (error) {
			onNotice({ tone: "problem", text: toAiError(error).message });
			return false;
		}
	};

	const chooseModel = async (value: string) => {
		if (value === service.model) return;
		if (await save(keys.model, value))
			onChange({ model: value === "" ? service.defaultModel : value });
	};

	const chooseBackup = async (value: string) => {
		if (value === (service.fallbackModel ?? "")) return;
		if (await save(keys.fallbackModel, value))
			onChange({ fallbackModel: value === "" ? null : value });
	};

	// The backup model may run on another service, which then brings its own key and model list.
	const backupService = services.find((other) => other.id === service.fallbackProvider) ?? service;
	const backupOnOtherService = backupService.id !== service.id;

	const chooseBackupService = async (value: string) => {
		const next = value === "" ? null : (value as ProviderId);
		if (next === service.fallbackProvider) return;
		if (!(await save(keys.fallbackProvider, next ?? ""))) return;
		// The backup model belonged to the other service, so it is chosen again: the new
		// service's own model, or none when the backup is back on this service.
		const model = next === null ? "" : (services.find((other) => other.id === next)?.model ?? "");
		if (await save(keys.fallbackModel, model))
			onChange({ fallbackProvider: next, fallbackModel: model === "" ? null : model });
	};

	const commitAddress = async () => {
		const value = addressDraft.trim();
		if (value === (service.baseUrl ?? "")) return;
		if (await save(keys.baseUrl, value)) onChange({ baseUrl: value === "" ? null : value });
	};

	const saveKey = async (raw: string) => {
		const key = raw.trim();
		if (!key || busy) return;
		setBusy("saving");
		onNotice(null);
		try {
			await aiSetApiKey(key, service.id);
			setKeyDraft("");
			setReplacingKey(false);
			setAddingOptionalKey(false);
			onChange({ hasKey: true });
			onForgetModels();
			await aiTestConnection(service.id);
			// A key that works makes this service usable. If nothing usable is in use yet,
			// it takes over; otherwise the user chooses when to switch.
			if (!inUse && !activeIsReady && (await onUse())) {
				onNotice({ tone: "ok", text: `Key saved. Zara now uses ${name}.` });
			} else {
				onNotice({ tone: "ok", text: `Connected to ${name}.` });
			}
		} catch (error) {
			onNotice({ tone: "problem", text: toAiError(error).message });
		} finally {
			setBusy(null);
		}
	};

	const testKey = async () => {
		setBusy("testing");
		onNotice(null);
		try {
			await aiTestConnection(service.id);
			onNotice({ tone: "ok", text: `Connected to ${name}.` });
		} catch (error) {
			onNotice({ tone: "problem", text: toAiError(error).message });
		} finally {
			setBusy(null);
		}
	};

	const removeKey = async () => {
		setBusy("removing");
		onNotice(null);
		try {
			await aiClearApiKey(service.id);
			onChange({ hasKey: false });
			onForgetModels();
			onNotice({ tone: "ok", text: "Key removed." });
		} catch (error) {
			onNotice({ tone: "problem", text: toAiError(error).message });
		} finally {
			setBusy(null);
		}
	};

	// Pasting a key is the usual way one arrives, so it is saved and checked at once.
	const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
		const pasted = event.clipboardData.getData("text").trim();
		if (!looksLikeApiKey(pasted)) return;
		event.preventDefault();
		void saveKey(pasted);
	};

	const showKeyField =
		(service.keyRequired && !service.hasKey) || replacingKey || addingOptionalKey;
	const keyDescription =
		busy === "saving"
			? "Checking the key…"
			: service.hasKey && !replacingKey
				? "Saved in Windows Credential Manager"
				: service.keyRequired
					? "Paste your key. It stays on this PC."
					: addingOptionalKey
						? "Paste the key your server asks for."
						: "No key needed.";

	const modelStatus = modelList?.status ?? "idle";
	const available = modelList?.ids ?? [];
	const backupList = backupOnOtherService ? backupModelList : modelList;
	const backupNeedsKey = backupOnOtherService && readinessOf(backupService) === "needs-key";

	return (
		<section
			className="service-details"
			aria-label={`${service.label} settings`}
			aria-busy={busy !== null}
		>
			<header className="service-header">
				<ProviderLogo provider={service.id} size={26} />
				<div className="service-heading">
					<h3 className="service-name">{service.label}</h3>
					<span className="service-tagline">{PROVIDER_TAGLINES[service.id]}</span>
				</div>
				<span className="service-chip" data-state={inUse ? "in-use" : readiness}>
					{statusLabel(inUse, readiness)}
				</span>
				{!inUse && readiness === "ready" && (
					<button type="button" className="settings-button" onClick={() => void onUse()}>
						{`Use ${name}`}
					</button>
				)}
			</header>
			{!inUse && readiness === "needs-key" && (
				<p className="service-hint">{`Add a key to use ${name}.`}</p>
			)}
			{!inUse && readiness === "needs-setup" && (
				<p className="service-hint">{`Add the server address and a model to use ${name}.`}</p>
			)}

			<div className="setting-group service-fields">
				<SettingRow icon={KeyRound} label="API key" desc={keyDescription}>
					{showKeyField ? (
						<>
							<input
								type="password"
								className="settings-input wide"
								value={keyDraft}
								onChange={(event) => setKeyDraft(event.target.value)}
								onPaste={handlePaste}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.nativeEvent.isComposing)
										void saveKey(keyDraft);
								}}
								placeholder="Paste API key"
								aria-label={`${service.label} API key`}
								autoComplete="off"
								spellCheck={false}
								disabled={busy !== null}
							/>
							<button
								type="button"
								className="settings-button"
								onClick={() => void saveKey(keyDraft)}
								disabled={busy !== null || keyDraft.trim() === ""}
							>
								Save key
							</button>
							{service.keyHelpUrl && (
								<button
									type="button"
									className="settings-button quiet"
									onClick={() => void openUrl(service.keyHelpUrl)}
								>
									Get a key
								</button>
							)}
							{(replacingKey || addingOptionalKey) && (
								<button
									type="button"
									className="settings-button quiet"
									onClick={() => {
										setReplacingKey(false);
										setAddingOptionalKey(false);
										setKeyDraft("");
									}}
								>
									Cancel
								</button>
							)}
						</>
					) : service.hasKey ? (
						<>
							<button
								type="button"
								className="settings-button quiet"
								onClick={() => void testKey()}
								disabled={busy !== null}
							>
								Test
							</button>
							<button
								type="button"
								className="settings-button quiet"
								onClick={() => setReplacingKey(true)}
								disabled={busy !== null}
							>
								Replace
							</button>
							<button
								type="button"
								className="settings-button quiet danger"
								onClick={() => void removeKey()}
								disabled={busy !== null}
							>
								Remove
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								className="settings-button quiet"
								onClick={() => void testKey()}
								disabled={busy !== null}
							>
								Test
							</button>
							<button
								type="button"
								className="settings-button quiet"
								onClick={() => setAddingOptionalKey(true)}
							>
								Add a key
							</button>
						</>
					)}
				</SettingRow>

				<SettingRow icon={Layers} label="Model" desc={`The model Zara asks ${name}.`}>
					<ModelPicker
						label="Model"
						value={service.model}
						suggested={service.suggestedModels}
						available={available}
						status={modelStatus}
						placeholder="Choose a model"
						onChange={(model) => void chooseModel(model)}
						onReload={onReloadModels}
					/>
					{modelStatus === "ready" && (
						<button
							type="button"
							className="icon-button"
							aria-label="Reload the model list"
							title="Reload the model list"
							onClick={onReloadModels}
						>
							<RotateCw size={13} aria-hidden="true" />
						</button>
					)}
				</SettingRow>

				<ModelTuning
					key={`${service.id}:${service.model}`}
					label="Model settings"
					provider={service.id}
					model={service.model}
					saved={service.tuning[service.model] ?? {}}
					onSaved={(values) => onTuningSaved(service.id, service.model, values)}
				/>

				<SettingRow
					icon={ArrowRightLeft}
					label="Backup service"
					desc={
						backupNeedsKey
							? `Add a key for ${shortName(backupService)} to use it as the backup.`
							: "Where the backup model runs."
					}
				>
					<select
						className="settings-select"
						aria-label="Backup service"
						value={service.fallbackProvider ?? ""}
						onChange={(event) => void chooseBackupService(event.target.value)}
					>
						<option value="">{`Same service (${name})`}</option>
						{services
							.filter((other) => other.id !== service.id)
							.map((other) => (
								<option key={other.id} value={other.id}>
									{readinessOf(other) === "needs-key"
										? `${shortName(other)} (needs a key)`
										: shortName(other)}
								</option>
							))}
					</select>
				</SettingRow>

				<SettingRow
					icon={LifeBuoy}
					label="Backup model"
					desc="Tried if the main model is busy or fails."
					divider={service.baseUrlEditable || service.fallbackModel !== null}
				>
					<ModelPicker
						key={backupService.id}
						label="Backup model"
						value={service.fallbackModel ?? ""}
						suggested={backupService.suggestedModels}
						available={backupList?.ids ?? []}
						status={backupList?.status ?? "idle"}
						placeholder="Choose a model"
						noneLabel="None"
						onChange={(model) => void chooseBackup(model)}
						onReload={backupOnOtherService ? onReloadBackupModels : onReloadModels}
					/>
				</SettingRow>

				<ModelTuning
					key={`${backupService.id}:${service.fallbackModel ?? ""}`}
					label="Backup model settings"
					provider={backupService.id}
					model={service.fallbackModel ?? ""}
					saved={backupService.tuning[service.fallbackModel ?? ""] ?? {}}
					onSaved={(values) => onTuningSaved(backupService.id, service.fallbackModel ?? "", values)}
					last={!service.baseUrlEditable}
				/>

				{service.baseUrlEditable && (
					<SettingRow
						icon={Server}
						label="Server address"
						desc="It must speak the OpenAI chat format."
						divider={false}
					>
						<input
							type="text"
							className="settings-input wide"
							value={addressDraft}
							placeholder={service.defaultBaseUrl || "https://your-server.example/v1"}
							onChange={(event) => setAddressDraft(event.target.value)}
							onBlur={() => void commitAddress()}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.nativeEvent.isComposing)
									event.currentTarget.blur();
							}}
							aria-label="Server address"
							autoComplete="off"
							spellCheck={false}
						/>
					</SettingRow>
				)}
			</div>

			{notice && (
				<p
					className={`settings-note ${notice.tone}`}
					role={notice.tone === "problem" ? "alert" : "status"}
				>
					{notice.text}
				</p>
			)}
		</section>
	);
}
