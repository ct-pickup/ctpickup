const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferralCodeInApp(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)]!;
  }
  return out;
}
