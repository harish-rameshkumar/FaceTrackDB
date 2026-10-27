// Registration rules shared by the browser form and the API route (no server-only
// imports here). The database repeats the important ones with constraints.

export const RELATIONS = ["father", "mother", "guardian"] as const;
export type Relation = (typeof RELATIONS)[number];

export interface ParentInput {
  name: string;
  phone: string;
  email: string;
  relation: string;
  password: string;
}

export interface RegistrationInput {
  name: string;
  roll_no: string;
  hostel_id: number | null;
  room_no: string;
  email: string;
  password: string;
  parents: ParentInput[]; // 1 or 2; a second parent that is completely blank is dropped before validation
  consent: boolean;
}

export type FieldErrors = Record<string, string>;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 -]{5,13}$/; // at most 15 characters in total (parents.phone is VARCHAR(15))
const SRN = /^[A-Za-z0-9-]{3,20}$/;

export const blankParent = (): ParentInput => ({ name: "", phone: "", email: "", relation: "", password: "" });
export const isBlankParent = (p: ParentInput) => !p.name.trim() && !p.phone.trim() && !p.email.trim() && !p.relation;

function checkPerson(prefix: string, p: { name: string; email: string; password: string }, e: FieldErrors, label: string) {
  if (p.name.trim().length < 2 || p.name.trim().length > 100) e[`${prefix}name`] = `${label} name must be 2 to 100 characters`;
  if (!EMAIL.test(p.email.trim()) || p.email.trim().length > 255) e[`${prefix}email`] = "Enter a valid email address";
  if (p.password.length < MIN_PASSWORD_LENGTH) e[`${prefix}password`] = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  else if (p.password.length > MAX_PASSWORD_LENGTH) e[`${prefix}password`] = `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
}

export function validateRegistration(input: RegistrationInput): FieldErrors {
  const e: FieldErrors = {};
  checkPerson("", input, e, "Student");
  if (!SRN.test(input.roll_no.trim())) e.roll_no = "SRN must be 3 to 20 letters, digits or dashes";
  if (!input.hostel_id) e.hostel_id = "Choose a hostel";
  if (input.room_no.trim().length > 10) e.room_no = "Room number must be at most 10 characters";
  if (input.parents.length < 1 || input.parents.length > 2) e.parents = "One or two parents are required";
  const seen = new Set([input.email.trim().toLowerCase()]);
  input.parents.forEach((p, i) => {
    const k = `parents.${i}.`;
    checkPerson(k, p, e, "Parent");
    if (!RELATIONS.includes(p.relation as Relation)) e[`${k}relation`] = "Choose father, mother or guardian";
    if (p.phone.trim() && !PHONE.test(p.phone.trim())) e[`${k}phone`] = "Phone must be 7 to 15 digits (optionally starting with +)";
    const em = p.email.trim().toLowerCase();
    if (em && seen.has(em)) e[`${k}email`] = "Each person needs a different email address";
    seen.add(em);
  });
  if (!input.consent) e.consent = "Consent is required to register a student";
  return e;
}

/** Strong temporary password: 14 characters from an unambiguous alphabet (no 0/O, 1/l/I). */
export function generatePassword(length = 14): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 is not a multiple of 54, so reject the biased tail
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  for (const b of bytes) if (b < limit) out += alphabet[b % alphabet.length];
  return out.length === length ? out : generatePassword(length);
}
