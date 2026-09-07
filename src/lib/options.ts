/**
 * Helpers for narrowing free-form CLI option strings onto the SDK's string-literal
 * unions.
 *
 * Commander hands every option through as `string`, but most SDK request fields are
 * closed unions. Casting would silently forward a typo to the API and surface as an
 * opaque 4xx; these helpers narrow only after checking, so a bad flag fails locally
 * with a message that names the accepted values.
 */

/**
 * Narrow `value` to one of `allowed`, or throw naming the flag and the valid set.
 */
export function oneOf<const T extends readonly string[]>(
  flag: string,
  value: string,
  allowed: T,
): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${flag} "${value}". Expected one of: ${allowed.join(", ")}.`);
  }
  return value as T[number];
}

/**
 * Same as {@link oneOf}, but passes `undefined` through for optional flags.
 */
export function optionalOneOf<const T extends readonly string[]>(
  flag: string,
  value: string | undefined,
  allowed: T,
): T[number] | undefined {
  if (value === undefined) return undefined;
  return oneOf(flag, value, allowed);
}
