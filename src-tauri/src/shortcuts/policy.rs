//! Shortcut rules: what a shortcut is, which ones are usable, and what happens
//! when one is not.
//!
//! The user chooses every shortcut. A choice goes through these checks in order:
//!
//! 1. **Shape:** a global shortcut needs a modifier (or be a function key); a
//!    panel shortcut needs Ctrl or Alt (or be a function key), because plain
//!    letters are typing.
//! 2. **Reserved:** Windows owns the Win key and a handful of system combinations
//!    (Alt+F4, Ctrl+Alt+Del, ...), and everyday editing combinations (Ctrl+C,
//!    Ctrl+V, ...) must not be taken away from every other application.
//! 3. **Duplicate:** another Zara action already uses it.
//! 4. **Operating system:** registering it fails because another application has
//!    already claimed it.
//!
//! When a choice fails, the action falls back to its default, and then to its
//! list of alternatives, and the user is told in plain words (see `message`).
//! Everything here is pure; the real registration goes through `Registrar`.

use serde::Serialize;
use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;

/// Where a shortcut works.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// In any application, registered with Windows.
    Global,
    /// Only while the Zara panel has keyboard focus, so everyday combinations
    /// like Ctrl+R can be used without taking them from other applications.
    Panel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Modifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
}

impl Modifiers {
    pub fn is_empty(self) -> bool {
        !(self.ctrl || self.alt || self.shift || self.win)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Key {
    Letter(char),
    Digit(u8),
    Function(u8),
    Named(Named),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Named {
    Space,
    Enter,
    Tab,
    Escape,
    Backspace,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,
    Up,
    Down,
    Left,
    Right,
    Comma,
    Period,
    Slash,
    Backslash,
    Semicolon,
    Quote,
    Minus,
    Equal,
    BracketLeft,
    BracketRight,
    Backquote,
}

const NAMED_KEYS: [(Named, &str); 26] = [
    (Named::Space, "Space"),
    (Named::Enter, "Enter"),
    (Named::Tab, "Tab"),
    (Named::Escape, "Escape"),
    (Named::Backspace, "Backspace"),
    (Named::Delete, "Delete"),
    (Named::Insert, "Insert"),
    (Named::Home, "Home"),
    (Named::End, "End"),
    (Named::PageUp, "PageUp"),
    (Named::PageDown, "PageDown"),
    (Named::Up, "Up"),
    (Named::Down, "Down"),
    (Named::Left, "Left"),
    (Named::Right, "Right"),
    (Named::Comma, "Comma"),
    (Named::Period, "Period"),
    (Named::Slash, "Slash"),
    (Named::Backslash, "Backslash"),
    (Named::Semicolon, "Semicolon"),
    (Named::Quote, "Quote"),
    (Named::Minus, "Minus"),
    (Named::Equal, "Equal"),
    (Named::BracketLeft, "BracketLeft"),
    (Named::BracketRight, "BracketRight"),
    (Named::Backquote, "Backquote"),
];

/// One key combination, in a single canonical form so two spellings of the same
/// combination compare equal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Accelerator {
    pub modifiers: Modifiers,
    pub key: Key,
}

impl fmt::Display for Accelerator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let m = self.modifiers;
        for (on, name) in [(m.ctrl, "Ctrl"), (m.alt, "Alt"), (m.shift, "Shift"), (m.win, "Win")] {
            if on {
                write!(f, "{name}+")?;
            }
        }
        match self.key {
            Key::Letter(c) => write!(f, "{c}"),
            Key::Digit(d) => write!(f, "{d}"),
            Key::Function(n) => write!(f, "F{n}"),
            Key::Named(named) => {
                let name = NAMED_KEYS.iter().find(|(n, _)| *n == named).map(|(_, s)| *s).unwrap_or("?");
                write!(f, "{name}")
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError(pub String);

fn parse_key(token: &str) -> Option<Key> {
    let upper = token.to_ascii_uppercase();
    if upper.len() == 1 {
        let c = upper.chars().next()?;
        if c.is_ascii_uppercase() {
            return Some(Key::Letter(c));
        }
        if let Some(d) = c.to_digit(10) {
            return Some(Key::Digit(d as u8));
        }
    }
    if let Some(number) = upper.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()) {
        if (1..=24).contains(&number) {
            return Some(Key::Function(number));
        }
    }
    let lowered = token.to_ascii_lowercase();
    let lowered = match lowered.as_str() {
        "esc" => "escape",
        "return" => "enter",
        "del" => "delete",
        "ins" => "insert",
        "pgup" | "pageup" => "pageup",
        "pgdn" | "pagedown" => "pagedown",
        "arrowup" => "up",
        "arrowdown" => "down",
        "arrowleft" => "left",
        "arrowright" => "right",
        other => other,
    }
    .to_string();
    NAMED_KEYS.iter().find(|(_, name)| name.to_ascii_lowercase() == lowered).map(|(named, _)| Key::Named(*named))
}

impl FromStr for Accelerator {
    type Err = ParseError;

    fn from_str(text: &str) -> Result<Self, ParseError> {
        let mut modifiers = Modifiers::default();
        let mut key: Option<Key> = None;
        for token in text.split('+').map(str::trim) {
            if token.is_empty() {
                return Err(ParseError(format!("\"{text}\" is not a key combination.")));
            }
            match token.to_ascii_lowercase().as_str() {
                "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" => modifiers.ctrl = true,
                "alt" | "option" => modifiers.alt = true,
                "shift" => modifiers.shift = true,
                "win" | "windows" | "super" | "meta" | "command" => modifiers.win = true,
                _ => {
                    let parsed = parse_key(token).ok_or_else(|| ParseError(format!("\"{token}\" is not a key.")))?;
                    if key.replace(parsed).is_some() {
                        return Err(ParseError("Use one key plus modifiers.".to_string()));
                    }
                }
            }
        }
        key.map(|key| Accelerator { modifiers, key })
            .ok_or_else(|| ParseError("A shortcut needs a key, not only modifiers.".to_string()))
    }
}

fn is_function_key(accelerator: &Accelerator) -> bool {
    matches!(accelerator.key, Key::Function(_))
}

/// Why a combination cannot be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reason {
    /// Missing the modifier keys the scope needs.
    Shape,
    /// Owned by Windows, or too common in other applications to take globally.
    Reserved,
    /// Another Zara action already uses it.
    DuplicateOf(&'static str),
    /// Another application has claimed it.
    TakenByAnotherApp,
}

/// Rule 1: does the combination have the shape its scope needs?
fn shape_ok(accelerator: &Accelerator, scope: Scope) -> bool {
    let m = accelerator.modifiers;
    match scope {
        Scope::Global => !m.is_empty() || is_function_key(accelerator),
        Scope::Panel => m.ctrl || m.alt || is_function_key(accelerator),
    }
}

/// Rule 2: combinations Windows owns, or that other applications depend on.
fn is_reserved(accelerator: &Accelerator, scope: Scope) -> bool {
    let m = accelerator.modifiers;
    let named = |n: Named| accelerator.key == Key::Named(n);
    // Escape closes the panel, so it is never assignable there either.
    if scope == Scope::Panel {
        return named(Named::Escape);
    }
    if m.win {
        return true; // Windows owns the Win key.
    }
    let system_combination = (m.alt && !m.ctrl && !m.shift && (accelerator.key == Key::Function(4) || named(Named::Tab) || named(Named::Escape)))
        || (m.ctrl && !m.alt && !m.shift && named(Named::Escape))
        || (m.ctrl && m.shift && !m.alt && named(Named::Escape))
        || (m.ctrl && m.alt && named(Named::Delete));
    if system_combination {
        return true;
    }
    // Plain Ctrl+<editing letter> would be taken from every application.
    let plain_ctrl = m.ctrl && !m.alt && !m.shift;
    plain_ctrl && matches!(accelerator.key, Key::Letter('C' | 'V' | 'X' | 'Z' | 'Y' | 'A' | 'S' | 'F' | 'P' | 'W' | 'T'))
}

/// Rules 1 to 3. `claimed` lists what other Zara actions currently use.
pub fn check(
    accelerator: &Accelerator,
    scope: Scope,
    claimed: &[(&'static str, Accelerator)],
) -> Result<(), Reason> {
    if !shape_ok(accelerator, scope) {
        return Err(Reason::Shape);
    }
    if is_reserved(accelerator, scope) {
        return Err(Reason::Reserved);
    }
    if let Some((action, _)) = claimed.iter().find(|(_, other)| other == accelerator) {
        return Err(Reason::DuplicateOf(action));
    }
    Ok(())
}

/// What an action is, and what it falls back to.
#[derive(Debug, Clone, Copy)]
pub struct ActionSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub scope: Scope,
    pub default: &'static str,
    /// Tried in order when the default is unavailable.
    pub fallbacks: &'static [&'static str],
}

/// The actions the user can bind. Panel-only actions are handled by the
/// frontend; global ones are registered with Windows.
pub const ACTIONS: [ActionSpec; 3] = [
    ActionSpec {
        id: "ai.toggle",
        label: "Show or hide Zara",
        scope: Scope::Global,
        default: "Ctrl+Shift+Space",
        fallbacks: &["Ctrl+Alt+Space", "Ctrl+Alt+Z", "Ctrl+Shift+F9"],
    },
    ActionSpec {
        id: "ai.settings",
        label: "Open Settings",
        scope: Scope::Global,
        default: "Ctrl+Shift+O",
        fallbacks: &["Ctrl+Alt+O", "Ctrl+Shift+F11"],
    },
    ActionSpec {
        id: "ai.reset",
        label: "Start a new conversation",
        scope: Scope::Panel,
        default: "Ctrl+R",
        fallbacks: &["Ctrl+Shift+R", "Alt+R"],
    },
];

pub fn spec_for(id: &str) -> Option<&'static ActionSpec> {
    ACTIONS.iter().find(|spec| spec.id == id)
}

/// Asks the operating system to start delivering a global combination.
pub trait Registrar {
    /// `Err` means another application already owns the combination (or the
    /// system refused it).
    fn register(&mut self, accelerator: &Accelerator) -> Result<(), ()>;
}

/// The combination the user asked for (or the default) and why it was not used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unavailable {
    pub requested: Accelerator,
    pub reason: Reason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolution {
    /// The combination that is now in effect, if any could be used.
    pub active: Option<Accelerator>,
    /// Set when the first choice could not be used.
    pub unavailable: Option<Unavailable>,
}

/// Picks the combination an action uses: the user's choice, else the default,
/// else the first working alternative. `claimed` is what earlier actions took.
pub fn resolve(
    spec: &ActionSpec,
    preferred: Option<Accelerator>,
    claimed: &[(&'static str, Accelerator)],
    registrar: &mut dyn Registrar,
) -> Resolution {
    let defaults = std::iter::once(spec.default).chain(spec.fallbacks.iter().copied());
    let candidates: Vec<Accelerator> =
        preferred.into_iter().chain(defaults.filter_map(|text| text.parse().ok())).collect();

    let mut unavailable: Option<Unavailable> = None;
    for (index, candidate) in candidates.iter().enumerate() {
        let failure = match check(candidate, spec.scope, claimed) {
            Err(reason) => Some(reason),
            Ok(()) if spec.scope == Scope::Global && registrar.register(candidate).is_err() => {
                Some(Reason::TakenByAnotherApp)
            }
            Ok(()) => None,
        };
        match failure {
            None => return Resolution { active: Some(*candidate), unavailable },
            Some(reason) if index == 0 => unavailable = Some(Unavailable { requested: *candidate, reason }),
            Some(_) => {}
        }
    }
    Resolution { active: None, unavailable }
}

/// The sentence shown to the user when their choice could not be used.
pub fn message(unavailable: &Unavailable, replacement: Option<&Accelerator>, action_label: &str) -> String {
    let requested = unavailable.requested;
    let why = match &unavailable.reason {
        Reason::Shape => format!(
            "{requested} isn't available. Use a modifier key (Ctrl or Alt for panel shortcuts; Ctrl, Alt or Shift for global ones) together with another key."
        ),
        Reason::Reserved | Reason::TakenByAnotherApp => format!(
            "{requested} isn't available. Windows or another application is using it, so it may not work while you're in that app."
        ),
        Reason::DuplicateOf(other) => {
            let other_label = spec_for(other).map(|s| s.label).unwrap_or(other);
            format!("{requested} isn't available. It's already used for \"{other_label}\".")
        }
    };
    match replacement {
        Some(active) => format!("{why} Zara is using {active} instead. You can pick a different shortcut."),
        None => format!(
            "{why} No shortcut is set for \"{action_label}\" right now; you can still click the notch. You can pick a different shortcut."
        ),
    }
}

/// Everything `claimed` needs: which accelerator each earlier action ended up with.
pub fn claimed_from(active: &HashMap<&'static str, Accelerator>) -> Vec<(&'static str, Accelerator)> {
    active.iter().map(|(id, accelerator)| (*id, *accelerator)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc(text: &str) -> Accelerator {
        text.parse().unwrap_or_else(|e| panic!("{text}: {e:?}"))
    }

    /// A registrar that refuses a fixed set of combinations, as if other
    /// applications held them.
    struct BusyRegistrar {
        taken: Vec<Accelerator>,
        accepted: Vec<Accelerator>,
    }

    impl BusyRegistrar {
        fn refusing(taken: &[&str]) -> Self {
            Self { taken: taken.iter().map(|t| acc(t)).collect(), accepted: Vec::new() }
        }
    }

    impl Registrar for BusyRegistrar {
        fn register(&mut self, accelerator: &Accelerator) -> Result<(), ()> {
            if self.taken.contains(accelerator) {
                return Err(());
            }
            self.accepted.push(*accelerator);
            Ok(())
        }
    }

    fn toggle() -> &'static ActionSpec {
        spec_for("ai.toggle").unwrap()
    }

    // ---- parsing and canonical form ----

    #[test]
    fn different_spellings_of_a_combination_are_the_same_accelerator() {
        assert_eq!(acc("ctrl+shift+space"), acc("Shift+Control+Space"));
        assert_eq!(acc("CommandOrControl+B").to_string(), "Ctrl+B");
        assert_eq!(acc("alt+esc").to_string(), "Alt+Escape");
        assert_eq!(acc("ctrl+arrowup").to_string(), "Ctrl+Up");
    }

    #[test]
    fn the_canonical_form_orders_modifiers_the_same_way_every_time() {
        assert_eq!(acc("Win+Shift+Alt+Ctrl+K").to_string(), "Ctrl+Alt+Shift+Win+K");
        assert_eq!(acc("f9").to_string(), "F9");
        assert_eq!(acc("ctrl+1").to_string(), "Ctrl+1");
    }

    #[test]
    fn text_that_is_not_a_combination_is_rejected() {
        for bad in ["", "Ctrl+", "Ctrl+Shift", "Ctrl+A+B", "Ctrl+Banana", "++", "F25", "F0"] {
            assert!(bad.parse::<Accelerator>().is_err(), "{bad:?} should not parse");
        }
    }

    #[test]
    fn every_named_key_round_trips_through_its_text() {
        for (named, text) in NAMED_KEYS {
            let accelerator = Accelerator { modifiers: Modifiers { ctrl: true, ..Default::default() }, key: Key::Named(named) };

            assert_eq!(accelerator.to_string(), format!("Ctrl+{text}"));
            assert_eq!(accelerator.to_string().parse::<Accelerator>().unwrap(), accelerator);
        }
    }

    // ---- shape ----

    #[test]
    fn a_global_shortcut_needs_a_modifier_unless_it_is_a_function_key() {
        assert_eq!(check(&acc("K"), Scope::Global, &[]), Err(Reason::Shape));
        assert_eq!(check(&acc("Space"), Scope::Global, &[]), Err(Reason::Shape));
        assert!(check(&acc("F9"), Scope::Global, &[]).is_ok());
        assert!(check(&acc("Ctrl+Shift+K"), Scope::Global, &[]).is_ok());
        assert!(check(&acc("Shift+K"), Scope::Global, &[]).is_ok());
    }

    #[test]
    fn a_panel_shortcut_needs_ctrl_or_alt_because_plain_and_shift_letters_are_typing() {
        assert_eq!(check(&acc("R"), Scope::Panel, &[]), Err(Reason::Shape));
        assert_eq!(check(&acc("Shift+R"), Scope::Panel, &[]), Err(Reason::Shape));
        assert!(check(&acc("Ctrl+R"), Scope::Panel, &[]).is_ok());
        assert!(check(&acc("Alt+N"), Scope::Panel, &[]).is_ok());
        assert!(check(&acc("F2"), Scope::Panel, &[]).is_ok());
    }

    // ---- reserved ----

    #[test]
    fn combinations_windows_owns_are_refused_globally() {
        for text in ["Win+L", "Win+Shift+S", "Alt+F4", "Alt+Tab", "Ctrl+Escape", "Ctrl+Shift+Escape", "Ctrl+Alt+Delete"] {
            assert_eq!(check(&acc(text), Scope::Global, &[]), Err(Reason::Reserved), "{text}");
        }
    }

    #[test]
    fn everyday_editing_combinations_are_not_taken_from_every_other_application() {
        for letter in ["C", "V", "X", "Z", "Y", "A", "S", "F", "P", "W", "T"] {
            assert_eq!(check(&acc(&format!("Ctrl+{letter}")), Scope::Global, &[]), Err(Reason::Reserved), "Ctrl+{letter}");
        }
        // With another modifier they are fine.
        assert!(check(&acc("Ctrl+Shift+C"), Scope::Global, &[]).is_ok());
        assert!(check(&acc("Ctrl+Alt+V"), Scope::Global, &[]).is_ok());
    }

    #[test]
    fn those_same_everyday_combinations_are_allowed_for_panel_shortcuts() {
        assert!(check(&acc("Ctrl+R"), Scope::Panel, &[]).is_ok());
        assert!(check(&acc("Ctrl+N"), Scope::Panel, &[]).is_ok());
        assert!(check(&acc("Ctrl+S"), Scope::Panel, &[]).is_ok());
    }

    #[test]
    fn escape_is_never_assignable_in_the_panel_because_it_closes_it() {
        assert_eq!(check(&acc("Ctrl+Escape"), Scope::Panel, &[]), Err(Reason::Reserved));
    }

    // ---- duplicates ----

    #[test]
    fn a_combination_already_used_by_another_action_is_refused_and_names_it() {
        let claimed = [("ai.settings", acc("Ctrl+Shift+O"))];

        assert_eq!(check(&acc("Ctrl+Shift+O"), Scope::Global, &claimed), Err(Reason::DuplicateOf("ai.settings")));
        assert!(check(&acc("Ctrl+Shift+P"), Scope::Global, &claimed).is_ok());
    }

    // ---- resolution ----

    #[test]
    fn the_users_choice_is_used_when_it_is_free() {
        let mut registrar = BusyRegistrar::refusing(&[]);

        let resolution = resolve(toggle(), Some(acc("Ctrl+Alt+Q")), &[], &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+Alt+Q")));
        assert_eq!(resolution.unavailable, None);
    }

    #[test]
    fn with_no_choice_the_default_is_used() {
        let mut registrar = BusyRegistrar::refusing(&[]);

        let resolution = resolve(toggle(), None, &[], &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+Shift+Space")));
        assert_eq!(resolution.unavailable, None);
    }

    #[test]
    fn a_combination_another_app_holds_falls_back_to_the_default_and_says_so() {
        let mut registrar = BusyRegistrar::refusing(&["Ctrl+Alt+Q"]);

        let resolution = resolve(toggle(), Some(acc("Ctrl+Alt+Q")), &[], &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+Shift+Space")));
        assert_eq!(
            resolution.unavailable,
            Some(Unavailable { requested: acc("Ctrl+Alt+Q"), reason: Reason::TakenByAnotherApp })
        );
    }

    #[test]
    fn a_reserved_choice_is_never_even_offered_to_windows() {
        let mut registrar = BusyRegistrar::refusing(&[]);

        let resolution = resolve(toggle(), Some(acc("Win+L")), &[], &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+Shift+Space")));
        assert_eq!(resolution.unavailable.unwrap().reason, Reason::Reserved);
        assert!(!registrar.accepted.contains(&acc("Win+L")));
    }

    #[test]
    fn when_the_default_is_also_taken_the_fallbacks_are_tried_in_order() {
        let mut registrar = BusyRegistrar::refusing(&["Ctrl+Alt+Q", "Ctrl+Shift+Space", "Ctrl+Alt+Space"]);

        let resolution = resolve(toggle(), Some(acc("Ctrl+Alt+Q")), &[], &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+Alt+Z")));
    }

    #[test]
    fn when_nothing_works_the_action_is_left_unassigned() {
        let mut registrar = BusyRegistrar::refusing(&["Ctrl+Shift+Space", "Ctrl+Alt+Space", "Ctrl+Alt+Z", "Ctrl+Shift+F9"]);

        let resolution = resolve(toggle(), None, &[], &mut registrar);

        assert_eq!(resolution.active, None);
        assert_eq!(resolution.unavailable.unwrap().requested, acc("Ctrl+Shift+Space"));
    }

    #[test]
    fn a_default_taken_by_another_app_is_reported_even_though_the_user_chose_nothing() {
        let mut registrar = BusyRegistrar::refusing(&["Ctrl+Shift+Space"]);

        let resolution = resolve(toggle(), None, &[], &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+Alt+Space")));
        assert_eq!(resolution.unavailable.unwrap().reason, Reason::TakenByAnotherApp);
    }

    #[test]
    fn a_choice_used_by_another_zara_action_falls_back_and_names_that_action() {
        let mut registrar = BusyRegistrar::refusing(&[]);
        let claimed = [("ai.settings", acc("Ctrl+Shift+O"))];

        let resolution = resolve(toggle(), Some(acc("Ctrl+Shift+O")), &claimed, &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+Shift+Space")));
        assert_eq!(resolution.unavailable.unwrap().reason, Reason::DuplicateOf("ai.settings"));
    }

    #[test]
    fn panel_shortcuts_never_touch_the_operating_system() {
        let mut registrar = BusyRegistrar::refusing(&["Ctrl+R"]);

        let resolution = resolve(spec_for("ai.reset").unwrap(), None, &[], &mut registrar);

        assert_eq!(resolution.active, Some(acc("Ctrl+R")));
        assert!(registrar.accepted.is_empty());
    }

    // ---- messages ----

    #[test]
    fn the_message_for_a_taken_shortcut_says_it_is_unavailable_may_not_work_in_that_app_and_names_the_replacement() {
        let unavailable = Unavailable { requested: acc("Ctrl+Shift+K"), reason: Reason::TakenByAnotherApp };

        let text = message(&unavailable, Some(&acc("Ctrl+Shift+Space")), "Show or hide Zara");

        assert_eq!(
            text,
            "Ctrl+Shift+K isn't available. Windows or another application is using it, so it may not work while you're in that app. Zara is using Ctrl+Shift+Space instead. You can pick a different shortcut."
        );
    }

    #[test]
    fn the_message_for_a_duplicate_names_the_other_action() {
        let unavailable = Unavailable { requested: acc("Ctrl+Shift+O"), reason: Reason::DuplicateOf("ai.settings") };

        let text = message(&unavailable, Some(&acc("Ctrl+Shift+Space")), "Show or hide Zara");

        assert!(text.contains("It's already used for \"Open Settings\"."), "{text}");
    }

    #[test]
    fn the_message_when_nothing_works_says_the_notch_can_still_be_clicked() {
        let unavailable = Unavailable { requested: acc("Ctrl+Shift+Space"), reason: Reason::TakenByAnotherApp };

        let text = message(&unavailable, None, "Show or hide Zara");

        assert!(text.contains("No shortcut is set for \"Show or hide Zara\" right now; you can still click the notch."), "{text}");
    }

    #[test]
    fn the_message_for_a_wrong_shape_explains_how_to_fix_it() {
        let unavailable = Unavailable { requested: acc("K"), reason: Reason::Shape };

        assert!(message(&unavailable, Some(&acc("Ctrl+Shift+Space")), "x").contains("modifier key"));
    }

    // ---- the shipped defaults ----

    #[test]
    fn every_default_and_fallback_is_valid_for_its_scope_and_not_reserved() {
        for spec in ACTIONS {
            for text in std::iter::once(spec.default).chain(spec.fallbacks.iter().copied()) {
                assert_eq!(check(&acc(text), spec.scope, &[]), Ok(()), "{} / {text}", spec.id);
            }
        }
    }

    #[test]
    fn no_default_or_fallback_is_shared_between_two_actions() {
        let mut seen: HashMap<Accelerator, &str> = HashMap::new();
        for spec in ACTIONS {
            for text in std::iter::once(spec.default).chain(spec.fallbacks.iter().copied()) {
                let accelerator = acc(text);
                if let Some(other) = seen.insert(accelerator, spec.id) {
                    panic!("{text} is used by both {other} and {}", spec.id);
                }
            }
        }
    }

    #[test]
    fn every_action_has_at_least_one_fallback() {
        for spec in ACTIONS {
            assert!(!spec.fallbacks.is_empty(), "{} has no fallback", spec.id);
        }
    }

    #[test]
    fn with_every_action_on_its_default_nothing_conflicts() {
        let mut registrar = BusyRegistrar::refusing(&[]);
        let mut active: HashMap<&'static str, Accelerator> = HashMap::new();

        for spec in ACTIONS {
            let resolution = resolve(&spec, None, &claimed_from(&active), &mut registrar);
            assert_eq!(resolution.unavailable, None, "{}", spec.id);
            active.insert(spec.id, resolution.active.unwrap());
        }
        assert_eq!(active["ai.toggle"], acc("Ctrl+Shift+Space"));
    }
}
