import StoreKit
import StoreKitTest
import XCTest
@testable import EveryOffice

@MainActor
final class TipStoreTests: XCTestCase {
    func testKoreanCatalogAndRepeatPurchases() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Tips", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        session.storefront = "KOR"
        session.disableDialogs = true
        session.clearTransactions()
        defer { session.clearTransactions() }
        let store = TipStore()
        await store.load()
        let expected: [Tip: String] = [.coffee: "₩3,900", .meal: "₩9,900", .cheer: "₩100,000"]
        for tip in Tip.allCases {
            let product = try XCTUnwrap(store.products[tip.productID])
            XCTAssertEqual(product.displayPrice, expected[tip])
            XCTAssertEqual(product.priceFormatStyle.currencyCode, "KRW")
        }
        let coffee = try XCTUnwrap(store.products[Tip.coffee.productID])
        for _ in 0..<2 {
            await store.buy(coffee) { try await $0.purchase() }
        }
        XCTAssertEqual(session.allTransactions().count, 2)
        // StoreKit can briefly return a finished transaction while its local queue updates.
        let deadline = ContinuousClock.now + .seconds(5)
        while await hasUnfinishedPurchase(of: coffee), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        let unfinished = await hasUnfinishedPurchase(of: coffee)
        XCTAssertFalse(unfinished)
    }

    private func hasUnfinishedPurchase(of product: Product) async -> Bool {
        for await result in Transaction.unfinished {
            if case .verified(let tx) = result, tx.productID == product.id { return true }
        }
        return false
    }
}
