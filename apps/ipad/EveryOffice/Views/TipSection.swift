import StoreKit
import SwiftUI

enum Tip: String, CaseIterable {
    case coffee, meal, cheer

    var productID: String { "app.everyoffice.ipad.tip." + rawValue }
    var title: LocalizedStringKey {
        switch self {
        case .coffee: "Buy a coffee"
        case .meal: "Buy a meal"
        case .cheer: "Cheer on the developer"
        }
    }
    var symbol: String {
        switch self {
        case .coffee: "cup.and.saucer"
        case .meal: "fork.knife"
        case .cheer: "heart"
        }
    }
}

@Observable @MainActor
final class TipStore {
    private(set) var products: [String: Product] = [:]
    private(set) var purchasing: String?
    private(set) var message: LocalizedStringKey?
    private var listener: Task<Void, Never>?

    func startListening() {
        guard listener == nil else { return }
        listener = Task {
            for await update in StoreKit.Transaction.updates { await finish(update) }
        }
        Task {
            for await transaction in StoreKit.Transaction.unfinished { await finish(transaction) }
        }
    }

    func load() async {
        do {
            let catalog = try await Product.products(for: Tip.allCases.map(\.productID))
            products = Dictionary(uniqueKeysWithValues: catalog.filter { $0.type == .consumable }.map { ($0.id, $0) })
        } catch { products = [:] }
    }

    func buy(_ product: Product, using purchase: (Product) async throws -> Product.PurchaseResult) async {
        guard purchasing == nil, AppStore.canMakePayments, products[product.id] != nil else { return }
        purchasing = product.id
        message = nil
        defer { purchasing = nil }
        do {
            switch try await purchase(product) {
            case .success(let result): await finish(result)
            case .pending: message = "Awaiting purchase approval."
            case .userCancelled: break
            @unknown default: message = "Purchase could not be completed."
            }
        } catch StoreKitError.userCancelled {
            return
        } catch { message = "Purchase could not be completed." }
    }

    private func finish(_ result: VerificationResult<StoreKit.Transaction>) async {
        guard case .verified(let transaction) = result else {
            message = "Purchase could not be completed."
            return
        }
        guard Tip.allCases.contains(where: { $0.productID == transaction.productID }),
              transaction.productType == .consumable else { return }
        if transaction.revocationDate == nil { message = "Thank you for your support!" }
        await transaction.finish()
    }
}

struct TipSection: View {
    @Environment(TipStore.self) private var store
    @Environment(\.purchase) private var purchase
    @State private var loading = true

    var body: some View {
        Section {
            ForEach(Tip.allCases, id: \.self) { tip in
                let product = store.products[tip.productID]
                Button {
                    if let product { Task { await store.buy(product) { try await purchase($0) } } }
                } label: {
                    HStack {
                        Label(tip.title, systemImage: tip.symbol)
                        Spacer()
                        if store.purchasing == tip.productID { ProgressView() }
                        else if let product { Text(verbatim: product.displayPrice).monospacedDigit() }
                    }
                }
                .disabled(product == nil || store.purchasing != nil || !AppStore.canMakePayments)
            }
            if !AppStore.canMakePayments { Text("Purchases are restricted on this device.") }
            else if loading { ProgressView() }
            else if store.products.count != Tip.allCases.count {
                Button("Reload unavailable prices") { Task { await reload() } }
            }
            if let message = store.message { Text(message) }
        } header: {
            Text("Support the developer")
        } footer: {
            Text("Each tip is a one-time purchase.")
        }
        .task { await reload() }
    }

    private func reload() async {
        loading = true
        await store.load()
        loading = false
    }
}
