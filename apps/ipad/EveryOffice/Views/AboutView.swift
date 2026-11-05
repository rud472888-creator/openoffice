import SwiftUI

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(verbatim: "every office").font(.title.weight(.bold))
                    Text("An iPad workspace based on GenOffice.")
                    Text("Documents are stored locally. Import makes a copy. Export shares a copy.")
                    Text("No AI service, account, or analytics is connected in this iPad app.")
                }
                Section("Document support") {
                    Text("Edit UTF-8 text and Markdown. Highlight PDFs. Edit supported text in DOCX, XLSX, and PPTX documents.")
                    Text("Complex formatting and advanced office features may require the desktop app. Other formats use system previews when available.")
                }
                Section("Open source notices") {
                    NavigationLink("License") { NoticeView(name: "LICENSE") }
                    NavigationLink("Notices") { NoticeView(name: "NOTICE") }
                }
            }
            .navigationTitle("About")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

private struct NoticeView: View {
    let name: String
    var body: some View {
        ScrollView {
            Text(verbatim: notice).font(.system(.caption, design: .monospaced))
                .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding()
        }
        .navigationTitle(name)
    }
    private var notice: String {
        guard let url = Bundle.main.url(forResource: name, withExtension: nil),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return name }
        return text
    }
}
