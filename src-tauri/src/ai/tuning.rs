//! Settings for how a model answers: how hard it thinks, how random it is, how
//! long it may talk, and anything else its service accepts.
//!
//! Every service names these differently and every model accepts a different set
//! (OpenRouter's `reasoning.effort`, Claude's `output_config.effort` with its
//! `thinking` object, Gemini's `generationConfig.thinkingConfig`, Groq's
//! `reasoning_effort` and `reasoning_format`, and so on). A [`Control`] describes
//! one such setting once: what it is called, what values it takes for which models,
//! and where in the request it goes. That one table drives both the settings screen
//! (see [`describe`]) and the request (see [`Tuning::resolve`] and
//! [`Tuning::apply`]), so the two cannot disagree.
//!
//! Nothing is sent unless the user chose it, with one exception a control may name
//! (`fallback`): a value the app needs for the answer to come out clean. Values are
//! kept per model, because a setting that suits one model is an error for the next.

use super::providers::{self, ProviderId};
use serde::Serialize;
use serde_json::{json, Map, Value};

// ---- which models a thing applies to ---------------------------------------

/// Which models something applies to, by pieces of the model's name. Empty `only`
/// means every model; a model that contains any of `except` is left out.
#[derive(Clone, Copy)]
pub struct Models {
    only: &'static [&'static str],
    except: &'static [&'static str],
}

impl Models {
    const ALL: Self = Self { only: &[], except: &[] };

    const fn only(only: &'static [&'static str]) -> Self {
        Self { only, except: &[] }
    }

    const fn except(except: &'static [&'static str]) -> Self {
        Self { only: &[], except }
    }

    fn covers(self, model: &str) -> bool {
        let name = model.to_lowercase();
        let names_any = |pieces: &[&str]| pieces.iter().any(|piece| name.contains(piece));
        (self.only.is_empty() || names_any(self.only)) && !names_any(self.except)
    }
}

// ---- the table of controls --------------------------------------------------

/// Where a control sits on the settings screen.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Group {
    Reasoning,
    Sampling,
    Output,
    Advanced,
}

/// One allowed value of a choice control.
#[derive(Clone, Copy)]
pub struct Choice {
    value: &'static str,
    label: &'static str,
    models: Models,
}

const fn choice(value: &'static str, label: &'static str) -> Choice {
    Choice { value, label, models: Models::ALL }
}

const fn choice_for(value: &'static str, label: &'static str, models: Models) -> Choice {
    Choice { value, label, models }
}

#[derive(Clone, Copy)]
pub enum Kind {
    /// One of a few named values.
    Choice(&'static [Choice]),
    /// On or off.
    Toggle,
    /// A number in a range; `whole` for counts of tokens and the like.
    Number { min: f64, max: f64, step: f64, whole: bool },
    /// A JSON object merged into the request, for anything not listed here.
    Json,
}

/// A fixed value written alongside a control's own.
#[derive(Clone, Copy)]
pub enum Lit {
    Text(&'static str),
}

impl Lit {
    fn value(self) -> Value {
        match self {
            Lit::Text(text) => json!(text),
        }
    }
}

#[derive(Clone, Copy)]
pub struct Control {
    id: &'static str,
    label: &'static str,
    help: &'static str,
    group: Group,
    kind: Kind,
    /// Where the value goes in the request body, as a path of keys.
    path: &'static [&'static str],
    /// Fields the service wants together with this one, written only where nothing
    /// else has already set them.
    with: &'static [(&'static [&'static str], Lit)],
    models: Models,
    /// Another control that wins over this one: when both are set, this is left out
    /// because the service would reject the request. Empty for none.
    yields_to: &'static str,
    /// What is used when the user chose nothing, for a choice that must have a value.
    fallback: Option<&'static str>,
    /// The values that turn this setting down for the "Fast" preset, the first one the
    /// model accepts being used. Empty for a setting the preset leaves alone.
    fast: &'static [&'static str],
}

const CONTROL: Control = Control {
    id: "",
    label: "",
    help: "",
    group: Group::Sampling,
    kind: Kind::Toggle,
    path: &[],
    with: &[],
    models: Models::ALL,
    yields_to: "",
    fallback: None,
    fast: &[],
};

// Shared by most services.

const TEMPERATURE: Control = Control {
    id: "temperature",
    label: "Temperature",
    help: "Lower is more focused and repeatable, higher is more varied. Some reasoning models do not accept it.",
    group: Group::Sampling,
    kind: Kind::Number { min: 0.0, max: 2.0, step: 0.05, whole: false },
    path: &["temperature"],
    ..CONTROL
};

const TOP_P: Control = Control {
    id: "top_p",
    label: "Top P",
    help: "Only the likeliest words adding up to this share are considered. Change this or temperature, not both.",
    group: Group::Sampling,
    kind: Kind::Number { min: 0.0, max: 1.0, step: 0.05, whole: false },
    path: &["top_p"],
    ..CONTROL
};

const TOP_K: Control = Control {
    id: "top_k",
    label: "Top K",
    help: "Only this many of the likeliest words are considered at each step.",
    group: Group::Sampling,
    kind: Kind::Number { min: 1.0, max: 1000.0, step: 1.0, whole: true },
    path: &["top_k"],
    ..CONTROL
};

const MAX_TOKENS: Control = Control {
    id: "max_tokens",
    label: "Longest answer",
    help: "The most tokens a reply may use, thinking included where the service counts it. Too low cuts answers short.",
    group: Group::Output,
    kind: Kind::Number { min: 16.0, max: 200_000.0, step: 1.0, whole: true },
    path: &["max_tokens"],
    ..CONTROL
};

const SEED: Control = Control {
    id: "seed",
    label: "Seed",
    help: "The same seed and settings aim to give the same answer. Not every service honours it.",
    group: Group::Output,
    kind: Kind::Number { min: 0.0, max: 2_147_483_647.0, step: 1.0, whole: true },
    path: &["seed"],
    ..CONTROL
};

const EXTRA: Control = Control {
    id: "extra",
    label: "Extra request fields",
    help: "Anything else the service accepts, as a JSON object, merged into every request. model, messages and stream cannot be changed.",
    group: Group::Advanced,
    kind: Kind::Json,
    ..CONTROL
};

// OpenRouter: everything about reasoning lives under one `reasoning` object.

const OPENROUTER: &[Control] = &[
    Control {
        id: "effort",
        fast: &["none", "minimal", "low"],
        label: "Reasoning effort",
        help: "How hard the model thinks before it answers. Models that cannot reason ignore it.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice("max", "Max"),
            choice("xhigh", "Extra high"),
            choice("high", "High"),
            choice("medium", "Medium"),
            choice("low", "Low"),
            choice("minimal", "Minimal"),
            choice("none", "Off"),
        ]),
        path: &["reasoning", "effort"],
        ..CONTROL
    },
    Control {
        id: "reasoning_tokens",
        label: "Reasoning budget",
        help: "A token limit for thinking, for the models that take one (Claude, Gemini, some Qwen). Used when no effort is chosen.",
        group: Group::Reasoning,
        kind: Kind::Number { min: 1.0, max: 128_000.0, step: 256.0, whole: true },
        path: &["reasoning", "max_tokens"],
        yields_to: "effort",
        ..CONTROL
    },
    Control {
        id: "reasoning_hidden",
        label: "Leave reasoning out of the reply",
        help: "The model still thinks; its reasoning is just not sent back, so the Thinking section has none to show.",
        group: Group::Reasoning,
        kind: Kind::Toggle,
        path: &["reasoning", "exclude"],
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    TOP_K,
    MAX_TOKENS,
    SEED,
    EXTRA,
];

// OpenAI.

const OPENAI: &[Control] = &[
    Control {
        id: "effort",
        fast: &["none", "minimal", "low"],
        label: "Reasoning effort",
        help: "How hard the model thinks before it answers. Reasoning models only; each model accepts some of these.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice_for("none", "Off", Models::except(&["astra", "sol"])),
            choice_for("minimal", "Minimal", Models::except(&["sol"])),
            choice("low", "Low"),
            choice("medium", "Medium"),
            choice("high", "High"),
            choice("xhigh", "Extra high"),
            choice("max", "Max"),
        ]),
        path: &["reasoning_effort"],
        models: Models::except(&["gpt-4", "gpt-3"]),
        ..CONTROL
    },
    Control {
        id: "verbosity",
        label: "Verbosity",
        help: "How much the model says: low gives short answers.",
        group: Group::Output,
        kind: Kind::Choice(&[choice("low", "Low"), choice("medium", "Medium"), choice("high", "High")]),
        path: &["verbosity"],
        models: Models::only(&["gpt-5", "gpt-6"]),
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    Control { path: &["max_completion_tokens"], ..MAX_TOKENS },
    SEED,
    EXTRA,
];

// Anthropic. Newer models think adaptively and take an effort; the older ones
// that predate it take a fixed budget of thinking tokens instead.

const CLAUDE_BUDGETED: &[&str] = &["sonnet-4-5", "haiku-4-5", "opus-4-5", "opus-4-6", "sonnet-4-6", "claude-3"];
const CLAUDE_WITHOUT_EFFORT: &[&str] = &["claude-3", "sonnet-4-5", "haiku-4-5", "-4-1", "-4-0", "-4-2"];

const ANTHROPIC: &[Control] = &[
    Control {
        id: "effort",
        fast: &["low"],
        label: "Effort",
        help: "How much Claude thinks and writes: low is quickest and cheapest, max is the most thorough.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice("low", "Low"),
            choice("medium", "Medium"),
            choice("high", "High"),
            choice("xhigh", "Extra high"),
            choice("max", "Max"),
        ]),
        path: &["output_config", "effort"],
        models: Models::except(CLAUDE_WITHOUT_EFFORT),
        ..CONTROL
    },
    Control {
        id: "thinking",
        fast: &["disabled", "between_tools"],
        label: "Thinking",
        help: "Whether Claude thinks before it answers. Some models cannot turn it off at high effort.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice("adaptive", "Adaptive"),
            choice_for("disabled", "Off", Models::except(&["opus-5-5", "sonnet-5-5"])),
            choice_for("between_tools", "Only between tool calls", Models::only(&["sonnet-5-5"])),
        ]),
        path: &["thinking", "type"],
        models: Models::except(CLAUDE_BUDGETED),
        ..CONTROL
    },
    Control {
        id: "thinking_display",
        label: "Thinking summary",
        help: "Whether Claude sends a summary of its thinking for the Thinking section to show.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[choice("summarized", "Show"), choice("omitted", "Hide")]),
        path: &["thinking", "display"],
        with: &[(&["thinking", "type"], Lit::Text("adaptive"))],
        models: Models::except(CLAUDE_BUDGETED),
        ..CONTROL
    },
    Control {
        id: "thinking_budget",
        label: "Thinking budget",
        help: "How many tokens Claude may spend thinking, at least 1,024. Older models only; newer ones use effort.",
        group: Group::Reasoning,
        kind: Kind::Number { min: 1024.0, max: 128_000.0, step: 256.0, whole: true },
        path: &["thinking", "budget_tokens"],
        with: &[(&["thinking", "type"], Lit::Text("enabled"))],
        models: Models::only(CLAUDE_BUDGETED),
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    TOP_K,
    MAX_TOKENS,
    EXTRA,
];

// Google, for Gemini and Gemma alike. Everything sits under `generationConfig`.
// Gemini 3 and later think by level, Gemini 2.5 by token budget.

const GEMINI_BY_LEVEL: &[&str] = &["gemini-3", "gemini-4", "gemma-4", "-latest"];

const GOOGLE: &[Control] = &[
    Control {
        id: "thinking_level",
        fast: &["minimal", "low"],
        label: "Thinking level",
        help: "How much the model thinks before it answers. Each model accepts some of these.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice_for(
                "minimal",
                "Minimal",
                Models::only(&["3.6-flash", "flash-lite", "gemini-3-flash", "gemma-4"]),
            ),
            choice_for("low", "Low", Models::except(&["gemma-4"])),
            choice_for("medium", "Medium", Models::except(&["gemma-4", "gemini-3-pro"])),
            choice("high", "High"),
        ]),
        path: &["generationConfig", "thinkingConfig", "thinkingLevel"],
        models: Models::only(GEMINI_BY_LEVEL),
        ..CONTROL
    },
    Control {
        id: "thinking_budget",
        label: "Thinking budget",
        help: "How many tokens the model may spend thinking. -1 lets it decide; 0 turns thinking off where the model allows.",
        group: Group::Reasoning,
        kind: Kind::Number { min: -1.0, max: 32_768.0, step: 128.0, whole: true },
        path: &["generationConfig", "thinkingConfig", "thinkingBudget"],
        models: Models::only(&["gemini-2.5"]),
        ..CONTROL
    },
    Control {
        id: "include_thoughts",
        label: "Thought summaries",
        help: "Asks Google to send a summary of the model's thinking, which the Thinking section shows.",
        group: Group::Reasoning,
        kind: Kind::Toggle,
        path: &["generationConfig", "thinkingConfig", "includeThoughts"],
        models: Models::only(&["gemini-3", "gemini-4", "gemma-4", "gemini-2.5", "-latest"]),
        ..CONTROL
    },
    Control { path: &["generationConfig", "temperature"], ..TEMPERATURE },
    Control { path: &["generationConfig", "topP"], ..TOP_P },
    Control { path: &["generationConfig", "topK"], ..TOP_K },
    Control { id: "max_tokens", path: &["generationConfig", "maxOutputTokens"], ..MAX_TOKENS },
    Control { path: &["generationConfig", "seed"], ..SEED },
    EXTRA,
];

// Groq. Its reasoning models differ in what they accept, so each choice names its models.

const GROQ: &[Control] = &[
    Control {
        id: "effort",
        fast: &["none", "low"],
        label: "Reasoning effort",
        help: "How hard the model thinks before it answers. Each model accepts some of these.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice_for("none", "Off", Models::only(&["qwen"])),
            choice_for("default", "Standard", Models::only(&["qwen"])),
            choice("low", "Low"),
            choice("medium", "Medium"),
            choice("high", "High"),
            choice_for("xhigh", "Extra high", Models::only(&["muse-spark"])),
        ]),
        path: &["reasoning_effort"],
        models: Models::only(&["gpt-oss", "qwen", "muse-spark"]),
        ..CONTROL
    },
    // Without this, Qwen writes its thinking into the answer inside <think> tags.
    Control {
        id: "reasoning_format",
        label: "Where reasoning goes",
        help: "Separate keeps the thinking out of the answer and in the Thinking section; Hidden drops it.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[choice("parsed", "Separate"), choice("hidden", "Hidden"), choice("raw", "In the answer")]),
        path: &["reasoning_format"],
        models: Models::only(&["qwen", "deepseek-r1"]),
        fallback: Some("parsed"),
        ..CONTROL
    },
    Control {
        id: "include_reasoning",
        label: "Send reasoning back",
        help: "Off still thinks, but leaves the reasoning out of the reply.",
        group: Group::Reasoning,
        kind: Kind::Toggle,
        path: &["include_reasoning"],
        models: Models::only(&["gpt-oss"]),
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    Control { path: &["max_completion_tokens"], ..MAX_TOKENS },
    SEED,
    EXTRA,
];

const MISTRAL: &[Control] = &[
    Control {
        id: "effort",
        fast: &["none", "low"],
        label: "Reasoning effort",
        help: "How hard the model thinks before it answers. Each model accepts some of these.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice_for("none", "Off", Models::only(&["mistral-small", "mistral-medium"])),
            choice_for("low", "Low", Models::only(&["large", "glm"])),
            choice_for("medium", "Medium", Models::only(&["large"])),
            choice("high", "High"),
            choice_for("max", "Max", Models::only(&["glm"])),
        ]),
        path: &["reasoning_effort"],
        models: Models::only(&["mistral-small", "mistral-medium", "mistral-large", "glm"]),
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    MAX_TOKENS,
    Control { id: "seed", path: &["random_seed"], ..SEED },
    EXTRA,
];

const XAI: &[Control] = &[
    Control {
        id: "effort",
        fast: &["low"],
        label: "Reasoning effort",
        help: "How hard Grok thinks before it answers. Grok 4 models cannot turn thinking off.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice("low", "Low"),
            choice_for("medium", "Medium", Models::except(&["grok-3-mini"])),
            choice("high", "High"),
            choice_for("xhigh", "Extra high", Models::only(&["grok-4.6", "grok-4.7"])),
        ]),
        path: &["reasoning_effort"],
        models: Models::only(&["grok-4", "grok-3-mini"]),
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    MAX_TOKENS,
    SEED,
    EXTRA,
];

const DEEPSEEK: &[Control] = &[
    Control {
        id: "thinking",
        fast: &["disabled"],
        label: "Thinking",
        help: "Whether the model thinks before it answers. While it thinks, temperature and top P have no effect.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[choice("enabled", "On"), choice("disabled", "Off")]),
        path: &["thinking", "type"],
        ..CONTROL
    },
    Control {
        id: "effort",
        label: "Reasoning effort",
        help: "How hard the model thinks. Minimal and low count as low; medium and high as high.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[choice("low", "Low"), choice("high", "High"), choice("max", "Max")]),
        path: &["reasoning_effort"],
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    MAX_TOKENS,
    EXTRA,
];

const OLLAMA: &[Control] = &[
    Control {
        id: "effort",
        fast: &["none", "low"],
        label: "Thinking",
        help: "How much a thinking model reasons. Models that cannot think ignore it.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice("none", "Off"),
            choice("low", "Low"),
            choice("medium", "Medium"),
            choice("high", "High"),
        ]),
        path: &["reasoning_effort"],
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    MAX_TOKENS,
    SEED,
    EXTRA,
];

const NVIDIA: &[Control] = &[TEMPERATURE, TOP_P, MAX_TOKENS, SEED, EXTRA];

const CUSTOM: &[Control] = &[
    Control {
        id: "effort",
        fast: &["low"],
        label: "Reasoning effort",
        help: "For servers that follow OpenAI's reasoning_effort. Servers that do not may reject it.",
        group: Group::Reasoning,
        kind: Kind::Choice(&[
            choice("low", "Low"),
            choice("medium", "Medium"),
            choice("high", "High"),
        ]),
        path: &["reasoning_effort"],
        ..CONTROL
    },
    TEMPERATURE,
    TOP_P,
    MAX_TOKENS,
    SEED,
    EXTRA,
];

fn controls(provider: ProviderId) -> &'static [Control] {
    match provider {
        ProviderId::OpenRouter => OPENROUTER,
        ProviderId::OpenAi => OPENAI,
        ProviderId::Anthropic => ANTHROPIC,
        ProviderId::Google => GOOGLE,
        ProviderId::Nvidia => NVIDIA,
        ProviderId::Groq => GROQ,
        ProviderId::Mistral => MISTRAL,
        ProviderId::Xai => XAI,
        ProviderId::DeepSeek => DEEPSEEK,
        ProviderId::Ollama => OLLAMA,
        ProviderId::Custom => CUSTOM,
    }
}

// ---- what the settings screen is told ---------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceInfo {
    value: &'static str,
    label: &'static str,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum KindInfo {
    Choice { choices: Vec<ChoiceInfo> },
    Toggle,
    Number { min: f64, max: f64, step: f64, whole: bool },
    Json,
}

/// A setting as the screen draws it, already narrowed to one model.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlInfo {
    id: &'static str,
    label: &'static str,
    help: &'static str,
    group: Group,
    #[serde(flatten)]
    kind: KindInfo,
    /// What is used when nothing is chosen, if the app needs one.
    fallback: Option<&'static str>,
    /// The value that turns this setting down for the "Fast" preset, for the settings
    /// that have one and the model accepts it.
    fast: Option<&'static str>,
}

/// The settings that `model` of `provider` accepts, with the values each takes.
pub fn describe(provider: ProviderId, model: &str) -> Vec<ControlInfo> {
    controls(provider)
        .iter()
        .filter(|control| control.models.covers(model))
        .map(|control| ControlInfo {
            id: control.id,
            label: control.label,
            help: control.help,
            group: control.group,
            kind: match control.kind {
                Kind::Choice(choices) => KindInfo::Choice {
                    choices: choices
                        .iter()
                        .filter(|choice| choice.models.covers(model))
                        .map(|choice| ChoiceInfo { value: choice.value, label: choice.label })
                        .collect(),
                },
                Kind::Toggle => KindInfo::Toggle,
                Kind::Number { min, max, step, whole } => KindInfo::Number { min, max, step, whole },
                Kind::Json => KindInfo::Json,
            },
            fallback: control.fallback,
            fast: match control.kind {
                Kind::Choice(choices) => control.fast.iter().copied().find(|wanted| {
                    choices.iter().any(|choice| choice.value == *wanted && choice.models.covers(model))
                }),
                _ => None,
            },
        })
        .collect()
}

// ---- what is saved ----------------------------------------------------------

/// The setting that holds a service's per-model values: a JSON object from model
/// name to that model's values.
pub fn setting_key(provider: ProviderId) -> String {
    format!("zara-ai-tuning-{}", providers::serde_name(provider))
}

/// Every model's saved values for a service. Anything unreadable is nothing saved.
pub fn saved_for_provider(get: &dyn Fn(&str) -> Option<String>, provider: ProviderId) -> Map<String, Value> {
    get(&setting_key(provider))
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(models) => Some(models),
            _ => None,
        })
        .unwrap_or_default()
}

/// A value as it is kept, or None when it is not one this control takes for `model`.
fn accept(control: &Control, model: &str, raw: &Value) -> Option<Value> {
    match control.kind {
        Kind::Choice(choices) => {
            let text = raw.as_str()?;
            choices.iter().find(|choice| choice.value == text && choice.models.covers(model))?;
            Some(json!(text))
        }
        Kind::Toggle => raw.as_bool().map(Value::Bool),
        Kind::Number { min, max, whole, .. } => {
            let number = raw.as_f64().filter(|number| number.is_finite())?.clamp(min, max);
            Some(if whole { json!(number.round() as i64) } else { json!(number) })
        }
        Kind::Json => {
            let text = raw.as_str()?.trim();
            parse_extra(text).map(|_| json!(text))
        }
    }
}

/// The extra fields: a non-empty JSON object.
fn parse_extra(text: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str::<Value>(text).ok()? {
        Value::Object(fields) if !fields.is_empty() => Some(fields),
        _ => None,
    }
}

/// `values` cut down to the settings `model` accepts, each in a form that is kept.
pub fn sanitize(provider: ProviderId, model: &str, values: &Map<String, Value>) -> Map<String, Value> {
    controls(provider)
        .iter()
        .filter(|control| control.models.covers(model))
        .filter_map(|control| {
            let kept = accept(control, model, values.get(control.id)?)?;
            Some((control.id.to_string(), kept))
        })
        .collect()
}

/// `saved_json` (a service's saved setting) with `model`'s entry replaced by
/// `values`, or removed when none of them is kept. Returns the new setting text.
pub fn with_model_values(
    saved_json: Option<&str>,
    provider: ProviderId,
    model: &str,
    values: &Map<String, Value>,
) -> String {
    let mut models = saved_json
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let kept = sanitize(provider, model, values);
    if kept.is_empty() {
        models.remove(model);
    } else {
        models.insert(model.to_string(), Value::Object(kept));
    }
    Value::Object(models).to_string()
}

// ---- what goes into a request ----------------------------------------------

/// Fields a request needs that the user may not set, whatever the extra fields say.
const RESERVED_FIELDS: [&str; 10] = [
    "model",
    "messages",
    "stream",
    "stream_options",
    "contents",
    "systemInstruction",
    "system_instruction",
    "system",
    "tools",
    "plugins",
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum Assignment {
    Set { path: &'static [&'static str], value: Value, keep_existing: bool },
    Merge(Map<String, Value>),
}

/// The changes one model's saved settings make to a request body.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Tuning {
    assignments: Vec<Assignment>,
}

impl Tuning {
    /// What `saved` (the values saved for `model`) asks of a request to `provider`'s
    /// `model`: settings the model does not accept, or with a value it does not
    /// take, are dropped; so is one that another chosen setting makes redundant.
    pub fn resolve(provider: ProviderId, model: &str, saved: &Map<String, Value>) -> Self {
        let applicable: Vec<&Control> =
            controls(provider).iter().filter(|control| control.models.covers(model)).collect();
        let chosen = |id: &str| {
            applicable
                .iter()
                .find(|control| control.id == id)
                .and_then(|control| saved.get(id).and_then(|raw| accept(control, model, raw)))
                .is_some()
        };

        let mut assignments = Vec::new();
        let mut extra = None;
        for control in &applicable {
            let value = saved
                .get(control.id)
                .and_then(|raw| accept(control, model, raw))
                .or_else(|| control.fallback.map(|fixed| json!(fixed)));
            let Some(value) = value else { continue };
            if !control.yields_to.is_empty() && chosen(control.yields_to) {
                continue;
            }
            if matches!(control.kind, Kind::Json) {
                extra = value.as_str().and_then(parse_extra);
                continue;
            }
            for (path, fixed) in control.with {
                assignments.push(Assignment::Set { path, value: fixed.value(), keep_existing: true });
            }
            assignments.push(Assignment::Set { path: control.path, value, keep_existing: false });
        }
        if let Some(fields) = extra {
            assignments.push(Assignment::Merge(fields));
        }
        Self { assignments }
    }

    /// Writes the changes into a request body.
    pub fn apply(&self, body: &mut Value) {
        if !body.is_object() {
            *body = json!({});
        }
        for assignment in &self.assignments {
            match assignment {
                Assignment::Set { path, value, keep_existing } => {
                    set_path(body, path, value.clone(), *keep_existing);
                }
                Assignment::Merge(fields) => {
                    let allowed: Map<String, Value> = fields
                        .iter()
                        .filter(|(key, _)| !RESERVED_FIELDS.contains(&key.as_str()))
                        .map(|(key, value)| (key.clone(), value.clone()))
                        .collect();
                    merge(body, &allowed);
                }
            }
        }
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.assignments.is_empty()
    }
}

/// Sets `value` at `path` in `body`, making the objects on the way. With
/// `keep_existing`, a field that is already there is left alone.
fn set_path(body: &mut Value, path: &[&str], value: Value, keep_existing: bool) {
    let Some((last, parents)) = path.split_last() else { return };
    let mut node = body;
    for key in parents {
        if !node.get(*key).is_some_and(Value::is_object) {
            node[*key] = json!({});
        }
        node = &mut node[*key];
    }
    if keep_existing && node.get(*last).is_some() {
        return;
    }
    node[*last] = value;
}

/// Merges `fields` into `target`, object by object; other values replace what was there.
fn merge(target: &mut Value, fields: &Map<String, Value>) {
    for (key, value) in fields {
        if let (Some(existing), Value::Object(inner)) = (target.get_mut(key.as_str()), value) {
            if existing.is_object() {
                merge(existing, inner);
                continue;
            }
        }
        target[key.as_str()] = value.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs.iter().map(|(key, value)| (key.to_string(), value.clone())).collect()
    }

    fn applied(provider: ProviderId, model: &str, values: &[(&str, Value)]) -> Value {
        let mut body = json!({ "model": model, "messages": [] });
        Tuning::resolve(provider, model, &saved(values)).apply(&mut body);
        body
    }

    fn ids(provider: ProviderId, model: &str) -> Vec<&'static str> {
        describe(provider, model).iter().map(|control| control.id).collect()
    }

    fn choices(provider: ProviderId, model: &str, id: &str) -> Vec<&'static str> {
        let controls = describe(provider, model);
        let control = controls.iter().find(|control| control.id == id).expect("the control is offered");
        match &control.kind {
            KindInfo::Choice { choices } => choices.iter().map(|choice| choice.value).collect(),
            _ => panic!("{id} is not a choice"),
        }
    }

    // ---- nothing chosen means nothing sent ----

    #[test]
    fn with_nothing_saved_a_request_is_left_exactly_as_it_was() {
        let body = applied(ProviderId::OpenRouter, "google/gemma-4-31b-it", &[]);

        assert_eq!(body, json!({ "model": "google/gemma-4-31b-it", "messages": [] }));
    }

    #[test]
    fn a_tuning_with_nothing_in_it_says_so() {
        assert!(Tuning::resolve(ProviderId::OpenAi, "gpt-5", &saved(&[])).is_empty());
    }

    // ---- where each service wants its settings ----

    #[test]
    fn openrouter_puts_reasoning_under_one_object() {
        let body = applied(
            ProviderId::OpenRouter,
            "openai/gpt-5",
            &[("effort", json!("high")), ("reasoning_hidden", json!(true)), ("temperature", json!(0.4))],
        );

        assert_eq!(body["reasoning"], json!({ "effort": "high", "exclude": true }));
        assert_eq!(body["temperature"], json!(0.4));
    }

    #[test]
    fn openrouter_effort_wins_over_a_reasoning_budget() {
        let body = applied(
            ProviderId::OpenRouter,
            "anthropic/claude-sonnet-4.5",
            &[("effort", json!("low")), ("reasoning_tokens", json!(2000))],
        );

        assert_eq!(body["reasoning"], json!({ "effort": "low" }));
    }

    #[test]
    fn openrouter_takes_a_reasoning_budget_when_no_effort_is_chosen() {
        let body = applied(ProviderId::OpenRouter, "x/y", &[("reasoning_tokens", json!(2000))]);

        assert_eq!(body["reasoning"], json!({ "max_tokens": 2000 }));
    }

    #[test]
    fn openai_uses_reasoning_effort_and_max_completion_tokens() {
        let body = applied(
            ProviderId::OpenAi,
            "gpt-5",
            &[("effort", json!("minimal")), ("max_tokens", json!(800)), ("verbosity", json!("low"))],
        );

        assert_eq!(body["reasoning_effort"], json!("minimal"));
        assert_eq!(body["max_completion_tokens"], json!(800));
        assert_eq!(body["verbosity"], json!("low"));
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn claude_effort_goes_in_output_config() {
        let body = applied(ProviderId::Anthropic, "claude-sonnet-5-5", &[("effort", json!("medium"))]);

        assert_eq!(body["output_config"], json!({ "effort": "medium" }));
    }

    #[test]
    fn a_claude_thinking_summary_brings_adaptive_thinking_with_it() {
        let body = applied(ProviderId::Anthropic, "claude-sonnet-5-5", &[("thinking_display", json!("summarized"))]);

        assert_eq!(body["thinking"], json!({ "type": "adaptive", "display": "summarized" }));
    }

    #[test]
    fn an_explicit_claude_thinking_choice_is_not_overridden_by_the_summary_setting() {
        let body = applied(
            ProviderId::Anthropic,
            "claude-sonnet-5-5",
            &[("thinking", json!("between_tools")), ("thinking_display", json!("summarized"))],
        );

        assert_eq!(body["thinking"]["type"], json!("between_tools"));
    }

    #[test]
    fn an_older_claude_takes_a_thinking_budget_and_enables_thinking() {
        let body = applied(ProviderId::Anthropic, "claude-sonnet-4-5", &[("thinking_budget", json!(4000))]);

        assert_eq!(body["thinking"], json!({ "type": "enabled", "budget_tokens": 4000 }));
    }

    #[test]
    fn google_settings_sit_under_generation_config() {
        let body = applied(
            ProviderId::Google,
            "gemini-3.8-flash",
            &[
                ("thinking_level", json!("low")),
                ("include_thoughts", json!(true)),
                ("temperature", json!(0.9)),
                ("top_p", json!(0.8)),
                ("top_k", json!(40)),
                ("max_tokens", json!(2048)),
            ],
        );

        assert_eq!(
            body["generationConfig"],
            json!({
                "thinkingConfig": { "thinkingLevel": "low", "includeThoughts": true },
                "temperature": 0.9,
                "topP": 0.8,
                "topK": 40,
                "maxOutputTokens": 2048
            })
        );
    }

    #[test]
    fn gemini_2_5_thinks_by_budget_not_by_level() {
        let body = applied(ProviderId::Google, "gemini-2.5-flash", &[("thinking_budget", json!(-1))]);

        assert_eq!(body["generationConfig"]["thinkingConfig"], json!({ "thinkingBudget": -1 }));
        assert!(!ids(ProviderId::Google, "gemini-2.5-flash").contains(&"thinking_level"));
        assert!(!ids(ProviderId::Google, "gemini-3.8-flash").contains(&"thinking_budget"));
    }

    #[test]
    fn groq_uses_max_completion_tokens_and_its_own_reasoning_fields() {
        let body = applied(
            ProviderId::Groq,
            "openai/gpt-oss-120b",
            &[("effort", json!("high")), ("include_reasoning", json!(false)), ("max_tokens", json!(4096))],
        );

        assert_eq!(body["reasoning_effort"], json!("high"));
        assert_eq!(body["include_reasoning"], json!(false));
        assert_eq!(body["max_completion_tokens"], json!(4096));
    }

    #[test]
    fn mistral_names_its_seed_random_seed() {
        let body = applied(ProviderId::Mistral, "mistral-large-latest", &[("seed", json!(7))]);

        assert_eq!(body["random_seed"], json!(7));
    }

    #[test]
    fn deepseek_thinking_is_an_object_and_effort_a_field() {
        let body = applied(
            ProviderId::DeepSeek,
            "deepseek-chat",
            &[("thinking", json!("disabled")), ("effort", json!("max"))],
        );

        assert_eq!(body["thinking"], json!({ "type": "disabled" }));
        assert_eq!(body["reasoning_effort"], json!("max"));
    }

    // ---- what each model is offered ----

    #[test]
    fn groq_offers_each_reasoning_model_only_the_efforts_it_accepts() {
        assert_eq!(choices(ProviderId::Groq, "openai/gpt-oss-20b", "effort"), vec!["low", "medium", "high"]);
        assert_eq!(
            choices(ProviderId::Groq, "qwen/qwen3.8-27b", "effort"),
            vec!["none", "default", "low", "medium", "high"]
        );
        assert_eq!(
            choices(ProviderId::Groq, "meta-models/muse-spark-open", "effort"),
            vec!["low", "medium", "high", "xhigh"]
        );
    }

    #[test]
    fn groq_offers_no_reasoning_settings_for_a_model_that_does_not_reason() {
        let offered = ids(ProviderId::Groq, "llama-3.3-70b-versatile");

        assert!(!offered.contains(&"effort"));
        assert!(!offered.contains(&"reasoning_format"));
        assert!(offered.contains(&"temperature"));
    }

    #[test]
    fn gemini_levels_follow_the_model() {
        assert_eq!(choices(ProviderId::Google, "gemini-3.8-flash", "thinking_level"), vec!["low", "medium", "high"]);
        assert_eq!(
            choices(ProviderId::Google, "gemini-3.6-flash", "thinking_level"),
            vec!["minimal", "low", "medium", "high"]
        );
        assert_eq!(choices(ProviderId::Google, "gemini-3-pro-preview", "thinking_level"), vec!["low", "high"]);
        assert_eq!(choices(ProviderId::Google, "gemma-4-31b-it", "thinking_level"), vec!["minimal", "high"]);
    }

    #[test]
    fn openai_does_not_offer_off_to_models_that_cannot_turn_thinking_off() {
        assert!(choices(ProviderId::OpenAi, "gpt-5.5", "effort").contains(&"none"));
        assert!(!choices(ProviderId::OpenAi, "gpt-6-astra", "effort").contains(&"none"));
        assert!(!choices(ProviderId::OpenAi, "gpt-6.1-sol", "effort").contains(&"minimal"));
    }

    #[test]
    fn claude_models_that_think_by_budget_are_offered_a_budget_not_an_effort() {
        let older = ids(ProviderId::Anthropic, "claude-haiku-4-5-20251001");
        let newer = ids(ProviderId::Anthropic, "claude-haiku-5-5");

        assert!(older.contains(&"thinking_budget") && !older.contains(&"effort"));
        assert!(newer.contains(&"effort") && !newer.contains(&"thinking_budget"));
    }

    // ---- the Fast preset ----

    fn fast_values(provider: ProviderId, model: &str) -> Vec<(&'static str, &'static str)> {
        describe(provider, model).iter().filter_map(|control| Some((control.id, control.fast?))).collect()
    }

    #[test]
    fn fast_turns_thinking_off_where_the_model_can_and_down_where_it_cannot() {
        assert_eq!(fast_values(ProviderId::OpenAi, "gpt-5.5"), vec![("effort", "none")]);
        assert_eq!(fast_values(ProviderId::OpenAi, "gpt-6-astra"), vec![("effort", "minimal")]);
        assert_eq!(fast_values(ProviderId::OpenAi, "gpt-6.1-sol"), vec![("effort", "low")]);
    }

    #[test]
    fn fast_uses_each_models_lowest_gemini_level() {
        assert_eq!(fast_values(ProviderId::Google, "gemini-3.6-flash"), vec![("thinking_level", "minimal")]);
        assert_eq!(fast_values(ProviderId::Google, "gemini-3.8-flash"), vec![("thinking_level", "low")]);
        assert_eq!(fast_values(ProviderId::Google, "gemma-4-31b-it"), vec![("thinking_level", "minimal")]);
    }

    #[test]
    fn fast_for_claude_lowers_effort_and_turns_thinking_down_as_far_as_the_model_allows() {
        assert_eq!(
            fast_values(ProviderId::Anthropic, "claude-haiku-5-5"),
            vec![("effort", "low"), ("thinking", "disabled")]
        );
        assert_eq!(
            fast_values(ProviderId::Anthropic, "claude-sonnet-5-5"),
            vec![("effort", "low"), ("thinking", "between_tools")]
        );
        assert_eq!(fast_values(ProviderId::Anthropic, "claude-opus-5-5"), vec![("effort", "low")]);
    }

    #[test]
    fn fast_for_groq_follows_what_each_model_accepts() {
        assert_eq!(fast_values(ProviderId::Groq, "qwen/qwen3.8-27b"), vec![("effort", "none")]);
        assert_eq!(fast_values(ProviderId::Groq, "openai/gpt-oss-20b"), vec![("effort", "low")]);
    }

    #[test]
    fn a_model_with_nothing_to_turn_down_has_no_fast_preset() {
        assert!(fast_values(ProviderId::Groq, "llama-3.3-70b-versatile").is_empty());
        assert!(fast_values(ProviderId::Nvidia, "any-model").is_empty());
    }

    #[test]
    fn every_fast_value_is_one_the_setting_accepts() {
        for spec in providers::all() {
            for control in controls(spec.id) {
                let Kind::Choice(choices) = control.kind else {
                    assert!(control.fast.is_empty(), "{}/{} has a fast value but is not a choice", spec.label, control.id);
                    continue;
                };
                for wanted in control.fast {
                    assert!(
                        choices.iter().any(|choice| choice.value == *wanted),
                        "{}/{} lists {wanted}, which is not one of its choices",
                        spec.label,
                        control.id
                    );
                }
            }
        }
    }

    #[test]
    fn the_fast_values_are_sent_when_chosen() {
        let body = applied(ProviderId::Groq, "openai/gpt-oss-20b", &[("effort", json!("low"))]);

        assert_eq!(body["reasoning_effort"], json!("low"));
    }

    #[test]
    fn every_service_offers_the_extra_fields_escape_hatch() {
        for spec in providers::all() {
            assert!(ids(spec.id, "any-model").contains(&"extra"), "{} has no extra fields", spec.label);
        }
    }

    #[test]
    fn every_service_has_unique_setting_ids_and_a_path_for_each_setting() {
        for spec in providers::all() {
            let table = controls(spec.id);
            let mut seen = std::collections::HashSet::new();
            for control in table {
                assert!(seen.insert(control.id), "{} repeats {}", spec.label, control.id);
                if !matches!(control.kind, Kind::Json) {
                    assert!(!control.path.is_empty(), "{}/{} has no path", spec.label, control.id);
                }
            }
        }
    }

    // ---- what is accepted ----

    #[test]
    fn a_value_the_model_does_not_take_is_left_out_of_the_request() {
        let body = applied(ProviderId::Groq, "openai/gpt-oss-20b", &[("effort", json!("xhigh"))]);

        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn a_setting_the_model_does_not_have_is_left_out_of_the_request() {
        let body = applied(ProviderId::Groq, "llama-3.3-70b-versatile", &[("effort", json!("high"))]);

        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn an_unknown_setting_or_a_value_of_the_wrong_kind_is_ignored() {
        let body = applied(
            ProviderId::OpenAi,
            "gpt-5",
            &[("made_up", json!(1)), ("temperature", json!("hot")), ("seed", json!(null))],
        );

        assert_eq!(body, json!({ "model": "gpt-5", "messages": [] }));
    }

    #[test]
    fn numbers_are_held_to_their_range_and_whole_numbers_are_whole() {
        let body = applied(
            ProviderId::OpenAi,
            "gpt-5",
            &[("temperature", json!(9.0)), ("max_tokens", json!(100.4)), ("seed", json!(-5))],
        );

        assert_eq!(body["temperature"], json!(2.0));
        assert_eq!(body["max_completion_tokens"], json!(100));
        assert_eq!(body["seed"], json!(0));
    }

    #[test]
    fn qwen_on_groq_keeps_its_thinking_out_of_the_answer_unless_told_otherwise() {
        let by_default = applied(ProviderId::Groq, "qwen/qwen3.8-27b", &[]);
        let chosen = applied(ProviderId::Groq, "qwen/qwen3.8-27b", &[("reasoning_format", json!("raw"))]);
        let gpt_oss = applied(ProviderId::Groq, "openai/gpt-oss-20b", &[]);

        assert_eq!(by_default["reasoning_format"], json!("parsed"));
        assert_eq!(chosen["reasoning_format"], json!("raw"));
        assert!(gpt_oss.get("reasoning_format").is_none());
    }

    // ---- the extra fields ----

    #[test]
    fn extra_fields_are_merged_into_the_request_deeply() {
        let body = applied(
            ProviderId::Google,
            "gemini-3.8-flash",
            &[
                ("temperature", json!(0.5)),
                ("extra", json!(r#"{"generationConfig":{"stopSequences":["END"]},"safetySettings":[]}"#)),
            ],
        );

        assert_eq!(body["generationConfig"]["temperature"], json!(0.5));
        assert_eq!(body["generationConfig"]["stopSequences"], json!(["END"]));
        assert_eq!(body["safetySettings"], json!([]));
    }

    #[test]
    fn extra_fields_cannot_replace_the_model_the_messages_or_streaming() {
        let body = applied(
            ProviderId::Custom,
            "my-model",
            &[("extra", json!(r#"{"model":"other","messages":["x"],"stream":false,"tools":[1],"top_k":5}"#))],
        );

        assert_eq!(body["model"], json!("my-model"));
        assert_eq!(body["messages"], json!([]));
        assert!(body.get("stream").is_none() && body.get("tools").is_none());
        assert_eq!(body["top_k"], json!(5));
    }

    #[test]
    fn extra_fields_that_are_not_a_json_object_are_ignored() {
        for text in ["not json", "[1,2]", "{}", "\"text\""] {
            let body = applied(ProviderId::Custom, "m", &[("extra", json!(text))]);

            assert_eq!(body, json!({ "model": "m", "messages": [] }), "for {text}");
        }
    }

    // ---- what is saved ----

    #[test]
    fn saving_keeps_only_what_the_model_accepts() {
        let values = saved(&[("effort", json!("high")), ("bogus", json!(1)), ("temperature", json!(0.3))]);

        let kept = sanitize(ProviderId::Groq, "llama-3.3-70b-versatile", &values);

        assert_eq!(Value::Object(kept), json!({ "temperature": 0.3 }));
    }

    #[test]
    fn values_are_kept_per_model() {
        let first = with_model_values(None, ProviderId::OpenAi, "gpt-5", &saved(&[("effort", json!("low"))]));
        let both =
            with_model_values(Some(&first), ProviderId::OpenAi, "gpt-4o-mini", &saved(&[("temperature", json!(0.2))]));

        let models: Value = serde_json::from_str(&both).unwrap();
        assert_eq!(models, json!({ "gpt-5": { "effort": "low" }, "gpt-4o-mini": { "temperature": 0.2 } }));
    }

    #[test]
    fn clearing_every_value_of_a_model_removes_its_entry() {
        let first = with_model_values(None, ProviderId::OpenAi, "gpt-5", &saved(&[("effort", json!("low"))]));

        let cleared = with_model_values(Some(&first), ProviderId::OpenAi, "gpt-5", &saved(&[]));

        assert_eq!(cleared, "{}");
    }

    #[test]
    fn a_damaged_saved_setting_counts_as_nothing_saved() {
        let get = |_: &str| Some("{not json".to_string());

        assert!(saved_for_provider(&get, ProviderId::Groq).is_empty());
        let recovered = with_model_values(Some("{not json"), ProviderId::Groq, "m", &saved(&[("temperature", json!(1))]));
        assert_eq!(serde_json::from_str::<Value>(&recovered).unwrap(), json!({ "m": { "temperature": 1.0 } }));
    }

    #[test]
    fn each_service_keeps_its_values_under_its_own_setting() {
        assert_eq!(setting_key(ProviderId::Groq), "zara-ai-tuning-groq");
        assert_eq!(setting_key(ProviderId::OpenRouter), "zara-ai-tuning-openrouter");
    }
}
