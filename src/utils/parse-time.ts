import dayjs, { Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import duration from 'dayjs/plugin/duration';
import isBetween from 'dayjs/plugin/isBetween';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(customParseFormat);
dayjs.extend(duration);
dayjs.extend(isBetween);
dayjs.extend(isSameOrAfter);
dayjs.extend(timezone);
dayjs.extend(utc);

const isBeforeNextDay = (date: Dayjs) =>
  date.hour() < 4 || (date.hour() === 4 && date.minute() < 30);

export function parseTime(time: string) {
  const now = dayjs();
  const computed = dayjs.tz(time, 'HH:mm:ss', 'Europe/Paris');
  if (isBeforeNextDay(now)) return computed.subtract(1, 'day');
  return computed;
}
