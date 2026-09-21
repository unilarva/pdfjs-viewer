// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public pure PDF date presentation helper.
 * Consumers import this function from the package root, never this emitted
 * sibling path. The metadata API intentionally retains raw PDF strings; this
 * helper projects them without converting through the host device timezone.
 * See the [architecture guide](../ARCHITECTURE.md).
 * @packageDocumentation
 * @module pdf-date
 */

const PDF_DATE =
  /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})(?:'?(\d{2})'?)?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Formats a PDF date while preserving the wall time and timezone encoded by the PDF.
 * Invalid or unsupported values are returned unchanged.
 */
export function formatPdfDate(value: string): string {
  const match = PDF_DATE.exec(value);
  if (!match) return value;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    utc,
    sign,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = monthText === undefined ? null : Number(monthText);
  const day = dayText === undefined ? null : Number(dayText);
  const hour = hourText === undefined ? null : Number(hourText);
  const minute = minuteText === undefined ? null : Number(minuteText);
  const second = secondText === undefined ? null : Number(secondText);
  const offsetHour = offsetHourText === undefined ? null : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (
    (month !== null && (month < 1 || month > 12)) ||
    (day !== null && (month === null || day < 1 || day > daysInMonth(year, month))) ||
    (hour !== null && hour > 23) ||
    (minute !== null && minute > 59) ||
    (second !== null && second > 59) ||
    (offsetHour !== null && offsetHour > 23) ||
    offsetMinute > 59
  )
    return value;

  let formatted = yearText;
  if (monthText !== undefined) formatted += `-${monthText}`;
  if (dayText !== undefined) formatted += `-${dayText}`;
  if (hourText !== undefined) formatted += ` ${hourText}`;
  if (minuteText !== undefined) formatted += `:${minuteText}`;
  if (secondText !== undefined) formatted += `:${secondText}`;
  if (utc) formatted += " +00:00";
  else if (sign && offsetHourText !== undefined)
    formatted += ` ${sign}${offsetHourText}:${String(offsetMinute).padStart(2, "0")}`;
  return formatted;
}
