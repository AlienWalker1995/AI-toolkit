/**
 * PKCE (Proof Key for Code Exchange) implementation per OAuth 2.1 / RFC 7636.
 *
 * The MCP auth spec mandates S256 as the only supported code challenge method.
 * This module generates cryptographically secure code verifiers and computes
 * S256 code challenges using only the Node.js built-in `crypto` module.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 * @see https://modelcontextprotocol.io/specification/draft/basic/authorization
 */
import { createHash, randomBytes } from "node:crypto";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Minimum allowed code verifier length per RFC 7636 section 4.1. */
const VERIFIER_MIN_LENGTH = 43;
/** Maximum allowed code verifier length per RFC 7636 section 4.1. */
const VERIFIER_MAX_LENGTH = 128;
/** Default code verifier length. */
const VERIFIER_DEFAULT_LENGTH = 64;
/**
 * Unreserved URI characters allowed in the code verifier per RFC 7636 section 4.1:
 * `[A-Z] [a-z] [0-9] - . _ ~`
 */
const UNRESERVED_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Generate a cryptographically random code verifier string.
 *
 * The verifier consists of characters from the unreserved URI character set
 * (`[A-Z] [a-z] [0-9] - . _ ~`) as defined in RFC 7636 section 4.1.
 * Random bytes from `crypto.randomBytes()` are mapped to this character set
 * using modular indexing.
 *
 * @param length - Desired verifier length in characters. Must be between 43
 *   and 128 inclusive (RFC 7636 section 4.1). Defaults to 64.
 * @returns A random code verifier string of the specified length.
 * @throws {RangeError} If `length` is outside the 43-128 range.
 */
export function generateCodeVerifier(length = VERIFIER_DEFAULT_LENGTH) {
    if (!Number.isInteger(length) ||
        length < VERIFIER_MIN_LENGTH ||
        length > VERIFIER_MAX_LENGTH) {
        throw new RangeError(`Code verifier length must be an integer between ${VERIFIER_MIN_LENGTH} and ${VERIFIER_MAX_LENGTH}, got ${String(length)}`);
    }
    const bytes = randomBytes(length);
    const chars = new Array(length);
    for (let i = 0; i < length; i++) {
        // Map each random byte to one of the 66 unreserved characters.
        // Using modulo introduces a negligible bias (256 % 66 = 58) which is
        // acceptable for PKCE verifiers that only need sufficient entropy.
        chars[i] = UNRESERVED_CHARACTERS[bytes[i] % UNRESERVED_CHARACTERS.length];
    }
    return chars.join("");
}
/**
 * Compute an S256 code challenge from a code verifier.
 *
 * Implements the transformation: `BASE64URL(SHA256(code_verifier))` as
 * defined in RFC 7636 section 4.2. Base64url encoding replaces `+` with `-`,
 * `/` with `_`, and strips trailing `=` padding.
 *
 * This function is pure: the same verifier always produces the same challenge.
 *
 * @param verifier - The code verifier string to hash.
 * @returns The Base64url-encoded SHA-256 code challenge.
 */
export async function computeCodeChallenge(verifier) {
    const hash = createHash("sha256").update(verifier, "ascii").digest("base64");
    // Convert standard base64 to base64url: replace + with -, / with _, strip =
    return hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
 * Generate a complete PKCE pair (code verifier + S256 code challenge).
 *
 * Convenience function that calls {@link generateCodeVerifier} and
 * {@link computeCodeChallenge}, returning both values along with the
 * challenge method identifier.
 *
 * @returns A {@link PKCEPair} containing the verifier, challenge, and method.
 */
export async function generatePKCE() {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await computeCodeChallenge(codeVerifier);
    return {
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: "S256",
    };
}
//# sourceMappingURL=pkce.js.map