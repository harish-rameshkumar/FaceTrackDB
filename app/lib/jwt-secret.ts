// Checks JWT_SECRET. No "server-only" import, so the tests can load it. The signing key is
// refused (the app then fails closed: nobody can log in and no token is accepted) when it is
// missing, shorter than 32 characters, or looks like a placeholder copied from an example file.
//
// Returns a short reason (never the secret itself), or null when the secret is acceptable.
export const MIN_SECRET_LENGTH = 32;

const PLACEHOLDER_WORDS = ["replace", "change_me", "change-me", "changeme", "example", "placeholder", "your_secret", "your-secret"];

export function checkJwtSecret(secret: string | undefined | null): string | null {
  if (!secret) return "JWT_SECRET is not set";
  if (secret.length < MIN_SECRET_LENGTH) return `JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`;
  const lower = secret.toLowerCase();
  const word = PLACEHOLDER_WORDS.find((w) => lower.includes(w));
  if (word) return "JWT_SECRET looks like a placeholder from an example file";
  // "secret" followed by only a few more characters (mysecret, secret123, secretkey...)
  if (/secret.{0,6}$/i.test(secret)) return "JWT_SECRET looks like a guessable word";
  if (/^([\s\S])\1*$/.test(secret)) return "JWT_SECRET is one repeated character";
  if (new Set(secret).size < 8) return "JWT_SECRET uses too few different characters";
  return null;
}
