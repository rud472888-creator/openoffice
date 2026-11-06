import SwiftUI

@main
struct EveryOfficeApp: App {
    @State private var tips = TipStore()
    @State private var library = DocumentLibrary()

    private var testAppearance: ColorScheme? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--uitesting-library") {
            if arguments.contains("--uitesting-dark-appearance") { return .dark }
            if arguments.contains("--uitesting-light-appearance") { return .light }
        }
        #endif
        return nil
    }

    var body: some Scene {
        WindowGroup {
            LibraryView(library: library)
                .environment(tips)
                .onAppear { tips.startListening() }
                .tint(OfficeTheme.accent)
                .preferredColorScheme(testAppearance)
                .onOpenURL { url in
                    do { library.selectedID = try library.importDocument(from: url).id }
                    catch { library.present(error) }
                }
        }
    }
}
