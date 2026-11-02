public with sharing class AccountScorer {
    public static void scoreAccounts(List<Account> accounts) {
        for (Account acc : accounts) {
            Decimal score = 0;
            if (acc.AnnualRevenue != null && acc.AnnualRevenue > 1000000) {
                score += 50;
            }
            if (acc.NumberOfEmployees != null && acc.NumberOfEmployees > 100) {
                score += 30;
            }
            acc.Priority_Score__c = score;
        }
    }
}
