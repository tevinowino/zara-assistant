//! How much Claude Code has been used: tokens, messages, tool calls, sessions, active hours and
//! an estimated cost, for the usage view of the Claude Code widget.
//!
//! Where the numbers come from. Claude Code writes every conversation to a transcript file
//! (`projects/<project>/<session>.jsonl` in its config folder). Each response is written
//! there with its token counts and model. This module reads those files, counts, and keeps
//! only the counts.
//!
//! Things the transcripts do that shape the code:
//! - A response is written once per content block (thinking, text, each tool call), all with
//!   the same message id and the same token counts. Counting every line would multiply the
//!   usage, so responses are told apart by message id and counted once.
//! - The files are append-only, so after the first reading only the new bytes are read.
//! - The format is Claude Code's own and is documented as subject to change. Lines that are not
//!   understood are skipped, never fatal; the worst a change can do is show fewer numbers.
//!
//! The cost is an estimate: the tokens of each response priced at the model's public API
//! price (`price_for`). It is not what a subscription charges. A model with no known price is
//! counted in tokens but not in cost, and is reported so the view can say so.
//!
//! Privacy:
//! - Nothing is read until the user allows it (`claude_usage_enable`).
//! - Only counts are kept: tokens, the model, the project folder's name, a session id, the time
//!   and tool-call ids. The text of the conversation is parsed past and never stored, shown or
//!   sent anywhere.
//! - It is all held in memory, and forgotten when the user turns it off.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

/// How far back transcripts are read, in days: a month and room for a streak.
const HISTORY_DAYS: i64 = 62;
/// Deepest folder (below `projects`) transcripts are looked for in.
const MAX_WALK_DEPTH: usize = 4;
const MILLIS_PER_MINUTE: i64 = 60_000;
const MILLIS_PER_HOUR: i64 = 3_600_000;
const MILLIS_PER_DAY: i64 = 86_400_000;

// ---- counting tokens -------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TokenCounts {
    pub input: u64,
    pub output: u64,
    /// Tokens written to the prompt cache.
    pub cache_write: u64,
    /// Tokens read from the prompt cache.
    pub cache_read: u64,
}

impl TokenCounts {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_write + self.cache_read
    }

    /// Each count becomes the larger of the two. A response written in several lines repeats
    /// its counts, and the last line can be more complete than the first.
    fn merge_max(&mut self, other: &TokenCounts) {
        self.input = self.input.max(other.input);
        self.output = self.output.max(other.output);
        self.cache_write = self.cache_write.max(other.cache_write);
        self.cache_read = self.cache_read.max(other.cache_read);
    }
}

// ---- prices ----------------------------------------------------------------------------------

/// Dollars per million tokens.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Price {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

/// The public API price of a model, or `None` if it is not known.
///
/// Prices are Anthropic's published per-million-token rates as of 2026-10 (cache writes at the
/// 5-minute rate, 1.25x input; cache reads at the model's own rate, 0.1x input unless
/// listed). They go stale: when a model is added or a price changes, edit this table. A model
/// that is not listed is shown without a cost rather than with a wrong one.
pub fn price_for(model: &str) -> Option<Price> {
    let model = model.trim();
    let table: [(&str, f64, f64, Option<f64>); 13] = [
        ("claude-fable-5-1", 10.0, 50.0, Some(0.25)),
        ("claude-fable-5", 10.0, 50.0, Some(0.25)),
        ("claude-mythos-5", 10.0, 50.0, Some(0.25)),
        ("claude-opus-5-5", 4.0, 20.0, Some(0.20)),
        ("claude-opus-5", 5.0, 25.0, None),
        ("claude-opus-4", 5.0, 25.0, None),
        ("claude-sonnet-5-5", 2.0, 10.0, Some(0.20)),
        ("claude-sonnet-5", 2.0, 10.0, None),
        ("claude-sonnet-4", 3.0, 15.0, None),
        ("claude-haiku-5-5", 0.10, 0.50, None),
        ("claude-haiku-5", 0.10, 0.50, None),
        ("claude-haiku-4", 1.0, 5.0, None),
        ("claude-3-5-sonnet", 3.0, 15.0, None),
    ];
    // The longest listed name that the model starts with, so "claude-opus-5-5-2026..." matches
    // "claude-opus-5-5" rather than "claude-opus-5".
    table
        .iter()
        .filter(|(name, ..)| model.starts_with(name))
        .max_by_key(|(name, ..)| name.len())
        .map(|&(_, input, output, cache_read)| Price {
            input,
            output,
            cache_write: input * 1.25,
            cache_read: cache_read.unwrap_or(input * 0.1),
        })
}

/// The estimated cost of `tokens` at `price`, in dollars.
pub fn cost_of(tokens: &TokenCounts, price: &Price) -> f64 {
    (tokens.input as f64 * price.input
        + tokens.output as f64 * price.output
        + tokens.cache_write as f64 * price.cache_write
        + tokens.cache_read as f64 * price.cache_read)
        / 1_000_000.0
}

/// A model's id as a person would say it: `claude-sonnet-5-5` is "Sonnet 5.5",
/// `claude-haiku-4-5-20251001` is "Haiku 4.5", `claude-3-5-sonnet-20241022` is "Sonnet 3.5".
pub fn display_name(model: &str) -> String {
    let mut family = String::new();
    let mut version: Vec<&str> = Vec::new();
    for part in model.split('-').filter(|part| *part != "claude") {
        if part.chars().all(|c| c.is_ascii_digit()) {
            // A date (20251001) is not part of the version.
            if part.len() <= 2 {
                version.push(part);
            }
        } else if family.is_empty() {
            let mut letters = part.chars();
            if let Some(first) = letters.next() {
                family = first.to_uppercase().chain(letters).collect();
            }
        }
    }
    match (family.is_empty(), version.is_empty()) {
        (true, _) => model.to_string(),
        (false, true) => family,
        (false, false) => format!("{family} {}", version.join(".")),
    }
}

// ---- reading a transcript line -----------------------------------------------------------------

/// What one transcript line says about one response.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineFacts {
    pub message_id: String,
    pub session_id: String,
    /// The project folder's name.
    pub project: String,
    pub model: String,
    pub timestamp_ms: i64,
    pub tokens: TokenCounts,
    /// The ids of the tool calls this line holds.
    pub tool_call_ids: Vec<String>,
}

#[derive(Deserialize)]
struct RawLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<RawUsage>,
    content: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RawUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

/// Seconds-since-epoch of a civil date, by Howard Hinnant's days-from-civil algorithm.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let year_of_era = y - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The civil date (year, month 1-12, day 1-31) of a day number counted from 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Milliseconds since the Unix epoch of a UTC timestamp like `2026-11-04T15:38:40.261Z`.
pub fn parse_timestamp_ms(text: &str) -> Option<i64> {
    let text = text.trim().strip_suffix('Z')?;
    let (date, time) = text.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || date_parts.next().is_some() {
        return None;
    }
    let (clock, fraction) = time.split_once('.').unwrap_or((time, "0"));
    let mut clock_parts = clock.split(':');
    let hour: i64 = clock_parts.next()?.parse().ok()?;
    let minute: i64 = clock_parts.next()?.parse().ok()?;
    let second: i64 = clock_parts.next()?.parse().ok()?;
    if hour > 23 || minute > 59 || second > 60 || clock_parts.next().is_some() {
        return None;
    }
    let millis: i64 = format!("{:0<3}", fraction.chars().take(3).collect::<String>()).parse().ok()?;
    Some(
        days_from_civil(year, month, day) * MILLIS_PER_DAY
            + hour * MILLIS_PER_HOUR
            + minute * MILLIS_PER_MINUTE
            + second * 1000
            + millis,
    )
}

/// The folder's name at the end of a path written with either kind of slash.
fn folder_name(path: &str) -> String {
    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

/// Reads one transcript line. Only a response with token counts and a real model counts:
/// everything else (prompts, tool results, bookkeeping) is `None`.
pub fn parse_transcript_line(line: &str) -> Option<LineFacts> {
    // Cheap test first: most lines are not responses, and parsing them is the slow part.
    if !line.contains(r#""type":"assistant""#) {
        return None;
    }
    let raw: RawLine = serde_json::from_str(line).ok()?;
    if raw.kind.as_deref() != Some("assistant") {
        return None;
    }
    let message = raw.message?;
    let usage = message.usage?;
    let model = message.model.filter(|model| !model.is_empty() && !model.starts_with('<'))?;
    let tokens = TokenCounts {
        input: usage.input_tokens.unwrap_or(0),
        output: usage.output_tokens.unwrap_or(0),
        cache_write: usage.cache_creation_input_tokens.unwrap_or(0),
        cache_read: usage.cache_read_input_tokens.unwrap_or(0),
    };
    if tokens.total() == 0 {
        return None;
    }
    let tool_call_ids = message
        .content
        .as_ref()
        .and_then(|content| content.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
                .filter_map(|block| block.get("id").and_then(|id| id.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Some(LineFacts {
        message_id: message.id.filter(|id| !id.is_empty())?,
        session_id: raw.session_id.filter(|id| !id.is_empty())?,
        project: folder_name(raw.cwd.as_deref().unwrap_or("")),
        model,
        timestamp_ms: parse_timestamp_ms(raw.timestamp.as_deref()?)?,
        tokens,
        tool_call_ids,
    })
}

// ---- the index -------------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Response {
    session_id: String,
    project: String,
    model: String,
    timestamp_ms: i64,
    tokens: TokenCounts,
    tool_call_ids: HashSet<String>,
}

/// Every response seen so far, once each, and how far into each transcript has been read.
#[derive(Default)]
pub struct UsageIndex {
    responses: HashMap<String, Response>,
    /// Bytes of each transcript already read (always up to the end of a whole line).
    read_up_to: HashMap<PathBuf, u64>,
}

impl UsageIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds what a line says. A response already seen takes the larger of each count and gains
    /// any new tool calls, so a response written in several lines is one response.
    pub fn add(&mut self, facts: LineFacts) {
        let entry = self.responses.entry(facts.message_id).or_insert_with(|| Response {
            session_id: facts.session_id,
            project: facts.project,
            model: facts.model,
            timestamp_ms: facts.timestamp_ms,
            tokens: TokenCounts::default(),
            tool_call_ids: HashSet::new(),
        });
        entry.tokens.merge_max(&facts.tokens);
        entry.timestamp_ms = entry.timestamp_ms.min(facts.timestamp_ms);
        entry.tool_call_ids.extend(facts.tool_call_ids);
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.responses.len()
    }

    /// Reads whatever was appended to `path` since the last time, up to the last whole line.
    /// A file that has become shorter is read again from its start.
    pub fn read_new_lines(&mut self, path: &Path) {
        let Ok(mut file) = std::fs::File::open(path) else { return };
        let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        let mut offset = self.read_up_to.get(path).copied().unwrap_or(0);
        if length < offset {
            offset = 0;
        }
        if length == offset || file.seek(SeekFrom::Start(offset)).is_err() {
            return;
        }
        let mut bytes = Vec::new();
        if file.take(length - offset).read_to_end(&mut bytes).is_err() {
            return;
        }
        let Some(last_newline) = bytes.iter().rposition(|byte| *byte == b'\n') else {
            return;
        };
        for line in bytes[..last_newline].split(|byte| *byte == b'\n') {
            if let Some(facts) = parse_transcript_line(&String::from_utf8_lossy(line)) {
                self.add(facts);
            }
        }
        self.read_up_to.insert(path.to_path_buf(), offset + last_newline as u64 + 1);
    }

    /// Reads every recently changed transcript under `config_dir/projects`.
    pub fn refresh(&mut self, config_dir: &Path, now_ms: i64) {
        let oldest = std::time::UNIX_EPOCH
            + std::time::Duration::from_millis((now_ms - HISTORY_DAYS * MILLIS_PER_DAY).max(0) as u64);
        let mut files = Vec::new();
        collect_transcripts(&config_dir.join("projects"), 0, oldest, &mut files);
        for file in files {
            self.read_new_lines(&file);
        }
    }

    pub fn clear(&mut self) {
        self.responses.clear();
        self.read_up_to.clear();
    }
}

fn collect_transcripts(
    directory: &Path,
    depth: usize,
    oldest: std::time::SystemTime,
    found: &mut Vec<PathBuf>,
) {
    let Ok(entries) = std::fs::read_dir(directory) else { return };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if depth < MAX_WALK_DEPTH {
                collect_transcripts(&path, depth + 1, oldest, found);
            }
        } else if path.extension().is_some_and(|ext| ext == "jsonl")
            && meta.modified().is_ok_and(|modified| modified >= oldest)
        {
            found.push(path);
        }
    }
}

// ---- the summary -----------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayStats {
    pub tokens: u64,
    /// Estimated cost in dollars of the models with a known price.
    pub cost_usd: f64,
    pub messages: u64,
    pub tool_calls: u64,
    pub sessions: u64,
    /// The project with the most tokens today.
    pub top_project: Option<String>,
    /// Consecutive days with activity, counting back from today (or from yesterday while today
    /// has none yet).
    pub streak_days: u32,
    /// Tokens used in each hour of today, local time.
    pub hourly_tokens: Vec<u64>,
    /// The first hour of the busiest two-hour stretch today.
    pub peak_start_hour: Option<u8>,
    /// The hour it is now, local time.
    pub current_hour: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    /// "Sonnet 5.5".
    pub display_name: String,
    pub tokens: u64,
    /// `None` when the model's price is not known.
    pub cost_usd: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthStats {
    pub cost_usd: f64,
    pub tokens: u64,
    /// The month's models, the costliest first.
    pub by_model: Vec<ModelUsage>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub today: TodayStats,
    pub month: MonthStats,
    /// Models used this month that have no known price, so their cost is missing.
    pub unpriced_models: Vec<String>,
    /// Whether any transcripts were found at all.
    pub any_usage: bool,
}

fn local_day(timestamp_ms: i64, utc_offset_minutes: i32) -> i64 {
    (timestamp_ms + i64::from(utc_offset_minutes) * MILLIS_PER_MINUTE).div_euclid(MILLIS_PER_DAY)
}

fn local_hour(timestamp_ms: i64, utc_offset_minutes: i32) -> u8 {
    (timestamp_ms + i64::from(utc_offset_minutes) * MILLIS_PER_MINUTE)
        .rem_euclid(MILLIS_PER_DAY)
        .div_euclid(MILLIS_PER_HOUR) as u8
}

/// The first hour of the busiest run of two hours in a day, or `None` for a day with no use.
fn busiest_two_hours(hourly: &[u64]) -> Option<u8> {
    (0..hourly.len().saturating_sub(1))
        .map(|hour| (hour, hourly[hour] + hourly[hour + 1]))
        .filter(|(_, total)| *total > 0)
        .max_by_key(|(hour, total)| (*total, std::cmp::Reverse(*hour)))
        .map(|(hour, _)| hour as u8)
}

impl UsageIndex {
    /// The numbers for the usage view. `utc_offset_minutes` is the user's offset from UTC now
    /// (the notch knows it; Rust's standard library does not), which sets where each day and
    /// hour starts.
    pub fn summarize(&self, now_ms: i64, utc_offset_minutes: i32) -> UsageSummary {
        let today = local_day(now_ms, utc_offset_minutes);
        let (this_year, this_month, _) = civil_from_days(today);

        let mut today_tokens = 0;
        let mut today_cost = 0.0;
        let mut today_messages = 0;
        let mut today_tool_calls = 0;
        let mut today_sessions: HashSet<&str> = HashSet::new();
        let mut today_projects: HashMap<&str, u64> = HashMap::new();
        let mut hourly = vec![0u64; 24];
        let mut active_days: HashSet<i64> = HashSet::new();
        let mut month_cost = 0.0;
        let mut month_tokens = 0;
        let mut month_models: HashMap<&str, (u64, Option<f64>)> = HashMap::new();
        let mut unpriced: HashSet<&str> = HashSet::new();

        for response in self.responses.values() {
            let day = local_day(response.timestamp_ms, utc_offset_minutes);
            active_days.insert(day);
            let price = price_for(&response.model);
            let cost = price.map(|price| cost_of(&response.tokens, &price));
            let tokens = response.tokens.total();

            if day == today {
                today_tokens += tokens;
                today_cost += cost.unwrap_or(0.0);
                today_messages += 1;
                today_tool_calls += response.tool_call_ids.len() as u64;
                today_sessions.insert(response.session_id.as_str());
                *today_projects.entry(response.project.as_str()).or_default() += tokens;
                hourly[usize::from(local_hour(response.timestamp_ms, utc_offset_minutes))] += tokens;
            }

            let (year, month, _) = civil_from_days(day);
            if (year, month) == (this_year, this_month) && day <= today {
                month_cost += cost.unwrap_or(0.0);
                month_tokens += tokens;
                let entry = month_models.entry(response.model.as_str()).or_insert((0, None));
                entry.0 += tokens;
                match cost {
                    Some(cost) => entry.1 = Some(entry.1.unwrap_or(0.0) + cost),
                    None => {
                        unpriced.insert(response.model.as_str());
                    }
                }
            }
        }

        let mut streak_days = 0;
        let mut day = if active_days.contains(&today) { today } else { today - 1 };
        while active_days.contains(&day) {
            streak_days += 1;
            day -= 1;
        }

        let mut by_model: Vec<ModelUsage> = month_models
            .into_iter()
            .map(|(model, (tokens, cost_usd))| ModelUsage {
                model: model.to_string(),
                display_name: display_name(model),
                tokens,
                cost_usd,
            })
            .collect();
        by_model.sort_by(|a, b| {
            b.cost_usd
                .unwrap_or(0.0)
                .partial_cmp(&a.cost_usd.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(b.tokens.cmp(&a.tokens))
                .then_with(|| a.model.cmp(&b.model))
        });
        let mut unpriced_models: Vec<String> = unpriced.into_iter().map(str::to_string).collect();
        unpriced_models.sort();

        UsageSummary {
            today: TodayStats {
                tokens: today_tokens,
                cost_usd: today_cost,
                messages: today_messages,
                tool_calls: today_tool_calls,
                sessions: today_sessions.len() as u64,
                top_project: today_projects
                    .into_iter()
                    .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(a.0)))
                    .map(|(project, _)| project.to_string()),
                streak_days,
                peak_start_hour: busiest_two_hours(&hourly),
                hourly_tokens: hourly,
                current_hour: local_hour(now_ms, utc_offset_minutes),
            },
            month: MonthStats { cost_usd: month_cost, tokens: month_tokens, by_model },
            unpriced_models,
            any_usage: !self.responses.is_empty(),
        }
    }
}

// ---- running it ------------------------------------------------------------------------------

static ALLOWED: AtomicBool = AtomicBool::new(false);

fn index() -> &'static Mutex<UsageIndex> {
    static INDEX: OnceLock<Mutex<UsageIndex>> = OnceLock::new();
    INDEX.get_or_init(|| Mutex::new(UsageIndex::new()))
}

/// Allows or forbids reading Claude Code's transcripts. Nothing is read until this is called
/// with `true`; with `false`, everything counted so far is forgotten.
#[tauri::command]
pub async fn claude_usage_enable(enabled: bool) {
    ALLOWED.store(enabled, Ordering::SeqCst);
    if !enabled {
        index().lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

/// The usage numbers, reading any transcript lines written since the last call. Refuses unless
/// the user has allowed it.
#[tauri::command]
pub async fn claude_usage_summary(now_ms: i64, utc_offset_minutes: i32) -> Result<UsageSummary, String> {
    if !ALLOWED.load(Ordering::SeqCst) {
        return Err("Reading Claude Code's usage is not allowed.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let config_dir = crate::claude_code::claude_settings_path()
            .and_then(|settings| settings.parent().map(Path::to_path_buf))
            .ok_or_else(|| "Zara could not find where Claude Code keeps its files.".to_string())?;
        let mut index = index().lock().unwrap_or_else(|e| e.into_inner());
        // Turned off while waiting for the lock: report nothing rather than read.
        if !ALLOWED.load(Ordering::SeqCst) {
            return Err("Reading Claude Code's usage is not allowed.".to_string());
        }
        index.refresh(&config_dir, now_ms);
        Ok(index.summarize(now_ms, utc_offset_minutes))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An arbitrary moment, for tests that do not depend on the date.
    const NOW: i64 = 1_793_000_000_000;

    fn response_line(
        message_id: &str,
        session: &str,
        cwd: &str,
        model: &str,
        timestamp: &str,
        usage: (u64, u64, u64, u64),
        blocks: &str,
    ) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{timestamp}","sessionId":"{session}","cwd":"{cwd}","message":{{"id":"{message_id}","model":"{model}","usage":{{"input_tokens":{},"output_tokens":{},"cache_creation_input_tokens":{},"cache_read_input_tokens":{}}},"content":[{blocks}]}}}}"#,
            usage.0, usage.1, usage.2, usage.3
        )
    }

    fn facts(message_id: &str, timestamp: &str, model: &str, tokens: TokenCounts) -> LineFacts {
        LineFacts {
            message_id: message_id.into(),
            session_id: "s1".into(),
            project: "zara".into(),
            model: model.into(),
            timestamp_ms: parse_timestamp_ms(timestamp).unwrap(),
            tokens,
            tool_call_ids: vec![],
        }
    }

    fn tokens(input: u64, output: u64) -> TokenCounts {
        TokenCounts { input, output, cache_write: 0, cache_read: 0 }
    }

    // ---- time

    #[test]
    fn reads_a_utc_timestamp_with_milliseconds() {
        assert_eq!(parse_timestamp_ms("1970-01-01T00:00:01.250Z"), Some(1_250));
    }

    #[test]
    fn reads_a_timestamp_without_a_fraction() {
        assert_eq!(parse_timestamp_ms("1970-01-02T00:00:00Z"), Some(MILLIS_PER_DAY));
    }

    #[test]
    fn reads_a_known_date() {
        // 2026-11-04T15:38:40.261Z
        assert_eq!(parse_timestamp_ms("2026-11-04T15:38:40.261Z"), Some(1_793_806_720_261));
    }

    #[test]
    fn reads_a_leap_day() {
        let leap = parse_timestamp_ms("2024-02-29T00:00:00Z").unwrap();
        let next = parse_timestamp_ms("2024-03-01T00:00:00Z").unwrap();

        assert_eq!(next - leap, MILLIS_PER_DAY);
    }

    #[test]
    fn rejects_a_timestamp_that_is_not_one() {
        assert_eq!(parse_timestamp_ms("yesterday"), None);
        assert_eq!(parse_timestamp_ms("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_timestamp_ms("2026-11-04T25:00:00Z"), None);
        assert_eq!(parse_timestamp_ms("2026-11-04T10:00:00"), None);
    }

    #[test]
    fn turns_days_back_into_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_722), (2023, 12, 31));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        let day = parse_timestamp_ms("2026-11-04T15:38:40Z").unwrap() / MILLIS_PER_DAY;
        assert_eq!(civil_from_days(day), (2026, 11, 4));
    }

    #[test]
    fn puts_a_time_on_the_users_local_day_and_hour() {
        // 2026-11-04T22:30Z is already 2026-11-05 01:30 at UTC+3.
        let at = parse_timestamp_ms("2026-11-04T22:30:00Z").unwrap();

        assert_eq!(civil_from_days(local_day(at, 180)), (2026, 11, 5));
        assert_eq!(local_hour(at, 180), 1);
        assert_eq!(civil_from_days(local_day(at, 0)), (2026, 11, 4));
        assert_eq!(local_hour(at, 0), 22);
    }

    #[test]
    fn puts_a_time_on_the_local_day_west_of_utc() {
        let at = parse_timestamp_ms("2026-11-05T02:30:00Z").unwrap();

        assert_eq!(civil_from_days(local_day(at, -300)), (2026, 11, 4));
        assert_eq!(local_hour(at, -300), 21);
    }

    // ---- prices and names

    #[test]
    fn prices_a_model_by_its_longest_known_name() {
        let opus = price_for("claude-opus-5-5").unwrap();
        let older = price_for("claude-opus-5").unwrap();

        assert_eq!((opus.input, opus.output), (4.0, 20.0));
        assert_eq!((older.input, older.output), (5.0, 25.0));
    }

    #[test]
    fn prices_a_dated_model_id_like_its_family() {
        assert_eq!(price_for("claude-haiku-4-5-20251001").unwrap().input, 1.0);
    }

    #[test]
    fn has_no_price_for_a_model_it_does_not_know() {
        assert_eq!(price_for("claude-future-9-9"), None);
        assert_eq!(price_for("gpt-5"), None);
    }

    #[test]
    fn prices_cache_writes_above_input_and_reads_well_below() {
        let price = price_for("claude-sonnet-4-6").unwrap();

        assert!((price.cache_write - 3.75).abs() < 1e-9);
        assert!((price.cache_read - 0.30).abs() < 1e-9);
    }

    #[test]
    fn uses_a_models_own_cache_read_price_when_it_has_one() {
        assert!((price_for("claude-opus-5-5").unwrap().cache_read - 0.20).abs() < 1e-9);
    }

    #[test]
    fn works_out_a_cost_from_every_kind_of_token() {
        let price = Price { input: 2.0, output: 10.0, cache_write: 2.5, cache_read: 0.2 };
        let counts = TokenCounts { input: 1_000_000, output: 100_000, cache_write: 400_000, cache_read: 5_000_000 };

        let cost = cost_of(&counts, &price);

        // 2.00 + 1.00 + 1.00 + 1.00
        assert!((cost - 5.0).abs() < 1e-9);
    }

    #[test]
    fn names_models_the_way_a_person_says_them() {
        assert_eq!(display_name("claude-sonnet-5-5"), "Sonnet 5.5");
        assert_eq!(display_name("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(display_name("claude-haiku-4-5-20251001"), "Haiku 4.5");
        assert_eq!(display_name("claude-3-5-sonnet-20241022"), "Sonnet 3.5");
        assert_eq!(display_name("claude-fable-5-1"), "Fable 5.1");
    }

    #[test]
    fn names_a_family_without_a_version() {
        assert_eq!(display_name("claude-sonnet"), "Sonnet");
    }

    #[test]
    fn leaves_an_unrecognizable_name_as_it_is() {
        assert_eq!(display_name("12345"), "12345");
    }

    // ---- reading a line

    #[test]
    fn reads_a_response_with_its_tokens_and_tool_calls() {
        let line = response_line(
            "msg_1",
            "s1",
            r"C:\\Users\\me\\Desktop\\zara",
            "claude-sonnet-5-5",
            "2026-11-04T15:00:00.000Z",
            (2, 114, 47_064, 24_810),
            r#"{"type":"tool_use","id":"toolu_a","name":"Bash"},{"type":"text","text":"never kept"}"#,
        );

        let parsed = parse_transcript_line(&line).unwrap();

        assert_eq!(parsed.message_id, "msg_1");
        assert_eq!(parsed.project, "zara");
        assert_eq!(parsed.model, "claude-sonnet-5-5");
        assert_eq!(parsed.tokens, TokenCounts { input: 2, output: 114, cache_write: 47_064, cache_read: 24_810 });
        assert_eq!(parsed.tool_call_ids, vec!["toolu_a"]);
        assert!(!format!("{parsed:?}").contains("never kept"));
    }

    #[test]
    fn ignores_a_line_that_is_not_a_response() {
        assert_eq!(parse_transcript_line(r#"{"type":"user","message":{"content":"hi"}}"#), None);
        assert_eq!(parse_transcript_line(r#"{"type":"cost-state","totalCostUSD":1.5}"#), None);
        assert_eq!(parse_transcript_line("not json"), None);
        assert_eq!(parse_transcript_line(""), None);
    }

    #[test]
    fn ignores_a_response_with_no_usage_or_no_tokens() {
        let no_usage = r#"{"type":"assistant","timestamp":"2026-11-04T15:00:00Z","sessionId":"s","message":{"id":"m","model":"claude-sonnet-5-5"}}"#;
        let zero = response_line("m", "s", "/a/b", "claude-sonnet-5-5", "2026-11-04T15:00:00Z", (0, 0, 0, 0), "");

        assert_eq!(parse_transcript_line(no_usage), None);
        assert_eq!(parse_transcript_line(&zero), None);
    }

    #[test]
    fn ignores_a_synthetic_response() {
        let line = response_line("m", "s", "/a/b", "<synthetic>", "2026-11-04T15:00:00Z", (5, 5, 0, 0), "");

        assert_eq!(parse_transcript_line(&line), None);
    }

    #[test]
    fn ignores_a_response_without_an_id_or_a_session_or_a_time() {
        let no_id = r#"{"type":"assistant","timestamp":"2026-11-04T15:00:00Z","sessionId":"s","message":{"model":"m","usage":{"input_tokens":5}}}"#;
        let no_session = r#"{"type":"assistant","timestamp":"2026-11-04T15:00:00Z","message":{"id":"i","model":"m","usage":{"input_tokens":5}}}"#;
        let no_time = r#"{"type":"assistant","sessionId":"s","message":{"id":"i","model":"m","usage":{"input_tokens":5}}}"#;

        assert_eq!(parse_transcript_line(no_id), None);
        assert_eq!(parse_transcript_line(no_session), None);
        assert_eq!(parse_transcript_line(no_time), None);
    }

    #[test]
    fn tolerates_fields_it_does_not_know() {
        let line = r#"{"type":"assistant","timestamp":"2026-11-04T15:00:00Z","sessionId":"s","a_new_field":[1],"message":{"id":"i","model":"claude-sonnet-5-5","stop":"x","usage":{"input_tokens":5,"a_new_count":9}}}"#;

        assert_eq!(parse_transcript_line(line).unwrap().tokens.input, 5);
    }

    // ---- the index

    #[test]
    fn counts_a_response_written_in_several_lines_once() {
        let mut index = UsageIndex::new();

        index.add(facts("m1", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(10, 20)));
        index.add(facts("m1", "2026-11-04T10:00:02Z", "claude-sonnet-5-5", tokens(10, 20)));
        index.add(facts("m1", "2026-11-04T10:00:03Z", "claude-sonnet-5-5", tokens(10, 20)));

        assert_eq!(index.len(), 1);
        assert_eq!(index.summarize(parse_timestamp_ms("2026-11-04T12:00:00Z").unwrap(), 0).today.tokens, 30);
    }

    #[test]
    fn takes_the_larger_counts_when_a_later_line_is_more_complete() {
        let mut index = UsageIndex::new();
        index.add(facts("m1", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(10, 5)));

        index.add(facts("m1", "2026-11-04T10:00:01Z", "claude-sonnet-5-5", tokens(10, 90)));

        let now = parse_timestamp_ms("2026-11-04T12:00:00Z").unwrap();
        assert_eq!(index.summarize(now, 0).today.tokens, 100);
    }

    #[test]
    fn counts_each_tool_call_once_however_many_lines_repeat_it() {
        let mut index = UsageIndex::new();
        let mut first = facts("m1", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(1, 1));
        first.tool_call_ids = vec!["a".into()];
        let mut second = facts("m1", "2026-11-04T10:00:01Z", "claude-sonnet-5-5", tokens(1, 1));
        second.tool_call_ids = vec!["a".into(), "b".into()];

        index.add(first);
        index.add(second);

        let now = parse_timestamp_ms("2026-11-04T12:00:00Z").unwrap();
        assert_eq!(index.summarize(now, 0).today.tool_calls, 2);
    }

    #[test]
    fn reads_new_lines_from_a_transcript_only_once() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("s1.jsonl");
        let line = response_line("m1", "s1", "/a/zara", "claude-sonnet-5-5", "2026-11-04T10:00:00Z", (5, 5, 0, 0), "");
        std::fs::write(&path, format!("{line}\n")).unwrap();
        let mut index = UsageIndex::new();

        index.read_new_lines(&path);
        index.read_new_lines(&path);

        assert_eq!(index.len(), 1);
    }

    #[test]
    fn reads_only_what_was_appended_since_the_last_reading() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("s1.jsonl");
        let first = response_line("m1", "s1", "/a/zara", "claude-sonnet-5-5", "2026-11-04T10:00:00Z", (5, 5, 0, 0), "");
        let second = response_line("m2", "s1", "/a/zara", "claude-sonnet-5-5", "2026-11-04T10:05:00Z", (7, 7, 0, 0), "");
        std::fs::write(&path, format!("{first}\n")).unwrap();
        let mut index = UsageIndex::new();
        index.read_new_lines(&path);

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, format!("{second}\n").as_bytes()).unwrap();
        index.read_new_lines(&path);

        assert_eq!(index.len(), 2);
    }

    #[test]
    fn waits_for_the_end_of_a_line_that_is_still_being_written() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("s1.jsonl");
        let line = response_line("m1", "s1", "/a/zara", "claude-sonnet-5-5", "2026-11-04T10:00:00Z", (5, 5, 0, 0), "");
        let (start, end) = line.split_at(line.len() / 2);
        std::fs::write(&path, start).unwrap();
        let mut index = UsageIndex::new();

        index.read_new_lines(&path);
        assert_eq!(index.len(), 0);
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, format!("{end}\n").as_bytes()).unwrap();
        index.read_new_lines(&path);

        assert_eq!(index.len(), 1);
    }

    #[test]
    fn skips_a_damaged_line_and_reads_the_rest() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("s1.jsonl");
        let good = response_line("m1", "s1", "/a/zara", "claude-sonnet-5-5", "2026-11-04T10:00:00Z", (5, 5, 0, 0), "");
        std::fs::write(&path, format!("{{ damaged\n{good}\n")).unwrap();
        let mut index = UsageIndex::new();

        index.read_new_lines(&path);

        assert_eq!(index.len(), 1);
    }

    #[test]
    fn finds_transcripts_in_every_project_folder() {
        let config = tempfile::tempdir().unwrap();
        for (project, id) in [("-a-zara", "m1"), ("-a-website", "m2")] {
            let folder = config.path().join("projects").join(project);
            std::fs::create_dir_all(&folder).unwrap();
            let line = response_line(id, "s", "/a/x", "claude-sonnet-5-5", "2026-11-04T10:00:00Z", (5, 5, 0, 0), "");
            std::fs::write(folder.join("s.jsonl"), format!("{line}\n")).unwrap();
        }
        let mut index = UsageIndex::new();
        let now = parse_timestamp_ms("2026-11-04T12:00:00Z").unwrap();

        index.refresh(config.path(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64);

        assert_eq!(index.len(), 2);
        assert!(index.summarize(now, 0).any_usage);
    }

    #[test]
    fn ignores_files_that_are_not_transcripts() {
        let config = tempfile::tempdir().unwrap();
        let folder = config.path().join("projects").join("-a-zara");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("notes.txt"), "not a transcript").unwrap();
        let mut index = UsageIndex::new();

        index.refresh(config.path(), 0);

        assert_eq!(index.len(), 0);
    }

    #[test]
    fn reads_nothing_from_a_config_folder_that_has_no_projects() {
        let config = tempfile::tempdir().unwrap();
        let mut index = UsageIndex::new();

        index.refresh(config.path(), 0);

        assert!(!index.summarize(0, 0).any_usage);
    }

    #[test]
    fn forgets_everything_when_cleared() {
        let mut index = UsageIndex::new();
        index.add(facts("m1", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(1, 1)));

        index.clear();

        assert_eq!(index.len(), 0);
    }

    // ---- the summary

    fn summary_at(index: &UsageIndex, now: &str) -> UsageSummary {
        index.summarize(parse_timestamp_ms(now).unwrap(), 0)
    }

    #[test]
    fn counts_only_todays_responses_in_the_today_figures() {
        let mut index = UsageIndex::new();
        index.add(facts("old", "2026-11-03T10:00:00Z", "claude-sonnet-5-5", tokens(1_000, 0)));
        index.add(facts("new", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(200, 50)));

        let summary = summary_at(&index, "2026-11-04T12:00:00Z");

        assert_eq!(summary.today.tokens, 250);
        assert_eq!(summary.today.messages, 1);
    }

    #[test]
    fn counts_each_session_active_today_once() {
        let mut index = UsageIndex::new();
        for (id, session) in [("m1", "a"), ("m2", "a"), ("m3", "b")] {
            let mut line = facts(id, "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(1, 1));
            line.session_id = session.into();
            index.add(line);
        }

        assert_eq!(summary_at(&index, "2026-11-04T12:00:00Z").today.sessions, 2);
    }

    #[test]
    fn names_the_project_with_the_most_tokens_today() {
        let mut index = UsageIndex::new();
        let mut small = facts("m1", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(10, 0));
        small.project = "website".into();
        let mut big = facts("m2", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(500, 0));
        big.project = "design-tokens".into();
        index.add(small);
        index.add(big);

        assert_eq!(summary_at(&index, "2026-11-04T12:00:00Z").today.top_project.as_deref(), Some("design-tokens"));
    }

    #[test]
    fn has_no_top_project_on_a_day_with_no_use() {
        let mut index = UsageIndex::new();
        index.add(facts("m1", "2026-11-01T10:00:00Z", "claude-sonnet-5-5", tokens(10, 0)));

        assert_eq!(summary_at(&index, "2026-11-04T12:00:00Z").today.top_project, None);
    }

    #[test]
    fn spreads_todays_tokens_over_the_hours_they_were_used() {
        let mut index = UsageIndex::new();
        index.add(facts("m1", "2026-11-04T09:15:00Z", "claude-sonnet-5-5", tokens(100, 0)));
        index.add(facts("m2", "2026-11-04T09:45:00Z", "claude-sonnet-5-5", tokens(50, 0)));
        index.add(facts("m3", "2026-11-04T20:05:00Z", "claude-sonnet-5-5", tokens(70, 0)));

        let today = summary_at(&index, "2026-11-04T21:00:00Z").today;

        assert_eq!(today.hourly_tokens.len(), 24);
        assert_eq!(today.hourly_tokens[9], 150);
        assert_eq!(today.hourly_tokens[20], 70);
        assert_eq!(today.current_hour, 21);
    }

    #[test]
    fn finds_the_busiest_two_hours() {
        let mut hourly = vec![0u64; 24];
        hourly[20] = 500;
        hourly[21] = 300;
        hourly[9] = 600;

        assert_eq!(busiest_two_hours(&hourly), Some(20));
    }

    #[test]
    fn has_no_busiest_hours_on_a_quiet_day() {
        assert_eq!(busiest_two_hours(&[0; 24]), None);
    }

    #[test]
    fn prefers_the_earlier_hours_when_two_stretches_tie() {
        let mut hourly = vec![0u64; 24];
        hourly[3] = 100;
        hourly[15] = 100;

        assert_eq!(busiest_two_hours(&hourly), Some(2));
    }

    #[test]
    fn estimates_todays_cost_from_the_models_prices() {
        let mut index = UsageIndex::new();
        index.add(facts("m1", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(1_000_000, 100_000)));

        let today = summary_at(&index, "2026-11-04T12:00:00Z").today;

        // $2 of input + $1 of output
        assert!((today.cost_usd - 3.0).abs() < 1e-9);
    }

    #[test]
    fn counts_the_tokens_of_a_model_with_no_price_but_not_its_cost() {
        let mut index = UsageIndex::new();
        index.add(facts("m1", "2026-11-04T10:00:00Z", "claude-future-9-9", tokens(1_000_000, 0)));

        let summary = summary_at(&index, "2026-11-04T12:00:00Z");

        assert_eq!(summary.today.tokens, 1_000_000);
        assert_eq!(summary.today.cost_usd, 0.0);
        assert_eq!(summary.unpriced_models, vec!["claude-future-9-9"]);
        assert_eq!(summary.month.by_model[0].cost_usd, None);
    }

    #[test]
    fn adds_up_this_month_and_not_last_month() {
        let mut index = UsageIndex::new();
        index.add(facts("last", "2026-10-31T10:00:00Z", "claude-sonnet-5-5", tokens(1_000_000, 0)));
        index.add(facts("early", "2026-11-01T10:00:00Z", "claude-sonnet-5-5", tokens(1_000_000, 0)));
        index.add(facts("now", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(1_000_000, 0)));

        let month = summary_at(&index, "2026-11-04T12:00:00Z").month;

        assert!((month.cost_usd - 4.0).abs() < 1e-9);
        assert_eq!(month.tokens, 2_000_000);
    }

    #[test]
    fn lists_the_months_models_costliest_first_with_readable_names() {
        let mut index = UsageIndex::new();
        index.add(facts("a", "2026-11-02T10:00:00Z", "claude-haiku-5-5", tokens(1_000_000, 0)));
        index.add(facts("b", "2026-11-02T10:00:00Z", "claude-opus-5-5", tokens(1_000_000, 0)));
        index.add(facts("c", "2026-11-02T10:00:00Z", "claude-sonnet-5-5", tokens(1_000_000, 0)));

        let by_model = summary_at(&index, "2026-11-04T12:00:00Z").month.by_model;

        let names: Vec<&str> = by_model.iter().map(|m| m.display_name.as_str()).collect();
        assert_eq!(names, vec!["Opus 5.5", "Sonnet 5.5", "Haiku 5.5"]);
    }

    #[test]
    fn counts_a_streak_of_consecutive_days_ending_today() {
        let mut index = UsageIndex::new();
        for day in ["2026-11-04", "2026-11-03", "2026-11-02", "2026-10-30"] {
            index.add(facts(day, &format!("{day}T10:00:00Z"), "claude-sonnet-5-5", tokens(1, 1)));
        }

        assert_eq!(summary_at(&index, "2026-11-04T12:00:00Z").today.streak_days, 3);
    }

    #[test]
    fn keeps_a_streak_alive_before_todays_first_use() {
        let mut index = UsageIndex::new();
        for day in ["2026-11-03", "2026-11-02"] {
            index.add(facts(day, &format!("{day}T10:00:00Z"), "claude-sonnet-5-5", tokens(1, 1)));
        }

        assert_eq!(summary_at(&index, "2026-11-04T08:00:00Z").today.streak_days, 2);
    }

    #[test]
    fn has_no_streak_after_a_gap_of_a_day() {
        let mut index = UsageIndex::new();
        index.add(facts("m", "2026-11-01T10:00:00Z", "claude-sonnet-5-5", tokens(1, 1)));

        assert_eq!(summary_at(&index, "2026-11-04T12:00:00Z").today.streak_days, 0);
    }

    #[test]
    fn counts_a_streak_across_a_month_boundary() {
        let mut index = UsageIndex::new();
        for day in ["2026-11-01", "2026-10-31", "2026-10-30"] {
            index.add(facts(day, &format!("{day}T10:00:00Z"), "claude-sonnet-5-5", tokens(1, 1)));
        }

        assert_eq!(summary_at(&index, "2026-11-01T12:00:00Z").today.streak_days, 3);
    }

    #[test]
    fn puts_late_evening_use_on_the_users_own_day() {
        let mut index = UsageIndex::new();
        // 23:30 UTC on the 4th is 02:30 on the 5th at UTC+3.
        index.add(facts("m", "2026-11-04T23:30:00Z", "claude-sonnet-5-5", tokens(10, 0)));
        let now = parse_timestamp_ms("2026-11-05T09:00:00Z").unwrap();

        let today = index.summarize(now, 180).today;

        assert_eq!(today.tokens, 10);
        assert_eq!(today.hourly_tokens[2], 10);
    }

    #[test]
    fn says_there_is_no_usage_when_nothing_was_found() {
        let summary = UsageIndex::new().summarize(NOW, 0);

        assert!(!summary.any_usage);
        assert_eq!(summary.today.tokens, 0);
        assert!(summary.month.by_model.is_empty());
    }

    #[test]
    fn serializes_for_the_notch_with_camel_case_names() {
        let mut index = UsageIndex::new();
        index.add(facts("m", "2026-11-04T10:00:00Z", "claude-sonnet-5-5", tokens(10, 0)));

        let json = serde_json::to_value(summary_at(&index, "2026-11-04T12:00:00Z")).unwrap();

        assert_eq!(json["today"]["tokens"], 10);
        assert_eq!(json["today"]["toolCalls"], 0);
        assert_eq!(json["month"]["byModel"][0]["displayName"], "Sonnet 5.5");
        assert_eq!(json["anyUsage"], true);
    }
}
