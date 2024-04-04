export function parseDelay(delay: string) {
  const actualDelay = delay.replace(/-?PT/, "").replace(/S$/, "");
  const [left, right] = actualDelay.split("M").map(Number);
  const seconds = typeof right !== "undefined" ? left * 60 + right : left;
  return actualDelay.startsWith("-") ? -seconds : seconds;
}
