public with sharing class DiscountCalculator {
    public static Decimal calculate(Decimal amount, String tier, Integer quantity) {
        if (amount == null || amount <= 0) {
            return 0;
        }
        Decimal rate = 0;
        if (tier == 'Gold') {
            rate = 0.20;
        } else if (tier == 'Silver') {
            rate = 0.10;
        } else if (tier == 'Bronze') {
            rate = 0.05;
        }
        if (quantity != null && quantity >= 100) {
            rate += 0.05;
        } else if (quantity != null && quantity >= 50) {
            rate += 0.02;
        }
        Decimal discount = amount * rate;
        Decimal maxDiscount = amount * 0.25;
        if (discount > maxDiscount) {
            discount = maxDiscount;
        }
        return discount.setScale(2);
    }

    public static Decimal finalPrice(Decimal amount, String tier, Integer quantity) {
        if (amount == null) {
            return 0;
        }
        return (amount - calculate(amount, tier, quantity)).setScale(2);
    }
}
