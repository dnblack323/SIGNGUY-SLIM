const QUANTITY_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/;

export function assertCents(value, field = "cents") {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field}_invalid`);
  return value;
}

export function quantityUnits(quantity) {
  if (typeof quantity !== "string" || !QUANTITY_RE.test(quantity)) {
    throw new Error("quantity_decimal_invalid");
  }
  const [whole, fraction = ""] = quantity.split(".");
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
}

export function lineTotalCents(quantityDecimal, unitPriceCents) {
  assertCents(unitPriceCents, "unit_price_cents");
  const raw = BigInt(unitPriceCents) * quantityUnits(quantityDecimal);
  return Number((raw + 5000n) / 10000n);
}

export function documentTotals(items, discountCents, taxRateBasisPoints, customerTaxExempt) {
  assertCents(discountCents, "discount_cents");
  if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
    throw new Error("sales_tax_rate_basis_points_invalid");
  }
  const subtotalCents = items.reduce((sum, item) => sum + assertCents(item.line_total_cents, "line_total_cents"), 0);
  if (discountCents > subtotalCents) throw new Error("discount_exceeds_subtotal");
  const taxableSubtotal = customerTaxExempt
    ? 0
    : Math.max(
        0,
        items.filter((item) => item.taxable).reduce((sum, item) => sum + item.line_total_cents, 0) - discountCents,
      );
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
  if (amountPaidCents <= 0) return "unpaid";
  if (amountPaidCents >= totalCents) return "paid";
  return "partial";
}

export function formatCents(cents, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
