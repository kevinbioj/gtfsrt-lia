import dayjs from "dayjs";

export function parseDelay(delay: string) {
  const ahead = delay.startsWith("-");
  return dayjs.duration(delay).asSeconds() * (ahead ? -1 : 1);
}
