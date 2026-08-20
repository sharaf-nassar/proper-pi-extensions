const OMITTED_IMAGE_TEXT = "[image omitted after its original user turn]";

type ContextMessage = {
	role: string;
	content?: unknown;
};

function isImagePart(value: unknown): value is { type: "image" } {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "image"
	);
}

/** Replace image bytes from earlier user turns without mutating session messages. */
export function omitPriorTurnImages<T extends ContextMessage>(
	messages: T[],
): T[] {
	let latestUser = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") {
			latestUser = index;
			break;
		}
	}
	if (latestUser <= 0) return messages;

	let changed = false;
	const next = messages.map((message, index) => {
		if (index >= latestUser || !Array.isArray(message.content)) return message;

		let replaced = false;
		const content = message.content.map((part) => {
			if (!isImagePart(part)) return part;
			replaced = true;
			changed = true;
			return { type: "text", text: OMITTED_IMAGE_TEXT };
		});
		return replaced ? ({ ...message, content } as T) : message;
	});

	return changed ? next : messages;
}
