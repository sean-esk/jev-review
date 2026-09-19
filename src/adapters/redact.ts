// Strip credential-shaped values from text before it becomes Jev state.

const PEM =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const JWT = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const VENDOR_KEY = /\b(?:sk-|sk_live_|sk_test_|rk_live_|rk_test_)[A-Za-z0-9_-]{8,}\b/g;
const ENV_SECRET =
  /^([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)[A-Z0-9_]*)\s*=\s*.+$/gm;
const ASSIGNED_SECRET =
  /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|authorization|bearer)\b\s*[:=]\s*)(['"]?)([^\s'"]+)\2/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(PEM, "[REDACTED PRIVATE KEY]")
    .replace(JWT, "[REDACTED JWT]")
    .replace(VENDOR_KEY, "[REDACTED KEY]")
    .replace(ENV_SECRET, "$1=[REDACTED]")
    .replace(ASSIGNED_SECRET, "$1$2[REDACTED]$2");
}