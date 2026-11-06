import SwiftUI
import UIKit

// The native workspace shares its paper, ink and cobalt palette with the iPad editor hosts.
enum OfficeTheme {
    static let surface = adaptive(light: 0xffffff, dark: 0x202326)
    static let subtle = adaptive(light: 0xfafaf8, dark: 0x151719)
    static let sidebar = adaptive(light: 0xf1f2ef, dark: 0x1b1e21)
    static let well = adaptive(light: 0xf0f2f5, dark: 0x292e34)
    static let previewPaper = adaptive(light: 0xffffff, dark: 0xe8ebef)
    static let previewInk = adaptive(light: 0x20242a, dark: 0x20242a)
    static let border = adaptive(light: 0xe4e6e8, dark: 0x343a42)
    static let ink = adaptive(light: 0x20242a, dark: 0xeff1f4)
    static let secondary = adaptive(light: 0x68717d, dark: 0xa7b0bd)
    static let accent = adaptive(light: 0x315be8, dark: 0x89a5ff)
    static let accentSoft = adaptive(light: 0xe9eeff, dark: 0x273453)
    static let documentBlue = adaptive(light: 0x315be8, dark: 0x89a5ff)
    static let sheetGreen = adaptive(light: 0x28745e, dark: 0x82c6ac)
    static let slideOrange = adaptive(light: 0xad5833, dark: 0xe9a380)
    static let pdfRed = adaptive(light: 0xba494b, dark: 0xf19a9c)

    static func color(for kind: DocumentKind) -> Color {
        switch kind {
        case .spreadsheet: sheetGreen
        case .presentation: slideOrange
        case .pdf: pdfRed
        default: documentBlue
        }
    }

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                           green: CGFloat((value >> 8) & 255) / 255,
                           blue: CGFloat(value & 255) / 255, alpha: 1)
        })
    }
}

struct OfficePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
    }
}
