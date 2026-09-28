import { describe, expect, test } from 'bun:test';
import { ago } from '../../src/lib/format';
import { catalogueFor } from '../../src/lib/i18n';
import { duration } from '../../src/lib/step-kind';

/**
 * Times in the catalogue's words (FR-026). `Intl` has no Mongolian in either
 * runtime here, so asking it for `mn` produced "12 minutes ago" on Mongolian
 * screens; the phrases are the artboards' own.
 */

const mn = catalogueFor('mn');
const en = catalogueFor('en');
const NOW = new Date('2026-09-28T12:00:00Z');
const before = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('how long ago, in Mongolian as the design writes it', () => {
  test('every unit', () => {
    expect(ago(before(4 * MIN), NOW, mn)).toBe('4 мин өмнө');
    expect(ago(before(3 * HOUR), NOW, mn)).toBe('3 цагийн өмнө');
    expect(ago(before(DAY), NOW, mn)).toBe('өчигдөр');
    expect(ago(before(5 * DAY), NOW, mn)).toBe('5 өдрийн өмнө');
    expect(ago(before(14 * DAY), NOW, mn)).toBe('2 7 хоногийн өмнө');
    expect(ago(before(60 * DAY), NOW, mn)).toBe('2 сарын өмнө');
    expect(ago(before(400 * DAY), NOW, mn)).toBe('1 жилийн өмнө');
  });

  test('under a minute is just now; an unreadable date says so', () => {
    expect(ago(before(20_000), NOW, mn)).toBe('дөнгөж сая');
    expect(ago('not a date', NOW, mn)).toBe('хэзээ нь тодорхойгүй');
  });

  test('a time still to come reads forward, not as a negative past', () => {
    expect(ago(new Date(NOW.getTime() + 10 * MIN), NOW, mn)).toBe('10 минутын дараа');
  });

  test('nothing in it is English', () => {
    expect(ago(before(12 * MIN), NOW, mn)).not.toMatch(/[a-z]/i);
  });
});

describe('English keeps the phrasing it always had', () => {
  test('from Intl, which does speak English', () => {
    expect(ago(before(12 * MIN), NOW, en)).toBe('12 minutes ago');
    expect(ago(before(DAY), NOW, en)).toBe('yesterday');
  });
});

describe('a length of time', () => {
  test('in Mongolian units', () => {
    expect(duration(130, mn)).toBe('2м 10с');
    expect(duration(45, mn)).toBe('45с');
    expect(duration(739, mn)).toBe('12м 19с');
  });

  test('in English units', () => {
    expect(duration(130, en)).toBe('2m 10s');
    expect(duration(14, en)).toBe('14s');
  });

  test('never negative, and rounded to the second', () => {
    expect(duration(-3, mn)).toBe('0с');
    expect(duration(59.6, mn)).toBe('1м 00с');
  });
});
