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
/**
 * A PKCE code verifier and its corresponding S256 code challenge.
 *
 * Returned by {@link generatePKCE} as a convenience bundle.
 */
export interface PKCEPair {
    /** The cryptographically random code verifier string. */
    readonly codeVerifier: string;
    /** The Base64url-encoded SHA-256 hash of the code verifier. */
    readonly codeChallenge: string;
    /** The code challenge method — always `'S256'` per MCP auth spec. */
    readonly codeChallengeMethod: "S256";
}
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
export declare function generateCodeVerifier(length?: number): string;
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
export declare function computeCodeChallenge(verifier: string): Promise<string>;
/**
 * Generate a complete PKCE pair (code verifier + S256 code challenge).
 *
 * Convenience function that calls {@link generateCodeVerifier} and
 * {@link computeCodeChallenge}, returning both values along with the
 * challenge method identifier.
 *
 * @returns A {@link PKCEPair} containing the verifier, challenge, and method.
 */
export declare function generatePKCE(): Promise<PKCEPair>;
//# sourceMappingURL=pkce.d.ts.map