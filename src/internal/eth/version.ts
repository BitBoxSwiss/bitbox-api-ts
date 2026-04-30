// SPDX-License-Identifier: Apache-2.0

import { atLeast, parseSemver, type Info } from '../hww.js';
import { versionError } from '../errors.js';

export const STREAMING_THRESHOLD = 6144;

export interface SemverTriple {
  major: number;
  minor: number;
  patch: number;
}

export function requireVersion(info: Info, target: SemverTriple): void {
  if (!atLeast(parseSemver(info.version), target)) {
    throw versionError(`>=${target.major}.${target.minor}.${target.patch}`);
  }
}
