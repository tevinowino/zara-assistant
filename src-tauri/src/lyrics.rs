//! Lyrics for the track that is playing, for the Lyrics widget and the lyric line in the notch.
//!
//! The lyrics come from LRCLIB (`lrclib.net`), a free community service that returns lyrics
//! with a timestamp for every line. This module is everything between "this track is playing"
//! and "here are its lines": it cleans up the title and artist Windows reports, asks LRCLIB
//! (`/api/get`, then `/api/search` if that finds nothing), remembers the answer on disk, and
//! reads LRCLIB's `.lrc` timestamps.
//!
//! Privacy: the artist, title and length of a track are sent to lrclib.net, once per track
//! (the answer is cached on this PC), and only while the Lyrics widget is on; the notch asks
//! for nothing otherwise. Nothing else is sent, and no identifier, key or account is involved.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LRCLIB_BASE_URL: &str = "https://lrclib.net";
/// LRCLIB asks clients to say who they are.
const USER_AGENT: &str = concat!(
    "Zara/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/tevinowino/zara-assistant)"
);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// A search result whose length differs from the playing track's by more than this many
/// seconds is a different recording (a live version, a remix) whose timing would not fit.
const MAX_DURATION_DIFFERENCE_SECONDS: f64 = 4.0;
/// Most results from a search that are looked at.
const MAX_SEARCH_RESULTS: usize = 20;
/// A track with no lyrics is asked about again after this long, in milliseconds (a day).
const NOT_FOUND_RETRY_AFTER_MS: i64 = 24 * 60 * 60 * 1000;
/// Most answers kept on disk; the least recently written are deleted first.
const MAX_CACHED_TRACKS: usize = 300;

/// One line of a song and when it is sung.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    /// Milliseconds from the start of the track.
    pub time_ms: i64,
    /// What is sung; empty for an instrumental break.
    pub text: String,
}

/// What is known about a track's lyrics.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum LyricsResult {
    /// Lyrics with a time for each line.
    Synced { lines: Vec<LyricLine> },
    /// Lyrics without timing.
    Plain { text: String },
    /// The track has no words.
    Instrumental,
    /// LRCLIB has nothing for this track.
    None,
    /// The answer could not be found out (offline, LRCLIB down); worth asking again later.
    Error,
}

// ---- reading .lrc ---------------------------------------------------------------------------

/// Reads `.lrc` text into lines in time order.
///
/// A line can carry several timestamps (`[00:12.00][01:40.50]La la`), the fraction can be one
/// to three digits, `<00:12.30>` word marks inside a line are dropped, and tags such as
/// `[ar:Artist]` are ignored. An `[offset:+500]` tag shifts every line: as the format defines
/// it, a positive offset makes the lyrics appear sooner.
pub fn parse_lrc(text: &str) -> Vec<LyricLine> {
    let mut offset_ms: i64 = 0;
    let mut lines: Vec<LyricLine> = Vec::new();

    for raw in text.lines() {
        let mut rest = raw.trim_start();
        let mut times: Vec<i64> = Vec::new();
        while let Some(stripped) = rest.strip_prefix('[') {
            let Some(end) = stripped.find(']') else { break };
            let tag = &stripped[..end];
            rest = &stripped[end + 1..];
            if let Some(ms) = parse_timestamp(tag) {
                times.push(ms);
            } else if let Some(value) = tag.strip_prefix("offset:") {
                offset_ms = value.trim().parse().unwrap_or(0);
            }
            // Any other tag ([ar:], [ti:], [by:]) is information about the file, not a lyric.
        }
        if times.is_empty() {
            continue;
        }
        let text = strip_word_marks(rest).trim().to_string();
        for time in times {
            lines.push(LyricLine { time_ms: time, text: text.clone() });
        }
    }

    for line in &mut lines {
        line.time_ms = (line.time_ms - offset_ms).max(0);
    }
    lines.sort_by_key(|line| line.time_ms);
    lines
}

/// `mm:ss`, `mm:ss.f`, `mm:ss.ff`, `mm:ss.fff` (or `:` before the fraction), in milliseconds.
fn parse_timestamp(tag: &str) -> Option<i64> {
    let (minutes, rest) = tag.split_once(':')?;
    let (seconds, fraction) = match rest.split_once(['.', ':']) {
        Some((seconds, fraction)) => (seconds, Some(fraction)),
        None => (rest, None),
    };
    if minutes.is_empty() || seconds.len() != 2 {
        return None;
    }
    let minutes: i64 = minutes.parse().ok()?;
    let seconds: i64 = seconds.parse().ok()?;
    if seconds >= 60 {
        return None;
    }
    let fraction_ms = match fraction {
        None => 0,
        Some(digits) if (1..=3).contains(&digits.len()) && digits.chars().all(|c| c.is_ascii_digit()) => {
            let value: i64 = digits.parse().ok()?;
            value * 10_i64.pow(3 - digits.len() as u32)
        }
        Some(_) => return None,
    };
    Some((minutes * 60 + seconds) * 1000 + fraction_ms)
}

/// Removes `<mm:ss.xx>` marks that some files put before each word.
fn strip_word_marks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        let Some(end) = rest[start..].find('>') else { break };
        let mark = &rest[start + 1..start + end];
        if parse_timestamp(mark).is_some() {
            out.push_str(&rest[..start]);
            rest = &rest[start + end + 1..];
        } else {
            out.push_str(&rest[..start + end + 1]);
            rest = &rest[start + end + 1..];
        }
    }
    out.push_str(rest);
    out
}

// ---- cleaning up what Windows says is playing ----------------------------------------------

/// A track's title and artist, cleaned up to match how lyrics services list them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CleanTrack {
    pub title: String,
    pub artist: String,
}

/// Words that, inside brackets or after a dash, mark something that is not part of the song's
/// name: "(Official Video)", "[Lyrics]", "- Remastered 2011".
const NOISE_WORDS: [&str; 18] = [
    "official",
    "video",
    "audio",
    "lyric",
    "lyrics",
    "visualizer",
    "visualiser",
    "remaster",
    "remastered",
    "explicit",
    "clean",
    "hd",
    "4k",
    "mv",
    "m/v",
    "single version",
    "album version",
    "radio edit",
];

/// Words that mark a featured artist.
const FEATURE_WORDS: [&str; 4] = ["feat.", "feat ", "ft.", "featuring"];

fn has_noise(segment: &str) -> bool {
    let lower = segment.to_lowercase();
    NOISE_WORDS.iter().any(|word| {
        lower
            .split(|c: char| !c.is_alphanumeric() && c != '/')
            .any(|token| token == *word)
            || (word.contains(' ') && lower.contains(word))
    }) || FEATURE_WORDS.iter().any(|word| lower.starts_with(word))
}

/// Drops `( ... )` and `[ ... ]` segments that are noise, keeping the ones that are part of the
/// name ("(Live)", "(Part 2)").
fn without_noisy_brackets(title: &str) -> String {
    let mut out = String::new();
    let mut chars = title.chars().peekable();
    while let Some(c) = chars.next() {
        let close = match c {
            '(' => ')',
            '[' => ']',
            _ => {
                out.push(c);
                continue;
            }
        };
        let mut inner = String::new();
        let mut closed = false;
        for next in chars.by_ref() {
            if next == close {
                closed = true;
                break;
            }
            inner.push(next);
        }
        if !closed || !has_noise(&inner) {
            out.push(c);
            out.push_str(&inner);
            if closed {
                out.push(close);
            }
        }
    }
    out
}

/// Drops a trailing " - Remastered 2011" style suffix.
fn without_noisy_suffix(title: &str) -> String {
    match title.rsplit_once(" - ") {
        Some((name, suffix)) if !name.trim().is_empty() && has_noise(suffix) => name.to_string(),
        _ => title.to_string(),
    }
}

fn collapse_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_artist(artist: &str) -> String {
    let artist = artist.trim();
    let artist = artist.strip_suffix(" - Topic").unwrap_or(artist);
    let lower = artist.to_lowercase();
    let artist = if lower.ends_with("vevo") && artist.len() > 4 {
        &artist[..artist.len() - 4]
    } else {
        artist
    };
    collapse_spaces(artist)
}

/// Cleans up the title and artist the way Windows reports them. Browsers often report a video
/// title ("Artist - Title (Official Video)") with the channel as the artist; lyrics services
/// list "Title" by "Artist".
pub fn clean_track(title: &str, artist: &str) -> CleanTrack {
    let mut artist = clean_artist(artist);
    let mut title = collapse_spaces(&without_noisy_suffix(&without_noisy_brackets(title)));

    // "Artist - Title": the artist is missing, or the title repeats it.
    if let Some((first, second)) = title.split_once(" - ") {
        let first = first.trim().to_string();
        let second = second.trim().to_string();
        if !second.is_empty() {
            if artist.is_empty() || artist.to_lowercase() == first.to_lowercase() {
                artist = first;
                title = second;
            } else if artist.to_lowercase().contains(&first.to_lowercase()) {
                title = second;
            }
        }
    }
    CleanTrack { title, artist }
}

// ---- LRCLIB ---------------------------------------------------------------------------------

/// A track as LRCLIB returns it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibRecord {
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

impl LrclibRecord {
    fn has_lyrics(&self) -> bool {
        self.instrumental
            || self.synced_lyrics.as_deref().is_some_and(|text| !text.trim().is_empty())
            || self.plain_lyrics.as_deref().is_some_and(|text| !text.trim().is_empty())
    }

    fn into_result(self) -> LyricsResult {
        if self.instrumental {
            return LyricsResult::Instrumental;
        }
        if let Some(synced) = self.synced_lyrics.as_deref() {
            let lines = parse_lrc(synced);
            if !lines.is_empty() {
                return LyricsResult::Synced { lines };
            }
        }
        match self.plain_lyrics {
            Some(text) if !text.trim().is_empty() => LyricsResult::Plain { text },
            _ => LyricsResult::None,
        }
    }
}

/// Asks LRCLIB for a track's lyrics.
pub struct LrclibClient {
    http: reqwest::Client,
    base_url: String,
}

impl LrclibClient {
    pub fn new(base_url: &str) -> Result<Self, reqwest::Error> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(REQUEST_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        Ok(Self { http, base_url: base_url.trim_end_matches('/').to_string() })
    }

    /// The lyrics for `track`, whose length is `duration_seconds` if known. `Err` means LRCLIB
    /// could not be asked or answered with an error, as opposed to answering "no lyrics".
    pub async fn lyrics(
        &self,
        track: &CleanTrack,
        duration_seconds: Option<u32>,
    ) -> Result<LyricsResult, reqwest::Error> {
        if let Some(record) = self.get_exact(track, duration_seconds).await? {
            return Ok(record.into_result());
        }
        Ok(match self.search(track, duration_seconds).await? {
            Some(record) => record.into_result(),
            None => LyricsResult::None,
        })
    }

    fn url(&self, path: &str, params: &[(&str, String)]) -> reqwest::Url {
        reqwest::Url::parse_with_params(&format!("{}{}", self.base_url, path), params)
            .expect("a fixed path and encoded parameters make a valid URL")
    }

    async fn get_exact(
        &self,
        track: &CleanTrack,
        duration_seconds: Option<u32>,
    ) -> Result<Option<LrclibRecord>, reqwest::Error> {
        let mut params = vec![
            ("artist_name", track.artist.clone()),
            ("track_name", track.title.clone()),
        ];
        if let Some(seconds) = duration_seconds {
            params.push(("duration", seconds.to_string()));
        }
        let response = self.http.get(self.url("/api/get", &params)).send().await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(response.error_for_status()?.json::<LrclibRecord>().await?))
    }

    async fn search(
        &self,
        track: &CleanTrack,
        duration_seconds: Option<u32>,
    ) -> Result<Option<LrclibRecord>, reqwest::Error> {
        let mut params = vec![("track_name", track.title.clone())];
        if !track.artist.is_empty() {
            params.push(("artist_name", track.artist.clone()));
        }
        let records: Vec<LrclibRecord> = self
            .http
            .get(self.url("/api/search", &params))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(best_match(records, duration_seconds))
    }
}

/// The search result that fits the playing track best: it has lyrics, its length is within a few
/// seconds of the track's (when that is known), and it prefers synced lyrics, then the closest
/// length.
fn best_match(records: Vec<LrclibRecord>, duration_seconds: Option<u32>) -> Option<LrclibRecord> {
    records
        .into_iter()
        .take(MAX_SEARCH_RESULTS)
        .filter(LrclibRecord::has_lyrics)
        .filter_map(|record| {
            let difference = match (duration_seconds, record.duration) {
                (Some(wanted), Some(actual)) => (actual - f64::from(wanted)).abs(),
                _ => 0.0,
            };
            (difference <= MAX_DURATION_DIFFERENCE_SECONDS).then_some((difference, record))
        })
        .min_by(|(a_diff, a), (b_diff, b)| {
            let a_synced = a.synced_lyrics.as_deref().is_some_and(|t| !t.trim().is_empty());
            let b_synced = b.synced_lyrics.as_deref().is_some_and(|t| !t.trim().is_empty());
            b_synced
                .cmp(&a_synced)
                .then(a_diff.partial_cmp(b_diff).unwrap_or(std::cmp::Ordering::Equal))
        })
        .map(|(_, record)| record)
}

// ---- remembering answers on disk -------------------------------------------------------------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedAnswer {
    result: LyricsResult,
    /// Milliseconds since the Unix epoch.
    stored_at_ms: i64,
}

/// What LRCLIB said about each track, kept so a song is asked about once.
pub struct LyricsCache {
    directory: PathBuf,
}

/// A name for a track's file: FNV-1a of the cleaned artist, title and length.
fn cache_file_name(track: &CleanTrack, duration_seconds: Option<u32>) -> String {
    let key = format!(
        "{}\u{1f}{}\u{1f}{}",
        track.artist.to_lowercase(),
        track.title.to_lowercase(),
        duration_seconds.unwrap_or(0)
    );
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}.json")
}

impl LyricsCache {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    /// The remembered answer, unless there is none or it is out of date: "no lyrics" is
    /// forgotten after a day, in case someone has added them since; lyrics are kept.
    pub fn get(&self, track: &CleanTrack, duration_seconds: Option<u32>, now_ms: i64) -> Option<LyricsResult> {
        let path = self.directory.join(cache_file_name(track, duration_seconds));
        let answer: CachedAnswer = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
        match answer.result {
            LyricsResult::None if now_ms - answer.stored_at_ms > NOT_FOUND_RETRY_AFTER_MS => None,
            LyricsResult::Error => None,
            result => Some(result),
        }
    }

    /// Remembers an answer. An `Error` is not an answer and is never kept.
    pub fn put(&self, track: &CleanTrack, duration_seconds: Option<u32>, result: &LyricsResult, now_ms: i64) {
        if *result == LyricsResult::Error {
            return;
        }
        if std::fs::create_dir_all(&self.directory).is_err() {
            return;
        }
        let answer = CachedAnswer { result: result.clone(), stored_at_ms: now_ms };
        let Ok(bytes) = serde_json::to_vec(&answer) else { return };
        let path = self.directory.join(cache_file_name(track, duration_seconds));
        if crate::utils::atomic_write_file(&path, &bytes).is_ok() {
            self.prune();
        }
    }

    /// Deletes the oldest files beyond `MAX_CACHED_TRACKS`.
    fn prune(&self) {
        let Ok(entries) = std::fs::read_dir(&self.directory) else { return };
        let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
            .collect();
        if files.len() <= MAX_CACHED_TRACKS {
            return;
        }
        files.sort();
        for (_, path) in files.iter().take(files.len() - MAX_CACHED_TRACKS) {
            let _ = std::fs::remove_file(path);
        }
    }
}

// ---- the command -----------------------------------------------------------------------------

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// The track length in whole seconds, rounded, if the player gave one.
fn whole_seconds(duration_ms: Option<i64>) -> Option<u32> {
    duration_ms.filter(|ms| *ms > 0).map(|ms| ((ms + 500) / 1000) as u32)
}

/// The lyrics of the track that is playing, from the disk cache or from LRCLIB.
///
/// Call this only while the Lyrics widget is on: asking sends the artist, title and length of
/// the track to lrclib.net. A track that is not asked about again is not sent again.
#[tauri::command]
pub async fn lyrics_for_track(
    app: AppHandle,
    title: String,
    artist: String,
    duration_ms: Option<i64>,
) -> LyricsResult {
    let track = clean_track(&title, &artist);
    if track.title.is_empty() {
        return LyricsResult::None;
    }
    let seconds = whole_seconds(duration_ms);
    let directory = match app.path().app_data_dir() {
        Ok(directory) => directory.join("lyrics-cache"),
        Err(_) => return fetch_uncached(&track, seconds).await,
    };
    let cache = LyricsCache::new(directory);

    let cached = {
        let (cache_dir, track) = (cache.directory.clone(), track.clone());
        tauri::async_runtime::spawn_blocking(move || {
            LyricsCache::new(cache_dir).get(&track, seconds, now_ms())
        })
        .await
        .ok()
        .flatten()
    };
    if let Some(result) = cached {
        return result;
    }

    let result = fetch_uncached(&track, seconds).await;
    let (cache_dir, stored, track_to_store) = (cache.directory.clone(), result.clone(), track.clone());
    let _ = tauri::async_runtime::spawn_blocking(move || {
        LyricsCache::new(cache_dir).put(&track_to_store, seconds, &stored, now_ms());
    })
    .await;
    result
}

async fn fetch_uncached(track: &CleanTrack, seconds: Option<u32>) -> LyricsResult {
    match LrclibClient::new(LRCLIB_BASE_URL) {
        Ok(client) => client.lyrics(track, seconds).await.unwrap_or(LyricsResult::Error),
        Err(_) => LyricsResult::Error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn track(title: &str, artist: &str) -> CleanTrack {
        CleanTrack { title: title.to_string(), artist: artist.to_string() }
    }

    fn line(time_ms: i64, text: &str) -> LyricLine {
        LyricLine { time_ms, text: text.to_string() }
    }

    // ---- parse_lrc

    #[test]
    fn reads_a_timestamped_line() {
        assert_eq!(parse_lrc("[00:12.34] Hello there"), vec![line(12_340, "Hello there")]);
    }

    #[test]
    fn reads_two_and_three_digit_fractions_and_none() {
        let lrc = "[00:01.5]a\n[00:02.25]b\n[00:03.125]c\n[00:04]d";

        assert_eq!(
            parse_lrc(lrc),
            vec![line(1_500, "a"), line(2_250, "b"), line(3_125, "c"), line(4_000, "d")]
        );
    }

    #[test]
    fn reads_minutes_past_an_hour_and_colon_fractions() {
        assert_eq!(parse_lrc("[62:05:50]x"), vec![line(3_725_500, "x")]);
    }

    #[test]
    fn gives_a_line_with_several_timestamps_to_each_time() {
        let lines = parse_lrc("[00:10.00][01:30.00]Chorus line");

        assert_eq!(lines, vec![line(10_000, "Chorus line"), line(90_000, "Chorus line")]);
    }

    #[test]
    fn puts_lines_in_time_order_whatever_order_they_are_written_in() {
        let lines = parse_lrc("[00:20.00]second\n[00:05.00]first");

        assert_eq!(lines, vec![line(5_000, "first"), line(20_000, "second")]);
    }

    #[test]
    fn ignores_tags_about_the_file() {
        let lrc = "[ar:Migos]\n[ti:Notice Me]\n[by:someone]\n[00:01.00]La";

        assert_eq!(parse_lrc(lrc), vec![line(1_000, "La")]);
    }

    #[test]
    fn keeps_an_empty_line_as_a_break() {
        assert_eq!(parse_lrc("[00:30.00]"), vec![line(30_000, "")]);
    }

    #[test]
    fn drops_word_marks_inside_a_line() {
        let lines = parse_lrc("[00:10.00]<00:10.00>Hel<00:10.40>lo <00:10.80>there");

        assert_eq!(lines, vec![line(10_000, "Hello there")]);
    }

    #[test]
    fn keeps_angle_brackets_that_are_not_word_marks() {
        let lines = parse_lrc("[00:10.00]I <3 you");

        assert_eq!(lines, vec![line(10_000, "I <3 you")]);
    }

    #[test]
    fn a_positive_offset_makes_the_lyrics_come_sooner() {
        let lines = parse_lrc("[offset:+500]\n[00:10.00]La");

        assert_eq!(lines, vec![line(9_500, "La")]);
    }

    #[test]
    fn a_negative_offset_makes_the_lyrics_come_later() {
        let lines = parse_lrc("[offset:-500]\n[00:10.00]La");

        assert_eq!(lines, vec![line(10_500, "La")]);
    }

    #[test]
    fn an_offset_never_moves_a_line_before_the_start() {
        let lines = parse_lrc("[offset:5000]\n[00:01.00]La");

        assert_eq!(lines, vec![line(0, "La")]);
    }

    #[test]
    fn ignores_lines_that_have_no_timestamp() {
        assert_eq!(parse_lrc("just some words\n[00:01.00]La"), vec![line(1_000, "La")]);
    }

    #[test]
    fn ignores_a_malformed_timestamp() {
        assert!(parse_lrc("[0:7x.00]La\n[00:75.00]Lb\n[00:01.2345]Lc").is_empty());
    }

    #[test]
    fn reads_windows_line_endings() {
        assert_eq!(
            parse_lrc("[00:01.00]a\r\n[00:02.00]b\r\n"),
            vec![line(1_000, "a"), line(2_000, "b")]
        );
    }

    // ---- clean_track

    #[test]
    fn leaves_a_clean_track_alone() {
        assert_eq!(clean_track("Notice Me", "Migos"), track("Notice Me", "Migos"));
    }

    #[test]
    fn drops_official_video_and_lyric_brackets() {
        assert_eq!(clean_track("Notice Me (Official Video)", "Migos").title, "Notice Me");
        assert_eq!(clean_track("Notice Me [Lyrics]", "Migos").title, "Notice Me");
        assert_eq!(clean_track("Notice Me (Official Audio) [HD]", "Migos").title, "Notice Me");
    }

    #[test]
    fn drops_a_featured_artist() {
        assert_eq!(clean_track("Notice Me (feat. Travis Scott)", "Migos").title, "Notice Me");
        assert_eq!(clean_track("Notice Me [ft. Someone]", "Migos").title, "Notice Me");
    }

    #[test]
    fn keeps_brackets_that_are_part_of_the_name() {
        assert_eq!(clean_track("Song (Part 2)", "Band").title, "Song (Part 2)");
        assert_eq!(clean_track("Song (Live)", "Band").title, "Song (Live)");
    }

    #[test]
    fn drops_a_remaster_suffix() {
        assert_eq!(clean_track("Bohemian Rhapsody - Remastered 2011", "Queen").title, "Bohemian Rhapsody");
        assert_eq!(clean_track("Hello - Single Version", "Adele").title, "Hello");
    }

    #[test]
    fn keeps_a_dash_that_is_part_of_the_name() {
        assert_eq!(clean_track("Hello - Goodbye", "The Beatles").title, "Hello - Goodbye");
    }

    #[test]
    fn splits_artist_and_title_when_the_artist_is_missing() {
        assert_eq!(clean_track("Migos - Notice Me (Official Video)", ""), track("Notice Me", "Migos"));
    }

    #[test]
    fn splits_artist_and_title_when_the_title_repeats_the_artist() {
        assert_eq!(clean_track("Migos - Notice Me", "Migos"), track("Notice Me", "Migos"));
    }

    #[test]
    fn drops_a_title_prefix_when_the_channel_name_contains_the_artist() {
        assert_eq!(
            clean_track("Migos - Notice Me", "Migos Official"),
            track("Notice Me", "Migos Official")
        );
    }

    #[test]
    fn cleans_a_youtube_topic_channel_and_vevo_suffix() {
        assert_eq!(clean_track("Notice Me", "Migos - Topic").artist, "Migos");
        assert_eq!(clean_track("Notice Me", "MigosVEVO").artist, "Migos");
    }

    #[test]
    fn collapses_extra_spaces() {
        assert_eq!(clean_track("  Notice   Me  ", " Migos ").title, "Notice Me");
    }

    // ---- LRCLIB client

    fn synced_record(duration: f64) -> serde_json::Value {
        serde_json::json!({
            "trackName": "Notice Me",
            "artistName": "Migos",
            "duration": duration,
            "instrumental": false,
            "plainLyrics": "first\nsecond",
            "syncedLyrics": "[00:01.00] first\n[00:03.50] second"
        })
    }

    #[tokio::test]
    async fn finds_synced_lyrics_for_an_exact_match() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .and(query_param("artist_name", "Migos"))
            .and(query_param("track_name", "Notice Me"))
            .and(query_param("duration", "234"))
            .respond_with(ResponseTemplate::new(200).set_body_json(synced_record(234.0)))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Notice Me", "Migos"), Some(234)).await.unwrap();

        assert_eq!(
            result,
            LyricsResult::Synced { lines: vec![line(1_000, "first"), line(3_500, "second")] }
        );
    }

    #[tokio::test]
    async fn says_who_is_asking() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .and(header("user-agent", USER_AGENT))
            .respond_with(ResponseTemplate::new(200).set_body_json(synced_record(234.0)))
            .expect(1)
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        client.lyrics(&track("Notice Me", "Migos"), Some(234)).await.unwrap();

        server.verify().await;
    }

    #[tokio::test]
    async fn asks_without_a_length_when_the_player_gave_none() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .respond_with(ResponseTemplate::new(200).set_body_json(synced_record(234.0)))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        client.lyrics(&track("Notice Me", "Migos"), None).await.unwrap();

        let requests = server.received_requests().await.unwrap();
        assert!(!requests[0].url.query().unwrap_or_default().contains("duration"));
    }

    #[tokio::test]
    async fn answers_plain_when_only_unsynced_lyrics_exist() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "instrumental": false, "plainLyrics": "one\ntwo", "syncedLyrics": null, "duration": 100.0
            })))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Song", "Band"), Some(100)).await.unwrap();

        assert_eq!(result, LyricsResult::Plain { text: "one\ntwo".to_string() });
    }

    #[tokio::test]
    async fn answers_instrumental_for_a_track_without_words() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "instrumental": true, "plainLyrics": null, "syncedLyrics": null, "duration": 100.0
            })))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Theme", "Band"), Some(100)).await.unwrap();

        assert_eq!(result, LyricsResult::Instrumental);
    }

    #[tokio::test]
    async fn falls_back_to_search_when_there_is_no_exact_match() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/search"))
            .and(query_param("track_name", "Notice Me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([synced_record(235.0)])))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Notice Me", "Migos"), Some(234)).await.unwrap();

        assert!(matches!(result, LyricsResult::Synced { .. }));
    }

    #[tokio::test]
    async fn answers_none_when_search_finds_nothing() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Nothing", "Nobody"), Some(100)).await.unwrap();

        assert_eq!(result, LyricsResult::None);
    }

    #[tokio::test]
    async fn rejects_a_search_result_of_a_different_length() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([synced_record(300.0)])))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Notice Me", "Migos"), Some(234)).await.unwrap();

        assert_eq!(result, LyricsResult::None);
    }

    #[tokio::test]
    async fn prefers_synced_lyrics_then_the_closest_length() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/get"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let plain_only = serde_json::json!({
            "duration": 234.0, "instrumental": false, "plainLyrics": "plain only", "syncedLyrics": null
        });
        let mut far_synced = synced_record(237.0);
        far_synced["syncedLyrics"] = serde_json::json!("[00:01.00] far");
        let mut near_synced = synced_record(234.5);
        near_synced["syncedLyrics"] = serde_json::json!("[00:01.00] near");
        Mock::given(method("GET"))
            .and(path("/api/search"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!([plain_only, far_synced, near_synced])),
            )
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Notice Me", "Migos"), Some(234)).await.unwrap();

        assert_eq!(result, LyricsResult::Synced { lines: vec![line(1_000, "near")] });
    }

    #[tokio::test]
    async fn reports_an_error_when_lrclib_fails() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Notice Me", "Migos"), Some(234)).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn reports_an_error_when_lrclib_asks_to_slow_down() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(429))
            .mount(&server)
            .await;
        let client = LrclibClient::new(&server.uri()).unwrap();

        let result = client.lyrics(&track("Notice Me", "Migos"), Some(234)).await;

        assert!(result.is_err());
    }

    // ---- cache

    #[test]
    fn remembers_lyrics_between_asks() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());
        let result = LyricsResult::Synced { lines: vec![line(1_000, "La")] };

        cache.put(&track("Notice Me", "Migos"), Some(234), &result, 1_000);

        assert_eq!(cache.get(&track("Notice Me", "Migos"), Some(234), 5_000), Some(result));
    }

    #[test]
    fn keeps_lyrics_however_long_ago_they_were_stored() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());
        let result = LyricsResult::Plain { text: "words".to_string() };
        cache.put(&track("Song", "Band"), Some(100), &result, 0);

        let much_later = 400 * 24 * 60 * 60 * 1000;

        assert_eq!(cache.get(&track("Song", "Band"), Some(100), much_later), Some(result));
    }

    #[test]
    fn forgets_no_lyrics_after_a_day_so_it_can_be_asked_again() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());
        cache.put(&track("Song", "Band"), Some(100), &LyricsResult::None, 0);

        assert_eq!(cache.get(&track("Song", "Band"), Some(100), NOT_FOUND_RETRY_AFTER_MS), Some(LyricsResult::None));
        assert_eq!(cache.get(&track("Song", "Band"), Some(100), NOT_FOUND_RETRY_AFTER_MS + 1), None);
    }

    #[test]
    fn never_keeps_an_error() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());

        cache.put(&track("Song", "Band"), Some(100), &LyricsResult::Error, 0);

        assert_eq!(cache.get(&track("Song", "Band"), Some(100), 1), None);
    }

    #[test]
    fn tells_tracks_apart_by_artist_title_and_length() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());
        cache.put(&track("Song", "Band"), Some(100), &LyricsResult::Instrumental, 0);

        assert_eq!(cache.get(&track("Song", "Other Band"), Some(100), 1), None);
        assert_eq!(cache.get(&track("Other Song", "Band"), Some(100), 1), None);
        assert_eq!(cache.get(&track("Song", "Band"), Some(200), 1), None);
    }

    #[test]
    fn ignores_capital_letters_when_matching_a_track() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());
        cache.put(&track("notice me", "migos"), Some(234), &LyricsResult::Instrumental, 0);

        assert_eq!(
            cache.get(&track("Notice Me", "Migos"), Some(234), 1),
            Some(LyricsResult::Instrumental)
        );
    }

    #[test]
    fn reads_nothing_from_a_damaged_file() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());
        let name = cache_file_name(&track("Song", "Band"), Some(100));
        std::fs::write(directory.path().join(name), b"{ not json").unwrap();

        assert_eq!(cache.get(&track("Song", "Band"), Some(100), 1), None);
    }

    #[test]
    fn keeps_at_most_three_hundred_tracks() {
        let directory = tempfile::tempdir().unwrap();
        let cache = LyricsCache::new(directory.path().to_path_buf());

        for index in 0..(MAX_CACHED_TRACKS + 10) {
            cache.put(&track(&format!("Song {index}"), "Band"), Some(100), &LyricsResult::Instrumental, 0);
        }

        let kept = std::fs::read_dir(directory.path()).unwrap().count();
        assert_eq!(kept, MAX_CACHED_TRACKS);
    }

    // ---- the result as the notch receives it

    #[test]
    fn serializes_synced_lyrics_with_a_status_and_camel_case_lines() {
        let json = serde_json::to_value(LyricsResult::Synced { lines: vec![line(1_000, "La")] }).unwrap();

        assert_eq!(json, serde_json::json!({ "status": "synced", "lines": [{ "timeMs": 1000, "text": "La" }] }));
    }

    #[test]
    fn serializes_the_other_answers_as_just_a_status() {
        assert_eq!(serde_json::to_value(LyricsResult::Instrumental).unwrap(), serde_json::json!({ "status": "instrumental" }));
        assert_eq!(serde_json::to_value(LyricsResult::None).unwrap(), serde_json::json!({ "status": "none" }));
        assert_eq!(serde_json::to_value(LyricsResult::Error).unwrap(), serde_json::json!({ "status": "error" }));
    }

    #[test]
    fn rounds_the_track_length_to_whole_seconds() {
        assert_eq!(whole_seconds(Some(234_400)), Some(234));
        assert_eq!(whole_seconds(Some(234_600)), Some(235));
        assert_eq!(whole_seconds(Some(0)), None);
        assert_eq!(whole_seconds(None), None);
    }
}
