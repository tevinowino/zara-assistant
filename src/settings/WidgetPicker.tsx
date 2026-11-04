import { ChevronDown, ChevronUp } from "../icons/glyphs";
import { Calendar, ClipboardList, CloudSun, Headphones, SlidersHorizontal, Sparkles, StickyNote, type Glyph } from "../icons/glyphs";
import {
	isPanelEnabled,
	NOTCH_PANEL_DEFINITIONS,
	notchPanelDefinition,
	type NotchPanel,
	type NotchPanelPreferences
} from "../notch/panels/notchPanels";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

const PANEL_ICONS: Record<NotchPanel, Glyph> = {
	ai: Sparkles,
	calendar: Calendar,
	"command-center": SlidersHorizontal,
	devices: Headphones,
	notes: StickyNote,
	clipboard: ClipboardList,
	weather: CloudSun
};

export interface WidgetPickerProps {
	preferences: NotchPanelPreferences;
	onToggle: (panel: NotchPanel, enabled: boolean) => void;
	onMove: (panel: NotchPanel, direction: -1 | 1) => void;
}

/**
 * Where the user chooses their widgets. The ones that are on come first, in the order the
 * notch cycles through them, each with arrows to move it; the ones that are off follow.
 * The last widget on cannot be turned off, so the notch always has something to open.
 */
export function WidgetPicker({ preferences, onToggle, onMove }: WidgetPickerProps) {
	const enabled = preferences.enabled;
	const available = NOTCH_PANEL_DEFINITIONS.filter(
		(definition) => !isPanelEnabled(preferences, definition.id)
	);
	const rows = [
		...enabled.map((panel) => ({ panel, on: true })),
		...available.map((definition) => ({ panel: definition.id, on: false }))
	];
	const onlyOne = enabled.length <= 1;

	return (
		<div className="setting-group">
			{rows.map(({ panel, on }, index) => {
				const definition = notchPanelDefinition(panel);
				const position = enabled.indexOf(panel);
				const isLastOn = on && onlyOne;
				return (
					<SettingRow
						key={panel}
						icon={PANEL_ICONS[panel]}
						label={definition.label}
						desc={definition.description}
						divider={index < rows.length - 1}
					>
						{on && (
							<span className="widget-move" role="group" aria-label={`Move ${definition.label}`}>
								<button
									type="button"
									className="widget-move-button"
									aria-label={`Move ${definition.label} earlier`}
									disabled={position <= 0}
									onClick={() => onMove(panel, -1)}
								>
									<ChevronUp size={14} strokeWidth={2.4} />
								</button>
								<button
									type="button"
									className="widget-move-button"
									aria-label={`Move ${definition.label} later`}
									disabled={position >= enabled.length - 1}
									onClick={() => onMove(panel, 1)}
								>
									<ChevronDown size={14} strokeWidth={2.4} />
								</button>
							</span>
						)}
						<SettingSwitch
							checked={on}
							onToggle={() => onToggle(panel, !on)}
							disabled={isLastOn}
							title={isLastOn ? "The notch needs at least one widget" : undefined}
							aria-label={definition.label}
						/>
					</SettingRow>
				);
			})}
		</div>
	);
}
