import SwiftUI
import UIKit

// Native equivalents of packages/ui/src/tokens.css and the shell accent.
enum OfficeTheme {
    static let surface = adaptive(light: 0xffffff, dark: 0x1e1e1e)
    static let subtle = adaptive(light: 0xf6f7f9, dark: 0x2a2a2a)
    static let border = adaptive(light: 0xe3e6ea, dark: 0x3a3a3a)
    static let ink = adaptive(light: 0x232425, dark: 0xe4e4e4)
    static let secondary = adaptive(light: 0x606366, dark: 0xa0a0a0)
    static let accent = adaptive(light: 0x0f7fff, dark: 0x3f99ff)
    static let accentSoft = adaptive(light: 0xeaf0fd, dark: 0x24354d)
    static let documentBlue = adaptive(light: 0x2867c4, dark: 0x79aaff)
    static let sheetGreen = adaptive(light: 0x107c41, dark: 0x70c99a)
    static let slideOrange = adaptive(light: 0xc4512b, dark: 0xffa17e)
    static let pdfRed = adaptive(light: 0xc43737, dark: 0xff9292)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                           green: CGFloat((value >> 8) & 255) / 255,
                           blue: CGFloat(value & 255) / 255, alpha: 1)
        })
    }
}
