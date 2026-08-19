/**
 * CLIProxyAPI can end a stream before the first payload; pi-ai surfaces it
 * as "Codex error: empty_stream: upstream stream closed before first
 * payload", which matches none of pi's retryable-error patterns and kills
 * the turn. Rewriting the message with a "network error:" prefix makes
 * pi's normal retry budget/backoff apply. Same mechanism the provider
 * package uses for its own transient patterns; message_end transforms
 * chain, so both normalizers compose.
 */

/** Structural subset of pi-ai's AssistantMessage used by the normalizer. */
export interface ErroredMessage {
	role: string;
	stopReason?: string;
	errorMessage?: string;
}

const CPA_TRANSIENT_ERROR_PATTERN =
	/\bempty_stream\b|\bupstream stream closed before first payload\b/i;
const NETWORK_ERROR_PREFIX = "network error:";

/** Return a retryable copy of a CPA transient stream error, or the
 * message unchanged when it is not one (reference equality = no-op). */
export function normalizeCpaTransientError<T extends ErroredMessage>(
	message: T,
): T {
	if (
		message.role !== "assistant" ||
		message.stopReason !== "error" ||
		!message.errorMessage ||
		message.errorMessage.startsWith(NETWORK_ERROR_PREFIX) ||
		!CPA_TRANSIENT_ERROR_PATTERN.test(message.errorMessage)
	) {
		return message;
	}
	return {
		...message,
		errorMessage: `${NETWORK_ERROR_PREFIX} ${message.errorMessage}`,
	};
}
