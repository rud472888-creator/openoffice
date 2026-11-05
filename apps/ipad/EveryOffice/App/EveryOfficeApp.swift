import SwiftUI

@main
struct EveryOfficeApp: App {
    @State private var library = DocumentLibrary()

    var body: some Scene {
        WindowGroup {
            LibraryView(library: library)
                .tint(OfficeTheme.accent)
                .onOpenURL { url in
                    do { library.selectedID = try library.importDocument(from: url).id }
                    catch { library.present(error) }
                }
        }
    }
}
