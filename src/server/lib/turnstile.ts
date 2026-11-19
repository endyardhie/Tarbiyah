const URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type VerifyTurnstile = (token: string, ip: string) => Promise<boolean>;

export function createTurnstileVerifier(secret: string): VerifyTurnstile {
  return async (token, ip) => {
    try {
      const res = await fetch(URL, {
        method: "POST",
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json()) as { success?: boolean };
      return body.success === true;
    } catch {
      return false;
    }
  };
}
