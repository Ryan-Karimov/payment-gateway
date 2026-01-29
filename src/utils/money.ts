import DecimalJS from 'decimal.js';

type Decimal = DecimalJS.default;
const Decimal = DecimalJS.default;

// Configure Decimal.js for financial calculations
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 21,
});

export class Money {
  private readonly value: Decimal;
  readonly currency: string;

  private constructor(amount: Decimal, currency: string) {
    this.value = amount;
    this.currency = currency.toUpperCase();
  }

  static fromNumber(amount: number, currency: string): Money {
    return new Money(new Decimal(amount), currency);
  }

  static fromString(amount: string, currency: string): Money {
    return new Money(new Decimal(amount), currency);
  }

  static fromCents(cents: number, currency: string): Money {
    return new Money(new Decimal(cents).dividedBy(100), currency);
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0), currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  multiply(factor: number | string | Decimal): Money {
    return new Money(this.value.times(factor), this.currency);
  }

  divide(divisor: number | string | Decimal): Money {
    return new Money(this.value.dividedBy(divisor), this.currency);
  }

  percentage(percent: number): Money {
    return this.multiply(percent).divide(100);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThanOrEqualTo(other.value);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  isLessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThanOrEqualTo(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  toFixed(decimalPlaces: number = 2): string {
    return this.value.toFixed(decimalPlaces);
  }

  toCents(): number {
    return this.value.times(100).round().toNumber();
  }

  toString(): string {
    return `${this.toFixed(2)} ${this.currency}`;
  }

  toJSON(): { amount: string; currency: string } {
    return {
      amount: this.toFixed(4),
      currency: this.currency,
    };
  }

  /**
   * Get the raw Decimal value for database storage
   */
  toDecimalString(): string {
    return this.value.toFixed(4);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new MoneyCurrencyMismatchError(
        `Cannot perform operation between ${this.currency} and ${other.currency}`
      );
    }
  }
}

export class MoneyCurrencyMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyCurrencyMismatchError';
  }
}

/**
 * Helper function to safely parse money from database
 */
export function parseMoneyFromDb(amount: string | number, currency: string): Money {
  if (typeof amount === 'string') {
    return Money.fromString(amount, currency);
  }
  return Money.fromNumber(amount, currency);
}

/**
 * Format money for display
 */
export function formatMoney(money: Money, locale: string = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(money.toNumber());
}
