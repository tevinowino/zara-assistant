# Forwards a Claude Code hook event to Zara, so the notch can show what Claude Code is doing.
#
# Zara installs this file and points Claude Code's hooks at it (Settings > Notch > Claude
# Code > Connect). Disconnecting in Settings removes the hooks; this file is then unused.
#
# Claude Code sends the event as JSON on standard input. Only the few fields the notch shows
# are kept, cut short: never the prompt, the tool input or the tool output. They are appended
# as one line to a file that Zara reads (and that exists only while Zara's Claude Code widget
# is on). Nothing is sent over the network.
#
# ZARA_CLAUDE_SPOOL overrides where the line is written; it exists for tests.

$ErrorActionPreference = 'SilentlyContinue'

$spool = $env:ZARA_CLAUDE_SPOOL
if (-not $spool) { $spool = Join-Path $env:APPDATA 'com.zara.app\claude-code-events.jsonl' }

# No file means the widget is off: do nothing, quickly.
if (-not (Test-Path -LiteralPath $spool)) { exit 0 }
# Zara is not running, or not reading: stop adding to the file instead of growing it.
if ((Get-Item -LiteralPath $spool).Length -gt 524288) { exit 0 }

$raw = [Console]::In.ReadToEnd()
$event = $raw | ConvertFrom-Json
if (-not $event.session_id) { exit 0 }

function Shorten($text, $maxLength) {
    if ($null -eq $text) { return $null }
    $value = [string]$text
    if ($value.Length -gt $maxLength) { return $value.Substring(0, $maxLength) }
    return $value
}

$line = [ordered]@{
    session_id             = $event.session_id
    hook_event_name        = $event.hook_event_name
    cwd                    = $event.cwd
    notification_type      = $event.notification_type
    message                = Shorten $event.message 400
    last_assistant_message = Shorten $event.last_assistant_message 400
    session_title          = Shorten $event.session_title 120
} | ConvertTo-Json -Compress

# Several hooks can fire at once; if the file is busy, wait a moment and try again.
for ($attempt = 0; $attempt -lt 4; $attempt++) {
    try {
        # UTF-8 without a byte-order mark, one line per event.
        [System.IO.File]::AppendAllText($spool, $line + "`n", (New-Object System.Text.UTF8Encoding $false))
        break
    } catch {
        Start-Sleep -Milliseconds 60
    }
}
exit 0
