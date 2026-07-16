// A cassette is one captured assistant turn — the HTTP status + the chunk objects the wire carried —
// so the runner's reduction (drive.ts `interpret`) is testable, and the live catalog runnable, with no
// model. `recordCassette` captures a real turn; `replay` reduces a stored one.

import { readFileSync } from 'node:fs';
import type { RunOutput } from '../run-output';
import { chatRequestBody, interpret, parseSse, type DriveOptions } from './drive';

export interface Cassette {
  status: number;
  /** The UIMessageChunk objects, in wire order (already JSON-parsed for readability in the fixture). */
  chunks: unknown[];
  note?: string;
}

/** Reduce a stored cassette exactly as the live runner would reduce the wire. */
export function replay(cassette: Cassette): RunOutput {
  return interpret(cassette.chunks, cassette.status);
}

/** Load a cassette JSON fixture from disk. */
export function loadCassette(url: URL): Cassette {
  return JSON.parse(readFileSync(url, 'utf8')) as Cassette;
}

/** Capture a live turn into a cassette (for authoring fixtures against a real target). Live-only. */
export async function recordCassette(prompt: string, opts: DriveOptions): Promise<Cassette> {
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      ...opts.headers,
    },
    body: chatRequestBody(prompt),
    signal: opts.signal,
  });
  return { status: res.status, chunks: parseSse(await res.text()) };
}
