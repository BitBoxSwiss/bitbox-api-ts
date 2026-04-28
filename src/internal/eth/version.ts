// SPDX-License-Identifier: Apache-2.0

import { atLeast, parseSemver, type Info } from '../hww.js';

export const STREAMING_THRESHOLD = 6144;

export interface SemverTriple {
  major: number;
  minor: number;
  patch: number;
}

class VersionError extends Error {
  readonly code = 'version';
  constructor(message: string) {
    super(message);
  }
}

export function requireVersion(info: Info, target: SemverTriple): void {
  if (!atLeast(parseSemver(info.version), target)) {
    throw new VersionError(
      `firmware version >=${target.major}.${target.minor}.${target.patch} required`,
    );
  }
}
