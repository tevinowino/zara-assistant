// Test replacement for @tauri-apps/api/core (see vitest.config.ts).
//
// A test registers what a command returns with setInvokeHandler and later
// asserts on invokeCalls. An unregistered command rejects, which mirrors the
// real backend refusing an unknown command and surfaces typos in tests.

type InvokeHandler = (args: Record<string, unknown> | undefined) => unknown | Promise<unknown>;

const handlers = new Map<string, InvokeHandler>();

export const invokeCalls: { command: string; args: Record<string, unknown> | undefined }[] = [];

export function setInvokeHandler(command: string, handler: InvokeHandler): void {
	handlers.set(command, handler);
}

export function resetInvokeHandlers(): void {
	handlers.clear();
	invokeCalls.length = 0;
}

export async function invoke<T = unknown>(
	command: string,
	args?: Record<string, unknown>
): Promise<T> {
	invokeCalls.push({ command, args });
	const handler = handlers.get(command);
	if (!handler) {
		throw new Error(`No test handler registered for command "${command}"`);
	}
	return (await handler(args)) as T;
}
