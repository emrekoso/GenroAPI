// No imports on purpose: bin.ts runs this before loading anything that needs a modern Node.
const MIN_MAJOR = 22;
const MIN_MINOR = 19;

/** Error text when `version` (e.g. process.versions.node) is older than the supported floor, else null. */
export function nodeCheckMessage(version: string): string | null {
  const [major, minor] = version.split('.').map(Number);
  const ok = Number.isFinite(major) && Number.isFinite(minor) && (major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR));
  return ok ? null : `GenroAPI needs Node >=${MIN_MAJOR}.${MIN_MINOR} (found ${version}). Use nvm/fnm to switch.`;
}
