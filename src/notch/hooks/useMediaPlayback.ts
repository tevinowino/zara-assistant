import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimation } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTrailingThrottle } from "../../hooks/useTrailingThrottle";
import type { MediaInfo } from "../types";

export interface UseMediaPlaybackOptions {
	/** Whether the music activity is enabled in Settings. */
	musicModeEnabled: boolean;
	/** The notch's mode setting; "peek" reveals the notch when a track starts. */
	notchMode: string;
	/** Reveals the notch for the given number of milliseconds. */
	triggerEventPeek: (duration?: number) => void;
}

/**
 * What is playing and how to control it: the current track and artwork, the system
 * volume, transport controls with their button animations, and whether the music
 * activity should still be shown on the collapsed notch.
 */
export function useMediaPlayback({
	musicModeEnabled,
	notchMode,
	triggerEventPeek
}: UseMediaPlaybackOptions) {
	// Media state
	const [isPlaying, setIsPlaying] = useState(false);
	const [mediaInfo, setMediaInfo] = useState<MediaInfo>({
		title: "",
		artist: "",
		is_playing: false,
		has_media: false
	});
	const [albumArtUrl, setAlbumArtUrl] = useState<string | null>(null);
	const [albumArtKey, setAlbumArtKey] = useState(0);
	const [volume, setVolume] = useState(0.5);
	const [isMuted, setIsMuted] = useState(false);
	// Sliders show 0 while muted, matching the overlay HUD.
	const displayVolume = isMuted ? 0 : volume;

	const lastTrackRef = useRef<string | null>(null);
	const lastPlayingRef = useRef<boolean>(false);
	const [musicActivityVisible, setMusicActivityVisible] = useState(false);

	// Keep a paused media session visible briefly so it can be resumed, then
	// clear its compact activity even if Windows retains the media session.
	useEffect(() => {
		if (!musicModeEnabled || !mediaInfo.has_media) {
			setMusicActivityVisible(false);
			return;
		}
		setMusicActivityVisible(true);
		if (isPlaying) return;
		const timeout = window.setTimeout(() => setMusicActivityVisible(false), 5000);
		return () => window.clearTimeout(timeout);
	}, [musicModeEnabled, mediaInfo.has_media, isPlaying]);

	// In peek mode, briefly show the notch when a new track starts or playback
	// resumes. The notch itself never switches views for media; the collapsed
	// pill follows the live-activity rule below.
	useEffect(() => {
		const isNewTrackWhilePlaying = mediaInfo.title !== lastTrackRef.current && isPlaying;
		const justStartedPlaying = isPlaying && !lastPlayingRef.current;

		// Peek notch on media events (play start or track change)
		if (notchMode === "peek" && (isNewTrackWhilePlaying || justStartedPlaying)) {
			triggerEventPeek(3000);
		}

		lastTrackRef.current = mediaInfo.title;
		lastPlayingRef.current = isPlaying;
	}, [isPlaying, mediaInfo.title, notchMode, triggerEventPeek]);

	// Listen for Volume Changes
	useEffect(() => {
		const unlisten = listen<{ volume: number; is_muted: boolean }>("volume-change", (event) => {
			setVolume(event.payload.volume);
			setIsMuted(event.payload.is_muted);
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// Native Windows Media Controls - Listen for updates from background worker
	useEffect(() => {
		const unlisten = listen<MediaInfo>("media-update", (event) => {
			const info = event.payload;
			if (!info) return;

			setMediaInfo((prev) => {
				// Find if artwork changed by checking the first element
				const prevArt = prev.artwork?.[0];
				const nextArt = info.artwork?.[0];
				const artChanged = prevArt !== nextArt;

				if (
					prev.title === info.title &&
					prev.artist === info.artist &&
					prev.is_playing === info.is_playing &&
					prev.has_media === info.has_media &&
					!artChanged &&
					prev.position_ms === info.position_ms &&
					prev.duration_ms === info.duration_ms
				) {
					return prev;
				}

				// Update playing state separately for the hook triggers
				setIsPlaying(info.is_playing);

				if (info.artwork && info.artwork.length > 0) {
					const newArt = info.artwork[0];
					setAlbumArtUrl((prev) => {
						if (prev !== newArt) {
							setAlbumArtKey((k) => k + 1);
							return newArt;
						}
						return prev;
					});
				} else {
					setAlbumArtUrl(null);
				}

				return info;
			});
		});

		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// Media controls via Tauri commands
	/* Unused saveAndBroadcast removed to fix TS build error */
	const togglePlayPause = useCallback(async () => {
		try {
			await invoke("media_play_pause");
			setIsPlaying(!isPlaying);
		} catch (e) {
			console.error("Failed to toggle play/pause:", e);
		}
	}, [isPlaying]);

	const skipNext = useCallback(async () => {
		try {
			await invoke("media_next");
		} catch (e) {
			console.error("Failed to skip next:", e);
		}
	}, []);

	const skipPrevious = useCallback(async () => {
		try {
			await invoke("media_previous");
		} catch (e) {
			console.error("Failed to skip previous:", e);
		}
	}, []);

	// Slide-push animation for prev/next buttons
	const prevFront = useAnimation();
	const prevBack = useAnimation();
	const nextFront = useAnimation();
	const nextBack = useAnimation();

	const animatePrev = useCallback(async () => {
		prevFront.set({ x: 0 });
		prevBack.set({ x: 30 });
		prevFront.start({ x: -30, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		await prevBack.start({ x: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		skipPrevious();
	}, [skipPrevious, prevFront, prevBack]);

	const animateNext = useCallback(async () => {
		nextFront.set({ x: 0 });
		nextBack.set({ x: -30 });
		nextFront.start({ x: 30, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		await nextBack.start({ x: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		skipNext();
	}, [skipNext, nextFront, nextBack]);

	const sendVolume = useTrailingThrottle((newVol: number) => {
		invoke("set_volume", { volume: newVol }).catch(() => {});
	}, 50);

	const handleVolumeChange = useCallback(
		(newVol: number) => {
			setVolume(newVol);
			// set_volume unmutes for any non-zero level.
			setIsMuted(newVol === 0);
			sendVolume(newVol);
		},
		[sendVolume]
	);

	return {
		isPlaying,
		mediaInfo,
		albumArtUrl,
		albumArtKey,
		setVolume,
		setIsMuted,
		displayVolume,
		musicActivityVisible,
		togglePlayPause,
		skipPrevious,
		prevFront,
		prevBack,
		nextFront,
		nextBack,
		animatePrev,
		animateNext,
		handleVolumeChange
	};
}
