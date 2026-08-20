const QUANTITY_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/;
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export function assertCents(value, field = "cents") {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_CENTS) throw new Error(`${field}_invalid`);
  return value;
}

export function quantityUnits(quantity) {
  if (typeof quantity !== "string" || !QUANTITY_RE.test(quantity)) {
    throw new Error("quantity_decimal_invalid");
  }
  const [whole, fraction = ""] = quantity.split(".");
  const units = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
  if (units <= 0n) throw new Error("quantity_decimal_must_be_positive");
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("quantity_decimal_too_large");
  return units;
}

export function lineTotalCents(quantityDecimal, unitPriceCents) {
  assertCents(unitPriceCents, "unit_price_cents");
  const raw = BigInt(unitPriceCents) * quantityUnits(quantityDecimal);
  return assertCents(Number((raw + 5000n) / 10000n), "line_total_cents");
}

export function documentTotals(items, discountCents, taxRateBasisPoints, customerTaxExempt) {
  assertCents(discountCents, "discount_cents");
  if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
    throw new Error("sales_tax_rate_basis_points_invalid");
  }
  const subtotalCents = items.reduce((sum, item) => sum + assertCents(item.line_total_cents, "line_total_cents"), 0);
  assertCents(subtotalCents, "subtotal_cents");
  if (discountCents > subtotalCents) throw new Error("discount_exceeds_subtotal");
  const taxableSubtotalBeforeDiscount = items
    .filter((item) => item.taxable)
    .reduce((sum, item) => sum + item.line_total_cents, 0);
  const taxableDiscountCents = subtotalCents === 0
    ? 0
    : Number((BigInt(discountCents) * BigInt(taxableSubtotalBeforeDiscount) + BigInt(Math.floor(subtotalCents / 2))) / BigInt(subtotalCents));
  const taxableSubtotal = customerTaxExempt
    ? 0
    : Math.max(0, taxableSubtotalBeforeDiscount - taxableDiscountCents);
  const taxCents = Number((BigInt(taxableSubtotal) * BigInt(taxRateBasisPoints) + 5000n) / 10000n);
  return {
    subtotal_cents: subtotalCents,
    discount_cents: discountCents,
    tax_cents: taxCents,
    total_cents: subtotalCents - discountCents + taxCents,
  };
}

export function paymentStatus(totalCents, amountPaidCents) {
  assertCents(totalCents, "total_cents");
  assertCents(amountPaidCents, "amount_paid_cents");
  if (amountPaidCents > totalCents) throw new Error("amount_paid_exceeds_total");
  if (amountPaidCents <= 0) return "unpaid";
  if (amountPaidCents >= totalCents) return "paid";
  return "partial";
}

export function formatCents(cents, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
