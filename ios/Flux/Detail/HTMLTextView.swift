import SwiftUI
import UIKit

/// Renders sanitized HTML as a selectable, non-editable UITextView sized to its content.
/// Conversion (WebKit-backed, main-thread) is memoized in the coordinator.
/// `highlights` get a background fill; tapping one calls `onTapHighlight`.
struct HTMLTextView: UIViewRepresentable {
    let html: String
    /// Substrings to mark as highlights (matched first-occurrence) + their highlight id.
    var highlights: [(id: String, text: String)] = []
    var onTapHighlight: ((String) -> Void)? = nil
    /// Called with the user's selected substring when they tap the "Highlight" menu item.
    var onCreateHighlight: ((String) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.isEditable = false
        tv.isSelectable = true
        tv.isScrollEnabled = false
        tv.backgroundColor = .clear
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        // Let SwiftUI dictate the width: don't resist horizontal compression, and have the
        // text container wrap to the view's width so the HTML body lays out within the screen
        // and grows only in height. Without this a non-scrolling UITextView overflows sideways.
        tv.textContainer.widthTracksTextView = true
        tv.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tv.setContentHuggingPriority(.required, for: .vertical)
        tv.delegate = context.coordinator
        context.coordinator.textView = tv

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        tap.cancelsTouchesInView = false
        tv.addGestureRecognizer(tap)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        context.coordinator.parent = self
        let attributed = context.coordinator.attributedString(for: html)
        let mutable = NSMutableAttributedString(attributedString: attributed)
        context.coordinator.applyHighlights(into: mutable)
        tv.attributedText = mutable
    }

    /// A non-scrolling UITextView doesn't report a content-driven height to SwiftUI on its own,
    /// so without this it lays out at zero/wrong height and overlaps sibling views. Compute the
    /// fitting height for the width SwiftUI proposes.
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? uiView.bounds.width
        guard width > 0 else { return nil }
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(fitted.height))
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: HTMLTextView
        weak var textView: UITextView?
        private var cachedHTML: String?
        private var cached: NSAttributedString?

        init(_ parent: HTMLTextView) { self.parent = parent }

        /// Convert + style once per unique html string.
        func attributedString(for html: String) -> NSAttributedString {
            if cachedHTML == html, let cached { return cached }
            let data = Data(html.utf8)
            let base: NSAttributedString
            if let parsed = try? NSAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue
                ],
                documentAttributes: nil
            ) {
                base = parsed
            } else {
                base = NSAttributedString(string: html)
            }
            let styled = NSMutableAttributedString(attributedString: base)
            let full = NSRange(location: 0, length: styled.length)
            let body = UIFont.preferredFont(forTextStyle: .body)
            let serif = UIFont(descriptor: body.fontDescriptor.withDesign(.serif) ?? body.fontDescriptor, size: body.pointSize)
            let para = NSMutableParagraphStyle()
            para.lineSpacing = 4
            para.paragraphSpacing = 12
            styled.addAttribute(.font, value: serif, range: full)
            styled.addAttribute(.foregroundColor, value: UIColor.label, range: full)
            styled.addAttribute(.paragraphStyle, value: para, range: full)
            cachedHTML = html
            cached = styled
            return styled
        }

        func applyHighlights(into text: NSMutableAttributedString) {
            let ns = text.string as NSString
            for hl in parent.highlights {
                let range = ns.range(of: hl.text)
                if range.location != NSNotFound {
                    text.addAttribute(.backgroundColor, value: UIColor.systemYellow.withAlphaComponent(0.35), range: range)
                    text.addAttribute(.init("hlid"), value: hl.id, range: range)
                }
            }
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let tv = textView, let onTap = parent.onTapHighlight else { return }
            let point = gesture.location(in: tv)
            guard let position = tv.closestPosition(to: point),
                  let range = tv.tokenizer.rangeEnclosingPosition(position, with: .character, inDirection: .layout(.right)) else { return }
            let offset = tv.offset(from: tv.beginningOfDocument, to: range.start)
            guard let attributed = tv.attributedText, offset >= 0, offset < attributed.length else { return }
            if let id = attributed.attribute(.init("hlid"), at: offset, effectiveRange: nil) as? String {
                onTap(id)
            }
        }

        // Custom "Highlight" edit-menu action
        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard range.length > 0, let onCreate = parent.onCreateHighlight else {
                return UIMenu(children: suggestedActions)
            }
            let selected = (textView.text as NSString).substring(with: range)
            let highlight = UIAction(title: "Highlight", image: UIImage(systemName: "highlighter")) { _ in
                onCreate(selected)
            }
            return UIMenu(children: [highlight] + suggestedActions)
        }
    }
}
