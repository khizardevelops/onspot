import { getDatabaseAdapter } from '$lib/adapters/db';

/**
 * Exports everything the learner has created as a single JSON file: sessions,
 * attempts, corrections, prompts, settings, and the stored recordings (base64).
 *
 * The TTS cache is deliberately not exported — it is regenerable and can be
 * large. Recordings are the irreplaceable part.
 */
export async function exportAllData(): Promise<void> {
	const db = await getDatabaseAdapter();
	const [sessions, attempts, corrections, prompts, settings] = await Promise.all([
		db.listSessions(),
		db.listAllAttempts(),
		db.listAllCorrections(),
		db.listPrompts(),
		db.listSettings()
	]);

	const recordings: { attemptId: string; mime: string; dataBase64: string }[] = [];
	for (const attempt of attempts) {
		const audio = await db.getAudio(`attempt:${attempt.id}`);
		if (audio) {
			recordings.push({
				attemptId: attempt.id,
				mime: audio.mime,
				dataBase64: audio.dataBase64
			});
		}
	}

	const payload = {
		app: 'onspot',
		format: 1,
		exportedAt: new Date().toISOString(),
		sessions,
		attempts,
		corrections,
		prompts,
		settings,
		recordings
	};

	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `onspot-export-${new Date().toISOString().slice(0, 10)}.json`;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
