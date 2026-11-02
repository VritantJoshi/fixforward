@isTest
private class AccountScorerTest {
    @isTest
    static void scoresLargeAccounts() {
        Account acc = new Account(Name = 'Big Co', AnnualRevenue = 5000000, NumberOfEmployees = 500);
        Test.startTest();
        AccountScorer.scoreAccounts(new List<Account>{ acc });
        Test.stopTest();
        System.assertEquals(80, acc.Priority_Score__c);
    }

    @isTest
    static void scoresSmallAccounts() {
        Account acc = new Account(Name = 'Small Co');
        AccountScorer.scoreAccounts(new List<Account>{ acc });
        System.assertEquals(0, acc.Priority_Score__c);
    }
}
