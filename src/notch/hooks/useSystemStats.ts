import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** How often the readings are refreshed while they are being shown, in milliseconds. */
const REFRESH_INTERVAL_MS = 3000;

/** The backend's `SystemMetrics`; a figure the system could not give this time is null. */
interface SystemMetrics {
	cpu_percent: number | null;
	ram_percent: number | null;
	disk_free_gigabytes: number | null;
	network_upload_bytes_per_second: number | null;
	network_download_bytes_per_second: number | null;
}

/**
 * CPU, memory, disk and network readings for the status widgets. They are read
 * together in one request every three seconds while `active`; while the notch
 * is hidden nobody can see them, so nothing is asked of the system. The last
 * readings stay until new ones arrive, and a figure the system could not give
 * keeps its previous value.
 */
export function useSystemStats(active = true) {
	const [cpuUsage, setCpuUsage] = useState(0);
	const [ramUsage, setRamUsage] = useState(0);
	const [diskSpace, setDiskSpace] = useState(0);
	const [netUpSpeed, setNetUpSpeed] = useState(0);
	const [netDownSpeed, setNetDownSpeed] = useState(0);

	useEffect(() => {
		if (!active) return;
		let stopped = false;
		const refresh = () => {
			invoke<SystemMetrics>("get_system_metrics")
				.then((metrics) => {
					if (stopped) return;
					if (metrics.cpu_percent !== null) setCpuUsage(metrics.cpu_percent);
					if (metrics.ram_percent !== null) setRamUsage(metrics.ram_percent);
					if (metrics.disk_free_gigabytes !== null) setDiskSpace(metrics.disk_free_gigabytes);
					if (metrics.network_upload_bytes_per_second !== null) {
						setNetUpSpeed(metrics.network_upload_bytes_per_second);
					}
					if (metrics.network_download_bytes_per_second !== null) {
						setNetDownSpeed(metrics.network_download_bytes_per_second);
					}
				})
				.catch((e) => console.warn("System metrics:", e));
		};
		refresh();
		const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
		return () => {
			stopped = true;
			clearInterval(interval);
		};
	}, [active]);

	return {
		cpuUsage,
		ramUsage,
		diskSpace,
		netUpSpeed,
		netDownSpeed
	};
}
